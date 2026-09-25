/* Shared by the phone view and the board view */
const socket = io();
const App = { state: null, offset: 0, myId: null, role: null, onState: [] };

socket.on('state', s => {
  App.offset = s.serverNow - Date.now();
  App.state = s;
  App.onState.forEach(fn => fn(s));
});
const serverNow = () => Date.now() + App.offset;

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (sel, root = document) => root.querySelector(sel);
const playerName = id => { const p = App.state && App.state.players.find(x => x.id === id); return p ? p.name : 'Someone'; };

// Replace a region only when its markup changes, and never while someone is typing in it.
function setHTML(el, html) {
  if (!el || el._html === html) return;
  if (el.dataset.keep !== undefined && el.contains(document.activeElement) && document.activeElement !== document.body) return;
  el.innerHTML = html;
  el._html = html;
}

function toast(text, kind = '') {
  let t = $('#toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
  t.className = 'toast ' + kind;
  t.textContent = text;
  t.classList.remove('hidden');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add('hidden'), 3200);
}
socket.on('toast', t => toast(t.text, t.kind));

/* ---------- sound (synthesised, no files) ---------- */
const Sound = {
  ctx: null,
  on: localStorage.getItem('la-sound') !== 'off',
  wake() {
    if (!this.ctx) { try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; } }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  },
  tone(freq, dur = 0.12, type = 'square', vol = 0.08, delay = 0) {
    if (!this.on || !this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.ctx.destination); o.start(t); o.stop(t + dur + 0.02);
  },
  bid() { this.tone(660, 0.08); this.tone(990, 0.1, 'square', 0.07, 0.07); },
  tick() { this.tone(420, 0.09, 'triangle', 0.12); },
  sold() { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.22, 'sawtooth', 0.06, i * 0.09)); },
  turn() { this.tone(880, 0.14, 'triangle', 0.12); this.tone(1175, 0.2, 'triangle', 0.12, 0.14); },
  toggle() { this.on = !this.on; localStorage.setItem('la-sound', this.on ? 'on' : 'off'); this.wake(); return this.on; }
};
document.addEventListener('pointerdown', () => Sound.wake(), { passive: true });
socket.on('bidFx', () => Sound.bid());

/* ---------- lot name sizing ---------- */
function lotSize(name, big) {
  const n = String(name).length;
  const scale = big ? 1.6 : 1;
  const px = n <= 8 ? 70 : n <= 14 ? 58 : n <= 22 ? 46 : n <= 32 ? 38 : 30;
  return Math.round(px * scale);
}

/* ---------- countdowns (one loop drives every [data-ends] element) ---------- */
const clockMarks = {};
function tickClocks() {
  document.querySelectorAll('[data-ends]').forEach(el => {
    const ends = Number(el.dataset.ends), total = Number(el.dataset.total) || 1;
    const left = Math.max(0, ends - serverNow());
    const frac = Math.min(1, left / total);
    const fill = el.querySelector('.clock-fill');
    if (fill) fill.style.transform = `scaleX(${frac})`;
    const secs = el.querySelector('.clock-secs');
    if (secs) secs.textContent = Math.ceil(left / 1000) + 's';
    const call = el.querySelector('.clock-call');
    if (call) {
      const key = el.dataset.key || '';
      let text = '', stage = 0;
      if (left <= 0) { text = 'Sold'; stage = 3; }
      else if (frac <= 0.25) { text = 'Going twice'; stage = 2; }
      else if (frac <= 0.5) { text = 'Going once'; stage = 1; }
      if (call.textContent !== text) call.textContent = text;
      call.classList.toggle('hot', stage >= 2);
      if (el.dataset.sound !== undefined && stage > (clockMarks[key] || 0) && stage < 3) Sound.tick();
      clockMarks[key] = stage;
    }
  });
  requestAnimationFrame(tickClocks);
}
requestAnimationFrame(tickClocks);

/* ---------- shared markup ---------- */
function lotHTML(s, big = false) {
  const a = s.auction;
  if (!a) return '';
  const leading = a.highBidderId === App.myId;
  return `
    <div class="lot">
      <div class="lot-meta"><span>Lot ${a.lot}</span><span>Random draw</span></div>
      <div class="lot-name" style="font-size:${lotSize(a.item, big)}px">${esc(a.item)}</div>
      ${a.highBidderId
        ? `<div class="high ${leading ? 'mine' : ''}"><b>$${a.highBid}</b><span>${leading ? 'You' : esc(playerName(a.highBidderId))}</span></div>`
        : `<div class="high"><b>$${s.settings.minBid}</b><span>No bids yet</span></div>`}
      ${a.passed.length ? `<p class="note">Passed: ${a.passed.map(id => esc(playerName(id))).join(', ')}</p>` : ''}
      ${a.finalId ? `<p class="note">${esc(playerName(a.finalId))} is the only player with empty slots: bid, skip, or take it for $${s.settings.minBid}</p>` : ''}
      <div class="clock" data-ends="${a.endsAt}" data-total="${s.settings.timer * 1000}" data-key="lot${a.lot}-${a.bids}" data-sound>
        <div class="clock-track"><div class="clock-fill"></div></div>
        <div class="clock-call"></div>
      </div>
    </div>`;
}

function soldHTML(s, big = false) {
  const sale = s.lastSale;
  if (!sale) return '';
  const who = sale.winnerId === App.myId ? 'you' : esc(playerName(sale.winnerId));
  if (sale.unsold) return `
    <div class="lot">
      <div class="lot-meta"><span>Lot ${sale.lot}</span><span>No bids</span></div>
      <div class="lot-name" style="font-size:${lotSize(sale.item, big)}px">${esc(sale.item)}</div>
      <div class="high"><b>No takers</b><span>Back in the pile</span></div>
    </div>`;
  return `
    <div class="lot">
      <div class="lot-meta"><span>Lot ${sale.lot}</span><span>${sale.forced ? 'Last one left' : `${sale.bids} bid${sale.bids === 1 ? '' : 's'}`}</span></div>
      <div class="lot-name" style="font-size:${lotSize(sale.item, big)}px">${esc(sale.item)}</div>
      <div class="high"><b>$${sale.price}</b><span>to ${who}</span></div>
      <div class="stamp"><span>Sold</span></div>
    </div>`;
}

function lineupsHTML(s, opts = {}) {
  const size = s.settings.rosterSize;
  const res = s.results;
  return `<div class="lineups">${s.players.map(p => {
    const cls = [];
    if (s.phase === 'bidding' && s.auction && s.auction.highBidderId === p.id) cls.push('leading');
    const items = p.roster.map(r => `<li><span>${esc(r.item)}</span><em>${r.filled ? 'free' : '$' + r.price}</em></li>`).join('');
    const empties = Array.from({ length: Math.max(0, size - p.roster.length) }, () => '<li class="empty"><span>Empty slot</span><em></em></li>').join('');
    let note = '';
    if (s.phase !== 'lobby' && p.slotsLeft > 0 && !p.active && s.phase !== 'results' && s.phase !== 'voting') note = 'Out of money. Empty slots get filled free at the end.';
    else if (p.slotsLeft > 0 && s.phase !== 'lobby') note = `Can bid up to $${p.maxBid}`;
    const votes = res && res.voted ? `<div class="votes">${res.tally[p.id] || 0} vote${res.tally[p.id] === 1 ? '' : 's'}${res.winners.includes(p.id) ? ', winner' : ''}</div>` : '';
    const voteBtn = opts.voteBtn ? opts.voteBtn(p) : '';
    return `
      <article class="lineup ${cls.join(' ')}">
        <header><b>${esc(p.name)}${p.id === App.myId ? ' (you)' : ''}</b><span>$${p.money} left</span></header>
        ${votes}
        <ol>${items}${empties}</ol>
        ${note ? `<div class="slot-note">${note}</div>` : ''}
        ${voteBtn}
      </article>`;
  }).join('')}</div>`;
}

/* ---------- results card (1080 x 1920 PNG) ---------- */
const THEMES = {
  poster: { bg: '#1b3cff', band: null, title: '#ffd400', text: '#f5f6fa', accent: '#ff3d8b', sub: '#c9d1ff', price: '#ffd400' },
  team:   { bg: '#0d5c3a', band: '#11683f', title: '#f5f6fa', text: '#f5f6fa', accent: '#ffd400', sub: '#bfe3cf', price: '#ffd400' },
  list:   { bg: '#f5f6fa', band: null, title: '#0a0f3c', text: '#0a0f3c', accent: '#ff3d8b', sub: '#5a6190', price: '#1b3cff' }
};

function fitFont(ctx, text, maxW, size, family, weight = '') {
  let s = size;
  do { ctx.font = `${weight} ${s}px ${family}`.trim(); s -= 2; } while (ctx.measureText(text).width > maxW && s > 16);
  let t = text;
  while (ctx.measureText(t).width > maxW && t.length > 3) t = t.slice(0, -2) + '…';
  return t;
}

async function makeCard(s) {
  await Promise.all([document.fonts.load('80px Anton'), document.fonts.load('800 40px Archivo'), document.fonts.load('700 40px Archivo')]).catch(() => {});
  const W = 1080, H = 1920, PAD = 64;
  const style = (s.meta && s.meta.style) || 'list';
  const th = THEMES[style];
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = th.bg; ctx.fillRect(0, 0, W, H);
  if (th.band) { ctx.fillStyle = th.band; for (let y = 0; y < H; y += 160) ctx.fillRect(0, y, W, 80); }
  ctx.textBaseline = 'alphabetic';

  // header
  ctx.fillStyle = th.sub;
  ctx.font = '800 40px Archivo';
  ctx.fillText(s.meta.goal, PAD, 130);
  ctx.fillStyle = th.title;
  const title = fitFont(ctx, s.meta.name.toUpperCase(), W - PAD * 2, 120, 'Anton');
  ctx.fillText(title, PAD, 260);
  ctx.fillStyle = th.accent; ctx.fillRect(PAD, 292, W - PAD * 2, 10);

  // cells
  const n = s.players.length;
  const cols = n <= 2 ? n : 2, rows = Math.ceil(n / cols);
  const top = 350, bottom = H - 150, gap = 36;
  const cellW = (W - PAD * 2 - gap * (cols - 1)) / cols;
  const cellH = (bottom - top - gap * (rows - 1)) / rows;
  const size = s.settings.rosterSize;
  const res = s.results;

  s.players.forEach((p, i) => {
    const x = PAD + (i % cols) * (cellW + gap);
    const y0 = top + Math.floor(i / cols) * (cellH + gap);
    const won = res && res.voted && res.winners.includes(p.id);
    const lineH = Math.min(cols === 1 ? 150 : 130, (cellH - 150) / Math.max(size, 1));
    const itemSize = Math.max(18, Math.min(cols === 1 ? 80 : 58, lineH * 0.62));
    const used = 150 + lineH * (size + 0.4);
    const y = y0 + (rows === 1 ? Math.max(0, (cellH - used) / 3) : 0);

    // name row
    ctx.fillStyle = th.text;
    const label = style === 'poster' ? `${p.name}'s stage` : style === 'team' ? `${p.name} XI` : p.name;
    ctx.fillText(fitFont(ctx, label.toUpperCase(), cellW - 10, 64, 'Anton'), x, y + 64);
    ctx.fillStyle = th.sub; ctx.font = '700 30px Archivo';
    let sub = `$${p.money} left`;
    if (res && res.voted) sub += `   ${res.tally[p.id] || 0} vote${res.tally[p.id] === 1 ? '' : 's'}`;
    ctx.fillText(sub, x, y + 108);
    if (won) {
      ctx.font = '800 30px Archivo';
      const w = ctx.measureText('Winner').width + 30;
      ctx.fillStyle = th.accent; ctx.fillRect(x + cellW - w, y + 80, w, 42);
      ctx.fillStyle = style === 'list' ? '#fff' : th.bg; ctx.fillText('Winner', x + cellW - w + 15, y + 111);
    }

    // items, most expensive first (headliner up top)
    const items = [...p.roster].sort((a, b) => b.price - a.price);
    items.forEach((r, k) => {
      const iy = y + 150 + lineH * (k + 1) - lineH * 0.25;
      const priceText = r.filled ? 'free' : `$${r.price}`;
      ctx.font = `800 ${Math.round(itemSize * 0.62)}px Archivo`;
      const pw = ctx.measureText(priceText).width;
      let prefix = '';
      if (style === 'team') prefix = `${k + 1}  `;
      if (style === 'list') prefix = `${k + 1}. `;
      const head = style === 'poster' && k === 0;
      const fs = head ? itemSize * 1.25 : itemSize;
      ctx.fillStyle = head ? th.title : th.text;
      const txt = fitFont(ctx, (prefix + r.item).toUpperCase(), cellW - pw - 24, Math.round(fs), 'Anton');
      ctx.fillText(txt, x, iy);
      ctx.fillStyle = th.price; ctx.font = `800 ${Math.round(itemSize * 0.62)}px Archivo`;
      ctx.fillText(priceText, x + cellW - pw, iy);
    });
  });

  // footer
  ctx.fillStyle = th.accent; ctx.fillRect(PAD, H - 118, W - PAD * 2, 6);
  ctx.fillStyle = th.sub; ctx.font = '800 34px Archivo';
  ctx.fillText('Lineup Auction', PAD, H - 60);
  const when = new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
  const ww = ctx.measureText(when).width;
  ctx.fillText(when, W - PAD - ww, H - 60);
  return c;
}

async function showCard(s) {
  const canvas = await makeCard(s);
  const url = canvas.toDataURL('image/png');
  const m = document.createElement('div');
  m.className = 'modal';
  m.innerHTML = `<div class="modal-inner">
      <img src="${url}" alt="Results card">
      <p class="note" style="color:#f5f6fa">On a phone, press and hold the image to save it.</p>
      <div class="row" style="justify-content:center">
        <a class="btn" href="${url}" download="lineup-auction.png">Download</a>
        <button class="btn plain" data-close>Close</button>
      </div></div>`;
  m.addEventListener('click', e => { if (e.target === m || e.target.hasAttribute('data-close')) m.remove(); });
  document.body.appendChild(m);
}
