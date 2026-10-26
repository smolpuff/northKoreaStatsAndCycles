// Render the real app icons under dev and Tauri's nonce-augmented packaged CSP.
// No Tauri build/launch, user browser profile, or application data is used.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const browsers = [
  process.env.STYLE_TEST_BROWSER,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
].filter(Boolean);
const browser = browsers.find(file => fs.existsSync(file));
assert(browser, "Chrome or Edge is required for the packaged-style regression check");
const modules = new Map();
function load(file) {
  file = path.resolve(file);
  if (modules.has(file)) return modules.get(file).exports;
  const module = { exports: {} };
  modules.set(file, module);
  const code = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  const require = name => load(path.resolve(path.dirname(file), `${name}.ts`));
  vm.runInNewContext(code, { module, exports: module.exports, require });
  return module.exports;
}
const { sidebarArtwork } = load("src/sidebar-icons.ts");
const names = ["home", "overview", "racecycles", "history", "streamer", "twitch", "lumia", "discord", "streamdeck", "overlays", "logs", "settings"];
const icons = names.map(name => sidebarArtwork(name, `test-${name}`)).join("");
const css = ["styles", "reference-theme", "themes"].map(name => fs.readFileSync(`src/${name}.css`, "utf8")).join("\n");
const config = JSON.parse(fs.readFileSync("src-tauri/tauri.conf.json", "utf8"));
const packaged = policy => policy.replace("style-src 'self' 'unsafe-inline'", "style-src 'self' 'unsafe-inline' 'nonce-packaged-style'");
const policies = {
  dev: config.app.security.devCsp,
  // Negative control: the old policy must reproduce the reported missing styles.
  packagedBefore: packaged(config.app.security.csp.replace(" style-src-attr 'unsafe-inline';", "")),
  packagedAfter: packaged(config.app.security.csp),
};
const root = fs.mkdtempSync(path.join(os.tmpdir(), "mosstats-style-regression-"));
try {
  for (const [name, base] of Object.entries(policies)) {
    // Tauri also permits its own bundled scripts via nonces/hashes. This nonce
    // allows only the local test's computed-style probe; it does not permit eval.
    const policy = base.replace("script-src 'self'", "script-src 'self' 'nonce-test-script'");
    const file = path.join(root, `${name}.html`);
    const probe = `window.addEventListener('load',()=>{
      const fills=[...document.querySelectorAll('.sidebar-artwork')].map(svg=>getComputedStyle(svg.querySelector('path[style]')).fill);
      const player=getComputedStyle(document.getElementById('player'));
      const layout=getComputedStyle(document.getElementById('layout'));
      document.getElementById('result').textContent=JSON.stringify({fills,color:player.color,width:layout.width,opacity:layout.opacity});
    });`;
    fs.writeFileSync(file, `<!doctype html><meta http-equiv="Content-Security-Policy" content="${policy}"><style nonce="packaged-style">${css}\n#player{color:var(--player-color,rgb(1,2,3))}#layout{width:17px;opacity:1}</style>${icons}<div id="player" style="--player-color:#ff69b4">Player</div><div id="layout" style="width:173px;opacity:0.6">Layout</div><pre id="result"></pre><script nonce="test-script">${probe}</script>`);
    const run = spawnSync(browser, ["--headless", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--disable-background-networking", "--disable-component-update", `--user-data-dir=${path.join(root, `profile-${name}`)}`, "--dump-dom", pathToFileURL(file).href], {
      encoding: "utf8", windowsHide: true, timeout: 25000, maxBuffer: 4 * 1024 * 1024,
    });
    if (run.error) throw run.error;
    assert.equal(run.status, 0, `Browser failed: ${run.stderr.slice(-500)}`);
    const text = run.stdout.match(/<pre id="result">([^<]*)<\/pre>/)?.[1];
    assert(text, `No computed-style result for ${name}`);
    const result = JSON.parse(text.replaceAll("&quot;", '"').replaceAll("&amp;", "&"));
    assert.equal(result.fills.length, names.length);
    const expected = name !== "packagedBefore";
    result.fills.forEach((fill, index) => assert.equal(fill.includes(`navigation-test-${names[index]}-`), expected, `${name}: ${names[index]} gradient`));
    assert.equal(result.color, expected ? "rgb(255, 105, 180)" : "rgb(1, 2, 3)", `${name}: player color`);
    assert.equal(result.width, expected ? "173px" : "17px", `${name}: inline layout width`);
    assert.equal(result.opacity, expected ? "0.6" : "1", `${name}: inline opacity`);
    console.log(`${name}: ${names.length} icon gradients, player color, layout width and opacity ${expected ? "applied" : "blocked as expected"}`);
  }
} finally {
  // Remove only this test's verified, newly-created temporary directory.
  if (path.dirname(path.resolve(root)) === path.resolve(os.tmpdir()) && path.basename(root).startsWith("mosstats-style-regression-")) {
    try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); }
    catch { /* Browser profile cleanup must not mask a rendering regression. */ }
  }
}
console.log("Packaged-style browser regression checks passed; no application compiled or launched.");
