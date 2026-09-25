const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const QRCode = require('qrcode');
const { Server } = require('socket.io');
const store = require('./store');

const PORT = Number(process.env.PORT) || 3000;
const SOLD_PAUSE_MS = 2800;
const HOST_HANDOVER_MS = 20000;
const MAX_PLAYERS = 8;
const VERSION = String(Date.now()); // changes on every deploy, so open pages know to reload

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.use('/fonts', express.static(path.join(__dirname, 'node_modules', '@fontsource')));
app.get('/board', (req, res) => res.sendFile(path.join(__dirname, 'public', 'board.html')));
app.get('/stats', (req, res) => res.sendFile(path.join(__dirname, 'public', 'stats.html')));
app.get('/api/stats', (req, res) => res.json(store.stats()));

// ---------- categories ----------
function loadCategories() {
  const dir = path.join(__dirname, 'categories');
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .sort()
    .map(f => {
      const data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      return {
        id: f.replace(/\.json$/, ''),
        name: data.name,
        goal: data.goal || data.name,
        about: data.about || '',
        details: data.details || {},
        style: ['poster', 'team', 'list'].includes(data.style) ? data.style : 'list',
        items: [...new Set((data.items || []).map(s => String(s).trim()).filter(Boolean))]
      };
    });
}
const CATEGORIES = loadCategories();

// ---------- network ----------
function lanAddress() {
  const nets = os.networkInterfaces();
  const found = [];
  for (const list of Object.values(nets)) {
    for (const n of list || []) {
      if (n.family === 'IPv4' && !n.internal) found.push(n.address);
    }
  }
  const rank = a => a.startsWith('192.168.') ? 0 : a.startsWith('10.') ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(a) ? 2 : 3;
  found.sort((a, b) => rank(a) - rank(b));
  return found[0] || 'localhost';
}
const JOIN_URL = process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || `http://${lanAddress()}:${PORT}`;
let JOIN_QR = '';
QRCode.toDataURL(JOIN_URL, { margin: 1, width: 480, color: { dark: '#0A0F3C', light: '#FFFFFF' } })
  .then(url => { JOIN_QR = url; });

// ---------- helpers ----------
const token = () => crypto.randomBytes(12).toString('hex');
const shortId = () => crypto.randomBytes(4).toString('hex');
const cleanText = (s, max) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, max);
const norm = s => cleanText(s, 80).toLowerCase();
const shuffle = arr => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; };

// ---------- state ----------
function defaultSettings() {
  return {
    categoryId: 'random',
    budget: 100,
    rosterSize: 5,
    minBid: 1,
    timer: 10
  };
}

const game = {
  phase: 'lobby', // lobby | bidding | sold | voting | results
  settings: defaultSettings(),
  players: [],   // {id, token, name, money, roster:[{item, price, filled}], connected}
  judges: [],    // {id, token, name, connected}
  hostId: null,
  meta: { name: '', goal: '', style: 'list' },
  pool: [],      // remaining listed items
  taken: new Set(),
  turnIndex: 0,
  turnId: null,
  auction: null, // {lot, item, highBid, highBidderId, nominatorId, endsAt}
  lot: 0,
  lastSale: null,
  history: [],
  votes: {},     // voterId -> playerId
  results: null,
  timers: { auction: null, sold: null, host: null }
};

function clearTimers() {
  for (const k of ['auction', 'sold']) {
    if (game.timers[k]) clearTimeout(game.timers[k]);
    game.timers[k] = null;
  }
}

const playerById = id => game.players.find(p => p.id === id);
const judgeById = id => game.judges.find(j => j.id === id);
const slotsLeft = p => game.settings.rosterSize - p.roster.length;

function maxBid(p) {
  const s = game.settings;
  const left = slotsLeft(p);
  if (left <= 0) return 0;
  // always keep the minimum bid for every other empty slot
  return Math.max(0, p.money - s.minBid * (left - 1));
}
const canPlay = p => slotsLeft(p) > 0 && maxBid(p) >= game.settings.minBid;

function eligibleVoters() {
  const voters = game.judges.map(j => j.id);
  if (game.players.length >= 3) voters.push(...game.players.map(p => p.id));
  return voters;
}

// ---------- broadcast ----------
function publicState() {
  const s = game.settings;
  const cat = CATEGORIES.find(c => c.id === s.categoryId);
  return {
    phase: game.phase,
    settings: s,
    categories: CATEGORIES.map(c => ({ id: c.id, name: c.name, goal: c.goal, about: c.about, count: c.items.length })),
    lobbyCategory: cat ? { name: cat.name, goal: cat.goal, about: cat.about }
      : { name: 'Random category', goal: 'Revealed when the draft starts' },
    meta: game.meta,
    hostId: game.hostId,
    profiles: store.data.profiles,
    players: game.players.map(p => ({
      id: p.id, name: p.name, money: p.money, roster: p.roster, connected: p.connected,
      slotsLeft: slotsLeft(p), maxBid: maxBid(p), active: game.phase !== 'lobby' && canPlay(p), skipUsed: !!p.skipUsed
    })),
    judges: game.judges.map(j => ({ id: j.id, name: j.name, connected: j.connected })),
    turnId: game.turnId,
    auction: game.auction && { ...game.auction, finalId: finalBidderId(game.auction) },
    lastSale: game.lastSale,
    pool: game.pool,
    history: game.history.slice(-8),
    votedIds: Object.keys(game.votes),
    voterIds: eligibleVoters(),
    results: game.results,
    serverNow: Date.now(),
    version: VERSION,
    joinUrl: JOIN_URL,
    qr: JOIN_QR
  };
}
let broadcastQueued = false;
function broadcast() {
  if (broadcastQueued) return;
  broadcastQueued = true;
  setImmediate(() => { broadcastQueued = false; io.emit('state', publicState()); });
}

// ---------- flow ----------
function startGame() {
  const s = game.settings;
  const cat = s.categoryId === 'random'
    ? CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)]
    : CATEGORIES.find(c => c.id === s.categoryId);
  game.meta = { name: cat.name, goal: cat.goal, about: cat.about, style: cat.style };
  game.id = Date.now();
  game.pool = [...cat.items];
  game.details = cat.details;
  game.returnedAt = {};
  game.taken = new Set();
  game.history = [];
  game.lot = 0;
  game.lastSale = null;
  game.votes = {};
  game.results = null;
  game.auction = null;
  for (const p of game.players) { p.money = s.budget; p.roster = []; p.skipUsed = false; }
  game.turnIndex = Math.floor(Math.random() * game.players.length) - 1;
  nextTurn();
}

function nextTurn() {
  clearTimers();
  game.auction = null;
  const active = game.players.filter(canPlay);
  if (active.length === 0 || game.pool.length === 0) return endDraft();

  // rotate to next active player
  for (let i = 1; i <= game.players.length; i++) {
    const idx = (game.turnIndex + i) % game.players.length;
    if (canPlay(game.players[idx])) { game.turnIndex = idx; break; }
  }
  const turnPlayer = game.players[game.turnIndex];
  game.turnId = turnPlayer.id;

  // fresh items first; passed items only come back once the fresh ones run out, oldest first
  const fresh = game.pool.filter(x => !(x in game.returnedAt));
  let choices = fresh;
  if (!fresh.length) {
    const oldest = Math.min(...game.pool.map(x => game.returnedAt[x]));
    choices = game.pool.filter(x => game.returnedAt[x] === oldest);
  }
  startAuction(choices[Math.floor(Math.random() * choices.length)], turnPlayer);
}

// lowest bid that would beat the current one
const nextMinBid = a => a.highBidderId ? a.highBid + 1 : game.settings.minBid;

// players who could still make a bid on this lot
function stillIn(a) {
  const need = nextMinBid(a);
  return game.players.filter(p => p.id !== a.highBidderId && !a.passed.includes(p.id) && slotsLeft(p) > 0 && maxBid(p) >= need);
}

// once only one player in the game still has empty slots, they get one skip,
// after that anything they don't bid on is theirs at the minimum
function finalBidderId(a) {
  if (a.highBidderId) return null;
  const active = game.players.filter(canPlay);
  return active.length === 1 && stillIn(a).some(p => p.id === active[0].id) ? active[0].id : null;
}

// full timer while someone can still bid, otherwise wrap it up quickly
function refreshAuctionClock() {
  scheduleAuctionEnd(stillIn(game.auction).length ? game.settings.timer * 1000 : 1500);
}

function scheduleAuctionEnd(ms) {
  if (game.timers.auction) clearTimeout(game.timers.auction);
  game.auction.endsAt = Date.now() + ms;
  game.timers.auction = setTimeout(sell, ms);
}

function startAuction(item, nominator) {
  clearTimers();
  const s = game.settings;
  game.lot += 1;
  game.auction = {
    lot: game.lot,
    item,
    desc: (game.details || {})[item] || '',
    highBid: 0,
    highBidderId: null,
    nominatorId: nominator.id,
    bids: 0,
    passed: [],
    endsAt: 0
  };
  game.phase = 'bidding';
  // remove from pool now so it can't come up twice
  game.pool = game.pool.filter(x => norm(x) !== norm(item));
  game.taken.add(norm(item));
  refreshAuctionClock();
  broadcast();
}

function sell() {
  const a = game.auction;
  if (!a || game.phase !== 'bidding') return;
  clearTimers();
  // the last player left didn't skip, so it's theirs at the minimum
  const finalId = finalBidderId(a);
  if (finalId) { a.highBidderId = finalId; a.highBid = game.settings.minBid; a.forced = true; }
  const winner = playerById(a.highBidderId);
  if (winner) {
    winner.money -= a.highBid;
    winner.roster.push({ item: a.item, price: a.highBid });
    game.lastSale = { lot: a.lot, item: a.item, price: a.highBid, winnerId: a.highBidderId, bids: a.bids, forced: !!a.forced };
    game.history.push(game.lastSale);
  } else {
    // no takers: back in the pile
    game.taken.delete(norm(a.item));
    if (!game.pool.some(x => norm(x) === norm(a.item))) game.pool.push(a.item);
    game.returnedAt[a.item] = a.lot;
    game.lastSale = { lot: a.lot, item: a.item, price: 0, winnerId: null, bids: 0, unsold: true };
  }
  game.phase = 'sold';
  broadcast();
  game.timers.sold = setTimeout(() => { nextTurn(); broadcast(); }, SOLD_PAUSE_MS);
}

function endDraft(early = false) {
  clearTimers();
  game.auction = null;
  game.turnId = null;
  // broke players with open slots get random leftovers at $0 (ending early leaves them empty)
  for (const p of early ? [] : game.players) {
    while (slotsLeft(p) > 0) {
      let item;
      if (game.pool.length) {
        const i = Math.floor(Math.random() * game.pool.length);
        item = game.pool.splice(i, 1)[0];
        game.taken.add(norm(item));
      } else {
        item = 'Empty slot';
      }
      p.roster.push({ item, price: 0, filled: true });
    }
  }
  game.votes = {};
  if (eligibleVoters().length > 0) {
    game.phase = 'voting';
    game.results = null;
  } else {
    finishResults(false);
  }
  broadcast();
}

function finishResults(voted) {
  const tally = {};
  for (const p of game.players) tally[p.id] = 0;
  for (const target of Object.values(game.votes)) if (target in tally) tally[target] += 1;
  const totalVotes = Object.values(game.votes).length;
  let winners = [];
  if (voted && totalVotes > 0) {
    const top = Math.max(...Object.values(tally));
    winners = Object.keys(tally).filter(id => tally[id] === top);
  }
  game.results = { voted: voted && totalVotes > 0, tally, winners, totalVotes };
  game.phase = 'results';
  store.recordGame({
    id: game.id,
    at: new Date().toISOString(),
    category: game.meta.name,
    voted: game.results.voted,
    players: game.players.map(p => ({
      name: p.name,
      votes: tally[p.id] || 0,
      won: winners.includes(p.id),
      spent: game.settings.budget - p.money,
      roster: p.roster.map(r => r.item)
    }))
  });
}

function maybeCloseVoting() {
  if (game.phase !== 'voting') return;
  const voters = eligibleVoters();
  const connectedVoters = voters.filter(id => {
    const p = playerById(id) || judgeById(id);
    return p && p.connected;
  });
  if (connectedVoters.length > 0 && connectedVoters.every(id => game.votes[id])) {
    finishResults(true);
  }
}

function backToLobby() {
  clearTimers();
  game.phase = 'lobby';
  game.auction = null;
  game.turnId = null;
  game.lastSale = null;
  game.history = [];
  game.votes = {};
  game.results = null;
  game.pool = [];
  for (const p of game.players) { p.money = game.settings.budget; p.roster = []; }
}

function ensureHost() {
  const host = playerById(game.hostId);
  if (host) return;
  const next = game.players.find(p => p.connected) || game.players[0];
  game.hostId = next ? next.id : null;
}

// ---------- sockets ----------
io.on('connection', socket => {
  socket.emit('state', publicState());

  const me = () => {
    const pid = socket.data.pid;
    if (!pid) return null;
    return playerById(pid) || judgeById(pid) || null;
  };
  const isHost = () => socket.data.pid && socket.data.pid === game.hostId;
  const fail = msg => socket.emit('toast', { kind: 'error', text: msg });

  socket.on('join', (data = {}, ack = () => {}) => {
    const role = data.role === 'judge' ? 'judge' : data.role === 'board' ? 'board' : 'player';
    if (role === 'board') { socket.data.pid = null; return ack({ ok: true, role: 'board' }); }

    const tok = cleanText(data.token, 64);
    const name = cleanText(data.name, 24);

    // 1. reconnect by token
    let person = tok && (game.players.find(p => p.token === tok) || game.judges.find(j => j.token === tok));
    // 2. reconnect by name to a disconnected seat
    if (!person && name) {
      const match = [...game.players, ...game.judges].find(p => norm(p.name) === norm(name));
      if (match && !match.connected) person = match;
      else if (match) return ack({ ok: false, error: `${match.name} is already in the game. Pick another name.` });
    }
    if (person) {
      person.connected = true;
      socket.data.pid = person.id;
      if (game.hostId === person.id && game.timers.host) { clearTimeout(game.timers.host); game.timers.host = null; }
      ensureHost();
      broadcast();
      socket.emit('state', publicState());
      return ack({ ok: true, id: person.id, token: person.token, role: playerById(person.id) ? 'player' : 'judge' });
    }

    if (!name) return ack({ ok: false, error: 'Enter a name to join.' });

    let finalRole = role;
    let note = null;
    if (role === 'player' && game.phase !== 'lobby') { finalRole = 'judge'; note = 'The draft has started, so you joined as a judge.'; }
    if (role === 'player' && game.players.length >= MAX_PLAYERS) { finalRole = 'judge'; note = 'The game is full, so you joined as a judge.'; }

    const seat = { id: shortId(), token: token(), name, connected: true };
    if (finalRole === 'player') {
      seat.name = store.addProfile(name);
      Object.assign(seat, { money: game.settings.budget, roster: [] });
      game.players.push(seat);
    } else {
      game.judges.push(seat);
    }
    socket.data.pid = seat.id;
    ensureHost();
    maybeCloseVoting();
    broadcast();
    socket.emit('state', publicState());
    ack({ ok: true, id: seat.id, token: seat.token, role: finalRole, note });
  });

  socket.on('leave', () => {
    const p = me();
    if (!p) return;
    if (game.phase === 'lobby') {
      game.players = game.players.filter(x => x.id !== p.id);
      game.judges = game.judges.filter(x => x.id !== p.id);
      socket.data.pid = null;
      ensureHost();
    } else if (judgeById(p.id)) {
      game.judges = game.judges.filter(x => x.id !== p.id);
      delete game.votes[p.id];
      socket.data.pid = null;
      maybeCloseVoting();
    }
    broadcast();
  });

  socket.on('switchRole', () => {
    const p = me();
    if (!p || game.phase !== 'lobby') return;
    if (playerById(p.id)) {
      game.players = game.players.filter(x => x.id !== p.id);
      game.judges.push({ id: p.id, token: p.token, name: p.name, connected: true });
      ensureHost();
    } else {
      if (game.players.length >= MAX_PLAYERS) return fail('The game is full.');
      game.judges = game.judges.filter(x => x.id !== p.id);
      store.addProfile(p.name);
      game.players.push({ id: p.id, token: p.token, name: p.name, connected: true, money: game.settings.budget, roster: [] });
      ensureHost();
    }
    broadcast();
  });

  socket.on('kick', id => {
    if (!isHost() || game.phase !== 'lobby' || id === game.hostId) return;
    game.players = game.players.filter(x => x.id !== id);
    game.judges = game.judges.filter(x => x.id !== id);
    broadcast();
  });

  // host tidies up profiles from the lobby; people in the room can't be changed
  const inRoom = name => [...game.players, ...game.judges].some(x => norm(x.name) === norm(name));
  socket.on('deleteProfile', name => {
    if (!isHost() || game.phase !== 'lobby') return;
    if (inRoom(name)) return fail(`${name} is in the room. Remove them first.`);
    if (store.deleteProfile(String(name))) broadcast();
  });
  socket.on('mergeProfile', ({ from, into } = {}) => {
    if (!isHost() || game.phase !== 'lobby') return;
    if (inRoom(from)) return fail(`${from} is in the room. Remove them first.`);
    if (store.mergeProfile(String(from), String(into))) broadcast();
  });

  socket.on('settings', (patch = {}) => {
    if (!isHost() || game.phase !== 'lobby') return;
    const s = game.settings;
    if ('categoryId' in patch) {
      const id = String(patch.categoryId);
      if (id === 'random' || CATEGORIES.some(c => c.id === id)) s.categoryId = id;
    }
    for (const p of game.players) p.money = s.budget;
    broadcast();
  });

  socket.on('start', () => {
    if (!isHost() || game.phase !== 'lobby') return;
    const s = game.settings;
    if (game.players.length < 2) return fail('You need at least 2 players to start.');
    startGame();
    broadcast();
  });

  socket.on('bid', raw => {
    const p = me();
    const a = game.auction;
    if (!p || !playerById(p.id) || game.phase !== 'bidding' || !a) return;
    const amount = Math.round(Number(raw));
    if (!Number.isFinite(amount)) return;
    if (a.highBidderId === p.id) return fail('You already hold the top bid.');
    if (a.passed.includes(p.id)) return fail('You passed on this one.');
    if (slotsLeft(p) <= 0) return fail('Your lineup is full.');
    if (amount < nextMinBid(a)) return fail(a.highBidderId ? `Bid more than $${a.highBid}.` : `The opening bid is at least $${game.settings.minBid}.`);
    const cap = maxBid(p);
    if (amount > cap) {
      return fail(`Your max is $${cap}. You need to keep $${game.settings.minBid} for each empty slot.`);
    }
    a.highBid = amount;
    a.highBidderId = p.id;
    a.bids += 1;
    refreshAuctionClock();
    io.emit('bidFx', { by: p.id, amount });
    broadcast();
  });

  socket.on('pass', () => {
    const p = me();
    const a = game.auction;
    if (!p || !playerById(p.id) || game.phase !== 'bidding' || !a) return;
    if (a.highBidderId === p.id) return fail('You hold the top bid, so you can\'t pass.');
    if (a.passed.includes(p.id)) return;
    if (finalBidderId(a) === p.id) {
      if (p.skipUsed) return fail(`You've used your skip. Bid, or it's yours for $${game.settings.minBid} when the timer runs out.`);
      p.skipUsed = true;
    }
    a.passed.push(p.id);
    // restart the clock when someone becomes the last one left, or wrap up when nobody is
    if (finalBidderId(a) || !stillIn(a).length) refreshAuctionClock();
    broadcast();
  });

  socket.on('vote', targetId => {
    const p = me();
    if (!p || game.phase !== 'voting') return;
    if (!eligibleVoters().includes(p.id)) return fail('Only judges vote in a 2 player game.');
    if (targetId === p.id) return fail("You can't vote for yourself.");
    if (!playerById(targetId)) return;
    game.votes[p.id] = targetId;
    maybeCloseVoting();
    broadcast();
  });

  socket.on('endVoting', () => {
    if (!isHost() || game.phase !== 'voting') return;
    finishResults(true);
    broadcast();
  });

  socket.on('openVoting', () => {
    if (!isHost() || game.phase !== 'results') return;
    if (eligibleVoters().length === 0) return fail('Nobody can vote yet. Get a mate to scan the code and join as a judge.');
    game.votes = {};
    game.results = null;
    game.phase = 'voting';
    broadcast();
  });

  socket.on('endGame', () => {
    if (!isHost() || !['bidding', 'sold'].includes(game.phase)) return;
    endDraft(true);
  });

  socket.on('backToLobby', () => {
    if (!isHost()) return;
    backToLobby();
    broadcast();
  });

  socket.on('disconnect', () => {
    const p = me();
    if (!p) return;
    const stillHere = [...io.sockets.sockets.values()].some(s => s.id !== socket.id && s.data.pid === p.id);
    if (stillHere) return;
    p.connected = false;
    if (p.id === game.hostId) {
      if (game.timers.host) clearTimeout(game.timers.host);
      game.timers.host = setTimeout(() => {
        game.timers.host = null;
        const host = playerById(game.hostId);
        if (host && !host.connected) {
          const next = game.players.find(x => x.connected);
          if (next) { game.hostId = next.id; broadcast(); }
        }
      }, HOST_HANDOVER_MS);
    }
    maybeCloseVoting();
    broadcast();
  });
});

store.load().then(() => server.listen(PORT, '0.0.0.0', () => {
  console.log('\n  Lineup Auction is running\n');
  console.log(`  Phones join at:   ${JOIN_URL}`);
  console.log(`  Big screen board: ${JOIN_URL}/board\n`);
  console.log(process.env.PUBLIC_URL ? '  Send that link to your mates. Close this window to stop.\n' : '  Everyone must be on the same wifi. Close this window to stop.\n');
  if (!process.env.NO_OPEN) {
    const url = `http://localhost:${PORT}/board`;
    const cmd = process.platform === 'darwin' ? `open "${url}"` : process.platform === 'win32' ? `start "" "${url}"` : `xdg-open "${url}"`;
    require('child_process').exec(cmd, () => {});
  }
}));

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  Port ${PORT} is already in use. Close the other copy, or start on another port:\n  PORT=3001 npm start\n`);
    process.exit(1);
  }
  throw err;
});
