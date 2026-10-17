import { invoke } from "@tauri-apps/api/core";

interface InstalledPlugin {
  installed: boolean | null;
  version: string | null;
}
type InstalledPlugins = Record<"controls" | "dropgate", InstalledPlugin>;

export function pluginInstallAction(status: InstalledPlugin, bundled: string): "Install" | "Update" | "Reinstall" {
  if (status.installed !== true) return "Install";
  const parse = (version: string) => /^\d+(?:\.\d+){2,3}$/.test(version)
    ? version.split(".").map(Number) : null;
  const installed = parse(status.version ?? "");
  const available = parse(bundled);
  if (installed && available) {
    for (let index = 0; index < 4; index++) {
      if ((installed[index] ?? 0) < (available[index] ?? 0)) return "Update";
      if ((installed[index] ?? 0) > (available[index] ?? 0)) break;
    }
  }
  return "Reinstall";
}

let cached: InstalledPlugins | undefined;
let checkedAt = 0;
let pending: Promise<void> | undefined;

function updateButtons(): void {
  if (!cached) return;
  document.querySelectorAll<HTMLButtonElement>("[data-streamdeck-plugin]").forEach(button => {
    if (button.disabled) return; // Keep the shared busy/success feedback intact.
    const status = cached![button.dataset.streamdeckPlugin as keyof InstalledPlugins];
    if (!status) return;
    const label = button.querySelector("span");
    if (label) label.textContent = `${pluginInstallAction(status, button.dataset.pluginVersion!)} ${button.dataset.pluginName}`;
    button.title = status.installed === null ? "Installation status unavailable"
      : status.installed ? (status.version ? `Installed v${status.version}` : "Installed") : "Not installed";
  });
}

export async function refreshStreamDeckInstallStatus(force = false): Promise<void> {
  if (!document.querySelector("[data-streamdeck-plugin]")) return;
  updateButtons();
  if (!force && Date.now() - checkedAt < 5000) return;
  if (!pending) {
    checkedAt = Date.now();
    pending = invoke<InstalledPlugins>("get_streamdeck_install_status")
      .then(status => { cached = status; })
      .catch(() => { cached = { controls: { installed: null, version: null }, dropgate: { installed: null, version: null } }; })
      .finally(() => { pending = undefined; });
  }
  await pending;
  updateButtons();
}

window.addEventListener("focus", () => { void refreshStreamDeckInstallStatus(true); });
window.setInterval(() => {
  if (!document.hidden) void refreshStreamDeckInstallStatus();
}, 5000);
