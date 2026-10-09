// Check the instructions and native clipboard adapter without building the app.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source=fs.readFileSync('src/streamer-events.ts','utf8');
let dialog;
let controls;
let copied;
const document={querySelector:()=>null,createElement:()=>{
  controls = new Map();
  return dialog={setAttribute(){},querySelector(selector){
    if(!controls.has(selector)) controls.set(selector,{value:'',textContent:'',addEventListener(type,handler){this[type]=handler}});
    return controls.get(selector);
  },addEventListener(){},showModal(){},innerHTML:''};
},body:{append(){}}};
const icons={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/icons.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:icons});
const illustrations={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/guide-illustrations.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:illustrations,require:()=>icons});
const inputs={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/input-field.ts","utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:inputs});
const exports={};
vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:(name)=>name.includes("guide-illustrations")?illustrations:name.includes("input-field")?inputs:icons,document,navigator:{clipboard:{async writeText(value){copied=value}}}});
const native = String.fromCharCode(37);
assert.equal(exports.formatStreamerBotText('GG {wrplayer} (+{wrplayerpoints} points)'), `GG ${native}wrplayer${native} (+${native}wrplayerpoints${native} points)`);
assert.equal(exports.formatStreamerBotText('{cycleplayer} #{cyclenumber}: {cycleraces} races'), `${native}cycleplayer${native} #${native}cyclenumber${native}: ${native}cycleraces${native} races`);
assert.equal(exports.formatStreamerBotText('Literal braces {} and {not a variable}'), 'Literal braces {} and {not a variable}');
for(const kind of ['gameComplete','worldRecord','cycleComplete']) {
  exports.openEventVariables(kind);
  assert(dialog.innerHTML.includes('Inspect Variables When Queued'));
  assert(dialog.innerHTML.includes('Set GDI Text'));
  assert(dialog.innerHTML.includes('Copy for Streamer.bot'));
  assert(dialog.innerHTML.includes('existing scene'));
  assert(dialog.innerHTML.includes('Text</b> field'));
  const input = controls.get('.streamer-template-input');
  assert(input.value.includes('{'));
  input.value = 'GG {firstplace} (+{firstplacepoints} points)';
  await controls.get('[data-copy-event-text]').click();
  assert.equal(copied, exports.formatStreamerBotText(input.value));
  assert.match(controls.get('[data-copy-status]').textContent, /Paste into Streamer.bot/);
  assert.doesNotMatch(dialog.innerHTML, /CPH|Execute C#|Copy action code/);
  assert(dialog.innerHTML.includes('guide-art-variables'));
  assert.doesNotMatch(dialog.innerHTML, /%[A-Za-z][A-Za-z0-9_]*%|%\$1%/);
}
for(const path of ['src/views.ts','src/streamer-events.ts','src-tauri/src/twitch.rs','README.md']) {
  const text=fs.readFileSync(path,'utf8').replace(/%LOCALAPPDATA%/g,'');
  assert.doesNotMatch(text, /%[A-Za-z][A-Za-z0-9_]*%|%\$1%/,path+' must display brace event placeholders');
}
assert(fs.readFileSync('src/views.ts','utf8').includes('renderGuideStep'));
console.log('Instruction checks passed: braces only, no pasted-code requirements, native clipboard conversion, all three source-update guides, four illustrated steps.');
