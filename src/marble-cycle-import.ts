import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { icons } from "./icons";
import { showAnimatedDialog } from "./dialog-motion";
import { parseMarbleCyclePage } from "./marble-cycle-parser";
import type { Snapshot } from "./types";

export function openMarbleCycleImport(state: Snapshot, update: (snapshot: Snapshot) => void): void {
  if (document.querySelector("#marble-cycle-import-dialog")) return;
  const seasons = { ...state.config.seasons };
  const dialog = document.createElement("dialog");
  dialog.id = "marble-cycle-import-dialog";
  dialog.className = "overlay-preview-dialog confirmation-dialog";
  dialog.setAttribute("aria-labelledby", "marble-cycle-import-title");
  dialog.innerHTML = `<header><h2 id="marble-cycle-import-title">Import Marble Cycle history</h2><button type="button" class="compact-button modal-close" aria-label="Close">${icons.close}</button></header>
    <p data-target></p>
    <label class="field">Session URL<input type="url" placeholder="https://marblecycle.com/session/…" aria-label="Marble Cycle session URL" /></label>
    <label class="backup-choice" data-br-option><input type="checkbox" data-br-wins /> Count BR wins as Cycles 1st places</label>
    <p class="muted" data-br-note>MarblesCycles counts BR results. This option adds BR wins as 1st places.</p>
    <p data-status role="status" aria-live="polite">Enter a session URL to import all its historical results.</p>
    <div class="app-update-progress-track" data-import-progress hidden><progress max="100" value="0" aria-label="Import progress"></progress><span data-update-progress-fill aria-hidden="true" style="width:0%"></span></div>
    <p class="muted">Cycles only. All pages included; original dates and tracks unavailable. Existing placements carry forward.</p>
    <section data-success hidden role="status"><h3>${icons.check} Import complete</h3><p data-summary></p></section>
    <footer class="confirmation-actions"><button type="button" class="compact-button" data-done>Cancel</button><button type="button" class="compact-button app-update-primary" data-import disabled>${icons.download} Import</button></footer>`;
  dialog.querySelector("[data-target]")!.textContent = `Import into: ${seasons.cycleName || "Cycle progress"}`;
  const done = dialog.querySelector<HTMLButtonElement>("[data-done]")!;
  done.addEventListener("click", () => dialog.close());
  const input = dialog.querySelector<HTMLInputElement>("input[type=url]")!;
  const brWins = dialog.querySelector<HTMLInputElement>("[data-br-wins]")!;
  const status = dialog.querySelector<HTMLElement>("[data-status]")!;
  const commit = dialog.querySelector<HTMLButtonElement>("[data-import]")!;
  const close = dialog.querySelector<HTMLButtonElement>(".modal-close")!;
  const track = dialog.querySelector<HTMLElement>("[data-import-progress]")!;
  const progress = dialog.querySelector<HTMLProgressElement>("progress")!;
  const fill = dialog.querySelector<HTMLElement>("[data-update-progress-fill]")!;
  const showProgress = (percent?: number) => {
    track.hidden = false;
    track.classList.toggle("indeterminate", percent == null);
    if (percent == null) progress.removeAttribute("value"); else progress.value = percent;
    fill.style.width = percent == null ? "35%" : `${percent}%`;
  };
  let busy = false;
  const sessionUrl = (): string | undefined => {
    try {
      const url = new URL(input.value.trim());
      const id = /^\/session\/([\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12})\/?$/i.exec(url.pathname)?.[1];
      if (url.protocol !== "https:" || !["marblecycle.com", "www.marblecycle.com"].includes(url.hostname) || !id || url.search || url.hash || url.username || url.password || url.port) return;
      return `https://marblecycle.com/session/${id.toLowerCase()}`;
    } catch { return; }
  };
  const setBusy = (value: boolean) => {
    busy = value;
    input.disabled = brWins.disabled = done.disabled = close.disabled = value;
    commit.disabled = value || !sessionUrl();
  };
  close.addEventListener("click", () => dialog.close());
  dialog.addEventListener("cancel", event => { if (busy) event.preventDefault(); });
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  input.addEventListener("input", () => { commit.disabled = busy || !sessionUrl(); });
  commit.addEventListener("click", async () => {
    const loadedUrl = sessionUrl();
    if (!loadedUrl || busy) return;
    setBusy(true);
    commit.textContent = "Importing...";
    showProgress();
    status.textContent = "Retrieving every historical result...";
    let unlisten: UnlistenFn | undefined;
    try {
      const html = await invoke<string>("fetch_marble_cycle_session", { url: loadedUrl });
      const page = parseMarbleCyclePage(html, loadedUrl);
      showProgress(0);
      status.textContent = `Importing all ${page.resultEntries} result entries...`;
      unlisten = await listen<{ phase: string; current: number; total: number; percent: number }>("marble-cycle-import-progress", event => {
        showProgress(event.payload.percent);
        status.textContent = `${event.payload.phase}: ${event.payload.current} / ${event.payload.total} (${event.payload.percent}%)`;
      });
      const report = await invoke<{ snapshot: Snapshot; added: number; cycleRaces: number; skipped: number }>("import_marble_cycle_results", { url: loadedUrl, games: page.games, seasons, includeBrWins: brWins.checked });
      update(report.snapshot);
      const summary = `Added ${report.cycleRaces} races. Total: ${report.snapshot.totalCycleRaceCount} races · ${report.snapshot.raceCycles.length} players · ${report.snapshot.raceCycles.reduce((sum, player) => sum + player.cycles, 0)} cycles.`;
      status.hidden = true;
      dialog.querySelector<HTMLElement>("[data-success]")!.hidden = false;
      dialog.querySelector<HTMLElement>("[data-summary]")!.textContent = summary;
      input.closest<HTMLElement>(".field")!.hidden = true;
      dialog.querySelector<HTMLElement>("[data-br-option]")!.hidden = true;
      dialog.querySelectorAll<HTMLElement>(".muted").forEach(element => { element.hidden = true; });
      commit.hidden = true;
      done.textContent = "Close";
      track.hidden = true;
    } catch (error) { status.textContent = String(error); track.hidden = true; }
    finally { unlisten?.(); setBusy(false); if (!commit.hidden) commit.innerHTML = `${icons.download} Import`; else done.focus(); }
  });
  document.body.append(dialog);
  showAnimatedDialog(dialog);
  input.focus();
}
