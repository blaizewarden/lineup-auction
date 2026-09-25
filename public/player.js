const main = $('#main');
const table = $('#table');
const muteBtn = $('#mute');
let view = null;
let lastSoldLot = null;

/* ---------- identity ---------- */
function saveIdentity(res, name) {
  App.myId = res.id;
  App.role = res.role;
  App.joinedAt = Date.now();
  localStorage.setItem('la-token', res.token);
  if (name) localStorage.setItem('la-name', name);
}
function forget() {
  App.myId = null; App.role = null;
  localStorage.removeItem('la-token');
}
function join(role) {
  const name = ($('#name') || {}).value || '';
  if (!name.trim()) { toast('Enter a name to join.', 'error'); return; }
  Sound.wake();
  socket.emit('join', { name, role }, res => {
    if (!res.ok) return toast(res.error, 'error');
    saveIdentity(res, name.trim());
    if (res.note) toast(res.note);
    render();
  });
}
socket.on('connect', () => {
  const tok = localStorage.getItem('la-token');
  const name = localStorage.getItem('la-name') || '';
  if (!tok) return;
  socket.emit('join', { token: tok, name, role: localStorage.getItem('la-role') || 'player' }, res => {
    if (res.ok) { saveIdentity(res, name); render(); }
    else { forget(); render(); }
  });
});

muteBtn.addEventListener('click', () => { Sound.toggle(); paintMute(); });
function paintMute() { muteBtn.textContent = Sound.on ? 'Sound on' : 'Muted'; }
paintMute();

/* ---------- helpers ---------- */
const me = () => App.state && App.state.players.find(p => p.id === App.myId);
const meJudge = () => App.state && App.state.judges.find(j => j.id === App.myId);
const isHost = () => App.state && App.state.hostId === App.myId;
const emit = (ev, data) => socket.emit(ev, data);

function shell(name, html) {
  if (view !== name) { main.innerHTML = html; view = name; main.querySelectorAll('[data-region]').forEach(r => { r._html = null; }); }
}

/* ---------- render ---------- */
App.onState.push(render);
function render() {
  const s = App.state;
  if (!s) return;

  // work out who I am from the live state
  if (App.myId) {
    if (me()) App.role = 'player';
    else if (meJudge()) App.role = 'judge';
    else if (Date.now() - (App.joinedAt || 0) > 3000) { forget(); }
    if (App.role) localStorage.setItem('la-role', App.role);
  }

  // header
  $('#catline').textContent = s.phase === 'lobby' ? s.lobbyCategory.name : s.meta.name;
  const p = me();
  $('#wallet').innerHTML = p && s.phase !== 'lobby'
    ? `<b>$${p.money}</b><span>${p.slotsLeft} slot${p.slotsLeft === 1 ? '' : 's'} left</span>`
    : (meJudge() ? '<span>Judge</span>' : '');

  if (!App.myId) return renderJoin(s);
  switch (s.phase) {
    case 'lobby': renderLobby(s); break;
    case 'bidding': renderBidding(s); break;
    case 'sold': renderSold(s); break;
    case 'voting': renderVoting(s); break;
    case 'results': renderResults(s); break;
  }
  setHTML(table, s.phase === 'lobby' ? '' : `<h3>Lineups</h3>${lineupsHTML(s, s.phase === 'voting' ? { voteBtn: voteButton } : {})}`);
}

/* ---------- join ---------- */
function renderJoin(s) {
  shell('join', `
    <section class="panel">
      <h2>Join the auction</h2>
      <label class="field"><span>Your name</span>
        <input class="input" id="name" maxlength="24" autocomplete="nickname" value="${esc(localStorage.getItem('la-name') || '')}">
      </label>
      <div class="row">
        <button class="btn grow" id="joinPlayer">Join as a player</button>
        <button class="btn plain grow" id="joinJudge">Join as a judge</button>
      </div>
      <p class="note" style="margin-top:12px">Judges don't bid. They vote on the best lineup at the end.</p>
    </section>
    <section class="panel" data-region id="joinPeople"></section>`);
  $('#joinPlayer').onclick = () => join('player');
  $('#joinJudge').onclick = () => join('judge');
  $('#name').onkeydown = e => { if (e.key === 'Enter') join(s.phase === 'lobby' ? 'player' : 'judge'); };
  const started = s.phase !== 'lobby';
  setHTML($('#joinPeople'), `
    <h2>${started ? 'Draft in progress' : 'In the lobby'}</h2>
    ${started ? '<p class="note">The draft has started. New arrivals join as judges.</p>' : ''}
    ${peopleHTML(s, false)}`);
}

function peopleHTML(s, controls) {
  const host = isHost();
  const row = (x, kind) => `
    <li>
      <span class="grow">${esc(x.name)}${x.id === App.myId ? ' (you)' : ''}</span>
      ${x.id === s.hostId ? '<span class="tag">Host</span>' : ''}
      ${kind === 'judge' ? '<span class="tag">Judge</span>' : ''}
      ${!x.connected ? '<span class="tag off">Away</span>' : ''}
      ${controls && host && x.id !== App.myId ? `<button class="btn ghost small" data-kick="${x.id}">Remove</button>` : ''}
    </li>`;
  return `
    <ul class="people">
      ${s.players.map(x => row(x, 'player')).join('') || '<li class="note">No players yet</li>'}
      ${s.judges.map(x => row(x, 'judge')).join('')}
    </ul>`;
}

/* ---------- lobby ---------- */
function renderLobby(s) {
  shell('lobby', `
    <section class="panel" data-region data-keep id="settingsBox"></section>
    <section class="panel" data-region id="peopleBox"></section>
    <section class="panel" data-region id="inviteBox"></section>`);

  const st = s.settings;
  if (isHost()) {
    const opts = s.categories.map(c => `<option value="${c.id}" ${c.id === st.categoryId ? 'selected' : ''}>${esc(c.name)}: ${esc(c.goal)}</option>`).join('');
    const enough = s.players.length >= 2;
    setHTML($('#settingsBox'), `
      <h2>Pick a category</h2>
      <label class="field">
        <select class="input" data-set="categoryId"><option value="random" ${st.categoryId === 'random' ? 'selected' : ''}>🎲 Random category</option>${opts}</select>
      </label>
      ${s.lobbyCategory.about ? `<p class="note">${esc(s.lobbyCategory.about)}</p>` : ''}
      <button class="btn pink wide" id="startBtn" ${enough ? '' : 'disabled'}>Start the draft</button>
      ${enough ? '' : '<p class="note" style="margin-top:8px">Waiting for at least one more player.</p>'}`);
    const box = $('#settingsBox');
    box.querySelectorAll('[data-set]').forEach(el => {
      const key = el.dataset.set;
      el.onchange = () => { emit('settings', { [key]: el.value }); el.blur(); };
    });
    $('#startBtn').onclick = () => { Sound.wake(); emit('start'); };
  } else {
    const hostName = (s.players.find(p => p.id === s.hostId) || {}).name || 'the host';
    setHTML($('#settingsBox'), `
      <h2>${esc(s.lobbyCategory.name)}</h2>
      <p>${esc(s.lobbyCategory.goal)}. $${st.budget} each, ${st.rosterSize} picks, ${st.timer} second bid timer.</p>
      ${s.lobbyCategory.about ? `<p class="note">${esc(s.lobbyCategory.about)}</p>` : ''}
      <p class="note">Items are drawn at random. Everyone gets one skip for when they're the last one left on an item.</p>
      <div class="status">Waiting for ${esc(hostName)} to start</div>`);
  }

  const amPlayer = !!me();
  setHTML($('#peopleBox'), `
    <h2>Who's in</h2>
    ${peopleHTML(s, true)}
    <div class="row">
      <button class="btn plain small" id="switchBtn">${amPlayer ? 'Switch to judge' : 'Switch to player'}</button>
      <button class="btn ghost small" id="leaveBtn">Leave</button>
    </div>`);
  $('#switchBtn').onclick = () => emit('switchRole');
  $('#leaveBtn').onclick = () => { emit('leave'); forget(); view = null; render(); };
  $('#peopleBox').querySelectorAll('[data-kick]').forEach(b => { b.onclick = () => emit('kick', b.dataset.kick); });

  setHTML($('#inviteBox'), `
    <h2>Get your mates in</h2>
    <div class="invite">
      ${s.qr ? `<img src="${s.qr}" alt="QR code to join">` : ''}
      <div><p class="note">Scan or open</p><code>${esc(s.joinUrl)}</code></div>
    </div>`);
}

/* ---------- bidding ---------- */
function renderBidding(s) {
  shell('bidding', `<div data-region id="lotBox"></div>
    <section class="panel">
      <div data-region id="bidBox"></div>
      <div data-region data-keep id="customBox"></div>
    </section>`);
  setHTML($('#lotBox'), lotHTML(s));

  const a = s.auction, p = me();
  let html = '', custom = '';
  if (!p) {
    html = `<h2>Watching</h2><p class="note">Judges watch the auction and vote at the end.</p>`;
  } else if (p.slotsLeft <= 0) {
    html = `<div class="status">Your lineup is full. Sit back and enjoy the chaos.</div>`;
  } else {
    const cap = p.maxBid;
    const leading = a.highBidderId === p.id;
    const passed = a.passed.includes(p.id);
    const open = !a.highBidderId;
    const next = open ? s.settings.minBid : a.highBid + 1;
    const base = open ? 0 : a.highBid;
    const can = v => !leading && !passed && v <= cap && v >= next;
    const final = a.finalId === p.id;
    const warn = !final ? ''
      : p.skipUsed ? `<div class="status warn">⚠️ Everyone else passed and you've used your skip. Bid now, or it's yours for $${s.settings.minBid} when the timer runs out.</div>`
      : `<div class="status warn">⚠️ Everyone else passed. Bid, or use your one skip for the game. If the timer runs out, it's yours for $${s.settings.minBid}.</div>`;
    if (passed) {
      html = `<div class="status">You passed on this one</div>`;
    } else {
      html = `
        ${warn || (leading ? '<div class="status">You hold the top bid</div>' : cap < next ? `<div class="status">You can't go above $${cap} on this one</div>` : '')}
        <div class="bids two">
          ${[1, 5].map(n => `<button class="btn" data-bid="${base + n}" ${can(base + n) ? '' : 'disabled'}><small>+$${n}</small><b>$${base + n}</b></button>`).join('')}
        </div>
        ${leading || (final && p.skipUsed) ? '' : `<button class="btn plain wide" id="passBtn" style="margin-bottom:10px">${final ? 'Use my one skip' : 'Pass'}</button>`}`;
    }
    if (!passed && !leading) custom = `
      <div class="custom-bid" style="grid-template-columns:1fr auto">
        <input class="input" id="customBid" type="number" inputmode="numeric" placeholder="Other amount">
        <button class="btn plain" id="customBtn">Bid</button>
      </div>`;
  }
  setHTML($('#bidBox'), html);
  setHTML($('#customBox'), custom);
  $('#bidBox').querySelectorAll('[data-bid]').forEach(b => { b.onclick = () => emit('bid', Number(b.dataset.bid)); });
  const pb = $('#passBtn'); if (pb) pb.onclick = () => emit('pass');
  const cb = $('#customBtn');
  if (cb) cb.onclick = () => {
    const v = Number($('#customBid').value);
    if (!v) return toast('Type an amount first.', 'error');
    emit('bid', v); $('#customBid').value = ''; $('#customBid').blur();
  };
  const ci = $('#customBid');
  if (ci) ci.onkeydown = e => { if (e.key === 'Enter') cb.click(); };
}

/* ---------- sold ---------- */
function renderSold(s) {
  shell('sold', `<div data-region id="soldBox"></div>`);
  setHTML($('#soldBox'), soldHTML(s));
  if (s.lastSale && lastSoldLot !== s.lastSale.lot) { lastSoldLot = s.lastSale.lot; if (!s.lastSale.unsold) Sound.sold(); if (navigator.vibrate && s.lastSale.winnerId === App.myId) navigator.vibrate([60, 40, 60]); }
}

/* ---------- voting ---------- */
function voteButton(p) {
  const s = App.state;
  if (!s.voterIds.includes(App.myId) || p.id === App.myId) return '';
  return `<button class="btn ${App._myVote === p.id ? 'pink' : 'plain'} wide small" style="margin-top:10px" onclick="castVote('${p.id}')">${App._myVote === p.id ? 'Your vote' : 'Vote for ' + esc(p.name)}</button>`;
}
function castVote(id) { App._myVote = id; emit('vote', id); render(); }

function renderVoting(s) {
  shell('voting', `<section class="panel" data-region id="voteBox"></section>`);
  const canVote = s.voterIds.includes(App.myId);
  const waiting = s.voterIds.length - s.votedIds.length;
  setHTML($('#voteBox'), `
    <h2>Pick the best lineup</h2>
    <p>${canVote ? 'Vote below. You can change your vote until voting closes.' : s.players.length === 2 ? 'The judges are voting.' : 'Voting is open.'}</p>
    <p class="note">${s.votedIds.length} of ${s.voterIds.length} votes in${waiting > 0 ? `, waiting on ${waiting}` : ''}.</p>
    ${isHost() ? '<button class="btn plain small" id="endVote">End voting now</button>' : ''}`);
  const ev = $('#endVote'); if (ev) ev.onclick = () => emit('endVoting');
}

/* ---------- results ---------- */
function renderResults(s) {
  App._myVote = null;
  shell('results', `<section class="panel" data-region id="resBox"></section>`);
  const r = s.results || {};
  let head, sub;
  if (r.voted && r.winners.length === 1) { head = `${esc(playerName(r.winners[0]))} wins`; sub = `${r.tally[r.winners[0]]} of ${r.totalVotes} votes.`; }
  else if (r.voted && r.winners.length > 1) { head = `Shared win: ${r.winners.map(id => esc(playerName(id))).join(' and ')}`; sub = `Tied on ${r.tally[r.winners[0]]} votes each.`; }
  else { head = 'Head to head. You decide.'; sub = 'No judges voted this time. Compare lineups and argue it out.'; }
  const canOpen = isHost() && !r.voted && s.voterIds.length > 0;
  setHTML($('#resBox'), `
    <h2>${head}</h2>
    <p>${sub}</p>
    <div class="row">
      <button class="btn grow" id="cardBtn">Save results card</button>
      ${canOpen ? '<button class="btn plain grow" id="openVote">Open voting</button>' : ''}
      ${isHost() ? '<button class="btn pink grow" id="againBtn">New game</button>' : ''}
    </div>
    ${isHost() && !r.voted && !canOpen ? '<p class="note" style="margin-top:10px">Want a verdict? Have someone scan the join code as a judge, then open voting.</p>' : ''}`);
  $('#cardBtn').onclick = () => showCard(s);
  const ov = $('#openVote'); if (ov) ov.onclick = () => emit('openVoting');
  const ag = $('#againBtn'); if (ag) ag.onclick = () => emit('backToLobby');
}
