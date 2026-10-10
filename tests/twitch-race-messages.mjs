import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const exports = {};
const source = fs.readFileSync('src/views.ts', 'utf8').replaceAll('import.meta.url', '"file:///app/src/views.ts"');
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports, require: () => ({ icons: {} }), URL });
const format = exports.twitchPreviewMessages;
assert(format('Results:').join(' ').includes('#5 PlayerFive +30pts'));
assert.equal(exports.raceMessageIsCustomized({ messagePrefix: '\u{1f3c1} Race results:', raceMessageTemplate: exports.defaultRaceMessage, raceEntryTemplate: exports.defaultRaceEntry, racePodiumTemplates: Array(3).fill(exports.defaultRaceEntry) }), false);
const game = { gameType: 'race', mapName: 'Test Map', playerCount: 4, results: [
  { placement: 1, playerName: 'Winner', seasonPointsEarned: 12, finishTime: 42.123 },
  { placement: 2, playerName: 'Second', seasonPointsEarned: 8, finishTime: 43.456 },
  { placement: 3, playerName: 'Third', seasonPointsEarned: 4 },
  { placement: 4, playerName: 'Fourth', seasonPointsEarned: 0 },
] };
assert.equal(format('{race} results:', game)[0], 'Race results: 🥇 Winner +12pts | 🥈 Second +8pts | 🥉 Third +4pts');
const custom = { raceMessageTemplate: '{race} on {mapName} ({playerCount} racers): {placements} — GG!', raceEntryTemplate: '{placement}. {player}: {points} points in {time}s', raceEntrySeparator: ' / ', racePodiumTemplates: ['Champion {player}: +{points} points'] };
assert.equal(format('', game, custom)[0], 'Race on Test Map (4 racers): Champion Winner: +12 points / 2. Second: 8 points in 43.456s / 3. Third: 4 points in unknowns — GG!');
game.results[0].playerName = '{points}';
assert(format('', game, custom)[0].includes('Champion {points}: +12 points'));
assert.equal(format('', game, { raceMessageTemplate: 'Finished {race} on {mapName}' }).length, 1);
const noPoints = { ...game, results: game.results.map(result => ({ ...result, seasonPointsEarned: 0 })) };
assert(!format('Results:', noPoints)[0].includes('pts'));
assert(!format('Results:', { ...noPoints, gameType: 'battleRoyale' })[0].includes('Second'));
const longGame = { ...game, playerCount: 30, results: Array.from({ length: 30 }, (_, i) => ({ placement: i + 1, playerName: `Player_${i + 1}_${'😺'.repeat(15)}`, seasonPointsEarned: 5 })) };
const split = format('', longGame, { raceMessageTemplate: 'Results: {placements} — END', raceEntryTemplate: '{player} {points} points' });
assert(split.length > 1);
assert(split.every(message => Array.from(message).length <= 500 && message.startsWith('Results:') && message.endsWith('— END')));
for (const player of longGame.results) assert(split.some(message => message.includes(player.playerName)));
assert(format('', game, { raceMessageTemplate: 'x'.repeat(600) + '{placements}' }).every(message => Array.from(message).length <= 500));
assert.equal(exports.raceMessageIsCustomized({ messagePrefix: '🏁 Race results:' }), false);
assert.equal(exports.raceMessageIsCustomized({ messagePrefix: '🏁 Race results:', ...custom }), true);
console.log('Race templates passed: overall/entry/podium customization, literal names, no-points fallback, Unicode splitting and preserved wrappers.');
