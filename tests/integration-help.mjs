import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const transpile = path => ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const catalog = {};
const catalogCode = transpile('src/help-fields.ts');
vm.runInNewContext(catalogCode,{exports:catalog});
const icons = {};
const iconsCode = transpile('src/icons.ts');
vm.runInNewContext(iconsCode,{exports:icons});
const illustrations = {};
const illustrationCode = transpile('src/guide-illustrations.ts');
vm.runInNewContext(illustrationCode,{exports:illustrations,require:()=>icons});
const inputs = {};
const inputCode = transpile("src/input-field.ts");
vm.runInNewContext(inputCode,{exports:inputs});
const help = {};
const helpCode = transpile('src/integration-help.ts').replaceAll('</script>', '<\\/script>');
vm.runInNewContext(helpCode,{exports:help,require:(name)=>name.includes("guide-illustrations")?illustrations:name.includes("input-field")?inputs:name.includes("icons")?icons:catalog});
const html = help.renderIntegrationHelp();
for (const text of ['Set GDI Text','%firstplace%','{placements.0.name}','3 seconds','id="overlay"','Automatic World Record detection','separate last-Race and last-BR','copy into new.html','Read from file unchecked','Copy for Streamer.bot','Arguments belong to this action run']) assert(html.includes(text),text);
assert.equal((html.match(/data-help-section=/g)||[]).length,6);
assert(html.includes('data-help-tab="custom"'));
assert(!html.includes('help-fifth-example'));
assert(!html.includes('help-live-examples'));
assert(html.includes('guide-step-copy'));
assert(html.includes('guide-art-twitch-connect'));
assert(!html.includes('/guides/'));
assert(!html.includes('<img')); 
for (const group of catalog.allHelpFieldGroups) {
 assert(group.availability && group.fields.length);
 for (const [key] of group.fields) assert(html.includes(key),key);
}
for (const match of html.matchAll(/src="(\/guides\/[^" ]+)"/g)) assert(fs.existsSync('public'+match[1]),match[1]);
const main = fs.readFileSync('src/main.ts','utf8');
assert(main.includes('installIntegrationHelp();'));
for (const path of ['src/views.ts','src/overlay-view.ts','src/overlay-help.ts','src/streamer-events.ts']) assert(/data-open-integration-help|renderGuideHeader/.test(fs.readFileSync(path,'utf8')),path);
assert(fs.readFileSync('public/overlays/overlay.js','utf8').includes('setInterval(refresh, 3000)'));
console.log('Help checks passed: full field catalog, correct syntax, current limitations, illustrated sections and contextual links.');
if (process.argv.includes('--preview')) {
 const script = `<script>const inputs={};((exports)=>{${inputCode}})(inputs);const icons={};((exports)=>{${iconsCode}})(icons);const illustrations={};((exports,require)=>{${illustrationCode}})(illustrations,()=>icons);const catalog={};((exports)=>{${catalogCode}})(catalog);const help={};((exports,require)=>{${helpCode}})(help,(name)=>name.includes("guide-illustrations")?illustrations:name.includes("input-field")?inputs:name.includes("icons")?icons:catalog);help.installIntegrationHelp();help.openIntegrationHelp();</script>`;
 fs.writeFileSync('public/help-review.html',`<!doctype html><html><head><meta charset="utf-8"><title>Help guide review</title><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/reference-theme.css"></head><body><button data-open-integration-help="overlays">Open help</button>${script}</body></html>`.replaceAll("/guides/", "/public/guides/").replaceAll("/overlays/", "/public/overlays/"));
}
