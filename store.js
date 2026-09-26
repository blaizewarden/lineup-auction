// Profiles and game history. Saved to a GitHub gist when GIST_TOKEN is set
// (Render's disk is wiped on every restart), otherwise to data/stats.json.
const fs = require('fs');
const path = require('path');

const GIST_ID = process.env.GIST_ID;
const GIST_TOKEN = process.env.GIST_TOKEN;
const GIST_FILE = 'lineup-auction-stats.json';
const LOCAL_FILE = path.join(__dirname, 'data', 'stats.json');
const STARTERS = ['Matt', 'Caelum', 'Blaize', 'Chantal', 'Aida', 'Rhys', 'Elani', 'Rohan'];
const useGist = !!(GIST_ID && GIST_TOKEN);

const data = { profiles: [], games: [] };

const gistHeaders = () => ({
  Authorization: `Bearer ${GIST_TOKEN}`,
  Accept: 'application/vnd.github+json',
  'User-Agent': 'lineup-auction'
});

async function load() {
  try {
    let saved = null;
    if (useGist) {
      const res = await fetch(`https://api.github.com/gists/${GIST_ID}`, { headers: gistHeaders() });
      if (!res.ok) throw new Error(`gist read ${res.status}`);
      const file = (await res.json()).files[GIST_FILE];
      if (file) saved = JSON.parse(file.content);
    } else if (fs.existsSync(LOCAL_FILE)) {
      saved = JSON.parse(fs.readFileSync(LOCAL_FILE, 'utf8'));
    }
    if (saved) {
      data.profiles = Array.isArray(saved.profiles) ? saved.profiles : [];
      data.games = Array.isArray(saved.games) ? saved.games : [];
    }
  } catch (err) {
    console.error('  Could not load stats:', err.message);
  }
  // only seed the starting names on a brand new store, so deleted ones stay deleted
  if (!data.profiles.length && !data.games.length) for (const name of STARTERS) addProfile(name, false);
  console.log(`  Stats: ${data.profiles.length} profiles, ${data.games.length} games (${useGist ? 'gist' : 'local file'})`);
}

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const body = JSON.stringify(data, null, 1);
    try {
      if (useGist) {
        const res = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
          method: 'PATCH',
          headers: { ...gistHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ files: { [GIST_FILE]: { content: body } } })
        });
        if (!res.ok) throw new Error(`gist write ${res.status}`);
      } else {
        fs.mkdirSync(path.dirname(LOCAL_FILE), { recursive: true });
        fs.writeFileSync(LOCAL_FILE, body);
      }
    } catch (err) {
      console.error('  Could not save stats:', err.message);
    }
  }, 2000);
}

const key = s => String(s).trim().toLowerCase();

// returns the stored spelling of the name
function addProfile(name, persist = true) {
  const found = data.profiles.find(p => key(p) === key(name));
  if (found) return found;
  data.profiles.push(name);
  if (persist) save();
  return name;
}

// one record per game; re-running the vote replaces it
function recordGame(record) {
  const i = data.games.findIndex(g => g.id === record.id);
  if (i >= 0) data.games[i] = record; else data.games.push(record);
  save();
}

const findProfile = name => data.profiles.find(p => key(p) === key(name));

// removes the profile and every game result it has
function deleteProfile(name) {
  if (!findProfile(name)) return false;
  data.profiles = data.profiles.filter(p => key(p) !== key(name));
  for (const g of data.games) g.players = g.players.filter(p => key(p.name) !== key(name));
  data.games = data.games.filter(g => g.players.length);
  save();
  return true;
}

// moves all of `from`'s games onto `into`, then removes `from`
function mergeProfile(from, into) {
  const target = findProfile(into);
  if (!findProfile(from) || !target || key(from) === key(into)) return false;
  for (const g of data.games) for (const p of g.players) if (key(p.name) === key(from)) p.name = target;
  data.profiles = data.profiles.filter(p => key(p) !== key(from));
  save();
  return true;
}

const MIN_GAMES = 3;

function stats() {
  const people = {};
  const pairs = {};
  const person = name => people[key(name)] || (people[key(name)] = {
    name, played: 0, voteGames: 0, judged: 0, wins: 0, votes: 0, spent: 0, left: 0, bids: 0,
    streak: 0, bestStreak: 0, cats: {}, picks: {}, votesCast: 0, kingVotes: 0
  });
  for (const name of data.profiles) person(name);
  const items = {};    // item -> { count, total }
  const signings = []; // every paid pick
  const outbids = {};  // "by|over" -> n
  const h2h = {};      // "a|b" (sorted) -> { games, a wins, b wins }

  const games = [...data.games].sort((a, b) => a.at.localeCompare(b.at));
  for (const g of games) {
    const budget = g.budget || 100;
    for (const p of g.players) {
      const s = person(p.name);
      s.played += 1;
      s.spent += p.spent || 0;
      s.left += budget - (p.spent || 0);
      s.bids += p.bids || 0;
      for (const r of p.roster || []) {
        const pick = typeof r === 'string' ? { item: r, price: 0, filled: true } : r;
        if (pick.filled || pick.item === 'Empty slot') continue;
        s.picks[pick.item] = (s.picks[pick.item] || 0) + 1;
        const it = items[pick.item] || (items[pick.item] = { item: pick.item, count: 0, total: 0 });
        it.count += 1; it.total += pick.price;
        signings.push({ name: p.name, item: pick.item, price: pick.price, category: g.category });
      }
      if (g.voted) {
        // voteGames = games with a winner; judged = games actually decided by a vote
        s.voteGames += 1;
        if (g.decided !== 'declared') { s.judged += 1; s.votes += p.votes; }
        const c = s.cats[g.category] || (s.cats[g.category] = { games: 0, wins: 0 });
        c.games += 1;
        if (p.won) { s.wins += 1; c.wins += 1; s.streak += 1; s.bestStreak = Math.max(s.bestStreak, s.streak); }
        else s.streak = 0;
      }
    }
    const names = [...new Set(g.players.map(p => p.name))].sort();
    const won = new Set(g.players.filter(p => p.won).map(p => p.name));
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        const k = `${names[i]}|${names[j]}`;
        pairs[k] = (pairs[k] || 0) + 1;
        if (g.voted && (won.has(names[i]) || won.has(names[j]))) {
          const h = h2h[k] || (h2h[k] = { a: names[i], b: names[j], aWins: 0, bWins: 0 });
          if (won.has(names[i])) h.aWins += 1;
          if (won.has(names[j])) h.bWins += 1;
        }
      }
    }
    for (const v of g.votes || []) {
      const s = person(v.from);
      s.votesCast += 1;
      if (won.has(v.to)) s.kingVotes += 1;
    }
    for (const o of g.outbids || []) outbids[`${o.by}|${o.over}`] = (outbids[`${o.by}|${o.over}`] || 0) + o.n;
  }

  const round = (n, d = 1) => Math.round(n * 10 ** d) / 10 ** d;
  const all = Object.values(people).map(s => {
    const cats = Object.entries(s.cats).filter(([, c]) => c.games >= 2)
      .map(([cat, c]) => ({ cat, ...c, pct: Math.round((c.wins / c.games) * 100) }))
      .sort((a, b) => b.pct - a.pct || b.games - a.games);
    const sig = Object.entries(s.picks).sort((a, b) => b[1] - a[1])[0];
    return {
      name: s.name, played: s.played, voteGames: s.voteGames, wins: s.wins, votes: s.votes,
      winPct: s.voteGames ? Math.round((s.wins / s.voteGames) * 100) : null,
      votesPerGame: s.judged ? round(s.votes / s.judged, 2) : null,
      avgSpent: s.played ? round(s.spent / s.played) : null,
      avgLeft: s.played ? round(s.left / s.played) : null,
      bidsPerGame: s.played ? round(s.bids / s.played) : null,
      streak: s.streak, bestStreak: s.bestStreak,
      bestCategory: cats[0] || null,
      signature: sig && sig[1] >= 2 ? { item: sig[0], times: sig[1] } : null,
      votesCast: s.votesCast,
      kingPct: s.votesCast ? Math.round((s.kingVotes / s.votesCast) * 100) : null
    };
  });
  const rated = all.filter(s => s.voteGames >= MIN_GAMES);
  const judged = all.filter(s => s.judged >= MIN_GAMES);
  const regulars = all.filter(s => s.played >= MIN_GAMES);
  const top = (list, by, dir = -1, n = 5) => [...list].filter(s => s[by] != null)
    .sort((a, b) => dir * (a[by] - b[by]) || a.name.localeCompare(b.name)).slice(0, n);

  return {
    minGames: MIN_GAMES,
    totalGames: data.games.length,
    players: all.filter(s => s.played || findProfile(s.name)).sort((a, b) => b.played - a.played || a.name.localeCompare(b.name)),
    boards: {
      mostPlayed: top(all.filter(s => s.played), 'played'),
      bestVotes: top(judged, 'votesPerGame'),
      worstVotes: top(judged, 'votesPerGame', 1),
      bestWin: top(rated, 'winPct'),
      worstWin: top(rated, 'winPct', 1),
      bigSpender: top(regulars, 'avgSpent'),
      tightWallet: top(regulars, 'avgLeft'),
      busiest: top(regulars, 'bidsPerGame'),
      longestStreak: top(all.filter(s => s.bestStreak), 'bestStreak'),
      currentStreak: top(all.filter(s => s.streak), 'streak'),
      kingmaker: top(all.filter(s => s.votesCast >= MIN_GAMES), 'kingPct')
    },
    together: Object.entries(pairs).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, n]) => ({ names: k.split('|'), games: n })),
    headToHead: Object.values(h2h).sort((x, y) => (y.aWins + y.bWins) - (x.aWins + x.bWins)).slice(0, 8),
    signings: signings.sort((a, b) => b.price - a.price).slice(0, 5),
    mostPicked: Object.values(items).sort((a, b) => b.count - a.count || a.item.localeCompare(b.item)).slice(0, 10),
    hottest: Object.values(items).filter(i => i.count >= 2).map(i => ({ item: i.item, count: i.count, avg: round(i.total / i.count) }))
      .sort((a, b) => b.avg - a.avg).slice(0, 5),
    nemesis: Object.entries(outbids).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, n]) => { const [by, over] = k.split('|'); return { by, over, n }; }),
    recent: data.games.slice(-10).reverse().map(g => ({
      at: g.at, category: g.category, voted: g.voted,
      winners: g.players.filter(p => p.won).map(p => p.name),
      players: g.players.map(p => p.name)
    }))
  };
}

module.exports = { data, load, save, addProfile, deleteProfile, mergeProfile, recordGame, stats };
