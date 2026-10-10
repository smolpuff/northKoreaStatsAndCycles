import { iconInput } from "./input-field";
import { showAnimatedDialog } from "./dialog-motion";
import { icons } from "./icons";
import { renderGuideStep } from "./guide-illustrations";
import { allHelpFieldGroups as helpFieldGroups } from "./help-fields";

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const example = (text: string) => `<pre>${escape(text)}</pre>`;
const illustratedGuide = (name: string) => {
  const step = renderGuideStep;
  const content = name === "overlay-setup" ? [
    step(1, "Copy the overlay path", "On the Overlays page, choose a template and click Copy path.", "overlay-path"),
    step(2, "Add a Browser Source", "In OBS, Sources + > Browser. Enable Local file and select that HTML page. Use the OBS source size on that overlay's card. Default Results: 400 &times; 413; Podium: 400 &times; 300; Points: 400 &times; 260; celebrations: full canvas.", "browser-source"),
    step(3, "Test and position", "Keep Results, Podium and Points visible and position their live data. Use Test on World record or Cycle completed to position those celebrations without counting a match.", "obs-results"),
    step(4, "Let the data update", "Leave the app running. Browser pages check for new match data every 3 seconds.", "live-data")
  ] : name === "overlay-template" ? [
    step(1, "Copy the starter", "Copy custom.html to new.html in the same live overlay folder. Keep its scripts beside it.", "copy-html"),
    step(2, "Edit your markup", "Open new.html in Notepad. Edit HTML inside #overlay and your CSS. Keep data-overlay=custom and both script links. Save as .html, not .html.txt.", "edit-html"),
    step(3, "Add your own page", "Use one Local-file Browser Source for new.html. Refresh the source after editing HTML.", "custom-source"),
    step(4, "Values update automatically", "The app writes overlay-data.js. The page replaces values in its existing markup every 3 seconds.", "live-data")
  ] : name === "streamer-server" ? [
    step(1, "Enable HTTP Server", "Open Servers/Clients in Streamer.bot. Start HTTP Server with the app's host and port; default 127.0.0.1:7474. Enable Auto Start.", "server"),
    step(2, "Create your actions", "Use each event card's exact action name. You only need the actions for events you enable.", "actions"),
    step(3, "No trigger needed", "Marbles Stats calls your named action through Streamer.bot's HTTP API, with that event's arguments.", "hook"),
    step(4, "Test and verify", "Add your OBS sub-actions to the action. Save and Test from the app. Check Action History in Streamer.bot.", "test")
  ] : [
    step(1, "Connect Twitch", "Connect Twitch opens the authorization page in your browser.", "twitch-connect"),
    step(2, "Approve access", "Sign in and approve the requested chat permission.", "twitch-access"),
    step(3, "Customize what to post", "Enable the posting card, open Customize, edit its listed brace variables, then Save.", "twitch-posts"),
    step(4, "Test in your chat", "Test posts sample text to the connected account's own channel without counting a match.", "twitch-test")
  ];
  return `<ol class="guide-steps">${content.join("")}</ol>`;
};

const overlayGuide = `
<h2>HTML overlays: one page, any supported fields</h2>
<p>Use a <b>Browser Source</b> for an HTML overlay. The app supplies data; the page fills its braces. Streamer.bot is not required.</p>
${illustratedGuide("overlay-setup")}

<p>Click Customize at the right of an overlay card's buttons to change its background opacity, colors, header and OBS width/height. The thumbnail previews edits; Save applies them to the live source on its next data check. After resizing, enter the size shown on the card in OBS Browser Source properties. Celebration duration is in the same section. Restore defaults resets these controls, preserving edited HTML/CSS files. Custom HTML pages keep their own styles.</p><p>Results, Podium and Points remain visible. WR and Cycle Complete show only for their events and hide after 10 seconds by default. Put celebrations above your other OBS sources. <b>Automatic World Record detection watches LastCustomRaceMapPlayed.csv.</b> A changed MapName/RecordHolderName/RecordTime/DateSet record must match the latest completed match's map and first-place player. Races also require the winning time to match within 0.001 seconds. Metadata and result writes must be within two minutes of each other. StreamerRecordHolder is a local streamer record and is ignored. Existing metadata on startup and repeated records do not trigger an alert; late metadata can trigger the WR without recounting the match.</p>
`;
const customGuide = `<h2>Custom HTML overlays</h2>
<p>Build one Browser Source with several values. Follow the illustrated steps to create your HTML file and connect it to the live data.</p>
<h3 id="help-custom">Create new.html</h3>
${illustratedGuide("overlay-template")}

<details><summary>Complete starter shell: copy into new.html</summary>${example(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>My overlay</title>
  <style>
    body { margin: 0; background: transparent; color: gold;
           font: 32px "Segoe UI", sans-serif; }
    [hidden] { display: none !important; }
    #overlay { padding: 16px; }
  </style>
</head>
<body data-overlay="custom">
  <main id="overlay" hidden>
    <p>{race} winner: {firstplace}</p>
    <p>Winner points: {firstplacepoints}</p>
    <p>Session: {sessionPoints} | Season: {seasonPoints}</p>
  </main>
  <script src="overlay-config.js"></script>
  <script src="overlay.js"></script>
</body>
</html>`)}</details>
<h3>What can I combine?</h3>
<p>You can put multiple supported variables in the same page. This example combines a player's name, points and overall season points:</p>
${example(`<p>{race} winner: {firstplace}</p>
<p>Earned: {firstplacepoints} points</p>
<p>Session: {sessionPoints} | Season: {seasonPoints}</p>`)}
<p>Arrays start at 0. Dotted paths such as <code>{placements.0.name}</code> select a row in placement order; an absent row is blank. Latest-match fields are replaced when a Race or BR is processed; separate last-Race and last-BR bindings do not currently exist. A custom page cannot retain both using braces alone.</p>
<h3>How it updates</h3>
<p>The app writes <code>overlay-data.js</code>. Your custom page loads it immediately and checks again every <b>3 seconds</b>. JavaScript fills the existing markup; it does not rewrite your HTML file. Leave the app running. Your HTML/CSS edits are preserved. The app's thumbnails and Open preview show bundled sample templates, not your edited live file.</p>
<p>Only text inside <code>#overlay</code> and the attributes <code>title</code>, <code>alt</code>, <code>aria-label</code> support braces. Unknown/missing text values become blank; numeric bindings show a dash. HTML names are inserted as safe text. Braces do not bind arbitrary CSS, href, src, styles, or scripts.</p>
<details><summary>Rows, number animation and conditional display</summary>
${example(`<ul data-repeat="placements" data-key="playerKey">
  <template><li>{place}. {name}: {points} points</li></template>
</ul>`)}
<p>Row fields such as <code>{name}</code> belong inside this template. <code>data-limit="3"</code> limits rows. Remove the limit to include everyone. A row also has access to the page fields.</p>
${example(`<span data-number="sessionPoints">{sessionPoints}</span>
<span data-number="firstplacetime" data-decimals="3" data-suffix="s">{firstplacetime}</span>
<p data-show="br">Battle Royale</p>`)}
<p>Plain brace text changes immediately. data-number counts between numeric values; decimals supports 0 to 6. data-show uses truthiness, so a points value of zero would hide that element. Use the documented boolean fields for visibility.</p>
<p>Cycle row example:</p>${example(`<div data-repeat="cycleCompletions" data-key="completionKey">
  <template><p>{playerName}: cycle #{cycleNumber}, {races} races</p></template>
</div>`)}
<p>For a custom WR or cycle alert, copy that celebration HTML and keep its data-overlay value. It reads its separate alert data file and keeps its show/hide timing. Generic custom.html reads the latest-match data file; it does not automatically receive WR fields or cycle-completion rows.</p></details>
<details><summary>Files and settings</summary><p>Keep new.html beside overlay.js, overlay-config.js and overlay-data.js. WR uses world-record-data.js; Cycle Complete uses cycle-complete-data.js. The app owns those data files. Edit your HTML or its own style block; changing shared overlay.css affects every template that links it. Settings are listed in All variables under overlay-config.js settings.</p><p>You choose which sources to add. Each selected HTML file gets one Browser Source, regardless of how many values you display. OBS can keep a source visible while switching scenes; these pages use their data file, not Streamer.bot arguments.</p></details>
<p><a href="https://obsproject.com/kb/browser-source" target="_blank" rel="noreferrer">Official OBS Browser Source documentation</a></p>`;

const streamerGuide = `
<h2>Streamer.bot: update your existing scene</h2>
<p>The app calls your named action and supplies its arguments. Your normal Streamer.bot sub-actions update text, play media, show sources, or switch scenes. The app does not control OBS directly.</p>
${illustratedGuide("streamer-server")}
<p>HTTP Server and WebSocket port 8080 are different servers. For OBS sub-actions, configure a working OBS connection <b>in Streamer.bot</b>. Create and style your Text (GDI+) source in your normal scene. Leave <b>Read from file unchecked</b>.</p>
<h3>Exactly what goes in the Text field?</h3>
<p>Add <b>OBS Studio &gt; Sources &gt; Set GDI Text</b>. Choose the OBS connection, scene, and your existing GDI source. In the sub-action's <b>Text</b> field, enter:</p>
${example(`Winner: %firstplace% (+%firstplacepoints% points)`)}
<p>Enable Race complete in the app and press its Test. The source should become <b>Winner: Test Winner (+10 points)</b>. Save your app settings to keep the event enabled for new matches.</p>
<p>Each event overwrites the source's entire text with the resolved message. Your font, colour, position, filters and other OBS styling stay intact. The template lives in Streamer.bot; OBS receives finished text. It stays until another update or source hide.</p>
<h3>Braces here; native arguments in Streamer.bot</h3>
<p>The app labels fields <code>{firstplace}</code>. In the event's Variables popup you can write your template with braces, then use <b>Copy for Streamer.bot</b>. That button converts them to Streamer.bot's required <code>%firstplace%</code> syntax. Plain braces pasted directly into Streamer.bot are literal text.</p>
<h3>More examples</h3>
${example(`Winner-points source: %firstplacepoints%
WR source: GG %wrplayer% (+%wrplayerpoints% points)
WR time source: %wrrecordtime%
Cycle source: %cycleplayer% completed cycle #%cyclenumber% in %cycleraces% races!`)}
<p>For each example, paste only the part after the label into its Text field. Use WR values in the World record action and cycle values in the Cycle complete action. You can combine fields in one text source or add multiple Set GDI Text sub-actions targeting different sources.</p>
<details><summary>Video, scenes, conditions and keeping information on screen</summary><p>Add the normal media playback/restart and source visibility sub-actions to the same action. Add scene changes or delays as desired. Conditions can use arguments in Streamer.bot's If/Else sub-action; the app does not have a CSV rule editor.</p><p>Arguments belong to this action run. Switching scenes later does not rerun the event or restore those arguments. A GDI source keeps the text last written to it. If you need later actions to reuse values, set them with Streamer.bot's Set Global Variable and retrieve them with Get Global Variable; the app does not persist globals for you.</p><p>The full placements array includes all players, but only first/second/third have direct convenience name/points arguments. Dotted HTML paths such as placements.0.name are not native Streamer.bot argument keys. Arrays/JSON need additional processing in your custom action; normal GDI text fields do not select an arbitrary row for you.</p></details>
<details><summary>When each hook runs</summary><ul><li><b>Race complete:</b> a new processed Race or BR result, with match and all-player data. eventType remains raceComplete for BR; gameType identifies the mode.</li><li><b>World record:</b> a confirmed new record. Confirmed by changed custom-map WR metadata matching the latest completed match. RecordHolderName is used, not StreamerRecordHolder. The WR hook may arrive after Race complete if the metadata is written later. Use Test to configure the action.</li><li><b>Cycle complete:</b> once per newly completed player cycle; multiple completions can run the action multiple times. Includes that player's cycle number and race count.</li></ul><p>Repeated touches of the same snapshot do not send another new-result event. Tests use sample arguments and do not count a match. Failed integrations do not stop saved stats. Standalone HTML overlays work separately.</p></details>
<p><a href="https://docs.streamer.bot/api/sub-actions/obs-studio/sources/set-gdi-text" target="_blank" rel="noreferrer">Set GDI Text</a> &middot; <a href="https://docs.streamer.bot/guide/core/variables" target="_blank" rel="noreferrer">Argument syntax and scope</a> &middot; <a href="https://docs.streamer.bot/api/http/requests/do-action" target="_blank" rel="noreferrer">DoAction</a></p>`;

const twitchGuide = `<h2>Twitch message templates</h2>${illustratedGuide("twitch-templates")}<p>These braces belong in this app's Twitch message fields. The app resolves them before posting; Streamer.bot is not involved.</p><ul><li><b>Race results:</b> Overall message supports <code>{intro}</code>, <code>{placements}</code>, <code>{race}</code>, <code>{mapName}</code>, and <code>{playerCount}</code>. Each placement supports those match fields plus <code>{place}</code> (medal or #), <code>{placement}</code> (number), <code>{player}</code>, <code>{points}</code>, and <code>{time}</code> (seconds). Choose the separator between entries; optional 1st/2nd/3rd templates override Each placement. All positive point scorers are included. With no earned points, the default posts the race podium or BR winner without a points amount.</li><li><b>Cycle message:</b> <code>{player}</code>, <code>{cycle}</code>, <code>{races}</code>. Add <code>{races}</code> wherever you want the count; no extra sentence is appended.</li><li><b>World record message:</b> <code>{wrplayer}</code>, <code>{wrplayerpoints}</code>, <code>{wrrecordtime}</code>, <code>{mapName}</code>. Points are the record holder's earned points in that match. Time uses three decimal places.</li></ul><p>Connect Twitch, enable the posting option, customize and use its Test button. Save beside that Test or at the bottom. Customized means the text differs from its default; it does not mean you have saved it. Tests post sample messages to the connected account's own channel without counting a game. WR posts require a changed custom-map record matching the completed match; existing metadata or an unrelated record holder does not post a WR.</p><p>Unknown placeholders remain literal text. The race intro is limited to 120 characters; WR/cycle messages are limited to 500 characters. If a template includes {races} and the count is unavailable, that value displays unknown. Blank overall/placement templates use their defaults. Race lists split into messages of at most 500 characters, repeating the overall template around each part. Empty cycle/WR templates use their default; an empty race intro omits the intro. Twitch posting options are independent.</p>`;
const troubleshooting = `<h2>Check these first</h2><details open><summary>My source shows braces or argument names</summary><p>HTML braces must be inside #overlay in a page that loads overlay.js. For Streamer.bot use Copy for Streamer.bot or native percent argument syntax in the sub-action's Text field. OBS's own Text box does not resolve either syntax.</p></details><details><summary>The HTML source is blank or stale</summary><p>Check the live path, Local file, source visibility, HTML extension, scripts beside the HTML, and the app/watchers running. Results, Podium and Points need a processed match. Use Test on World record or Cycle completed for celebration samples. WR/cycle hide after their alert duration; old alerts expire. Generic custom HTML does not read the separate alert files. After editing HTML, refresh its Browser Source. Data polling is every 3 seconds.</p></details><details><summary>The action runs but my GDI source does not change</summary><p>Check Streamer.bot's OBS connection, chosen scene/source and its Set GDI Text sub-action. Test from the event card in this app, so the arguments are supplied. A manual action run or scene change alone does not supply these match values.</p><p>In Streamer.bot: Action Queues &gt; Action History, right-click that run &gt; Inspect Variables When Queued. Compare exact names and capitalization with this guide. Connection Test checks connectivity; each event's Test checks that the named action exists and is enabled, then sends sample arguments. A disabled action reports a failure with instructions to enable it in Streamer.bot. If Streamer.bot does not report an enabled state, the app cannot verify it and does not send the action.</p></details><details><summary>The wrong action runs or nothing runs</summary><p>Check the exact action name, event toggle and saved settings. Use HTTP Server rather than the WebSocket port. Look in Live log for the integration warning. Streamer.bot owns OBS connections and source behavior; standalone overlay previews do not verify Streamer.bot actions.</p></details><details><summary>I want to keep values from an older match</summary><p>GDI text stays until overwritten. Update the source only in the action you intend to change it. A generic HTML page follows the newest match; it does not freeze an old winner automatically. Arbitrary placements are available in the HTML placements array, but not as direct Streamer.bot name/points keys.</p></details>`;

export function renderIntegrationHelp(): string {
  return `<header class="help-dialog-heading"><div><h2>Overlays &amp; event help</h2><p>Choose where you want to use your data.</p></div><button class="compact-button modal-close" aria-label="Close" title="Close" type="button" data-close-help>${icons.close}</button></header>
    <nav class="help-tabs" aria-label="Help sections"><button type="button" data-help-tab="overlays">HTML overlays</button><button type="button" data-help-tab="custom">Custom HTML overlays</button><button type="button" data-help-tab="streamer">Streamer.bot</button><button type="button" data-help-tab="variables">All variables</button><button type="button" data-help-tab="twitch">Twitch chat</button><button type="button" data-help-tab="troubleshooting">Troubleshooting</button></nav>
    <div class="help-scroll"><section data-help-section="overlays">${overlayGuide}</section><section data-help-section="custom" hidden>${customGuide}</section><section data-help-section="streamer" hidden>${streamerGuide}</section>
    <section data-help-section="variables" hidden><h2>Complete variable reference</h2><p>Labels use braces. HTML resolves braces; Streamer.bot's normal sub-actions use native percent arguments. Read each group's availability before using a field. Keys are case-sensitive. Numbers can be zero; null means unavailable.</p><label class="field"><span>Find a field</span>${iconInput(icons.search, `<input type="search" data-help-search placeholder="Try points, kills, WR..." />`)}</label>${helpFieldGroups.map(group => `<details class="help-field-group"><summary>${escape(group.title)}</summary><p>${escape(group.availability)}</p><dl>${group.fields.map(([key, description]) => `<div data-help-field><dt><code>${group.title === "overlay-config.js settings" ? escape(key) : `{${escape(key)}}`}</code></dt><dd>${escape(description)}</dd></div>`).join("")}</dl></details>`).join("")}</section>
    <section data-help-section="twitch" hidden>${twitchGuide}</section><section data-help-section="troubleshooting" hidden>${troubleshooting}</section></div>`;
}

export function openIntegrationHelp(topic = "overlays"): void {
  document.querySelector<HTMLDialogElement>("#integration-help-dialog")?.close();
  const dialog = document.createElement("dialog");
  dialog.id = "integration-help-dialog";
  dialog.className = "overlay-preview-dialog integration-help-dialog";
  dialog.setAttribute("aria-label", "Overlays and event help");
  dialog.innerHTML = renderIntegrationHelp();
  const scroll = dialog.querySelector<HTMLElement>(".help-scroll")!;
  const select = (tab: string) => {
    dialog.querySelectorAll<HTMLElement>("[data-help-section]").forEach(section => { section.hidden = section.dataset.helpSection !== tab; });
    dialog.querySelectorAll<HTMLButtonElement>("[data-help-tab]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.helpTab === tab)));
    scroll.scrollTop = 0;
  };
  dialog.querySelectorAll<HTMLButtonElement>("[data-help-tab]").forEach(button => button.addEventListener("click", () => select(button.dataset.helpTab!)));
  dialog.querySelector("[data-close-help]")!.addEventListener("click", () => dialog.close());
  dialog.querySelectorAll<HTMLElement>(".help-scroll pre").forEach(block => {
    const copy = document.createElement("button");
    copy.type = "button"; copy.className = "compact-button help-copy-code"; copy.textContent = "Copy example";
    copy.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(block.textContent || ""); copy.textContent = "Copied"; }
      catch { copy.textContent = "Select the example to copy"; }
    });
    block.after(copy);
  });
  dialog.querySelector<HTMLInputElement>("[data-help-search]")!.addEventListener("input", event => {
    const query = (event.target as HTMLInputElement).value.trim().toLowerCase();
    dialog.querySelectorAll<HTMLDetailsElement>(".help-field-group").forEach(group => {
      let found = false;
      group.querySelectorAll<HTMLElement>("[data-help-field]").forEach(row => {
        row.hidden = Boolean(query && !row.textContent?.toLowerCase().includes(query));
        found ||= !row.hidden;
      });
      group.hidden = !found;
      if (query) group.open = found;
    });
  });
  dialog.addEventListener("close", () => dialog.remove(), {once:true});
  document.body.append(dialog);
  showAnimatedDialog(dialog);
  select(["streamer", "gameComplete", "worldRecord", "cycleComplete"].includes(topic) ? "streamer" : ["custom", "variables", "twitch", "troubleshooting"].includes(topic) ? topic : "overlays");

}

export function installIntegrationHelp(): void {
  document.addEventListener("click", event => {
    const button = (event.target as Element).closest<HTMLButtonElement>("[data-open-integration-help]");
    if (button) openIntegrationHelp(button.dataset.openIntegrationHelp);
  });
}
