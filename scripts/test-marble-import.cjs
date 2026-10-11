// Run with downloaded session HTML and a temporary linkedom installation.
// No application build or launch, and no runtime JSON writes.
const fs = require('fs');
const vm = require('vm');
const ts = require('typescript');
const assert = require('assert/strict');
const { DOMParser } = require(process.argv[3]);
const code = ts.transpileModule(fs.readFileSync('src/marble-cycle-parser.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const moduleObject = { exports: {} };
vm.runInNewContext(code, { exports: moduleObject.exports, module: moduleObject, DOMParser });
const parse = moduleObject.exports.parseMarbleCyclePage;
const html = fs.readFileSync(process.argv[2], 'utf8');
const url = 'https://marblecycle.com/session/13e1c46f-3301-4d50-ba61-4324972c7e08';
const page = parse(html, url);
assert.equal(page.resultEntries, 519);
assert.equal(page.playerEntries, 625);
assert.equal(page.games.reduce((sum, game) => sum + game.results.length, 0), 22533);
assert.equal(page.games.filter(game => game.gameType === 'battleRoyale').length, 2);
assert.equal(new Set(page.games.map(game => game.id)).size, 519);
const source = new DOMParser().parseFromString(html, 'text/html');
const players = new Map();
for (const game of page.games) for (const result of game.results) {
  const key = result.username.toLowerCase();
  if (!players.has(key)) players.set(key, { total: 0, br: 0, counts: Array(10).fill(0) });
  const player = players.get(key);
  player.total++;
  if (game.gameType === 'battleRoyale') player.br++;
  else if (!result.eliminated && result.placement <= 10) player.counts[result.placement - 1]++;
}
const cycleDifferences = [];
for (const row of source.querySelectorAll('#marbleSessionResults tbody tr')) {
  const cells = [...row.children].map(cell => cell.textContent.trim());
  const player = players.get(cells[0].toLowerCase());
  assert.equal(player.total, Number(cells[1]), cells[0] + ' participation');
  const cycles = Math.min(...player.counts);
  if (cycles !== Number(cells[2])) cycleDifferences.push([cells[0], cycles, Number(cells[2])]);
}
assert.deepEqual(cycleDifferences, [['Schumi554', 0, 1]]); // Source counts this player's BR 10th.
for (const [name, total, cycles] of [['unremarkablefleshbag', 511, 11], ['wormmyz', 517, 8], ['jade_bc', 457, 6]]) {
  const player = players.get(name);
  assert.equal(player.total - player.br, total);
  assert.equal(Math.min(...player.counts), cycles);
}
assert(page.games.every(game => game.timestamp === '' && game.mapName === undefined && game.results.length === game.playerCount));
assert(page.games.every((game, index) => !index || Number(page.games[index - 1].results[0].rawData.MarbleCycleRaceNumber) <= Number(game.results[0].rawData.MarbleCycleRaceNumber)));
assert.throws(() => parse('<table id="marbleRaceResults"></table>', url));
assert.throws(() => parse(html.replace(/(id="62769836-0900-48b0-b287-39046ca532d2" class="race-summary">[\s\S]*?<td>474<\/td>[\s\S]*?<td>[^<]+<\/td>[\s\S]*?<td>)42/, '$199999'), url));
console.log('Verified all 519 source results, 625 Cycle table rows, 22,533 participant rows, Race/BR/DNF classification, all 625 participation totals, 624 matching Race-only cycle totals (source counts one BR 10th), source order and absent dates/tracks.');
