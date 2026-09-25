const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const main = document.getElementById('main');

function board(title, rows, value, empty) {
  const items = rows.map(r => `<li>${esc(r.name)}<em>${value(r)}</em></li>`).join('');
  return `<section class="panel"><h2>${title}</h2>${items ? `<ol>${items}</ol>` : `<p class="note">${empty}</p>`}</section>`;
}

fetch('/api/stats').then(r => r.json()).then(s => {
  const need = `Needs ${s.minGames}+ games with voting`;
  const b = s.boards;
  const together = s.together.map(t => `<li>${esc(t.names.join(' & '))}<em>${t.games} game${t.games === 1 ? '' : 's'}</em></li>`).join('');
  const rows = s.players.map(p => `
    <tr><td>${esc(p.name)}</td><td>${p.played}</td><td>${p.wins}</td>
    <td>${p.winPct == null ? '–' : p.winPct + '%'}</td><td>${p.votesPerGame == null ? '–' : p.votesPerGame}</td></tr>`).join('');
  const recent = s.recent.map(g => `
    <li><b>${esc(g.category)}</b> <span class="note">${new Date(g.at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}</span><br>
    ${g.voted ? (g.winners.length ? 'Won by ' + esc(g.winners.join(' & ')) : 'No winner') : 'No vote'} · ${esc(g.players.join(', '))}</li>`).join('');

  main.innerHTML = `
    <p style="margin:0 0 14px">${s.totalGames} game${s.totalGames === 1 ? '' : 's'} played. Win % and votes per game only count people with ${s.minGames}+ games that had voting.</p>
    <div class="stats-grid">
      ${board('Most played', b.mostPlayed, r => r.played, 'No games yet')}
      ${board('Best win %', b.bestWin, r => r.winPct + '%', need)}
      ${board('Worst win %', b.worstWin, r => r.winPct + '%', need)}
      ${board('Most votes per game', b.bestVotes, r => r.votesPerGame, need)}
      ${board('Fewest votes per game', b.worstVotes, r => r.votesPerGame, need)}
      <section class="panel"><h2>Played together most</h2>${together ? `<ol>${together}</ol>` : '<p class="note">No games yet</p>'}</section>
    </div>
    <section class="panel"><h2>Everyone</h2>
      <div class="table-wrap"><table class="stats-table">
        <thead><tr><th>Player</th><th>Played</th><th>Wins</th><th>Win %</th><th>Votes/game</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    </section>
    <section class="panel"><h2>Recent games</h2>${recent ? `<ol class="stats-recent">${recent}</ol>` : '<p class="note">No games yet</p>'}</section>`;
}).catch(() => { main.innerHTML = '<section class="panel"><p>Couldn\'t load stats. Try again in a moment.</p></section>'; });
