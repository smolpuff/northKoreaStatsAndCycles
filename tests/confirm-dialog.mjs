import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

let active;
const document = {
  querySelector: () => active,
  body: { append(dialog) { active = dialog; } },
  createElement() {
    const controls = new Map();
    const listeners = new Map();
    return {
      returnValue: '',
      setAttribute() {},
      querySelector(selector) {
        if (!controls.has(selector)) controls.set(selector, {
          textContent: '',
          addEventListener(type, handler) { this[type] = handler; },
        });
        return controls.get(selector);
      },
      addEventListener(type, handler) { listeners.set(type, handler); },
      showModal() {},
      close(value = '') { this.returnValue = value; listeners.get('close')(); },
      remove() { active = undefined; },
    };
  },
};
const exports = {};
const source = fs.readFileSync('src/confirm-dialog.ts', 'utf8');
vm.runInNewContext(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports, document, require: () => ({ icons: { close: '<svg aria-hidden="true"></svg>' }, showAnimatedDialog: dialog => dialog.showModal() }) });

for (const dismissal of ['[data-cancel]', '[data-close]', 'escape', '[data-confirm]']) {
  const result = exports.confirmClear('Clear results?', 'What is removed.', 'Clear results');
  assert.equal(await exports.confirmClear('Duplicate', '', ''), false);
  assert.equal(active.querySelector('h2').textContent, 'Clear results?');
  assert(active.innerHTML.includes('data-cancel autofocus'));
  if (dismissal === 'escape') active.close();
  else active.querySelector(dismissal).click();
  assert.equal(await result, dismissal === '[data-confirm]');
  assert.equal(active, undefined);
}
const main = fs.readFileSync('src/main.ts', 'utf8');
assert.equal((main.match(/!await confirmClear\(/g) || []).length, 4);
assert(!/\bconfirm\(/.test(main));
console.log('Clear confirmations passed: all four actions guarded; Cancel, Close, Escape, and duplicate clicks cannot approve.');
