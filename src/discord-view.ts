import { invoke } from "@tauri-apps/api/core";
import type {
  DiscordConfig,
  DiscordEvent,
  DiscordEventKind,
  Snapshot,
} from "./types";
import { icons } from "./icons";
import { sidebarArtwork } from "./sidebar-icons";
import { feedbackButton } from "./button-feedback";
import { renderGuideHeader, renderGuideStep } from "./guide-illustrations";
import { showAnimatedDialog } from "./dialog-motion";

export const discordEmbedStyles: Record<
  DiscordEventKind,
  { title: string; color: string }
> = {
  race: { title: "🏁 Race finished", color: "#00efaa" },
  battleRoyale: { title: "⚔️ Battle Royale finished", color: "#00efaa" },
  worldRecord: { title: "🏆 World record", color: "#ffe024" },
  cycleComplete: { title: "🎉 Cycle complete", color: "#ffe024" },
};

export const discordEvents: {
  kind: DiscordEventKind;
  title: string;
  description: string;
  icon: string;
}[] = [
  {
    kind: "race",
    title: "Race results",
    description:
      "Post newly counted Race results, with every placement and earned points.",
    icon: "raceFlag",
  },
  {
    kind: "battleRoyale",
    title: "Battle Royale results",
    description:
      "Post newly counted Battle Royale results independently of Race posts.",
    icon: "battleRoyale",
  },
  {
    kind: "cycleComplete",
    title: "Cycle complete",
    description:
      "Post once for each completed cycle, with the player and races taken.",
    icon: "cycles",
  },
  {
    kind: "worldRecord",
    title: "World record",
    description:
      "Post a confirmed world record, including records confirmed after the match.",
    icon: "stopwatch",
  },
];
export function defaultDiscordConfig(): DiscordConfig {
  const events = Object.fromEntries(
    discordEvents.map(({ kind }) => [
      kind,
      {
        enabled: false,
        target: "marbles-results",
        messageTemplate:
          kind === "cycleComplete"
            ? "🎉 Congrats {player} on a cycle! You are great! That's cycle #{cycle}! 🎉"
            : kind === "worldRecord"
              ? "World Record! {wrplayer} earned +{wrplayerpoints} points on {mapName} in {wrrecordtime}s!"
              : "🏁 {race} results: {placements}",
        placementTemplate: "{place} {player} +{points}pts",
        placementSeparator: " | ",
      },
    ]),
  ) as DiscordConfig["events"];
  return { enabled: false, targets: ["marbles-results"], events };
}
const escape = (text: string) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
const sample = (kind: DiscordEventKind): Record<string, string | number> => ({
  race: kind === "battleRoyale" ? "Battle Royale" : "Race",
  gameType: kind,
  playerCount: 3,
  mapName: "Test Map",
  firstplace: "Test Winner",
  firstplacepoints: 10,
  secondplace: "Test Second",
  secondplacepoints: 8,
  thirdplace: "Test Third",
  thirdplacepoints: 6,
  player: "Test Winner",
  cycle: 1,
  races: 823,
  cycleplayer: "Test Winner",
  cyclenumber: 1,
  cycleraces: 823,
  cycleplayerpoints: 10,
  wrplayer: "Test Winner",
  wrplayerpoints: 10,
  wrrecordtime: 42.123,
  isTest: "true",
  sessionPoints: 24,
  seasonPoints: 1200,
  matchPoints: 24,
  seasonName: "Test season",
  cycleSeasonName: "Test cycles",
});
export function formatDiscordText(
  template: string,
  values: Record<string, string | number>,
): string {
  return template.replace(/\{([^{}]+)\}/g, (token, key: string) =>
    String(values[key] ?? token),
  );
}
export function discordPreview(
  kind: DiscordEventKind,
  event: DiscordEvent,
): string {
  const values = sample(kind);
  const placements = ["Test Winner", "Test Second", "Test Third"]
    .map((player, index) =>
      formatDiscordText(event.placementTemplate, {
        ...values,
        player,
        username: player,
        placement: index + 1,
        place: ["🥇", "🥈", "🥉"][index],
        points: [10, 8, 6][index],
        time: [42.123, 43.123, 44.123][index],
      }),
    )
    .join(event.placementSeparator);
  return formatDiscordText(event.messageTemplate, { ...values, placements });
}
export const discordGuideSteps = () => `<ol class="guide-steps">
  ${renderGuideStep(1, "Create a text channel", "In your Discord server, create a normal text channel such as #marbles-results, or choose an existing one. You need Manage Webhooks permission for that channel. Ask a server admin if it is unavailable.", "discord-channel")}
  ${renderGuideStep(2, "Create its webhook", "Edit Channel > Integrations > Webhooks > New Webhook. Name it Marbles Stats, choose the correct channel, save changes if prompted, and Copy Webhook URL. Repeat for additional channels. Forum/media channels and threads are not supported here.", "discord-webhook")}
  ${renderGuideStep(3, "Connect your channels", "Click Set webhook here, label the target and paste its URL. The app validates it and stores it in Windows Credential Manager. Use Add channel for more targets; choose a saved target on each event. Every event starts on #marbles-results. No developer app, bot token or app ID is needed.", "discord-connect")}
  ${renderGuideStep(4, "Choose, customize and test", "Enable Discord, then only the events you want. Open Customize to edit the message and placement wording and check the live preview. Save, then Test posts a sample to that event's selected channel. The connection is checked automatically; Test connection checks Discord reachability without using webhooks or posting. Leave the app running for automatic posts.", "discord-test")}
</ol>`;
export function discordPage(state: Snapshot): string {
  const config = state.config.discord ?? defaultDiscordConfig();
  const status = state.discordStatus ?? "Disabled";
  const targets = (selected: string) =>
    config.targets
      .map(
        (target) =>
          `<option value="${escape(target)}" ${target === selected ? "selected" : ""}>#${escape(target)}</option>`,
      )
      .join("");
  const defaults = defaultDiscordConfig();
  return `<div class="page-head simple"><div class="race-heading"><i class="race-heading-icon">${sidebarArtwork("discord", "header-discord")}</i><div><h1>Discord</h1></div></div></div>
  <form id="settings-form" class="integration-page-layout discord-page-layout">
  <section class="panel settings-panel streamer-panel twitch-connection-panel"><div class="panel-body">
    <div class="twitch-connection-heading automation-connection-heading"><div class="twitch-layout-heading"><i>${icons.chain}</i><h2 class="connection-title">Discord Connection${status === "Connected" ? `<span class="connection-check">${icons.check}</span>` : ""}</h2></div><div class="connection-heading-controls"><div class="watch-state ${status === "Connected" ? "good" : ""}"><i></i><span>${escape(status)}</span></div><label class="toggle-row connection-enable-toggle" title="Enable Discord"><input id="discord-enabled" type="checkbox" role="switch" aria-label="Enable Discord" ${config.enabled ? "checked" : ""}></label></div></div>
    <div class="discord-hook-table-wrap"><table class="discord-hook-table"><thead><tr><th scope="col">Channel target</th><th scope="col">Webhook</th></tr></thead><tbody>${config.targets.map((target) => `<tr><td>#${escape(target)}</td><td><div class="discord-hook-actions">${feedbackButton(`discord-webhook-${target}`, "Set webhook", `data-discord-webhook="${escape(target)}"`, "chain")}${feedbackButton(`discord-webhook-test-${target}`, "Test", `data-discord-test="webhook" data-discord-target="${escape(target)}"`, "test")}${feedbackButton(`discord-remove-${target}`, "Remove", `data-discord-remove="${escape(target)}"`, "trash")}</div></td></tr>`).join("")}</tbody></table></div>
    <div class="integration-connection-controls">${feedbackButton("discord-add-channel", "Add channel", "data-discord-add-channel", "chain")}${feedbackButton("discord-connection", "Test connection", 'data-discord-test="connection"', "test")}</div>
  </div></section>
  <section class="panel settings-panel streamer-panel"><div class="panel-body"><fieldset class="integration-hook-controls" data-integration-master="discord-enabled" ${config.enabled ? "" : "disabled inert"}>
  <div class="twitch-layout-heading streamer-event-heading"><i>${icons.webhook}</i><h2>Event messages</h2><p>Every post is optional. Choose its target channel and customize its text, independently of Twitch and other integrations.</p></div>
  <div class="twitch-settings-grid">${discordEvents
    .map(({ kind, title, description, icon }) => {
      const event = config.events[kind];
      const results = ["race", "battleRoyale"].includes(kind);
      const customized =
        event.messageTemplate !== defaults.events[kind].messageTemplate ||
        event.placementTemplate !== defaults.events[kind].placementTemplate ||
        event.placementSeparator !== defaults.events[kind].placementSeparator;
      return `<section class="twitch-settings-section" data-feature-section="discord-${kind}-enabled"><label class="toggle-row twitch-feature-heading"><i>${icons[icon] ?? icons.raceFlag}</i><span><b>${title}</b><small>${description}</small></span><input id="discord-${kind}-enabled" type="checkbox" role="switch" aria-label="Post ${title}" ${event.enabled ? "checked" : ""}></label>
    <details class="twitch-message-customization" data-discord-customization="${kind}"><summary><span class="customize-button">${icons.caretDown} Customize</span><span class="twitch-customized-state" data-discord-customized="${kind}" ${customized ? "" : "hidden"}>${icons.check} Customized</span></summary>
    <div class="feature-content discord-message-content"><div class="discord-message-fields">
      <label class="field"><span>Target channel</span><select id="discord-${kind}-target">${targets(event.target)}</select></label>
      <label class="field"><span>${results ? "Overall message" : "Message"}</span><textarea id="discord-${kind}-message" rows="3" maxlength="2000">${escape(event.messageTemplate)}</textarea><small>${results ? "Use {race}, {mapName}, {playerCount}, {placements}, {firstplace}, {firstplacepoints}. Long results split into Discord-sized messages." : kind === "worldRecord" ? "Use {wrplayer}, {wrplayerpoints}, {wrrecordtime}, {mapName}." : "Use {player}, {cycle}, {races} (same as Twitch), or {cycleplayer}, {cyclenumber}, {cycleraces}, {cycleplayerpoints}, {cycleSeasonName}."} Discord Markdown is supported; mentions do not ping.</small></label>
      ${results ? `<label class="field"><span>Each placement</span><textarea id="discord-${kind}-placement" rows="2" maxlength="500">${escape(event.placementTemplate)}</textarea><small>Use {place} for 🥇/🥈/🥉 or #4+, {placement} for the number, {player}, {points}, {time}, {username}. All players are included.</small></label><label class="field"><span>Between placements</span><textarea id="discord-${kind}-separator" rows="1" maxlength="40">${escape(event.placementSeparator)}</textarea></label>` : ""}
    </div><div class="twitch-message-preview"><span>Preview · sample data · #<span data-discord-preview-target="${kind}">${escape(event.target)}</span></span><div class="discord-embed-preview" style="--discord-embed-color:${discordEmbedStyles[kind].color}"><b>${discordEmbedStyles[kind].title}</b><p data-discord-preview="${kind}">${escape(discordPreview(kind, event))}</p><small>Marbles Stats</small></div></div>
    <div class="twitch-message-actions">${feedbackButton(`discord-${kind}`, "Test message", `data-discord-test="${kind}"`, "test")}${feedbackButton(`save-discord-${kind}`, "Save", "data-discord-save", "file")}<button type="button" class="overlay-inline-link" data-open-integration-help="discord">Message help</button></div>
    </div></details></section>`;
    })
    .join("")}</div></fieldset></div></section>
  <div class="integration-save">${feedbackButton("save-discord", "Save settings", "", "file", "submit")}</div>
  <section class="panel settings-panel streamer-panel twitch-guide-panel">${renderGuideHeader("Setup Guide", "Connect Discord channels and choose the event messages you want to post.", "discord")}<div class="panel-body">${discordGuideSteps()}</div></section>
  <p class="settings-autosave-status" id="settings-autosave-status" role="status" aria-live="polite"></p></form>`;
}
export function readDiscordSettings(
  previous = defaultDiscordConfig(),
): DiscordConfig {
  const config: DiscordConfig = {
    ...previous,
    targets: [...previous.targets],
    events: { ...previous.events },
  };
  config.enabled =
    document.querySelector<HTMLInputElement>("#discord-enabled")?.checked ??
    previous.enabled;
  for (const { kind } of discordEvents) {
    const event = previous.events[kind];
    config.events[kind] = {
      ...event,
      enabled:
        document.querySelector<HTMLInputElement>(`#discord-${kind}-enabled`)
          ?.checked ?? event.enabled,
      target:
        document.querySelector<HTMLSelectElement>(`#discord-${kind}-target`)
          ?.value ?? event.target,
      messageTemplate:
        document.querySelector<HTMLTextAreaElement>(`#discord-${kind}-message`)
          ?.value ?? event.messageTemplate,
      placementTemplate:
        document.querySelector<HTMLTextAreaElement>(
          `#discord-${kind}-placement`,
        )?.value ?? event.placementTemplate,
      placementSeparator:
        document.querySelector<HTMLTextAreaElement>(
          `#discord-${kind}-separator`,
        )?.value ?? event.placementSeparator,
    };
  }
  return config;
}
export function openDiscordWebhookDialog(
  config: DiscordConfig,
  existing: string | undefined,
  saved: (state: Snapshot) => void,
): void {
  document.querySelector<HTMLDialogElement>("#discord-webhook-dialog")?.close();
  const dialog = document.createElement("dialog");
  dialog.id = "discord-webhook-dialog";
  dialog.className =
    "overlay-preview-dialog lumia-token-dialog discord-webhook-dialog";
  dialog.setAttribute("aria-labelledby", "discord-webhook-title");
  dialog.innerHTML = `<header><h2 id="discord-webhook-title">${existing ? "Set" : "Add"} Discord webhook</h2><button type="button" class="compact-button modal-close" data-close aria-label="Close">${icons.close}</button></header><form class="lumia-token-form"><label class="field"><span>Channel label</span><input name="target" value="${escape(existing ?? "")}" placeholder="marbles-results" pattern="[a-z0-9_-]{1,60}" required maxlength="60" ${existing ? "readonly" : ""}><small>Use the channel name as a label: lowercase letters, numbers, hyphens or underscores.</small></label><label class="field"><span>Webhook URL</span><input name="url" type="password" required autocomplete="off" maxlength="2048" aria-describedby="discord-webhook-help"></label><p id="discord-webhook-help" class="lumia-token-help">Discord: Edit Channel &gt; Integrations &gt; Webhooks &gt; Copy Webhook URL. The URL is validated without posting and stored in Windows Credential Manager. A webhook is tied to its channel.</p><p class="button-feedback-error" role="alert"></p><div class="lumia-token-actions"><button type="button" class="compact-button" data-close>Cancel</button>${feedbackButton("discord-save-webhook", "Save webhook", "", "file", "submit")}</div></form>`;
  dialog
    .querySelectorAll("[data-close]")
    .forEach((button) =>
      button.addEventListener("click", () => dialog.close()),
    );
  dialog.addEventListener("close", () => dialog.remove());
  dialog.querySelector("form")!.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = dialog.querySelector<HTMLButtonElement>(
      'button[type="submit"]',
    )!;
    submit.disabled = true;
    const target = dialog
      .querySelector<HTMLInputElement>('[name="target"]')!
      .value.trim();
    const secret = dialog.querySelector<HTMLInputElement>('[name="url"]')!;
    try {
      if (!existing && config.targets.includes(target))
        throw Error(
          "That label already exists. Use Set webhook on its existing row.",
        );
      const next = {
        ...config,
        targets: config.targets.includes(target)
          ? config.targets
          : [...config.targets, target],
      };
      const snapshot = await invoke<Snapshot>("save_discord_webhook", {
        config: next,
        target,
        url: secret.value,
      });
      secret.value = "";
      saved(snapshot);
      dialog.close();
    } catch (error) {
      dialog.querySelector('[role="alert"]')!.textContent = String(error);
    } finally {
      submit.disabled = false;
    }
  });
  document.body.append(dialog);
  showAnimatedDialog(dialog);
}
