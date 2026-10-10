import { icons } from "./icons";
import { showAnimatedDialog } from "./dialog-motion";

const examples: Record<string, {title: string; example: string; fields: [string, string][]; row?: [string, string][]}> = {
  results: {title:"Results", example:"<p>{race} winner: {firstplace} (+{firstplacepoints} points)</p>",
    fields:[["race", "Race or Battle Royale"], ["mapName", "Track/map name"], ["firstplace", "Winner's name"], ["firstplacepoints", "Winner's earned points"]],
    row:[["name", "Player's display name"], ["place", "Placement"], ["points", "Points earned"], ["time", "Race time in seconds"], ["kills", "BR kills"], ["damage", "BR damage"]]},
  "cycle-status": {title:"Cycle status", example:'<tbody data-repeat="cycleStandings" data-key="playerKey">\n  <template><tr><td>{rank}</td><td>{playerName}</td><td>{cycles}</td><td>{left}</td></tr></template>\n</tbody>',
    fields:[["cycleSeasonName", "RaceCycles season label"], ["cyclePlayers", "All tracked cycle players"]],
    row:[["rank", "Standings rank: cycles, then current progress, then name"], ["playerName", "Player display name"], ["cycles", "Completed cycles"], ["position1.count", "Total first-place finishes; position2 through position10 work the same way"], ["position1.ready", "Collected in the current cycle; use data-class to highlight"], ["left", "Number of positions still needed"], ["missingPositions", "Comma-separated positions still needed"]]},
  podium: {title:"Podium", example:"<h1>{firstplace}</h1>\n<p>+{firstplacepoints} points</p>",
    fields:[["firstplace", "First player's name"], ["firstplacepoints", "First player's points"], ["secondplace", "Second player's name"], ["secondplacepoints", "Second player's points"], ["thirdplace", "Third player's name"], ["thirdplacepoints", "Third player's points"]],
    row:[["name", "Player's display name"], ["place", "Placement"], ["points", "Points earned"], ["time", "Race time in seconds"], ["kills", "BR kills"], ["damage", "BR damage"]]},
  points: {title:"Points", example:"<p>This match: {matchPoints}</p>\n<p>This session: {sessionPoints}</p>\n<p>Season: {seasonPoints}</p>",
    fields:[["matchPoints", "All player points earned in the latest match"], ["sessionPoints", "All Race + BR points since this app opened"], ["seasonPoints", "All Race + BR points since stats reset"]]},
  "world-record": {title:"World record", example:"<h1>World Record!</h1>\n<p>{wrplayer}: {wrrecordtime}s</p>\n<p>+{wrplayerpoints} points</p>",
    fields:[["wrplayer", "Record player's name"], ["wrrecordtime", "Record time in seconds"], ["wrplayerpoints", "Their earned points"], ["mapName", "Track name"]]},
  "cycle-complete": {title:"Cycle complete", example:'<div data-repeat="cycleCompletions">\n  <template>\n    <p>{playerName}: cycle #{cycleNumber}, {races} races!</p>\n  </template>\n</div>',
    fields:[["cycleSeasonName", "RaceCycles season label"]],
    row:[["playerName", "Player who completed the cycle"], ["cycleNumber", "Their completed cycle number"], ["races", "Matches taken, including duplicates; blank when unknown"]]},
};
const escape = (value: string) => value.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
const glossary = (fields: [string,string][]) => `<dl>${fields.map(([key, description]) => `<div><dt><code>{${key}}</code></dt><dd>${description}</dd></div>`).join("")}</dl>`;

export function openOverlayVariables(name: string): void {
  const help = examples[name];
  if (!help) return;
  document.querySelector<HTMLDialogElement>("#overlay-variables-dialog")?.close();
  const dialog = document.createElement("dialog");
  dialog.id = "overlay-variables-dialog";
  dialog.className = "overlay-preview-dialog event-variables-dialog";
  dialog.setAttribute("aria-label", `${help.title} HTML variables`);
  dialog.innerHTML = `<header><h2>${help.title}: edit HTML &amp; variables</h2><button type="button" class="compact-button modal-close" aria-label="Close" title="Close" data-close>${icons.close}</button></header>
    <p>Open this overlay's HTML file in Notepad using the path on its card. Put the example below <b>inside <code>&lt;main id="overlay"&gt;</code></b>. Save it, then refresh its OBS Browser Source. The app's JavaScript fills the braces with live data; Streamer.bot is not involved.</p>
    <pre>${escape(help.example)}</pre><button type="button" class="compact-button" data-copy>Copy HTML example</button><p data-copy-status role="status"></p>
    <p><b>These work in the HTML file.</b> Typing <code>{firstplace}</code> into OBS's own text field does nothing. OBS displays the HTML page; <code>overlay.js</code> binds its values.</p>
    <button type="button" class="compact-button" data-open-integration-help="custom">Full illustrated guide &amp; all variables</button><h3>Page variables</h3>${glossary(help.fields)}
    ${help.row ? `<h3>${name === "cycle-complete" ? "Inside the cycle completion template" : "Inside the player-row template"}</h3><p>Keep the <code>data-repeat</code> container and its <code>&lt;template&gt;</code>. Edit the markup inside that template; one copy is filled for each item.</p>${glossary(help.row)}` : ""}
    <details><summary>Animate numbers or make a new overlay</summary><p>For a count animation: <code>&lt;span data-number="sessionPoints"&gt;{sessionPoints}&lt;/span&gt;</code>. Add <code>data-decimals="3"</code> for times. Plain <code>{sessionPoints}</code> text updates immediately.</p><p>Copy <code>custom.html</code> in the live folder to a new filename and edit its HTML. Keep <code>id="overlay"</code> and the script links; keep the file beside <code>overlay.js</code> and the data files. Add your new HTML file as an OBS Local-file Browser Source. It fills with the latest processed match and updates as new matches arrive. For a custom WR or cycle celebration, copy that overlay's HTML instead and keep its <code>data-overlay</code> value so it reads the correct alert data and expires automatically. The in-app thumbnails show the bundled examples, not your edited files.</p><p>Edit the HTML for layout, <code>overlay.css</code> for shared styling, or add your own <code>&lt;style&gt;</code> to just this HTML file. Missing values are blank; numeric bindings show a dash. Player names are inserted as text, never HTML.</p></details>`;
  dialog.querySelector("[data-close]")!.addEventListener("click", () => dialog.close());
  dialog.querySelector<HTMLButtonElement>("[data-copy]")!.addEventListener("click", async () => {
    const status = dialog.querySelector<HTMLElement>("[data-copy-status]")!;
    try { await navigator.clipboard.writeText(help.example); status.textContent = "Copied HTML example."; }
    catch { status.textContent = "Copy failed. Select the example above and copy it manually."; }
  });
  dialog.addEventListener("close", () => dialog.remove(), {once:true});
  document.body.append(dialog);
  showAnimatedDialog(dialog);
}
