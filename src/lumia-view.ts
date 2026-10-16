import { invoke } from "@tauri-apps/api/core";
import type { LumiaConfig, Snapshot } from "./types";
import { lumiaIcon } from "./lumia-icon";
import { icons } from "./icons";
import { iconInput } from "./input-field";
import { feedbackButton } from "./button-feedback";
import { renderGuideHeader, renderGuideStep } from "./guide-illustrations";
import { showAnimatedDialog } from "./dialog-motion";

export function defaultLumiaConfig(): LumiaConfig {
  return { enabled: false, port: 39231,
    events: { raceComplete: false, worldRecord: false, cycleComplete: false, missionPromotion: false },
    actions: { gameComplete: "marbles-game-complete", worldRecord: "marbles-world-record", cycleComplete: "marbles-cycle-complete", missionPromotion: "marbles-mission-promotion" } };
}
const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export function lumiaPage(state: Snapshot): string {
  const config = state.config.lumia ?? defaultLumiaConfig();
  const status = state.lumiaStatus ?? "Disabled";
  const events = [
    { key: "raceComplete", action: "gameComplete", title: "Race / Battle Royale complete", description: "Run once per newly counted match. Includes first/second/third fields and every placement.", icon: icons.raceFlag },
    { key: "worldRecord", action: "worldRecord", title: "World record", description: "Run when a new world record is confirmed, including delayed record metadata.", icon: icons.stopwatch },
    { key: "cycleComplete", action: "cycleComplete", title: "Cycle complete", description: "Run once per completed cycle with the player, cycle number and races taken.", icon: icons.cycles },
    { key: "missionPromotion", action: "missionPromotion", title: "Mission app promotion", description: "Run on the promotion interval in Settings, even without a Twitch login in this app.", icon: icons.webhook },
  ] as const;
  return `<div class="page-head simple"><div class="race-heading"><i class="race-heading-icon">${lumiaIcon}</i><h1>Lumia Stream</h1></div></div>
  <form id="settings-form" class="integration-page-layout lumia-page-layout">
    <section class="panel settings-panel streamer-panel twitch-connection-panel"><div class="panel-body">
      <div class="twitch-connection-heading automation-connection-heading"><div class="twitch-layout-heading"><i>${icons.chain}</i><div><h2 class="connection-title">Lumia Stream Connection${status === "Connected" ? `<span class="connection-check">${icons.check}</span>` : ""}</h2></div></div><div class="connection-heading-controls"><div class="watch-state ${status === "Connected" ? "good" : status === "Error" || status === "Unavailable" ? "warning" : ""}"><i></i><span>${escape(status)}</span></div><label class="toggle-row connection-enable-toggle" title="Enable Lumia Stream"><input id="lumia-enabled" type="checkbox" role="switch" aria-label="Enable Lumia Stream" ${config.enabled ? "checked" : ""}></label></div></div>
      <div class="fields-grid connection-fields streamer-connection-fields"><label class="field"><span>Host</span>${iconInput(icons.server, `<input value="127.0.0.1" readonly aria-label="Lumia host">`)}</label><label class="field port-field"><span>Port</span>${iconInput(icons.port, `<input id="lumia-port" type="number" min="1" max="65535" required value="${config.port}">`)}</label>${feedbackButton("lumia-connection", "Test connection", 'data-lumia-test="connection"', "test")}</div>
      <div class="integration-connection-controls lumia-token-controls">${feedbackButton("lumia-token", "Set API token", "data-lumia-token", "file")}${feedbackButton("lumia-remove-token", "Remove API token", "data-lumia-remove-token", "trash")}</div>
      <p>In Lumia, expand Settings in the sidebar and open API &amp; MCP. Enable Developers API. The token is saved in Windows Credential Manager.</p>
      ${state.lumiaMessage ? `<p class="lumia-connection-message ${status === "Error" || status === "Unavailable" ? "button-feedback-error" : ""}" role="status">${escape(state.lumiaMessage)}</p>` : ""}
    </div></section>
    <section class="panel settings-panel streamer-panel streamer-hooks-panel"><div class="panel-body"><fieldset class="integration-hook-controls" data-integration-master="lumia-enabled" ${config.enabled ? "" : "disabled inert"}><div class="twitch-layout-heading streamer-event-heading"><i>${icons.webhook}</i><h2>Custom event hooks</h2><p>Run saved Lumia commands directly through its local API, with the same event data used by Streamer.bot. No chat message is sent to trigger them. Configure their actions in Lumia. HTML overlays work independently.</p></div>
    <div class="streamer-events">${events.map(event => `<section class="twitch-settings-section streamer-event-card" data-feature-section="lumia-${event.key}-enabled"><label class="toggle-row twitch-feature-heading"><i>${event.icon}</i><span><b>${event.title}</b><small>${event.description}</small></span><input id="lumia-${event.key}-enabled" type="checkbox" role="switch" ${config.events[event.key] ? "checked" : ""}></label><div class="streamer-action-controls"><div class="feature-content"><label class="field"><span>Command name:</span>${iconInput(icons.webhook, `<input id="lumia-${event.action}-action" maxlength="200" value="${escape(config.actions[event.action] ?? "")}">`)}</label>${feedbackButton(`lumia-${event.action}`, "Test", `data-lumia-test="${event.action}"`, "test")}</div><button type="button" class="overlay-inline-link event-variables-link" data-lumia-variables="${event.action}">Variables</button></div></section>`).join("")}</div></fieldset></div></section>
    <div class="integration-save">${feedbackButton("save-lumia", "Save settings", "", "file", "submit")}</div>
    <section class="panel settings-panel streamer-panel twitch-guide-panel">${renderGuideHeader("Setup Guide", "Connect Lumia and configure its actions for every Marbles event.", "lumia")}<div class="panel-body"><ol class="guide-steps">
      ${renderGuideStep(1, "Enable Developers API", "In Lumia, expand Settings in the sidebar and open API &amp; MCP. Enable Developers API, copy the token and use Set API token here. Match the port, then Test connection.", "lumia-server")}
      ${renderGuideStep(2, "Create your commands", "Create and enable the named commands in Lumia's Chat Commands section and enter their exact names here. The app invokes them directly through the API; no chat message is sent.", "lumia-actions")}
      ${renderGuideStep(3, "Configure your actions", "Add your desired actions in Lumia. Variables lets you copy text using {{firstplace}}, {{firstplacepoints}} and other event data. Use placementsJson or overlayDataJson for complete data in custom processing.", "variables")}
      ${renderGuideStep(4, "Test and verify", "Enable the event, save, then Test. A sample runs without adding stats. Check Lumia's Dashboard activity and your configured effects. Stats and overlays continue if Lumia is unavailable.", "lumia-test")}
    </ol><p>Test confirms the API accepted the request. Check Lumia's activity queue and OBS to verify your configured effects. Lumia must report the name-validation API capability. Older versions that cannot validate disabled commands are rejected with an update message.</p><p><a href="https://dev.lumiastream.com/docs/rest/send-commands" target="_blank" rel="noreferrer">Lumia command API documentation</a></p></div></section>
    <p class="settings-autosave-status" id="settings-autosave-status" role="status" aria-live="polite"></p>
  </form>`;
}
export function readLumiaSettings(previous = defaultLumiaConfig()): LumiaConfig {
  const config: LumiaConfig = { ...previous, actions: { ...previous.actions }, events: { ...previous.events } };
  config.enabled = document.querySelector<HTMLInputElement>("#lumia-enabled")?.checked ?? previous.enabled;
  config.port = Number(document.querySelector<HTMLInputElement>("#lumia-port")?.value ?? previous.port);
  for (const key of ["raceComplete", "worldRecord", "cycleComplete", "missionPromotion"] as const) config.events[key] = document.querySelector<HTMLInputElement>(`#lumia-${key}-enabled`)?.checked ?? previous.events[key] ?? false;
  for (const key of ["gameComplete", "worldRecord", "cycleComplete", "missionPromotion"] as const) config.actions[key] = document.querySelector<HTMLInputElement>(`#lumia-${key}-action`)?.value.trim() ?? previous.actions[key] ?? "";
  return config;
}
export function openLumiaTokenDialog(config: LumiaConfig, saved: (snapshot: Snapshot) => void): void {
  document.querySelector<HTMLDialogElement>("#lumia-token-dialog")?.close();
  const dialog = document.createElement("dialog"); dialog.id = "lumia-token-dialog"; dialog.className = "overlay-preview-dialog lumia-token-dialog";
  dialog.setAttribute("aria-labelledby", "lumia-token-title");
  dialog.innerHTML = `<header><h2 id="lumia-token-title">Lumia API token</h2><button type="button" class="compact-button modal-close" data-close aria-label="Close">${icons.close}</button></header>
    <form class="lumia-token-form"><p>Copy your token from Lumia's <b>Settings &gt; API &amp; MCP</b>.</p>
      <label class="field"><span>API token</span><input type="password" autocomplete="off" required maxlength="2048" aria-label="Lumia API token" aria-describedby="lumia-token-help" autofocus></label>
      <p id="lumia-token-help" class="lumia-token-help">The token is checked against your local Lumia API and saved in Windows Credential Manager.</p>
      <p class="button-feedback-error" role="alert"></p>
      <div class="lumia-token-actions"><button type="button" class="compact-button" data-close>Cancel</button>${feedbackButton("lumia-save-token", "Save token", "", "file", "submit")}</div>
    </form>`;
  dialog.querySelectorAll("[data-close]").forEach(button => button.addEventListener("click", () => dialog.close()));
  dialog.addEventListener("close", () => dialog.remove());
  dialog.querySelector("form")!.addEventListener("submit", async event => {
    event.preventDefault(); const input = dialog.querySelector("input")!; const submit = dialog.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    submit.disabled = true;
    try { const snapshot = await invoke<Snapshot>("save_lumia_token", { config, token: input.value }); input.value = ""; saved(snapshot); dialog.close(); }
    catch (error) { dialog.querySelector('[role="alert"]')!.textContent = String(error); }
    finally { submit.disabled = false; }
  });
  document.body.append(dialog); showAnimatedDialog(dialog);
}
