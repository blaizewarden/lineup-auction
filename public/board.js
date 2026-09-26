const stage = $('#stage');
const side = $('#side');
const muteBtn = $('#mute');
let lastSoldLot = null;

socket.on('connect', () => socket.emit('join', { role: 'board' }, () => {}));
muteBtn.addEventListener('click', () => { Sound.toggle(); paintMute(); });
function paintMute() { muteBtn.textContent = Sound.on ? 'Sound on (tap anywhere to enable)' : 'Muted'; }
paintMute();

App.onState.push(s => {
  $('#catline').textContent = s.phase === 'lobby' ? s.lobbyCategory.name : `${s.meta.name}: ${s.meta.goal}`;
  const st = s.settings;
  let html = '';

  if (s.phase === 'lobby') {
    html = `
      <div class="panel board-join">
        <img src="/qr.png" alt="QR code to join">
        <div>
          <h2>Scan to join</h2>
          <p>Scan or open</p>
          <code>${esc(s.joinUrl)}</code>
          <p class="note" style="margin-top:14px">${esc(s.lobbyCategory.name)}. $${st.budget} each, ${st.rosterSize} picks, ${st.timer} second timer.</p>
          ${s.lobbyCategory.about ? `<p class="note">${esc(s.lobbyCategory.about)}</p>` : ''}
        </div>
      </div>`;
  } else if (s.phase === 'bidding') {
    html = lotHTML(s, true);
  } else if (s.phase === 'sold') {
    html = soldHTML(s, true);
    if (s.lastSale && lastSoldLot !== s.lastSale.lot) { lastSoldLot = s.lastSale.lot; if (!s.lastSale.unsold) Sound.sold(); }
  } else if (s.phase === 'voting') {
    html = `
      <div class="panel board-join">
        <img src="/qr.png" alt="QR code to join as a judge">
        <div>
          <h2>Voting is open</h2>
          <p>${s.votedIds.length} of ${s.voterIds.length} votes in.</p>
          <p class="note">Anyone can scan and join as a judge to vote.</p>
        </div>
      </div>`;
  } else if (s.phase === 'results') {
    const r = s.results || {};
    const head = r.voted
      ? (r.winners.length === 1 ? `${esc(playerName(r.winners[0]))} wins` : `Shared win: ${r.winners.map(id => esc(playerName(id))).join(' and ')}`)
      : 'Head to head. You decide.';
    html = `
      <div class="lot">
        <div class="lot-meta"><span>Final</span><span>${r.voted ? `${r.totalVotes} votes` : 'No votes'}</span></div>
        <div class="lot-name" style="font-size:96px">${head}</div>
        <button class="btn pink" id="cardBtn">Save results card</button>
      </div>`;
  }
  setHTML(stage, html);
  const cb = $('#cardBtn'); if (cb) cb.onclick = () => showCard(s);

  const recent = s.history.slice().reverse().map(h => `<li><span>${esc(h.item)}</span><em>$${h.price} to ${esc(playerName(h.winnerId))}</em></li>`).join('');
  setHTML(side, s.phase === 'lobby'
    ? `<div class="panel"><h2>Who's in</h2><ul class="people">${s.players.map(p => `<li>${esc(p.name)}${p.id === s.hostId ? ' <span class="tag">Host</span>' : ''}</li>`).join('') || '<li class="note">Nobody yet</li>'}${s.judges.map(j => `<li>${esc(j.name)} <span class="tag">Judge</span></li>`).join('')}</ul></div>`
    : `${lineupsHTML(s)}${recent ? `<div class="lineup" style="margin-top:14px"><header><b>Recent sales</b></header><ol>${recent}</ol></div>` : ''}`);
});
