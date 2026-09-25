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
  const person = name => people[key(name)] || (people[key(name)] = { name, played: 0, voteGames: 0, wins: 0, votes: 0 });
  for (const name of data.profiles) person(name);

  for (const g of data.games) {
    for (const p of g.players) {
      const s = person(p.name);
      s.played += 1;
      if (g.voted) { s.voteGames += 1; s.votes += p.votes; if (p.won) s.wins += 1; }
    }
    const names = [...new Set(g.players.map(p => p.name))].sort();
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        const k = `${names[i]}|${names[j]}`;
        pairs[k] = (pairs[k] || 0) + 1;
      }
    }
  }

  const all = Object.values(people).map(s => ({
    ...s,
    winPct: s.voteGames ? Math.round((s.wins / s.voteGames) * 100) : null,
    votesPerGame: s.voteGames ? Math.round((s.votes / s.voteGames) * 100) / 100 : null
  }));
  const rated = all.filter(s => s.voteGames >= MIN_GAMES);
  const top = (list, by, dir = -1) => [...list].sort((a, b) => dir * (a[by] - b[by]) || a.name.localeCompare(b.name)).slice(0, 5);

  return {
    minGames: MIN_GAMES,
    totalGames: data.games.length,
    players: [...all].sort((a, b) => b.played - a.played || a.name.localeCompare(b.name)),
    boards: {
      mostPlayed: top(all.filter(s => s.played), 'played'),
      bestVotes: top(rated, 'votesPerGame'),
      worstVotes: top(rated, 'votesPerGame', 1),
      bestWin: top(rated, 'winPct'),
      worstWin: top(rated, 'winPct', 1)
    },
    together: Object.entries(pairs).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, n]) => ({ names: k.split('|'), games: n })),
    recent: data.games.slice(-10).reverse().map(g => ({
      at: g.at, category: g.category, voted: g.voted,
      winners: g.players.filter(p => p.won).map(p => p.name),
      players: g.players.map(p => p.name)
    }))
  };
}

module.exports = { data, load, save, addProfile, deleteProfile, mergeProfile, recordGame, stats };
