import { icons } from "./icons";

export type GuideArt =
  | "server"
  | "actions"
  | "hook"
  | "variables"
  | "test"
  | "twitch-connect"
  | "twitch-access"
  | "twitch-posts"
  | "twitch-test"
  | "overlay-path"
  | "browser-source"
  | "obs-results"
  | "live-data"
  | "copy-html"
  | "edit-html"
  | "custom-source";
const icon = (name: string, extra = "") =>
  `<i class="guide-icon ${extra}">${icons[name] ?? icons.file}</i>`;
const cursor = icons.cursor.replace("phosphor-icon", "phosphor-icon guide-pointer");
const arrow = icons.arrowRight.replace("phosphor-icon", "phosphor-icon guide-arrow");
const check = `<span class="guide-success">${icons.check}</span>`;
const switchOn = `<span class="guide-mini-switch on"><span></span></span>`;
const switchOff = `<span class="guide-mini-switch"><span></span></span>`;
const miniButton = (label: string, name = "", pink = false) =>
  `<span class="guide-mini-button ${pink ? "pink" : ""}">${name ? icon(name) : ""}${label}</span>`;
const field = (label: string, value: string) =>
  `<div class="guide-mini-field"><span>${label}</span><span class="guide-mini-input">${value}</span></div>`;
const actionRow = (name: string, label: string) =>
  `<div class="guide-action-row">${icon(name)}<span>${label}</span><span class="guide-kebab">&#8942;</span></div>`;
const previewRow = (place: number, name: string, points: string) =>
  `<div class="guide-result-row ${place === 1 ? "winner" : ""}"><span>${place}</span><b>${name}</b><span>${points}</span></div>`;

/** Small, inert illustrations; every label is HTML text, never baked into an image. */
export function renderGuideIllustration(
  kind: GuideArt,
  event = "gameComplete",
): string {
  let art = "";
  const playerToken =
    event === "worldRecord"
      ? "{wrplayer}"
      : event === "cycleComplete"
        ? "{cycleplayer}"
        : "{firstplace}";
  switch (kind) {
    case "server":
      art = `<div class="guide-mini-panel guide-server"><div class="guide-mini-bar">${icon("streamer")}Streamer.bot</div><div class="guide-server-body"><div class="guide-server-nav"><span>General</span><b>Servers/Clients</b><span>WebSocket</span><span>OBS</span></div><div class="guide-server-options"><b>HTTP Server</b><span class="guide-checkbox">${icons.check}<span>Auto Start</span></span>${field("Host", "127.0.0.1")}${field("Port", "7474")}</div></div></div>`;
      break;
    case "actions":
      art = `<div class="guide-mini-panel guide-actions"><div class="guide-mini-bar"><b>Actions</b>${miniButton("+ Add Action")}</div>${actionRow("statRaceFlag", "Marbles - Game Complete")}${actionRow("trophy", "Marbles - World Record")}${actionRow("cycles", "Marbles - Cycle Complete")}</div>`;
      break;
    case "hook":
      art = `<div class="guide-hook"><div class="guide-no-trigger">${icon("file")}<span>Trigger</span>${icons.close}</div><div class="guide-hook-flow"><div class="guide-flow-node">${icon("cycles")}<b>Marbles Stats</b></div>${arrow}<div class="guide-flow-node">${icon("streamer")}<b>Streamer.bot<br>Action</b></div></div></div>`;
      break;
    case "variables":
      art = `<div class="guide-variable-flow"><div class="guide-mini-panel"><div class="guide-mini-bar">${icon("file")}Event arguments</div><code>${playerToken}</code><span>Test Winner</span></div>${arrow}<div class="guide-source-frame"><span>Winner:</span><b>Test Winner</b><span class="guide-source-handle"></span></div></div>`;
      break;
    case "test":
      art = `<div class="guide-test-art"><div class="guide-test-click">${miniButton("Test", "statRaceFlag")}${cursor}<span class="guide-click-rays"></span></div><div class="guide-mini-panel guide-action-history"><div class="guide-mini-bar">Action History</div><div>${check}<span>Marbles - Game Complete</span><small>3s ago</small></div><div>${check}<span>Marbles - World Record</span><small>12s ago</small></div><div>${check}<span>Marbles - Cycle Complete</span><small>28s ago</small></div></div></div>`;
      break;
    case "twitch-connect":
      art = `<div class="guide-connect-art"><div class="guide-twitch-browser"><div class="guide-browser-toolbar"><span></span><span></span><span></span></div><div class="guide-browser-ghost"><span></span><span></span></div><div class="guide-twitch-tile">${icon("twitch")}</div><div class="guide-browser-lines"><span></span><span></span></div></div><div class="guide-connect-button">${miniButton("Connect Twitch", "twitch", true)}${cursor}</div><span class="guide-connect-arrow">${arrow}</span></div>`;
      break;
    case "twitch-access":
      art = `<div class="guide-mini-panel guide-twitch-auth"><div class="guide-browser-toolbar"><span></span><span></span><span></span></div><b class="guide-twitch-word">twitch</b><div class="guide-auth-user"><span class="guide-avatar">${icon("racers")}</span><div><span></span><span></span></div></div><div class="guide-auth-permission"><span>${icons.check}</span>Send chat messages</div><div class="guide-auth-buttons">${miniButton("Cancel")}${miniButton("Authorize", "", true)}</div></div>`;
      break;
    case "twitch-posts":
      art = `<div class="guide-message-options"><div>${icon("statRaceFlag")}<span><b>Race Results</b><small>Post race results to Twitch chat.</small></span>${switchOn}</div><div>${icon("cycles")}<span><b>Cycle Completions</b><small>Post completed cycles to chat.</small></span>${switchOn}</div><div>${icon("trophy")}<span><b>World Records</b><small>Celebrate confirmed records.</small></span>${switchOff}</div></div>`;
      break;
    case "twitch-test":
      art = `<div class="guide-twitch-test"><div class="guide-mini-panel guide-chat"><div class="guide-mini-bar">Twitch Chat (example)</div><div>${icon("twitch")}<p><b>your account:</b> Race results:<br><span>Test Winner +10pts</span></p></div>${check}</div><div class="guide-chat-send">${miniButton("Test race results", "twitch")}${cursor}${arrow}</div></div>`;
      break;
    case "overlay-path":
      art = `<div class="guide-overlay-path"><div class="guide-overlay-file">${icon("file")}<div><b>Results</b><code>&#8230;/overlays/results.html</code></div></div><span class="guide-mini-input">Live overlay file path</span><div>${miniButton("Copy path", "file")}${cursor}</div></div>`;
      break;
    case "browser-source":
      art = `<div class="guide-mini-panel guide-browser-source"><div class="guide-mini-bar">OBS &middot; Browser Source</div><span class="guide-checkbox">${icons.check}<span>Local file</span></span><span class="guide-mini-input">&#8230;/overlays/results.html</span><div class="guide-browser-dimensions">${field("Width", "400")}${field("Height", "413")}</div></div>`;
      break;
    case "obs-results":
      art = `<div class="guide-obs-art"><div class="guide-obs-canvas"><div class="guide-results-frame"><b>Race results</b>${previewRow(1, "Test Winner", "+10")}${previewRow(2, "Test Second", "+8")}${previewRow(3, "Test Third", "+6")}<span class="guide-source-handle"></span></div></div><div class="guide-obs-source">${icon("overview")}<span>Results browser source</span>${icon("check")}</div></div>`;
      break;
    case "live-data":
      art = `<div class="guide-data-flow"><div class="guide-data-file">${icon("file")}<code>overlay-data.js</code></div>${arrow}<div class="guide-live-result"><b>Test Winner</b><span>10 points</span></div><span class="guide-poll">${icon("cycles")}Every 3 seconds</span></div>`;
      break;
    case "copy-html":
      art = `<div class="guide-copy-files"><div>${icon("file")}<code>custom.html</code></div>${arrow}<div>${icon("file")}<code>new.html</code></div><span>Same overlay folder</span></div>`;
      break;
    case "edit-html":
      art = `<div class="guide-mini-panel guide-code-editor"><div class="guide-mini-bar">${icon("file")}new.html</div><code>&lt;main id="overlay"&gt;<br><span>&nbsp;{firstplace}</span><br><span>&nbsp;{seasonPoints} season points</span><br>&lt;/main&gt;</code><div>overlay-config.js &middot; overlay.js</div></div>`;
      break;
    case "custom-source":
      art = `<div class="guide-custom-art"><div class="guide-obs-canvas"><div class="guide-source-frame"><b>Test Winner</b><span>1200 season points</span><span class="guide-source-handle"></span></div></div><div class="guide-obs-source">${icon("file")}<code>new.html</code>${icon("check")}</div></div>`;
      break;
  }
  return `<div class="guide-illustration guide-art-${kind}" aria-label="Illustration: ${kind.replaceAll("-", " ")}">${art}</div>`;
}

export function renderGuideStep(
  number: number,
  title: string,
  description: string,
  kind: GuideArt,
): string {
  return `<li class="guide-step"><div class="guide-step-copy"><div class="guide-step-title"><span>${number}</span><b>${title}</b></div><p>${description}</p></div>${renderGuideIllustration(kind)}</li>`;
}

/** Consistent section heading with its help action at the right edge. */
export function renderGuideHeader(
  title: string,
  description: string,
  topic: string,
  symbol = "book",
): string {
  return `<header class="guide-section-header"><div class="guide-section-heading"><i aria-hidden="true">${icons[symbol]}</i><div><h2>${title}</h2><p>${description}</p></div></div><button type="button" class="compact-button guide-help-button" data-open-integration-help="${topic}">Help &amp; variables</button></header>`;
}
