import { invoke } from "@tauri-apps/api/core";
import { showAnimatedDialog } from "./dialog-motion";
import { listen } from "@tauri-apps/api/event";
import { icons } from "./icons";

interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  notes: string[];
  skipped: boolean;
}
interface UpdateStatus { phase: string; percent?: number; error?: string }
const day = 24 * 60 * 60 * 1000;
const openedAt = Date.now();
let currentVersion = "";
let lastChecked = 0;
let lastAttempt = 0;
let message = "";
let checking = false;
let installing = false;
let canCancel = false;
let cancellationRequested = false;
let dialog: HTMLDialogElement | undefined;
let automaticEnabled = () => true;
let enabledPreviously: boolean | undefined;
let backgroundTimer: number | undefined;
let initialized = false;

function scheduleBackground(): void {
  if (backgroundTimer !== undefined) window.clearTimeout(backgroundTimer);
  backgroundTimer = undefined;
  enabledPreviously = automaticEnabled();
  if (!initialized || !enabledPreviously) return;
  const due = Math.max(openedAt + day, lastAttempt ? lastAttempt + day : openedAt + day);
  backgroundTimer = window.setTimeout(() => void check(false), Math.max(1000, due - Date.now()));
}

function refreshSettings(): void {
  const version = document.querySelector<HTMLElement>("[data-app-version]");
  if (version) version.textContent = currentVersion ? `v${currentVersion}` : "";
  const checked = document.querySelector<HTMLElement>("[data-update-last-checked]");
  if (checked) checked.textContent = `Last checked: ${lastChecked ? new Date(lastChecked).toLocaleString() : "Never"}`;
  const status = document.querySelector<HTMLElement>("[data-update-message]");
  if (status) status.textContent = message;
  const button = document.querySelector<HTMLButtonElement>("[data-check-updates]");
  if (button) {
    button.disabled = checking || installing;
    button.textContent = checking ? "Checking…" : "Check for updates";
  }
}

function showStatus(status: UpdateStatus): void {
  canCancel = installing && ["downloading", "verifying"].includes(status.phase);
  if (cancellationRequested && canCancel) return;
  const text = dialog?.querySelector<HTMLElement>("[data-install-status]");
  if (text) text.textContent = status.error ?? ({
    downloading: `Downloading update… ${status.percent ?? 0}%`,
    verifying: "Verifying download…",
    preparing: "Installing update…",
    restarting: "Restarting…",
    cancelled: "Download cancelled.",
    complete: "Simulation complete.",
  }[status.phase] ?? status.phase);
  const progress = dialog?.querySelector<HTMLProgressElement>("progress");
  if (progress) {
    progress.hidden = ["error", "cancelled", "complete"].includes(status.phase);
    if (status.phase === "downloading") progress.value = status.percent ?? 0;
    else progress.removeAttribute("value");
  }
  const bar = dialog?.querySelector<HTMLElement>("[data-update-bar]");
  const fill = dialog?.querySelector<HTMLElement>("[data-update-progress-fill]");
  if (bar && fill) {
    bar.hidden = progress?.hidden ?? false;
    bar.classList.toggle("indeterminate", status.phase !== "downloading");
    fill.style.width = status.phase === "downloading" ? `${Math.max(0, Math.min(100, status.percent ?? 0))}%` : "35%";
  }
  const cancel = dialog?.querySelector<HTMLButtonElement>("[data-cancel-download]");
  if (cancel) {
    cancel.disabled = installing && (!canCancel || cancellationRequested);
    cancel.textContent = installing ? "Cancel" : "Close";
  }
  const title = dialog?.querySelector<HTMLElement>("h2");
  if (title && installing) title.textContent = "Updating app";
  else if (title && status.phase === "cancelled") title.textContent = "Update cancelled";
  else if (title && status.phase === "complete") title.textContent = "Preview complete";
}

function showUpdate(info: UpdateInfo, preview = false): void {
  if (dialog) return;
  dialog = document.createElement("dialog");
  const popup = dialog;
  popup.className = "overlay-preview-dialog confirmation-dialog app-update-dialog";
  popup.setAttribute("aria-labelledby", "app-update-title");
  popup.setAttribute("aria-describedby", "app-update-description");
  popup.innerHTML = `<header><h2 id="app-update-title">App update available</h2><button type="button" class="compact-button modal-close" aria-label="Close" data-close>${icons.close}</button></header>
    <div data-update-offer><p id="app-update-description"></p><ul data-release-notes></ul>
    <p data-update-explanation></p></div>
    <div data-update-progress hidden><p id="app-install-status" data-install-status role="status" aria-live="polite"></p>
    <div class="app-update-progress-track" data-update-bar><progress max="100" value="0" aria-label="Update progress"></progress><span data-update-progress-fill aria-hidden="true" style="width: 0%"></span></div></div>
    <footer class="confirmation-actions"><button type="button" class="compact-button" data-later autofocus>Later</button><button type="button" class="compact-button app-update-primary" data-install>${icons.download}<span data-install-label>Download and install</span></button><button type="button" class="compact-button" data-cancel-download hidden>Cancel</button></footer>`;
  popup.querySelector("#app-update-description")!.textContent = `Installed: v${info.currentVersion} · Available: v${info.latestVersion}`;
  popup.querySelector("[data-update-explanation]")!.textContent = preview
    ? "Test preview: simulate download progress and restart stages. Your running app will stay open."
    : "The app will download and verify the update, finish current work, and restart. Your stats and settings are kept.";
  if (preview) popup.querySelector("[data-install-label]")!.textContent = "Simulate update";
  let simulationCancelled = false;
  let finishSimulationWait: (() => void) | undefined;
  const progressView = (active: boolean) => {
    popup.classList.toggle("update-in-progress", active);
    popup.querySelector<HTMLElement>("[data-update-offer]")!.hidden = active;
    popup.querySelector<HTMLElement>("[data-update-progress]")!.hidden = !active;
    popup.querySelectorAll<HTMLElement>("[data-close], [data-later], [data-install]").forEach(button => button.hidden = active);
    popup.querySelector<HTMLElement>("[data-cancel-download]")!.hidden = !active;
    popup.setAttribute("aria-describedby", active ? "app-install-status" : "app-update-description");
  };
  const cancelDownload = async () => {
    if (!installing) { popup.close(); return; }
    if (!canCancel || cancellationRequested) return;
    cancellationRequested = true;
    popup.querySelector<HTMLButtonElement>("[data-cancel-download]")!.disabled = true;
    popup.querySelector("[data-install-status]")!.textContent = "Cancelling…";
    if (preview) {
      simulationCancelled = true;
      finishSimulationWait?.();
    } else {
      try { await invoke("cancel_app_update"); }
      catch (error) {
        cancellationRequested = false;
        popup.querySelector("[data-install-status]")!.textContent = String(error);
        popup.querySelector<HTMLButtonElement>("[data-cancel-download]")!.disabled = !canCancel;
      }
    }
  };
  const notes = popup.querySelector("[data-release-notes]")!;
  for (const note of info.notes) {
    const item = document.createElement("li");
    item.textContent = note;
    notes.append(item);
  }
  popup.querySelectorAll("[data-close], [data-later]").forEach(button => button.addEventListener("click", () => { if (!installing) popup.close(); }));
  popup.querySelector("[data-cancel-download]")!.addEventListener("click", () => void cancelDownload());
  popup.addEventListener("cancel", event => { if (installing) { event.preventDefault(); void cancelDownload(); } });
  popup.addEventListener("close", () => { popup.remove(); dialog = undefined; }, { once: true });
  popup.querySelector("[data-install]")!.addEventListener("click", async () => {
    if (installing) return;
    installing = true;
    cancellationRequested = false;
    simulationCancelled = false;
    popup.querySelectorAll<HTMLButtonElement>("button").forEach(button => button.disabled = true);
    progressView(true);
    showStatus({ phase: "downloading", percent: 0 });
    popup.querySelector<HTMLButtonElement>("[data-cancel-download]")!.focus();
    refreshSettings();
    try {
      if (preview) {
        for (const status of [
          { phase: "downloading", percent: 25 },
          { phase: "downloading", percent: 65 },
          { phase: "downloading", percent: 100 },
          { phase: "verifying" },
          { phase: "preparing" },
          { phase: "restarting" },
        ]) {
          await new Promise<void>(resolve => {
            const timer = window.setTimeout(() => { finishSimulationWait = undefined; resolve(); }, 650);
            finishSimulationWait = () => { window.clearTimeout(timer); finishSimulationWait = undefined; resolve(); };
          });
          if (simulationCancelled) break;
          showStatus(status);
        }
        installing = false;
        cancellationRequested = false;
        showStatus({ phase: simulationCancelled ? "cancelled" : "complete" });
        popup.querySelectorAll<HTMLButtonElement>("button").forEach(button => button.disabled = false);
        refreshSettings();
      } else {
        await invoke("install_app_update", { version: info.latestVersion });
      }
    } catch (error) {
      installing = false;
      cancellationRequested = false;
      popup.querySelectorAll<HTMLButtonElement>("button").forEach(button => button.disabled = false);
      if (String(error).includes("Update cancelled")) showStatus({ phase: "cancelled" });
      else {
        progressView(false);
        popup.querySelector("h2")!.textContent = "App update available";
        popup.querySelector<HTMLElement>("[data-update-progress]")!.hidden = false;
        showStatus({ phase: "error", error: String(error) });
      }
      refreshSettings();
    }
  });
  document.body.append(popup);
  showAnimatedDialog(popup);
}

async function check(manual: boolean): Promise<void> {
  if (checking || installing) return;
  checking = true;
  lastAttempt = Date.now();
  if (manual) message = "";
  refreshSettings();
  try {
    const info = await invoke<UpdateInfo>("check_app_updates", { manual });
    if (info.skipped) return;
    lastChecked = Date.now();
    currentVersion = info.currentVersion;
    if (info.updateAvailable) {
      message = "Update available.";
      showUpdate(info);
    } else if (manual) message = "You are up to date.";
  } catch (error) {
    lastChecked = Date.now();
    if (manual) message = `Unable to check for updates: ${String(error)}`;
  } finally {
    checking = false;
    refreshSettings();
    scheduleBackground();
  }
}

export function bindUpdateSettings(): void {
  refreshSettings();
  if (initialized && enabledPreviously !== automaticEnabled()) scheduleBackground();
  document.querySelector("[data-check-updates]")?.addEventListener("click", () => void check(true));
}

export async function initializeUpdates(isEnabled = () => true): Promise<void> {
  automaticEnabled = isEnabled;
  await listen<UpdateStatus>("app-update-status", event => showStatus(event.payload));
  const info = await invoke<{ currentVersion: string; recovery?: string }>("app_update_ready");
  currentVersion = info.currentVersion;
  message = info.recovery ?? "";
  refreshSettings();
  initialized = true;
  scheduleBackground();
}
