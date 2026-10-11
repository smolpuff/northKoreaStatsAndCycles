// Focused view checks without building or launching the application.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require('typescript');
const assert = require('assert/strict');
const { pathToFileURL } = require('url');
const cache = new Map();
function load(file) {
  file = path.resolve(file);
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} };
  cache.set(file, module);
  const source = fs.readFileSync(file, 'utf8').replaceAll('import.meta.url', JSON.stringify(pathToFileURL(file).href));
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const req = id => id.startsWith('.') ? load(path.resolve(path.dirname(file), id + '.ts')) : require(id);
  vm.runInThisContext('(function(require,module,exports){' + js + '\n})', { filename: file })(req, module, module.exports);
  return module.exports;
}
const views = load('src/views.ts');
const result = { playerName: 'Racer <one>', username: 'racer', displayName: 'Racer <one>', platform: 'Twitch', placement: 1, seasonPointsEarned: 12, seasonPointsTotal: 24, finishTime: 42, rawData: {} };
const game = { id: 'latest', timestamp: '2026-10-10T12:00:00Z', gameType: 'race', playerCount: 38, results: [result], mapName: 'Latest <Track>', hasWorldRecord: true, worldRecordPlayer: 'RACER' };
const old = { ...game, id: 'previous', mapName: 'Previous Track', playerCount: 27, hasWorldRecord: false };
const state = {
  latestResult: game, recentResults: [old, game], sessionResults: [], totalRaceCount: 2,
  totalBattleRoyaleCount: 0, seasonPointsEarned: 24, totalCycleRaceCount: 1,
  raceCycles: [{ playerKey: 'twitch:racer', playerName: result.playerName, placementCounts: [3,1,1,1,1,1,1,1,1,1], cycles: 1 }],
  cycleHistory: [{ timestamp: game.timestamp, mapName: game.mapName, playerCount: 38, gameId: game.id, earnings: [{ playerKey: 'twitch:racer', playerName: result.playerName, placement: 10, pointsEarned: 1, cyclesEarned: 1, cycleNumber: 1, placementCounts: [3,1,1,1,1,1,1,1,1,1] }] }],
  config: { csv: { path: 'LastSeasonRace.csv' }, seasons: {}, streamerBot: { events: {} }, twitch: {} },
  watcherStatus: 'Stopped', streamerBotStatus: 'Disabled', twitchStatus: 'Disconnected', session: { gamesPlayed: 0 }, logs: [],
};
const render = (page, id = '') => views.renderApplication(state, page, false, 'all', { key: 'cycles', direction: 'desc' }, false, { key: 'placement', direction: 'asc' }, '', id);
let html = render('overview', 'previous');
assert(html.includes('Participants</small><b>27</b>'));
assert(html.includes('Previous Track'));
assert(html.includes('id="race-search"'));
assert(!html.includes('data-export="race"'));
assert(html.includes('data-export="session"'));
assert(html.includes('<div class="results-actions">'));
assert(html.includes('value="previous" selected'));
assert(!html.includes('<option value="latest"'));
assert(html.includes('data-race-player="twitch:racer"'));
html = render('racecycles');
assert(html.includes('data-cycle-player="twitch:racer"'));
assert(!html.includes('then start a new set'));
assert.equal((html.match(/cycle-count ready/g) || []).length, 1);
const races = views.playerHistoryContent(state, 'race', 'twitch:racer');
assert(races.content.includes('player-history-summary'));
assert(races.content.includes('1st places: 2'));
assert(races.content.includes('<small>Total points</small><b>24</b>'));
const reportedSeason = { ...game, results: [{ ...result, seasonPointsTotal: 999 }] };
assert(views.playerHistoryContent({ ...state, recentResults: [reportedSeason, old] }, 'race', 'twitch:racer').content.includes('<small>Total points</small><b>24</b>'));
const eventCard = views.playerHistoryContent({ ...state, eventResultIds: ['previous'] }, 'race', 'twitch:racer').content;
assert(eventCard.includes('<small>Event points</small><b>12</b>'));
const resetCard = views.playerHistoryContent({ ...state, eventResultIds: [], sessionResults: [game] }, 'race', 'twitch:racer').content;
assert(resetCard.includes('<small>Event points</small><b>0</b>'));
assert(races.content.includes('World record'));
assert(races.content.includes('Previous Track'));
assert(!races.content.includes('Cycles earned'));
assert(!races.content.includes('<th>Kills</th>'));
assert(!races.content.includes('<th>Damage</th>'));
const cycles = views.playerHistoryContent(state, 'cycles', 'twitch:racer');
assert(cycles.content.includes('Cycle #1 completed'));
assert(cycles.content.includes('history-achievement'));
assert(cycles.content.includes('Latest &lt;Track&gt;'));
assert(!cycles.content.includes('Previous Track'));
assert(cycles.content.includes('player-history-summary'));
assert(cycles.content.includes('1st places'));
assert(cycles.content.includes('10th places'));
// Existing saved cycle fingerprints can display their actual archived placements
// without rewriting either archive or inventing missing results.
const legacy = { ...state, cycleHistory: [{ gameId: old.id, timestamp: old.timestamp, mapName: old.mapName, earnings: [], completions: [] }] };
assert(views.playerHistoryContent(legacy, 'cycles', 'twitch:racer').content.includes('Previous Track'));
const unearned = { ...old, results: [{ ...result, placement: 11 }] };
assert(!views.playerHistoryContent({ ...legacy, recentResults: [unearned] }, 'cycles', 'twitch:racer').content.includes('<td>Previous Track</td>'));
const completionOnly = { ...state, recentResults: [], cycleHistory: [{ gameId: 'older', timestamp: game.timestamp, mapName: 'Older Track', completions: [{ playerName: result.playerName, cycleNumber: 4 }] }] };
assert(views.playerHistoryContent(completionOnly, 'cycles', 'twitch:racer').content.includes('Cycle #4 completed'));
const br = { ...old, id: 'br', gameType: 'battleRoyale', results: [{ ...result, rawData: { MatchKills: '4', MatchDamageDealt: '900' } }] };
const mixed = views.playerHistoryContent({ ...state, recentResults: [game, br] }, 'race', 'twitch:racer').content;
const raceSection = mixed.slice(mixed.indexOf('<h3>Race results'), mixed.indexOf('<h3>Battle Royale results'));
assert(!raceSection.includes('Kills'));
assert(!raceSection.includes('Damage'));
assert(mixed.includes('<th>Kills</th>'));
assert(mixed.includes('<td>4</td><td>900</td>'));
assert(mixed.includes('<small>Races</small><b>1</b>'));
assert(mixed.includes('<small>BRs</small><b>1</b>'));
assert(render('racecycles').includes('data-import-marble-cycle'));
assert(render('racecycles').includes('data-import-marble-cycle><svg'));
assert(/<span>Import (?:data )?from MarblesCycles<\/span>/.test(render('racecycles')));
assert(render('overview').includes('<option value="">Latest Results</option>'));
assert(render('racecycles').includes('Race #'));
assert(render('racecycles').includes('summary-icon statRaceFlag'));
assert(!render('overview').includes('<h1>RaceStats</h1><p>'));
assert(!render('racecycles').includes('Placements 1-10 accumulate and carry forward into every cycle.</p>'));
assert(render('racecycles').includes('data-cycle-sort="races"'));
const outsideTen = { ...game, id: 'outside', results: [{ ...result, placement: 11 }] };
const participationCard = views.playerHistoryContent({ ...state, cycleHistory: [
  { ...state.cycleHistory[0], game },
  { gameId: outsideTen.id, timestamp: game.timestamp, game: outsideTen, earnings: [] },
] }, 'cycles', 'twitch:racer').content;
assert(participationCard.includes('<small>Races</small><b>3</b>')); // Includes archived participation without a point-earning entry.
assert(!participationCard.includes('<td>11</td>'));
const dates = load('src/dates.ts');
assert(!dates.formatTimestamp(game.timestamp).includes('2026'));
assert(!dates.formatTime(game.timestamp).includes(':00:'));
state.raceCycles = [];
state.latestResult = undefined;
assert(views.playerHistoryContent(state, 'cycles', 'twitch:racer').content.includes('Cycle #1 completed'));
assert(views.playerHistoryContent(state, 'race', 'twitch:racer').content.includes('Previous Track'));
assert(render('overview', 'previous').includes('Participants</small><b>27</b>'));
console.log('Passed results/history rendering checks.');
