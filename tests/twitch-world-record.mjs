import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source = fs.readFileSync('src/views.ts','utf8');
const exports = {};
vm.runInNewContext(ts.transpileModule(source.replaceAll('import.meta.url', '"file:///app/src/views.ts"'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:()=>({icons:{}}),URL});
assert.equal(exports.worldRecordMessagePreview('{wrplayer}: +{wrplayerpoints} points on {mapName} in {wrrecordtime}s'), 'Test Winner: +10 points on Test Map in 42.123s');
assert.equal(exports.worldRecordMessagePreview(''), 'World Record! Test Winner earned +10 points on Test Map in 42.123s!');
assert.equal(exports.worldRecordMessagePreview('x'.repeat(600)).length, 500);
assert(source.includes('data-twitch-test="worldRecord"'));
assert(source.includes('data-feature-section="twitch-post-world-records"'));
console.log('World Record Twitch preview checks passed.');

const main = fs.readFileSync('src/main.ts','utf8');
const raceDefault = JSON.parse(main.match(/messagePrefix: ("[^"\n]+")/)[1]);
const cycleDefault = JSON.parse(main.match(/cycleMessageTemplate:\s*("[^"\n]+")/)[1]);
for (const [field, text] of [['twitch-message-prefix',raceDefault],['twitch-cycle-message',cycleDefault],['twitch-world-record-message',exports.defaultWorldRecordMessage]]) {
  assert.equal(exports.twitchMessageIsCustomized(field,text), false);
  assert.equal(exports.twitchMessageIsCustomized(field,'  '+text+'  '), false);
  assert.equal(exports.twitchMessageIsCustomized(field,'Custom message'), true);
  assert.equal(exports.twitchMessageIsCustomized(field,''), field==='twitch-message-prefix');
}
console.log('Customization state checks passed: defaults, edits, restored defaults, and empty-template fallbacks.');

const customCycle = "rmrfkoBurn rmrfkoBurn Congrats {player} on a cycle! You are great! That's cycle #{cycle}!";
assert.equal(exports.cycleMessagePreview(customCycle), "rmrfkoBurn rmrfkoBurn Congrats rmrfkorea on a cycle! You are great! That's cycle #1!");
assert.equal(exports.cycleMessagePreview('{player}: {races} races, cycle #{cycle}'), 'rmrfkorea: 823 races, cycle #1');
assert.equal(exports.cycleMessagePreview('Cycle complete!'), 'Cycle complete!');
assert.equal(Array.from(exports.cycleMessagePreview('x'.repeat(600))).length, 500);
console.log('Cycle previews preserve custom text and include race counts only when requested.');
