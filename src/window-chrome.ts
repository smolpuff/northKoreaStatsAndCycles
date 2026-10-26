import { getCurrentWindow } from "@tauri-apps/api/window";

const chrome = document.createElement("header");
chrome.className = "window-chrome";
chrome.innerHTML = `<div class="window-drag" data-tauri-drag-region>Marbles Stats</div>
  <div class="window-actions">
    <button type="button" data-window="minimize" aria-label="Minimize window" title="Minimize"><svg viewBox="0 0 12 12"><path d="M1 6.5h10"/></svg></button>
    <button type="button" data-window="maximize" aria-label="Maximize window" title="Maximize"><svg viewBox="0 0 12 12"><rect x="1.5" y="1.5" width="9" height="9"/></svg></button>
    <button type="button" data-window="close" aria-label="Close window" title="Close"><svg viewBox="0 0 12 12"><path d="m1.5 1.5 9 9m0-9-9 9"/></svg></button>
  </div>`;
document.body.prepend(chrome);
const appWindow = getCurrentWindow();
const maximize = chrome.querySelector<HTMLButtonElement>('[data-window="maximize"]')!;
async function refreshMaximize(): Promise<void> {
  const maximized = await appWindow.isMaximized();
  maximize.title = maximized ? "Restore" : "Maximize";
  maximize.setAttribute("aria-label", `${maximize.title} window`);
  maximize.innerHTML = maximized
    ? '<svg viewBox="0 0 12 12"><path d="M4 3V1.5h6.5V8H9"/><rect x="1.5" y="4" width="6.5" height="6.5"/></svg>'
    : '<svg viewBox="0 0 12 12"><rect x="1.5" y="1.5" width="9" height="9"/></svg>';
}
chrome.addEventListener("click", event => {
  const action = (event.target as Element).closest<HTMLButtonElement>("[data-window]")?.dataset.window;
  const pending = action === "minimize" ? appWindow.minimize()
    : action === "maximize" ? appWindow.toggleMaximize().then(refreshMaximize)
    : action === "close" ? appWindow.close() : undefined;
  void pending?.catch(console.error);
});
void refreshMaximize().catch(console.error);
void appWindow.onResized(() => { void refreshMaximize().catch(console.error); }).catch(console.error);
