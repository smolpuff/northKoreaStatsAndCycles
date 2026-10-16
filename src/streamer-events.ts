import { iconInput } from "./input-field";
import { showAnimatedDialog } from "./dialog-motion";
import { icons } from "./icons";
import { renderGuideIllustration } from "./guide-illustrations";
const events: Record<string, {title: string; example: string; fields: [string, string][]}> = {
  missionPromotion: {
    title: "Mission app promotion",
    example: "{promotionMessage}",
    fields: [["promotionMessage", "Promotion text"], ["downloadUrl", "Download link"], ["intervalMinutes", "Promotion interval"], ["isTest", "Whether this is a test"]],
  },
  gameComplete: {
    title: "Race complete",
    example: "Winner: {firstplace} (+{firstplacepoints} points)",
    fields: [["firstplace", "Winner's name"], ["firstplacepoints", "Winner's earned points"],
      ["secondplace", "Second player's name"], ["secondplacepoints", "Second player's earned points"],
      ["thirdplace", "Third player's name"], ["thirdplacepoints", "Third player's earned points"],
      ["firstplacetime", "Winner's finish time in seconds (BR may contain survival time)"],
      ["playerCount", "Players in this match"], ["mapName", "Track or map"],
      ["gameType", "race or battleRoyale"], ["matchPoints", "All players' points this match"],
      ["sessionPoints", "Race + BR points this app session"],
      ["placementsJson", "All player results as JSON, for scripts"]],
  },
  worldRecord: {
    title: "World record",
    example: "World record! {wrplayer}: {wrrecordtime}s (+{wrplayerpoints} points)",
    fields: [["wrplayer", "Record player's name"], ["wrplayerpoints", "Their earned points"],
      ["wrrecordtime", "Record time in seconds"], ["mapName", "Track name"]],
  },
  cycleComplete: {
    title: "Cycle complete",
    example: "{cycleplayer} completed cycle #{cyclenumber} in {cycleraces} races!",
    fields: [["cycleplayer", "Player who completed the cycle"], ["cyclenumber", "Their completed cycle number"],
      ["cycleraces", "Races taken, including duplicate placements; empty if unknown"],
      ["cycleSeasonName", "RaceCycles season label"]],
  },
};

const commonFields: [string, string][] = [
  ["race", "Race or Battle Royale"], ["mapName", "Track/map name"], ["playerCount", "Players in this match"],
  ["matchPoints", "All points earned this match"], ["sessionPoints", "Race + BR points this app session"],
  ["seasonPoints", "Race + BR points since reset"], ["seasonName", "RaceStats season label"],
  ["cycleSeasonName", "RaceCycles season label"], ["sessionRaces", "Session races"], ["sessionBRs", "Session BRs"],
  ["sessionPlayers", "Unique session players"], ["cyclePlayers", "Unique cycle players"], ["cycleRaces", "Tracked cycle races"],
  ["gameId", "Stable match ID"], ["snapshotId", "CSV snapshot ID"], ["eventId", "Event ID"],
  ["timestamp", "Match timestamp"], ["gameType", "Machine match type"], ["eventType", "Event kind"],
  ["hasWorldRecord", "Whether this match has a confirmed record"],
];

// Streamer.bot has its own argument delimiter. Keep app templates in braces and
// adapt only the clipboard text for its native sub-action fields.
export function formatStreamerBotText(template: string): string {
  const delimiter = String.fromCharCode(37);
  return template.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (_, name: string) => `${delimiter}${name}${delimiter}`);
}

function playerFields(prefix: string): [string, string][] {
  return [["username", "Account username"], ["platform", "Player platform"], ["placement", "Placement number"],
    ["seasontotal", "Player's CSV season total; empty if unavailable"], ["kills", "BR kills; empty for races"],
    ["damage", "BR damage; empty for races"], ["eliminated", "Eliminated flag; empty if unavailable"]]
    .map(([key, description]) => [prefix + key, description]);
}

export function formatLumiaText(template: string): string {
  return template.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (_, name: string) => `{{${name}}}`);
}

export function openEventVariables(kind: string, provider: "streamer" | "lumia" = "streamer"): void {
  const lumia = provider === "lumia";
  const providerName = lumia ? "Lumia Stream" : "Streamer.bot";
  const event = events[kind];
  if (!event) return;
  document.querySelector<HTMLDialogElement>("#event-variables-dialog")?.close();
  const dialog = document.createElement("dialog");
  dialog.id = "event-variables-dialog";
  dialog.className = "overlay-preview-dialog event-variables-dialog";
  dialog.setAttribute("aria-label", `${event.title} variables`);
  const extra = kind === "missionPromotion" ? [] : kind === "gameComplete"
    ? ["firstplace", "secondplace", "thirdplace"].flatMap(playerFields).concat([["secondplacetime", "Second player's time"], ["thirdplacetime", "Third player's time"]])
    : playerFields(kind === "worldRecord" ? "wrplayer" : "cycleplayer").concat(kind === "cycleComplete" ? [["cycleplayerpoints", "Points earned in the completing race"]] : []);
  const list = (fields: [string, string][]) => fields.map(([key, description]) => `<div><dt><code>{${key}}</code></dt><dd>${description}</dd></div>`).join("");
  dialog.innerHTML = `<header><h2>${event.title} variables</h2><button type="button" class="compact-button modal-close" aria-label="Close" title="Close">${icons.close}</button></header>
    ${lumia ? `<p>The app invokes your saved Lumia command directly through its local API with these extra variables. It does not send a chat message to trigger it. Add your desired actions in Lumia.</p><ol><li>Create and enable the Chat Command and its folder in Lumia.</li><li>Write text using the listed brace variables. Copy for Lumia converts them to double braces, such as <code>{{firstplace}}</code>. Paste it into the desired Lumia action.</li><li>Enable this event here, save and Test. Check Lumia's activity queue and OBS to verify the effects.</li></ol>` : `    <p>The app runs your named action with these values. Your normal Streamer.bot sub-actions decide what to update.</p>
    ${renderGuideIllustration("variables", kind)}
    <ol><li>In your Streamer.bot action, add <b>OBS Studio &gt; Sources &gt; Set GDI Text</b>. Choose your OBS connection, existing scene, and text source.</li><li>Write your text below using the listed brace variables. Click <b>Copy for Streamer.bot</b>, then paste into that sub-action's <b>Text</b> field. The copy button converts the variables to Streamer.bot's required format.</li><li>Enable this event here and click <b>Test</b>. Streamer.bot replaces the arguments and updates your source. Add your other sub-actions (show source, switch scene, sound) in the same action.</li></ol>
`}
    <label>Your text${iconInput(icons.file, `<input class="streamer-template-input" aria-label="Your text" />`)}</label>
    <button type="button" class="compact-button" data-copy-event-text>Copy for ${providerName}</button><p data-copy-status aria-live="polite"></p>
    <button type="button" class="compact-button" data-open-integration-help="${lumia ? "lumia" : kind}">Full guide &amp; all variables</button><dl>${list(event.fields)}</dl>
    <details><summary>More match and player values</summary><dl>${list(extra.concat(commonFields))}</dl>
    <p>Full result: placements / placementsJson contain every player's place, name, username, platform, points, seasonTotal, time, eliminated, kills, and damage. Arrays are for custom processing; use the named player fields above in normal text sub-actions. cycleCompletions and cycleLeaders contain cycle data; overlayDataJson contains the complete event packet.</p></details>
    ${lumia ? `<details><summary>Check the values sent</summary><p>These variables belong to the command run. For custom processing, placementsJson includes every result and overlayDataJson includes the complete packet. Lumia controls the command's actions. Check the activity queue after Test; acceptance does not prove every action ran.</p></details><p>Standalone HTML overlays have separate brace templates and work without either automation integration.</p>` : `    <details><summary>Check the values sent</summary><p>After Test: Streamer.bot &gt; Action Queues &gt; Action History. Right-click the run &gt; <b>Inspect Variables When Queued</b>. These arguments belong to this action run; another action needs its arguments forwarded. A later scene change does not run this event again.</p></details>
    <p>Use the copy button for Streamer.bot text fields that support arguments. OBS receives finished text. Standalone HTML overlays have their own brace templates and work separately.</p>`}`;
  const input = dialog.querySelector<HTMLInputElement>(".streamer-template-input")!;
  input.value = event.example;
  dialog.querySelector("button")!.addEventListener("click", () => dialog.close());
  dialog.querySelector("[data-copy-event-text]")!.addEventListener("click", async () => {
    const status = dialog.querySelector<HTMLElement>("[data-copy-status]")!;
    try {
      await navigator.clipboard.writeText(lumia ? formatLumiaText(input.value) : formatStreamerBotText(input.value));
      status.textContent = `Copied. Paste into ${providerName}'s text field.`;
    } catch {
      status.textContent = "Clipboard unavailable. Try copying again.";
    }
  });
  dialog.addEventListener("close", () => dialog.remove(), {once:true});
  document.body.append(dialog);
  showAnimatedDialog(dialog);
}
