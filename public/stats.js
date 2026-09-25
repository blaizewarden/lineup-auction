const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const main = document.getElementById('main');

// a leaderboard card: rows are [label, value] pairs
function card(title, rows, empty, sub = '') {
  const items = rows.map(([label, value]) => `<li>${label}<em>${value}</em></li>`).join('');
  return `<section class="panel"><h2>${title}</h2>${sub ? `<p class="note">${sub}</p>` : ''}${items ? `<ol>${items}</ol>` : `<p class="note">${empty}</p>`}</section>`;
}
const people = (list, value) => list.map(r => [esc(r.name), value(r)]);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

fetch('/api/stats').then(r => r.json()).then(s => {
  const b = s.boards;
  const need = `Needs ${s.minGames}+ games`;
  const none = 'No games yet';
  const withCat = s.players.filter(p => p.bestCategory);
  const withSig = s.players.filter(p => p.signature);

  const rows = s.players.map(p => `
    <tr><td>${esc(p.name)}</td><td>${p.played}</td><td>${p.wins}</td>
    <td>${p.winPct == null ? '–' : p.winPct + '%'}</td><td>${p.votesPerGame ?? '–'}</td>
    <td>${p.avgSpent == null ? '–' : '$' + p.avgSpent}</td><td>${p.bestStreak || '–'}</td></tr>`).join('');
  const recent = s.recent.map(g => `
    <li><b>${esc(g.category)}</b> <span class="note">${new Date(g.at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}</span><br>
    ${g.voted ? (g.winners.length ? 'Won by ' + esc(g.winners.join(' & ')) : 'No winner') : 'No vote'} · ${esc(g.players.join(', '))}</li>`).join('');

  main.innerHTML = `
    <p style="margin:0 0 14px">${plural(s.totalGames, 'game')} played. Averages only count people with ${s.minGames}+ games. Games ended early don't count.</p>

    <h2 class="stats-head">Winning</h2>
    <div class="stats-grid">
      ${card('Most played', people(b.mostPlayed, r => r.played), none)}
      ${card('Best win %', people(b.bestWin, r => r.winPct + '%'), need)}
      ${card('Worst win %', people(b.worstWin, r => r.winPct + '%'), need)}
      ${card('Most votes per game', people(b.bestVotes, r => r.votesPerGame), need)}
      ${card('Fewest votes per game', people(b.worstVotes, r => r.votesPerGame), need)}
      ${card('Current win streak', people(b.currentStreak, r => plural(r.streak, 'win')), 'Nobody is on a streak')}
      ${card('Longest win streak', people(b.longestStreak, r => plural(r.bestStreak, 'win')), none)}
      ${card('Best category', withCat.sort((x, y) => y.bestCategory.pct - x.bestCategory.pct).slice(0, 8)
        .map(p => [`${esc(p.name)}: ${esc(p.bestCategory.cat)}`, `${p.bestCategory.wins}/${p.bestCategory.games}`]), 'Needs 2+ games in a category')}
      ${card('Kingmaker', people(b.kingmaker, r => r.kingPct + '%'), `Needs ${s.minGames}+ votes cast`, 'How often their vote goes to the winner')}
    </div>

    <h2 class="stats-head">Money</h2>
    <div class="stats-grid">
      ${card('Biggest spender', people(b.bigSpender, r => '$' + r.avgSpent), need, 'Average spent per game')}
      ${card('Tightest wallet', people(b.tightWallet, r => '$' + r.avgLeft), need, 'Average money left over')}
      ${card('Most expensive signings', s.signings.map(x => [`${esc(x.name)}: ${esc(x.item)}`, '$' + x.price]), none)}
      ${card('Busiest bidder', people(b.busiest, r => r.bidsPerGame), need, 'Bids placed per game')}
    </div>

    <h2 class="stats-head">Picks</h2>
    <div class="stats-grid">
      ${card('Most picked', s.mostPicked.map(x => [esc(x.item), plural(x.count, 'time')]), none)}
      ${card('Hottest items', s.hottest.map(x => [esc(x.item), `$${x.avg} avg`]), 'Needs an item bought twice', 'Highest average price paid')}
      ${card('Signature picks', withSig.map(p => [`${esc(p.name)} always gets ${esc(p.signature.item)}`, p.signature.times + '×']), 'Needs someone to buy the same thing twice')}
    </div>

    <h2 class="stats-head">Rivalries</h2>
    <div class="stats-grid">
      ${card('Head to head', s.headToHead.map(h => [`${esc(h.a)} ${h.aWins} – ${h.bWins} ${esc(h.b)}`, '']), 'Needs games with a winner')}
      ${card('Nemesis', s.nemesis.map(x => [`${esc(x.by)} outbid ${esc(x.over)}`, plural(x.n, 'time')]), none)}
      ${card('Played together most', s.together.map(t => [esc(t.names.join(' & ')), plural(t.games, 'game')]), none)}
    </div>

    <section class="panel"><h2>Everyone</h2>
      <div class="table-wrap"><table class="stats-table">
        <thead><tr><th>Player</th><th>Played</th><th>Wins</th><th>Win %</th><th>Votes/game</th><th>Avg spent</th><th>Best streak</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    </section>
    <section class="panel"><h2>Recent games</h2>${recent ? `<ol class="stats-recent">${recent}</ol>` : `<p class="note">${none}</p>`}</section>`;
}).catch(() => { main.innerHTML = '<section class="panel"><p>Couldn\'t load stats. Try again in a moment.</p></section>'; });
