// Headless dialog behavior only; never starts the app or writes runtime data.
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const ts = require('typescript');
const assert = require('assert/strict');
const { parseHTML, DOMParser } = require(process.argv[2]);
const { document, window } = parseHTML('<html><body></body></html>');
window.HTMLElement.prototype.focus = function () {};
let progressListener, unlistened = false, request, updated;
const id = '13e1c46f-3301-4d50-ba61-4324972c7e08';
const html = `<table id="marbleRaceResults"><tbody><tr id="${id}" class="race-summary"><td>1</td><td>Winner</td><td>1</td><td>1</td><td>00:00:50</td></tr><tr id="tbl-${id}"><td><table><tbody><tr><td>1</td><td>Winner</td><td>10</td><td>0</td></tr></tbody></table></td></tr></tbody></table>`;
const cache = new Map();
function load(file) {
  file = path.resolve(file);
  if (cache.has(file)) return cache.get(file);
  const module = { exports: {} };
  cache.set(file, module.exports);
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const requireModule = name => {
    if (name === '@tauri-apps/api/core') return { invoke: async (command, args) => {
      if (command === 'fetch_marble_cycle_session') return html;
      request = args;
      progressListener({ payload: { phase: 'Calculating Cycles', current: 1, total: 1, percent: 95 } });
      assert.equal(document.querySelector('progress').value, 95);
      return { snapshot: { imported: true, totalCycleRaceCount: 1, raceCycles: [{ cycles: 0 }] }, added: 1, cycleRaces: 1, skipped: 0 };
    } };
    if (name === '@tauri-apps/api/event') return { listen: async (_, callback) => { progressListener = callback; return () => { unlistened = true; }; } };
    if (name === './dialog-motion') return { showAnimatedDialog: dialog => { dialog.close = () => dialog.dispatchEvent(new window.Event('close')); } };
    return load(path.resolve(path.dirname(file), name + '.ts'));
  };
  vm.runInNewContext(js, { module, exports: module.exports, require: requireModule, document, DOMParser, URL });
  return module.exports;
}
(async () => {
  const { openMarbleCycleImport } = load('src/marble-cycle-import.ts');
  openMarbleCycleImport({ config: { seasons: { raceName: 'Season 72', cycleName: 'Season 72' } } }, snapshot => { updated = snapshot; });
  const dialog = document.querySelector('dialog');
  const option = dialog.querySelector('[data-br-wins]');
  assert(!option.checked);
  option.checked = true;
  assert(dialog.querySelector('[data-import]').disabled);
  assert(!dialog.querySelector('[data-load]'));
  assert(dialog.querySelector('[data-import]').classList.contains('app-update-primary'));
  dialog.querySelector('input[type=url]').value = `https://marblecycle.com/session/${id}`;
  dialog.querySelector('input[type=url]').dispatchEvent(new window.Event('input'));
  assert(!dialog.querySelector('[data-import]').disabled);
  dialog.querySelector('[data-import]').click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(request.includeBrWins, true);
  assert.equal(request.seasons.cycleName, 'Season 72');
  assert(updated.imported);
  assert(unlistened);
  assert(!dialog.querySelector('[data-success]').hidden);
  assert(dialog.querySelector('[data-success] h3 svg'));
  assert(dialog.querySelector('[data-success]').textContent.includes('Import complete'));
  assert(dialog.querySelector('[data-import]').hidden);
  assert(!dialog.querySelector('[data-done]').hidden);
  dialog.querySelector('[data-done]').click();
  assert(!document.querySelector('dialog'));
  console.log('Passed import progress, BR-win option, success/checkmark, Close and listener-cleanup checks.');
})().catch(error => { console.error(error); process.exitCode = 1; });
