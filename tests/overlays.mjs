// Template contracts; actual binding/animation DOM checks are in overlays-browser.html.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = name => fs.readFileSync(new URL('../public/overlays/'+name, import.meta.url),'utf8');
const runtime = read('overlay.js');
assert.doesNotMatch(runtime, /innerHTML|outerHTML|insertAdjacentHTML/, 'Runtime cannot replace the template layout with generated HTML');
for(const name of ['results','podium','points','world-record','cycle-complete','custom']) {
  const html = read(name+'.html');
  assert.match(html, /<main id="overlay"[^>]*>\s*(?:<!--[\s\S]*?-->\s*)?<\w/, name+' has actual editable markup');
  assert.match(html, /\{[A-Za-z][\w.]*\}/, name+' has real brace bindings');
  assert.match(html, /<script src="overlay.js"><\/script>/, name+' loads the binding runtime');
}
for(const name of ['results','podium']) {
  assert.match(read(name+'.html'), /<tbody data-repeat="placements"[^>]*>\s*<template>\s*<tr/);
  assert.match(read(name+'.html'), /data-show="isRace"/);
  assert.match(read(name+'.html'), /data-show="br"/);
}
for (const name of ['world-record','cycle-complete']) {
  const html = read(name+'.html');
  assert.match(html, name === "world-record" ? /data-confetti="400"/ : /data-confetti="300"/);
  assert.equal((html.match(/class="laser-beam"/g)||[]).length,name === 'world-record' ? 24 : 16);
  assert.equal((html.match(/class="party-spotlight /g)||[]).length,4);
}
assert.match(runtime, /if \(!\("animationName" in animation\)\) animation.cancel\(\)/, 'Hover resets preserve CSS celebration animations');
assert.match(read('cycle-complete.html'), /data-repeat="cycleCompletions"/);
assert.match(read('custom.html'), /\{firstplace\}/);
const guide = read('README.md');
assert.match(guide, /They do not work in OBS/);
assert.match(guide, /Edit HTML & variables/);
assert.match(guide, /Streamer.bot custom-event hooks are a separate integration/);
console.log('Template contracts passed: editable HTML, repeat templates, working binding entry points, separate setup instructions.');
