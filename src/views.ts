import { formatTimestamp, formatTime } from "./dates";
import { iconInput } from "./input-field";
import { renderGuideHeader, renderGuideStep } from "./guide-illustrations";
import { icons } from "./icons";
import { sidebarArtwork } from "./sidebar-icons";
import { overlaysPage } from "./overlay-view";
import type { Config, GameResult, Snapshot } from "./types";

function cyclePositions(player: Snapshot["raceCycles"][number]): number[] {
  const completed = Math.min(
    ...Array.from(
      { length: 10 },
      (_, index) => player.placementCounts[index] ?? 0,
    ),
  );
  return player.placementCounts
    .slice(0, 10)
    .flatMap((count, index) => (count > completed ? [index + 1] : []));
}

function cycleProgress(player: Snapshot["raceCycles"][number]): number {
  return cyclePositions(player).length;
}

function cycleRaceTotal(player: Snapshot["raceCycles"][number]): number {
  if (player.totalRacesComplete) return player.totalRaces ?? 0;
  return Math.max(
    player.totalRaces ?? 0,
    player.placementCounts.reduce((sum, count) => sum + count, 0),
  );
}

function compareCycleLeaders(
  a: Snapshot["raceCycles"][number],
  b: Snapshot["raceCycles"][number],
): number {
  const value = b.cycles - a.cycles || cycleProgress(b) - cycleProgress(a);
  if (value) return value;
  const left = a.playerName.toLowerCase(),
    right = b.playerName.toLowerCase();
  return left < right
    ? -1
    : left > right
      ? 1
      : a.playerKey < b.playerKey
        ? -1
        : a.playerKey > b.playerKey
          ? 1
          : 0;
}

export interface RaceCycleSort {
  key: string;
  direction: "asc" | "desc";
}

export interface ResultsSort {
  key:
    | "placement"
    | "player"
    | "time"
    | "kills"
    | "damage"
    | "points"
    | "total"
    | "wins"
    | "eliminated";
  direction: "asc" | "desc";
}

function sortResults(
  game: GameResult,
  sort: ResultsSort,
): GameResult["results"] {
  const value = (
    player: GameResult["results"][number],
  ): string | number | undefined => {
    switch (sort.key) {
      case "placement":
        return player.placement;
      case "player":
        return player.playerName;
      case "time":
        return player.finishTime;
      case "kills":
      case "damage": {
        const raw =
          player.rawData?.[
            sort.key === "kills" ? "MatchKills" : "MatchDamageDealt"
          ]?.trim();
        return raw && Number.isFinite(Number(raw)) ? Number(raw) : undefined;
      }
      case "points":
        return game.gameType === "battleRoyale" &&
          player.rawData &&
          !player.rawData.SeasonPointsEarned?.trim()
          ? undefined
          : player.seasonPointsEarned;
      case "total":
        return player.seasonPointsTotal;
      case "wins":
        return player.seasonWinsTotal;
      case "eliminated":
        return player.eliminated == null
          ? undefined
          : Number(player.eliminated);
    }
  };
  return [...game.results].sort((left, right) => {
    const a = value(left);
    const b = value(right);
    if (a == null && b != null) return 1;
    if (b == null && a != null) return -1;
    const comparison =
      a == null || b == null
        ? 0
        : typeof a === "string" && typeof b === "string"
          ? a.localeCompare(b, undefined, {
              sensitivity: "base",
              numeric: true,
            })
          : Number(a) - Number(b);
    return (
      (sort.direction === "asc" ? comparison : -comparison) ||
      left.placement - right.placement
    );
  });
}

export function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character]!,
  );
}

function formatDate(value?: string): string {
  return value === "" ? "Unknown date" : formatTimestamp(value);
}

function formatRaceTime(value?: number): string {
  return value == null ? "—" : `${value.toFixed(3)}s`;
}

function formatLabel(value?: string): string {
  if (!value) return "—";
  return value
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (character) => character.toUpperCase());
}

export const defaultRaceMessage = "{intro} {placements}";
export const defaultRaceEntry = "{place} {player} +{points}pts";
export const defaultPromotionMessage =
  "Doing missions? Try Korea's Mission Manager! Automate your entire MoS flow with 1 click. Never pay for resets again.  Full self-custody with build-in burner wallet. Windows, Mac & Linux. You dont need to buy my love.  Get it at https://www.missions.lol";

export function twitchPreviewMessages(
  messagePrefix: string,
  game?: GameResult,
  options: Partial<Config["twitch"]> = {},
): string[] {
  const sample = [
    {
      placement: 1,
      playerName: "rmrfkorea",
      seasonPointsEarned: 123,
      finishTime: 42.123,
    },
    {
      placement: 2,
      playerName: "PlayerTwo",
      seasonPointsEarned: 90,
      finishTime: 43.456,
    },
    {
      placement: 3,
      playerName: "PlayerThree",
      seasonPointsEarned: 70,
      finishTime: 44.789,
    },
    {
      placement: 4,
      playerName: "PlayerFour",
      seasonPointsEarned: 45,
      finishTime: 45.123,
    },
    {
      placement: 5,
      playerName: "PlayerFive",
      seasonPointsEarned: 30,
      finishTime: 46.234,
    },
  ];
  const all = game?.results ?? sample;
  const scoring = all.some((result) => result.seasonPointsEarned > 0);
  const results = all.filter((result) =>
    scoring
      ? result.seasonPointsEarned > 0
      : result.placement > 0 &&
        result.placement <= (game?.gameType === "battleRoyale" ? 1 : 3) &&
        !("eliminated" in result && result.eliminated),
  );
  const resolve = (template: string, fields: Record<string, string>) =>
    template.replace(
      /\{([^{}]+)\}/g,
      (token, name: string) => fields[name] ?? token,
    );
  const chars = (text: string) => Array.from(text);
  const common = {
    race: formatLabel(game?.gameType ?? "race"),
    mapName: game?.mapName ?? (game ? "Unknown track" : "Test Map"),
    playerCount: String(game?.playerCount ?? all.length),
  };
  const intro = chars(resolve(messagePrefix.trim(), common))
    .slice(0, 120)
    .join("");
  const outer = options.raceMessageTemplate?.trim() || defaultRaceMessage;
  const message = (placements: string) =>
    resolve(outer, { ...common, intro, placements })
      .replace(/[\r\n]/g, " ")
      .trim();
  if (!results.length) return [];
  if (!outer.includes("{placements}"))
    return [chars(message("")).slice(0, 500).join("")];
  const separator = options.raceEntrySeparator ?? " | ";
  const messages: string[] = [];
  let current = "";
  for (const result of results) {
    const place =
      (
        { 1: "\u{1f947}", 2: "\u{1f948}", 3: "\u{1f949}" } as Record<
          number,
          string
        >
      )[result.placement] ?? "#" + result.placement;
    const template =
      options.racePodiumTemplates?.[result.placement - 1]?.trim() ||
      options.raceEntryTemplate?.trim() ||
      (scoring ? defaultRaceEntry : "{place} {player}");
    const entry = resolve(template, {
      ...common,
      place,
      placement: String(result.placement),
      player: result.playerName,
      points: String(result.seasonPointsEarned),
      time:
        result.finishTime == null ? "unknown" : result.finishTime.toFixed(3),
    });
    const candidate = current ? current + separator + entry : entry;
    if (current && chars(message(candidate)).length > 500) {
      messages.push(message(current));
      current = "";
    }
    const remaining = current ? current + separator + entry : entry;
    if (chars(message(remaining)).length > 500) {
      // Preserve the message wrapper while fitting an unusually long single entry.
      let fitted = chars(entry);
      while (fitted.length && chars(message(fitted.join(""))).length > 500)
        fitted.pop();
      messages.push(
        chars(message(fitted.join("")))
          .slice(0, 500)
          .join(""),
      );
      current = "";
    } else current = remaining;
  }
  if (current) messages.push(message(current));
  return messages;
}

export const defaultWorldRecordMessage =
  "World Record! {wrplayer} earned +{wrplayerpoints} points on {mapName} in {wrrecordtime}s!";

const twitchMessageDefaults: Record<string, string> = {
  "twitch-message-prefix": "🏁 Race results:",
  "twitch-cycle-message":
    "🎉 Congrats {player} on a cycle! You are great! That's cycle #{cycle}! 🎉",
  "twitch-world-record-message": defaultWorldRecordMessage,
};

export function twitchMessageIsCustomized(
  field: string,
  message: string,
): boolean {
  const fallback = twitchMessageDefaults[field];
  if (fallback === undefined) return false;
  const text = message.trim();
  return (
    (text || (field === "twitch-message-prefix" ? "" : fallback)) !== fallback
  );
}

export function raceMessageIsCustomized(config: Config["twitch"]): boolean {
  return (
    twitchMessageIsCustomized("twitch-message-prefix", config.messagePrefix) ||
    (!!config.raceMessageTemplate?.trim() &&
      config.raceMessageTemplate.trim() !== defaultRaceMessage) ||
    (!!config.raceEntryTemplate?.trim() &&
      config.raceEntryTemplate.trim() !== defaultRaceEntry) ||
    (config.racePodiumTemplates ?? []).some(
      (text) =>
        !!text.trim() &&
        text.trim() !== (config.raceEntryTemplate?.trim() || defaultRaceEntry),
    ) ||
    (config.raceEntrySeparator ?? " | ") !== " | "
  );
}

function twitchCustomizationSummary(
  field: string,
  message: string,
  customized = twitchMessageIsCustomized(field, message),
): string {
  return `<summary><span class="twitch-customized-state" data-customized-for="${field}" ${customized ? "" : "hidden"}>${icons.check} Customized</span><span class="customize-button">Customize${icons.caretDown}</span></summary>`;
}

export function worldRecordMessagePreview(template: string): string {
  const fields: Record<string, string> = {
    wrplayer: "Test Winner",
    wrplayerpoints: "10",
    wrrecordtime: "42.123",
    mapName: "Test Map",
  };
  return Array.from(
    (template.trim() || defaultWorldRecordMessage).replace(
      /\{(wrplayer|wrplayerpoints|wrrecordtime|mapName)\}/g,
      (_, name: string) => fields[name],
    ),
  )
    .slice(0, 500)
    .join("");
}

export function cycleMessagePreview(messageTemplate: string): string {
  const fallback =
    "🎉 Congrats {player} on a cycle! You are great! That's cycle #{cycle}! 🎉";
  const template = messageTemplate.trim() || fallback;
  const message = template
    .replaceAll("{player}", "rmrfkorea")
    .replaceAll("{cycle}", "1")
    .replaceAll("{races}", "823");
  return Array.from(message).slice(0, 500).join("");
}

export function watcherIsActive(state: Snapshot): boolean {
  return (
    state.watcherStatus === "Watching" || state.watcherStatus === "Processing"
  );
}

function streamerBotTone(state: Snapshot): string {
  if (state.streamerBotStatus === "Connected") return "good";
  if (
    state.streamerBotStatus === "Unavailable" ||
    state.streamerBotStatus === "Error"
  )
    return "bad";
  return "warn";
}

function twitchTone(state: Snapshot): string {
  if (state.twitchStatus === "Connected") return "good";
  if (
    state.twitchStatus === "Unavailable" ||
    state.twitchStatus === "Expired"
  ) {
    return "bad";
  }
  return "warn";
}

function panel(
  title: string,
  _eyebrow: string,
  content: string,
  className = "",
  headerActions = "",
): string {
  return `
    <section class="panel ${className}">
      <header>
        <div>
          <h2>${escapeHtml(title)}</h2>
        </div>
        ${headerActions}
      </header>
      <div class="panel-body">
        ${content}
      </div>
    </section>
  `;
}

function stat(label: string, value: unknown): string {
  const icon = (
    {
      "Session races": "file",
      "Session BRs": "battleRoyale",
      "Last update": "clock",
      "Last updated": "clock",
      "Tracked racers": "racers",
      "Completed cycles": "cycles",
      "Race #": "statRaceFlag",
      "Streamer.bot": "chain",
    } as Record<string, string>
  )[label];
  return `<span class="summary-item">${icon ? `<i class="summary-icon ${icon}">${icons[icon]}</i>` : ""}<span class="summary-copy"><span>${escapeHtml(label)}</span><b class="${label === "Streamer.bot" && value === "Connected" ? "connected-value" : ""}">${escapeHtml(value)}</b></span></span>`;
}

function feedbackButton(
  key: string,
  label: string,
  attributes = "",
  icon = "play",
  type = "button",
): string {
  return `<span class="inline-action"><button class="compact-button" type="${type}" data-feedback-key="${key}" ${attributes}>${icons[icon]}<span>${escapeHtml(label)}</span></button><span class="button-feedback-error" data-error-for="${key}" role="alert"></span></span>`;
}

export function trackingIsActive(
  state: Snapshot,
  kind: "stats" | "cycles",
): boolean {
  return (
    (kind === "stats"
      ? state.statsTrackingEnabled
      : state.cyclesTrackingEnabled) ?? watcherIsActive(state)
  );
}

function watcherControls(
  state: Snapshot,
  busy: boolean,
  kind: "stats" | "cycles",
): string {
  const watching = trackingIsActive(state, kind);

  const spinning = busy || (watching && state.watcherStatus === "Processing");
  return `<div class="head-actions">
    <button id="watch-toggle" class="action ${watching ? "stop" : "start"}" ${busy ? "disabled" : ""}>
      ${spinning ? icons.spinner : watching ? icons.stop : icons.play}
      <span>${busy ? "Please wait" : watching ? "Stop watcher" : "Start watcher"}</span>
    </button>
  </div>`;
}

function resultRow(
  result: GameResult["results"][number],
  battleRoyale: boolean,
  compact = false,
): string {
  const playerColor = escapeHtml(result.nameColorHex ?? "94a3b8");
  const eliminated =
    result.eliminated == null ? "—" : result.eliminated ? "Yes" : "No";
  const royaleValue = (field: string) =>
    escapeHtml(result.rawData?.[field]?.trim() || "—");
  const dead = battleRoyale && result.placement !== 1;
  const rowClass = dead ? "royale-dead" : `p${result.placement}`;

  return `
    <tr class="${rowClass}">
      <td>
        ${dead ? `<span class="dead-placement" role="img" aria-label="Eliminated, placement ${result.placement}" title="Eliminated — placement ${result.placement}">${icons.skull}</span>` : `<b class="place p${result.placement}">${result.placement}</b>`}
      </td>
      <td>
        <div class="player">
          <span>
            <b class="player-history-link" tabindex="0" role="button" data-race-player="${escapeHtml(playerKey(result))}" title="${escapeHtml(result.playerName)}" style="--player-color:#${playerColor}">${escapeHtml(result.playerName)}</b>
          </span>
        </div>
      </td>
      ${battleRoyale ? "" : `<td class="mono">${formatRaceTime(result.finishTime)}</td>`}
      ${battleRoyale ? `<td>${royaleValue("MatchKills")}</td><td>${royaleValue("MatchDamageDealt")}</td>` : ""}
      <td class="points">${battleRoyale && result.rawData ? royaleValue("SeasonPointsEarned") : result.seasonPointsEarned}</td>
      ${compact ? "" : `<td>${result.seasonPointsTotal ?? "—"}</td>`}
      <td>${result.seasonWinsTotal ?? "—"}</td>
      ${compact ? "" : `<td>${eliminated}</td>`}
    </tr>
  `;
}

function resultsTable(
  game: GameResult | undefined,
  requestedSort: ResultsSort,
): string {
  if (!game) {
    return `
      <div class="empty-state">
        <b>No race processed yet</b>
        <span>Start the watcher to read Race and Battle Royale results.</span>
      </div>
    `;
  }

  const winner = game.results.find((result) => result.placement === 1);
  const battleRoyale = game.gameType === "battleRoyale";
  const sort: ResultsSort =
    (!battleRoyale && ["kills", "damage"].includes(requestedSort.key)) ||
    (battleRoyale && requestedSort.key === "time")
      ? { key: "placement", direction: "asc" }
      : requestedSort;
  const sortableHeader = (key: ResultsSort["key"], label: string): string => {
    const active = sort.key === key;
    const arrow = active ? (sort.direction === "asc" ? "▲" : "▼") : "";
    return `<th aria-sort="${active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}"><button type="button" class="cycle-sort ${active ? "active" : ""}" data-results-sort="${key}">${label}<span>${arrow}</span></button></th>`;
  };

  return `
    <div class="race-context">
      <span class="track-item"><i>${battleRoyale ? icons.battleRoyale : icons.raceFlag}</i><span><small>Game Type</small><b>${formatLabel(game.gameType)}</b></span></span>
      <span class="track-item"><i>${icons.track}</i><span><small>Track</small><b>${escapeHtml(game.mapName ?? "Unknown track")}</b></span></span>
      <span class="track-item"><i>${icons.stopwatch}</i><span><small>${game.gameType === "battleRoyale" ? "Survival time" : "Winning time"}</small><b class="mono">${formatRaceTime(winner?.finishTime)}</b></span></span>
      <span class="track-item"><i>${icons.racers}</i><span><small>Participants</small><b>${game.playerCount}</b></span></span>
    </div>
    <div class="table-frame"><div class="table-scroll">
      <table class="${battleRoyale ? "battle-royale-results" : "race-results"}">
        <colgroup>
          <col class="rank-column" />
          <col class="player-column" />
          ${battleRoyale ? "" : '<col class="time-column" />'}
          ${battleRoyale ? '<col class="kills-column" /><col class="damage-column" />' : ""}
          <col class="earned-column" />
          <col class="total-column" />
          <col class="wins-column" />
          <col class="eliminated-column" />
        </colgroup>
        <thead>
          <tr>
            ${sortableHeader("placement", "#")}
            ${sortableHeader("player", "Player")}
            ${battleRoyale ? sortableHeader("kills", "Kills") + sortableHeader("damage", "Damage") : sortableHeader("time", "Race time")}
            ${sortableHeader("points", battleRoyale ? "Points earned" : "Season points earned")}
            ${sortableHeader("total", "Season total")}
            ${sortableHeader("wins", "Wins")}
            ${sortableHeader("eliminated", "Eliminated")}
          </tr>
        </thead>
        <tbody>
          ${sortResults(game, sort)
            .map((result) => resultRow(result, battleRoyale))
            .join("")}
        </tbody>
      </table>
    </div></div>
  `;
}

function overviewPage(
  state: Snapshot,
  busy: boolean,
  editingName: boolean,
  resultsSort: ResultsSort,
  selectedRaceId: string,
): string {
  const displayedGame = selectedRaceId
    ? state.recentResults.find((game) => game.id === selectedRaceId)
    : state.latestResult;
  const fileName =
    state.config.csv.path.split(/[\\/]/).pop() || "LastSeasonRace.csv";

  return `
    <div class="overview-page">
      <div class="page-head tracking-page-head">
        <div>
          <div class="race-heading">
            <i class="race-heading-icon">${sidebarArtwork("overview", "header-overview")}</i>
            <div><h1>RaceStats</h1></div>
          </div>
        </div>

      <div class="summary-row">
        ${stat("Session races", state.sessionResults.filter((game) => game.gameType === "race").length)}
        ${stat("Session BRs", state.sessionResults.filter((game) => game.gameType === "battleRoyale").length)}
        ${stat(
          "Last update",
          state.lastUpdate ? formatTime(state.lastUpdate) : "Never",
        )}
      </div>

        <div class="head-actions tracking-controls">
          ${watcherControls(state, busy, "stats")}
          ${feedbackButton("reprocess-latest", "Reprocess latest file", 'data-reprocess-latest title="Reprocess the most recently modified Race or Battle Royale for stats and cycles"', "cycles")}
          <div class="previous-results-control"><select id="previous-race-results" class="theme-select" aria-label="Previous race results"><option value="">Latest Results</option>${[
            ...state.recentResults,
          ]
            .reverse()
            .filter((game) => game.id !== state.latestResult?.id)
            .map(
              (game) =>
                `<option value="${escapeHtml(game.id)}" ${selectedRaceId === game.id ? "selected" : ""}>${escapeHtml(formatDate(game.timestamp))} &middot; ${escapeHtml(game.mapName ?? "Unknown track")}</option>`,
            )
            .join("")}</select></div>
        </div>
      </div>

      <section class="panel results-panel">
        <header class="results-header">
          ${resultsName(state.config.seasons.raceName || fileName, editingName)}
          <div class="results-actions">
            ${iconInput(icons.search, `<input id="race-search" class="cycle-search" type="search" placeholder="Search players" aria-label="Search players" />`)}
            <span id="race-filter-count" aria-live="polite"></span>
            <div class="results-actions-group">
              <button data-export="session" class="compact-button" type="button">Export session</button>
              <button id="clear-race-results" class="compact-button btn-error" type="button" ${state.latestResult || state.sessionResults.length || state.totalRaceCount || state.totalBattleRoyaleCount || state.seasonPointsEarned ? "" : "disabled"}>Clear Results</button>
            </div>
          </div>
        </header>
        <div class="panel-body">${resultsTable(displayedGame, resultsSort)}</div>
      </section>
    </div>
  `;
}

function historyPage(state: Snapshot): string {
  const games = [...state.recentResults].reverse();
  const cycles = [...(state.cycleHistory ?? [])].reverse();
  const cycleContent = cycles.length
    ? `<div class="table-frame"><div class="table-scroll"><table><thead><tr><th>Date</th><th>Track</th><th>Winner</th><th>Winning time</th><th>Players</th><th>Completions</th><th>Fingerprint</th></tr></thead><tbody>${cycles
        .map((entry) => {
          const completions = entry.completions?.length
            ? entry.completions
            : entry.cycleNumber > 0
              ? [
                  {
                    playerName: entry.playerName,
                    cycleNumber: entry.cycleNumber,
                  },
                ]
              : [];
          return `<tr><td>${formatDate(entry.timestamp)}</td><td>${escapeHtml(entry.mapName ?? "Unknown track")}</td><td>${escapeHtml(entry.winnerName ?? "—")}</td><td class="race-time">${formatRaceTime(entry.winningTime)}</td><td>${entry.playerCount ?? "—"}</td><td>${completions.length ? completions.map((completion) => `${escapeHtml(completion.playerName)}: cycle #${completion.cycleNumber}`).join(" | ") : "—"}</td><td class="mono">${escapeHtml(entry.gameId.slice(0, 12))}</td></tr>`;
        })
        .join("")}</tbody></table></div></div>`
    : '<div class="empty-state">No cycle points earned yet.</div>';

  const content = games.length
    ? `
      <div class="table-frame"><div class="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Track</th>
              <th>Winner</th>
              <th>Winning time</th>
              <th>Players</th>
              <th>Type</th>
              <th>Fingerprint</th>
            </tr>
          </thead>
          <tbody>
            ${games
              .map(
                (game) => `
                  <tr>
                    <td>${formatDate(game.timestamp)}</td>
                    <td>${escapeHtml(game.mapName ?? "Unknown track")}</td>
                    <td><b>${escapeHtml(game.results[0]?.playerName ?? "Unknown")}</b></td>
                    <td class="race-time">${formatRaceTime(game.results[0]?.finishTime)}</td>
                    <td>${game.playerCount}</td>
                    <td>${formatLabel(game.gameType)}</td>
                    <td class="mono">${escapeHtml(game.id.slice(0, 12))}</td>
                  </tr>
                `,
              )
              .join("")}
          </tbody>
        </table>
      </div></div>
    `
    : `<div class="empty-state">No saved races yet.</div>`;

  return `
    <div class="history-view">
    <div class="page-head">
      <div class="race-heading"><i class="race-heading-icon">${sidebarArtwork("history", "header-history")}</i><div><h1>History</h1></div></div>
    </div>

    <div class="history-panels">
    ${panel("Processed races", "Recent first", content, "history-panel", `<button id="clear-history" class="compact-button btn-error" type="button" ${games.length ? "" : "disabled"}>Clear history</button>`)}
    ${panel("Cycle points and achievements", "Recent first", cycleContent, "history-panel", `<button id="clear-cycle-history" class="compact-button btn-error" type="button" ${cycles.length ? "" : "disabled"}>Clear history</button>`)}
    </div>
    </div>
  `;
}

function settingsPage(
  state: Snapshot,
  section: "settings" | "streamer" | "twitch" = "settings",
): string {
  const startupToggle = (
    id: string,
    icon: string,
    title: string,
    description: string,
    checked: boolean,
  ) => `
    <label class="toggle-row settings-option">
      <i aria-hidden="true">${icons[icon]}</i>
      <span><b>${title}</b><small>${description}</small></span>
      <input id="${id}" type="checkbox" role="switch" ${checked ? "checked" : ""} />
    </label>`;
  const watcherSettings = `
      <label class="toggle-row settings-option">
        <i aria-hidden="true">${icons.palette}</i>
        <span><b>Theme</b><small id="theme-save-status" role="status">Changes save automatically.</small></span>
        <select id="appearance-theme" class="theme-select">
          <option value="default" ${(state.config.theme ?? "default") === "default" ? "selected" : ""}>Default</option>
          <option value="dark" ${state.config.theme === "dark" ? "selected" : ""}>Dark</option>
          <option value="minimal" ${state.config.theme === "minimal" ? "selected" : ""}>I hate my retinas mode</option>
        </select>
      </label>
      ${startupToggle("auto-start", "watcherStart", "Start RaceStats automatically", "Count races and Battle Royales when the app opens.", state.config.csv.autoStartWatcher)}
      ${startupToggle("auto-start-cycles", "cycles", "Start RaceCycles automatically", "Count cycle placements when the app opens.", state.config.csv.autoStartCycles)}
      ${startupToggle("start-minimized", "monitor", "Start minimized", "Start the application minimized to the Windows taskbar.", state.config.startMinimized)}
  `;

  const promotionSettings = `
      <div class="mission-promotion-settings">
        ${startupToggle("promote-mission-app", "webhook", "Promote Korea's Mission App in chat", "Give chat a nudge toward Korea's FREE Mission App. Because it's free. you don't have to buy my love.", state.config.twitch.promoteMissionApp ?? false)}
        <details class="promotion-options twitch-message-customization">
          <summary><span class="customize-button">${icons.caretDown} Options</span></summary>
        <div class="mission-promotion-controls">
          <div class="twitch-message-preview promotion-preview"><span>Preview</span><p>${escapeHtml(defaultPromotionMessage)}</p></div>
          <label class="field promotion-interval"><span>Post every (minutes)</span><input id="promotion-interval" type="number" min="1" max="1440" step="1" value="${state.config.twitch.promotionIntervalMinutes ?? 60}" /></label>
          <small>Posts while this app is open and Twitch is connected. The optional Mission app promotion hook on the Streamer.bot page uses this interval independently. The first post waits one full interval. Save to apply an interval change.</small>
          <div class="promotion-actions">${feedbackButton("twitch-promotion", "Test promotion", `data-twitch-test="promotion" ${state.twitchStatus === "Connected" ? "" : "disabled"}`, "test")}${feedbackButton("save-promotion", "Save", "data-twitch-save", "file")}</div>
        </div>
        </details>
      </div>
  `;
  const updateSettings = `
      <div class="app-update-settings">
        ${startupToggle("auto-update-check", "download", "Check for app updates automatically", "Check when the app opens, then daily. You choose when to download and restart.", state.config.autoUpdateCheckEnabled ?? true)}
        <div class="app-update-controls">
          <div class="app-update-check-row"><button type="button" class="compact-button" data-check-updates>Check for updates</button><span data-app-version></span><span data-update-message role="status" aria-live="polite"></span><span data-update-last-checked>Last checked: Never</span></div>
        </div>
      </div>
  `;

  const streamerBot = state.config.streamerBot;
  const streamerBotConnection = `
    <div class="twitch-connection-heading">
      <div class="twitch-layout-heading"><i>${icons.chain}</i><div><h2 class="connection-title">Streamer.bot Connection${state.streamerBotStatus === "Connected" ? `<span class="connection-check">${icons.check}</span>` : ""}</h2></div></div>
      <div class="watch-state ${streamerBotTone(state)}"><i></i><span>${escapeHtml(state.streamerBotStatus)}</span></div>
    </div>
    <div class="fields-grid connection-fields streamer-connection-fields">
      <label class="field"><span>Host</span>${iconInput(icons.server, `<input id="streamer-host" value="${escapeHtml(streamerBot.host)}" />`)}</label>
      <label class="field port-field"><span>Port</span>${iconInput(icons.port, `<input id="streamer-port" type="number" min="1" max="65535" value="${streamerBot.port}" />`)}</label>
      ${feedbackButton("streamer-connection", "Test connection", 'data-streamer-test="connection"', "test")}
    </div>
  `;

  const streamerBotEvents = `
    <div class="twitch-layout-heading streamer-event-heading"><i>${icons.webhook}</i><h2>Custom event hooks</h2><p>Optional: run your own Streamer.bot action when an event happens. Add sub-actions for chat, OBS text, sounds, or your entire stream flow. The app calls the action by name and supplies its data; no trigger is needed. Standalone HTML overlays are independent of these hooks.</p></div>
    <div class="streamer-events">${[
      {
        key: "race",
        kind: "gameComplete",
        title: "Race complete",
        description:
          "Runs after a Race or Battle Royale, with player results and earned points.",
        icon: icons.raceFlag,
        enabled: streamerBot.events?.raceComplete ?? false,
        action: streamerBot.actions.gameComplete,
        input: "streamer-game-action",
      },
      {
        key: "record",
        kind: "worldRecord",
        title: "World record",
        description:
          "Runs for a confirmed new record, with the record player, time, and points.",
        icon: icons.stopwatch,
        enabled: streamerBot.events?.worldRecord ?? true,
        action: streamerBot.actions.worldRecord,
        input: "streamer-record-action",
      },
      {
        key: "cycle",
        kind: "cycleComplete",
        title: "Cycle complete",
        description:
          "Runs once for each completed cycle, with the player, cycle number, and races taken.",
        icon: icons.cycles,
        enabled: streamerBot.events?.cycleComplete ?? false,
        action: streamerBot.actions.cycleComplete || "Marbles - Cycle Complete",
        input: "streamer-cycle-action",
      },
      {
        key: "promotion",
        kind: "missionPromotion",
        title: "Mission app promotion",
        description:
          "Runs on the promotion interval in Settings, even without Twitch. Sends promotionMessage, downloadUrl, and intervalMinutes arguments.",
        icon: icons.webhook,
        enabled: streamerBot.events?.missionPromotion ?? false,
        action:
          streamerBot.actions.missionPromotion || "Marbles - Mission Promotion",
        input: "streamer-promotion-action",
      },
    ]
      .map(
        (
          event,
        ) => `<section class="twitch-settings-section streamer-event-card" data-feature-section="streamer-${event.key}-enabled">
      <label class="toggle-row twitch-feature-heading"><i>${event.icon}</i><span><b>${event.title}</b><small>${event.description}</small></span><input id="streamer-${event.key}-enabled" type="checkbox" role="switch" ${event.enabled ? "checked" : ""} /></label>
      <div class="streamer-action-controls"><div class="feature-content"><label class="field"><span>Action name:</span>${iconInput(icons.streamer, `<input id="${event.input}" value="${escapeHtml(event.action)}" />`)}</label>${feedbackButton(`streamer-${event.key}`, "Test", `data-streamer-test="${event.kind}"`, "test")}</div>${event.kind === "missionPromotion" ? "" : `<button type="button" class="overlay-inline-link event-variables-link" data-event-variables="${event.kind}">Variables</button>`}</div>
    </section>`,
      )
      .join("")}</div>
  `;

  const setupGuide = `<ol class="guide-steps">
    ${renderGuideStep(1, "Enable HTTP Server", "In Streamer.bot, open Servers/Clients and start HTTP Server. Use the host and post from your Streamer.Bot config. Enable Auto Start.", "server")}
    ${renderGuideStep(2, "Create your actions", "Create Streamer.bot actions for the events you want to use. Enter the exact action name on its event card.", "actions")}
    ${renderGuideStep(3, "Update your existing sources", "No trigger is needed. Add your OBS sub-actions to the action. Variables lets you copy a text template for Set GDI Text.", "variables")}
    ${renderGuideStep(4, "Test and verify", "Enable the event, save, then Test. Check Action History in Streamer.bot to confirm the action ran.", "test")}
  </ol>`;

  const twitch = state.config.twitch;
  const twitchConnected = state.twitchStatus === "Connected";
  const twitchPreview = twitchPreviewMessages(
    twitch.messagePrefix,
    undefined,
    twitch,
  );
  const cyclePreview = cycleMessagePreview(twitch.cycleMessageTemplate);
  const twitchConnection = `
  <div class="twitch-connection-heading">
    <div class="twitch-layout-heading"><i>${icons.chain}</i><div><h2 class="connection-title">Twitch Connection${twitchConnected ? `<span class="connection-check">${icons.check}</span>` : ""}</h2></div></div>
  <div class="watch-state ${twitchTone(state)}">
    <i></i>

      <span>${escapeHtml(
        twitchConnected && state.twitchUsername
          ? `Connected as ${state.twitchUsername}`
          : state.twitchStatus,
      )}</span>
  </div>
  </div>
  <div class="test-actions integration-connection-controls">
    ${twitchConnected ? '<button id="twitch-disconnect" class="twitch-disconnect-button" type="button">Disconnect Twitch</button>' : `<button id="twitch-connect" class="twitch-connect-button" type="button" ${state.twitchStatus === "Authorizing" ? "disabled" : ""}>${state.twitchStatus === "Authorizing" ? "Waiting for Twitch..." : "Connect Twitch"}</button>`}
    ${state.twitchMessage && ["Unavailable", "Expired"].includes(state.twitchStatus) ? `<span class="button-feedback-error" role="alert">${escapeHtml(state.twitchMessage)}</span>` : ""}
  </div>
  ${!twitchConnected ? `<div class="twitch-message-preview twitch-auth-preview" role="status"><span>Twitch sign-in</span><p>${escapeHtml(state.twitchStatus === "Authorizing" && state.twitchMessage ? state.twitchMessage : "Connect Twitch opens Twitch in your browser with your sign-in code already filled in. The code comes from this app. Confirm the code and click Authorize, then return here. Your login renews automatically.")}</p></div>` : ""}  `;

  const twitchMessages = `
  <div class="twitch-layout-heading twitch-message-heading"><i>${icons.webhook}</i><h2>Chat messages</h2><p>Choose which events to post and customize their messages.</p></div>
  <div class="twitch-settings-grid">
    <section class="twitch-settings-section" data-feature-section="twitch-post-results">
      <div class="toggle-row twitch-feature-heading">
        <i>${icons.raceFlag}</i>
        <span><b>Post Race Results</b><small>Post race results to Twitch chat.</small></span>
        <input
          id="twitch-post-results"
          type="checkbox" role="switch" aria-label="Post Race Results"
          ${twitch.postResults ? "checked" : ""}
        />

      </div>
          <details class="twitch-message-customization" name="twitch-post-customization">
        ${twitchCustomizationSummary("twitch-message-prefix", twitch.messagePrefix, raceMessageIsCustomized(twitch))}
        <div class="feature-content">

      <label class="field">
        <span>Message intro</span>

        <input
          id="twitch-message-prefix"
          type="text"
          maxlength="120"
          value="${escapeHtml(twitch.messagePrefix)}"
          placeholder="🏁 {race} winner:"
        />
        <small>Use <code>{race}</code> for the match type: <b>Race</b> or <b>Battle Royale</b>.</small>
      </label>

      <div class="race-message-templates">
        <label class="field"><span>Overall message</span><textarea id="twitch-race-message" rows="1" maxlength="500" placeholder="{intro} {placements}">${escapeHtml(twitch.raceMessageTemplate?.trim() || defaultRaceMessage)}</textarea><small>Use <code>{intro}</code>, <code>{placements}</code>, <code>{race}</code>, <code>{mapName}</code>, <code>{playerCount}</code>. Long lists split into multiple messages.</small></label>
        <label class="field"><span>Each placement</span><textarea id="twitch-race-entry" rows="1" maxlength="500" placeholder="{place} {player} +{points}pts">${escapeHtml(twitch.raceEntryTemplate?.trim() || defaultRaceEntry)}</textarea><small>Use <code>{place}</code>, <code>{placement}</code> (number), <code>{player}</code>, <code>{points}</code>, <code>{time}</code>, and the match fields above. Change pts to points, or leave points out entirely.</small></label>
        <label class="field"><span>Between placements</span><input id="twitch-race-separator" maxlength="40" value="${escapeHtml(twitch.raceEntrySeparator ?? " | ")}" /></label>
        <details class="race-podium-templates"><summary>Custom wording for 1st, 2nd, and 3rd</summary><p>Leave an override blank to use Each placement.</p>${["1st", "2nd", "3rd"].map((label, index) => `<label class="field"><span>${label} place</span><textarea id="twitch-race-place-${index + 1}" rows="1" maxlength="500">${escapeHtml(twitch.racePodiumTemplates?.[index]?.trim() || twitch.raceEntryTemplate?.trim() || defaultRaceEntry)}</textarea></label>`).join("")}</details>
      </div>

            <div class="twitch-message-preview">
        <span>Preview</span>

        <p id="twitch-message-preview">${twitchPreview.map(escapeHtml).join("<br><br>")}</p>
      </div>
      <div class="twitch-message-actions">${feedbackButton("twitch-race", "Test race results", `data-twitch-test="race" ${twitchConnected ? "" : "disabled"}`, "test")}${feedbackButton("save-twitch-race", "Save", "data-twitch-save", "file")}<button type="button" class="overlay-inline-link" data-open-integration-help="twitch">Message help</button></div>
      </div>
      </details>
    </section>

    <section class="twitch-settings-section" data-feature-section="twitch-post-cycles">
      <div class="toggle-row twitch-feature-heading">
        <i>${icons.trophy}</i>
        <span><b>Post Cycle Completions</b><small>Post cycle completions to Twitch.</small></span>
        <input
          id="twitch-post-cycles"
          type="checkbox" role="switch" aria-label="Post Cycle Completions"
          ${twitch.postCycleResults ? "checked" : ""}
        />

      </div>
      <details class="twitch-message-customization" name="twitch-post-customization">
        ${twitchCustomizationSummary("twitch-cycle-message", twitch.cycleMessageTemplate)}
        <div class="feature-content">
     

      <label class="field">
        <span>Cycle complete message</span>

        <textarea
          id="twitch-cycle-message"
          maxlength="500"
          rows="3"
          placeholder="🎉 Congrats {player} on a cycle! That's cycle #{cycle}! 🎉"
        >${escapeHtml(twitch.cycleMessageTemplate)}</textarea>

        <small>
          Use <code>{player}</code> for the racer and
          <code>{cycle}</code> for their completed cycle number, and
          <code>{races}</code> for matches taken by that particular cycle.
        </small>
      </label>

      <div class="twitch-message-preview">
        <span>Preview</span>

        <p id="twitch-cycle-message-preview">${escapeHtml(cyclePreview)}</p>
      </div>
      <div class="twitch-message-actions">${feedbackButton("twitch-cycle", "Test cycle message", `data-twitch-test="cycles" ${twitchConnected ? "" : "disabled"}`, "test")}${feedbackButton("save-twitch-cycle", "Save", "data-twitch-save", "file")}<button type="button" class="overlay-inline-link" data-open-integration-help="twitch">Message help</button></div>
      </div>
      </details>
    </section>

    <section class="twitch-settings-section" data-feature-section="twitch-post-world-records">
      <div class="toggle-row twitch-feature-heading">
        <i>${icons.stopwatch}</i>
        <span><b>Post World Records</b><small>Celebrate confirmed records with the player's earned points, track, and time.</small></span>
        <input id="twitch-post-world-records" type="checkbox" role="switch" aria-label="Post World Records" ${twitch.postWorldRecords ? "checked" : ""} />
      </div>
      <details class="twitch-message-customization" name="twitch-post-customization">
        ${twitchCustomizationSummary("twitch-world-record-message", twitch.worldRecordMessageTemplate ?? defaultWorldRecordMessage)}
        <div class="feature-content">
        <label class="field"><span>World record message</span>
          <textarea id="twitch-world-record-message" maxlength="500" rows="3">${escapeHtml(twitch.worldRecordMessageTemplate ?? defaultWorldRecordMessage)}</textarea>
          <small><code>{wrplayerpoints}</code> = points earned in this race &middot; <code>{wrplayer}</code> = record player &middot; <code>{wrrecordtime}</code> = record time in seconds &middot; <code>{mapName}</code> = track name</small>
        </label>
        <div class="twitch-message-preview"><span>Preview</span><p id="twitch-world-record-preview">${escapeHtml(worldRecordMessagePreview(twitch.worldRecordMessageTemplate ?? defaultWorldRecordMessage))}</p></div>
        <div class="twitch-message-actions">${feedbackButton("twitch-world-record", "Test world record", `data-twitch-test="worldRecord" ${twitchConnected ? "" : "disabled"}`, "test")}${feedbackButton("save-twitch-world-record", "Save", "data-twitch-save", "file")}<button type="button" class="overlay-inline-link" data-open-integration-help="twitch">Message help</button></div>
      </div>
      </details>
    </section>
  </div>


`;

  const twitchGuide = `<ol class="guide-steps">
    ${renderGuideStep(1, "Click Connect Twitch", "Press Connect Twitch to open Twitch's authorization page in your normal Windows browser.", "twitch-connect")}
    ${renderGuideStep(2, "Approve Twitch access", "Sign in and approve the Twitch authorization to post as you or your bot account.", "twitch-access")}
    ${renderGuideStep(3, "Choose what to post", "Enable only what you want. Customize each message to make it yours.", "twitch-posts")}
    ${renderGuideStep(4, "Test and go live", "Test your messages (or don't). The connected account posts the a message into your Twitch chat.", "twitch-test")}
  </ol>`;

  const page = {
    settings: {
      eyebrow: "Integrations",
      title: "Settings",
      description: "smol korea is the best!",
      content: `<section class="panel settings-panel"><div class="panel-body">${watcherSettings}${updateSettings}</div></section><section class="panel settings-panel mission-promotion-panel" aria-label="Mission app promotion"><div class="panel-body">${promotionSettings}</div></section>`,
    },
    streamer: {
      eyebrow: "Automation",
      title: "Streamer.bot",
      description:
        "Optional custom actions for your stream, with live event data.",
      content:
        `<section class="panel settings-panel streamer-panel twitch-connection-panel"><div class="panel-body">${streamerBotConnection}</div></section>` +
        `<section class="panel settings-panel streamer-panel streamer-hooks-panel"><div class="panel-body">${streamerBotEvents}</div></section>` +
        `<div class="integration-save">${feedbackButton("save-streamer", "Save settings", "", "file", "submit")}</div>` +
        `<section class="panel settings-panel streamer-panel twitch-guide-panel">${renderGuideHeader("Setup Guide", "Connect Streamer.bot and configure your own actions.", "streamer")}<div class="panel-body">${setupGuide}</div></section>`,
    },
    twitch: {
      eyebrow: "Chat",
      title: "Twitch",
      description:
        "Authorize the account you want to use to post results to chat.",
      content:
        `<section class="panel settings-panel streamer-panel twitch-connection-panel"><div class="panel-body">${twitchConnection}</div></section>` +
        `<section class="panel settings-panel streamer-panel twitch-messages-panel"><div class="panel-body">${twitchMessages}</div></section>` +
        `<div class="integration-save">${feedbackButton("save-twitch", "Save settings", "", "file", "submit")}</div>` +
        `<section class="panel settings-panel streamer-panel twitch-guide-panel">${renderGuideHeader("Setup Guide", "Follow these steps to connect Twitch and start posting to chat.", "twitch")}<div class="panel-body">${twitchGuide}</div></section>`,
    },
  }[section];

  return `
    <div class="page-head simple">
      <div class="race-heading">
        <i class="race-heading-icon ${section === "twitch" ? "twitch-heading-icon" : ""}">${sidebarArtwork(section, `header-${section}`)}</i><div>
        <h1>${page.title}</h1>
        </div>
      </div>
    </div>

    
    <form id="settings-form" class="integration-page-layout ${section}-page-layout">
      ${page.content}
      <p class="settings-autosave-status" id="settings-autosave-status" role="status" aria-live="polite"></p>
      ${section !== "settings" ? "" : `<div class="integration-save">${feedbackButton("save-settings", "Save settings", "", "file", "submit")}</div>`}
    </form>
  `;
}

function sidebarIcon(id: string): string {
  const name = id.replace(/^status-/, "");
  return sidebarArtwork(name === "cycles" ? "racecycles" : name, id);
}
function navItem(page: string, currentPage: string, title: string): string {
  const gradientIcon = sidebarIcon(page);
  return `
    <button
      data-page="${page}"
      title="${title}" aria-label="${title}"
      class="nav-item ${currentPage === page ? "active" : ""}"
    >
      ${gradientIcon}
      <span>${title}</span>
    </button>
  `;
}

function resultsName(name: string, editing: boolean): string {
  const pencil = icons.pencil;
  return `<form id="season-form" class="results-name">
    ${editing ? `${iconInput(icons.file, `<input id="season-name" maxlength="120" value="${escapeHtml(name)}" aria-label="Results name" />`)}` : `<h2>${escapeHtml(name)}</h2>`}
    <button id="edit-season-name" type="button" class="compact-button edit-name" aria-label="Edit name" title="Edit name">${pencil}</button>
    ${editing ? `<button type="submit" class="compact-button">Save</button>` : ""}
  </form>`;
}

function raceCyclesPage(
  state: Snapshot,
  sort: RaceCycleSort,
  editingName: boolean,
  busy: boolean,
): string {
  const ranks = new Map(
    [...state.raceCycles]
      .sort(compareCycleLeaders)
      .map((player, index) => [player.playerKey, index + 1]),
  );
  const players = [...state.raceCycles].sort((left, right) => {
    let comparison: number;
    if (sort.key === "racer") {
      comparison = left.playerName.localeCompare(right.playerName, undefined, {
        sensitivity: "base",
      });
    } else if (sort.key === "cycles") {
      comparison = left.cycles - right.cycles;
    } else if (sort.key === "races") {
      comparison = cycleRaceTotal(left) - cycleRaceTotal(right);
    } else {
      const position = Number(sort.key.replace("position-", "")) - 1;
      comparison =
        (left.placementCounts[position] ?? 0) -
        (right.placementCounts[position] ?? 0);
    }
    if (comparison === 0) {
      if (sort.key === "cycles") return compareCycleLeaders(left, right);
      comparison = left.playerName.localeCompare(right.playerName, undefined, {
        sensitivity: "base",
      });
    }
    return sort.direction === "asc" ? comparison : -comparison;
  });
  const sortableHeader = (key: string, label: string): string => {
    const active = sort.key === key;
    const arrow = active ? (sort.direction === "asc" ? "▲" : "▼") : "";
    return `<th><button type="button" class="cycle-sort ${active ? "active" : ""}" data-cycle-sort="${key}">${label}<span>${arrow}</span></button></th>`;
  };
  const totalCycles = players.reduce(
    (total, player) => total + player.cycles,
    0,
  );
  const rows = players
    .map(
      (player, index) => `
        <tr>
          <td class="cycle-rank"><b class="place">${ranks.get(player.playerKey)}</b></td>
          <td class="cycle-player">
            <button type="button" class="player-history-link" data-cycle-player="${escapeHtml(player.playerKey)}">${escapeHtml(player.playerName)}</button>
          </td>
          <td class="cycle-total">${player.cycles}</td>
          <td title="${player.totalRacesComplete ? "Races participated in, including positions outside the top ten" : "Minimum known races; older saved results do not contain complete participation counts"}">${player.totalRacesComplete ? "" : "≥"}${cycleRaceTotal(player)}</td>
          ${Array.from({ length: 10 }, (_, index) => {
            const count = player.placementCounts[index] ?? 0;
            return `<td class="cycle-count ${cyclePositions(player).includes(index + 1) ? "ready" : ""}">${count}</td>`;
          }).join("")}
        </tr>
      `,
    )
    .join("");

  return `
    <div class="cycles-view">
    <div class="page-head tracking-page-head">
      <div class="race-heading">
        <i class="race-heading-icon">${sidebarArtwork("racecycles", "header-racecycles")}</i>
        <div><h1>RaceCycles</h1></div>
      </div>
    <div class="summary-row">
      ${stat("Tracked racers", players.length)}
      ${stat("Completed cycles", totalCycles)}
      ${stat("Race #", state.totalCycleRaceCount)}
      ${stat("Last updated", state.cycleLastUpdate ? formatTime(state.cycleLastUpdate) : "Never")}
    </div>

      <div class="tracking-controls">${watcherControls(state, busy, "cycles")}
        ${feedbackButton("reprocess-latest", "Reprocess latest file", 'data-reprocess-latest title="Reprocess the most recently modified Race or Battle Royale for stats and cycles"', "cycles")}
        ${feedbackButton("import-marble-cycle", "Import from MarblesCycles", "data-import-marble-cycle", "download")}
      </div>
    </div>

    <section class="panel fill-panel cycles-panel">
      <header class="results-header">
        ${resultsName(state.config.seasons.cycleName || "Cycle progress", editingName)}
        <div class="results-actions">
          ${iconInput(icons.search, `<input id="cycle-search" class="cycle-search" type="search" placeholder="Search players" aria-label="Search players" />`)}
          <span id="cycle-filter-count" aria-live="polite"></span>
          <div class="results-actions-group">
            <button data-export="cycles" class="compact-button" title="Export entire cycles list">Export</button>
            <button id="clear-race-cycles" class="compact-button btn-error" type="button" ${players.length || state.totalCycleRaceCount ? "" : "disabled"}>Clear Results</button>
          </div>
        </div>
      </header>
      <div class="panel-body">
        ${
          players.length
            ? `<div class="table-frame"><div class="table-wrap cycle-table-wrap">
                <table class="cycle-table">
                  <thead><tr><th>#</th>${sortableHeader("racer", "Racer")}${sortableHeader("cycles", "Cycles")}${sortableHeader("races", "Races")}${Array.from({ length: 10 }, (_, index) => sortableHeader(`position-${index + 1}`, String(index + 1))).join("")}</tr></thead>
                  <tbody>${rows}</tbody>
                </table>
              </div></div>`
            : `<div class="empty-state"><b>No cycle placements recorded yet</b><span>New Race results will populate this page automatically.</span></div>`
        }
      </div>
    </section>
    </div>
  `;
}

function homePage(state: Snapshot, busy: boolean): string {
  const game = state.latestResult;
  const battleRoyale = game?.gameType === "battleRoyale";
  const pointsEarned = (games: GameResult[]) =>
    games.reduce(
      (total, match) =>
        total +
        match.results.reduce(
          (points, player) => points + player.seasonPointsEarned,
          0,
        ),
      0,
    );
  const sessionPoints = pointsEarned(state.sessionResults);
  const seasonPoints =
    state.seasonPointsEarned ?? pointsEarned(state.recentResults);
  const totalBRs =
    state.totalBattleRoyaleCount ??
    state.recentResults.filter((result) => result.gameType === "battleRoyale")
      .length;
  const totalRaces =
    state.totalBattleRoyaleCount == null
      ? Math.max(0, state.totalRaceCount - totalBRs)
      : state.totalRaceCount;
  const podium = [1, 2, 3].map((place) =>
    game?.results.find((result) => result.placement === place),
  );
  const leaders = [...state.raceCycles].sort(compareCycleLeaders);
  const topCycles = leaders.slice(0, 3);
  const summary = (label: string, value: number, icon: string) =>
    `<span><i class="home-stat-icon" aria-hidden="true">${icons[icon]}</i><span class="home-stat-copy"><small>${escapeHtml(label)}</small><b>${value}</b></span></span>`;
  const lastUpdated = (timestamp?: string | null) =>
    `<p class="home-table-updated"><i aria-hidden="true">${icons.clock}</i><span>Last updated: ${timestamp ? `<time datetime="${escapeHtml(timestamp)}" title="${escapeHtml(formatDate(timestamp))}">${escapeHtml(formatTime(timestamp))}</time>` : "Never"}</span></p>`;
  const watcherCard = (
    kind: "stats" | "cycles",
    title: string,
    icon: string,
    season: string,
  ) => {
    const active = trackingIsActive(state, kind);
    const running = active && watcherIsActive(state);
    return `<section class="panel home-watcher">
      <header><div class="home-card-heading"><i>${icons[icon]}</i><h2>${title}</h2></div><div class="watch-state ${running ? "good" : "bad"}"><i></i><span>${active ? escapeHtml(state.watcherStatus) : "Stopped"}</span></div></header>
      <div class="panel-body"><p class="home-season">${escapeHtml(season)}</p>
        <button class="action ${active ? "stop" : "start"} home-watch-button" data-tracking-toggle="${kind}" ${busy ? "disabled" : ""}>${busy || active ? icons.spinner : icons.watcherStart}<span>${active ? "Stop" : "Start"} ${title}</span></button>
      </div>
    </section>`;
  };
  return `<div class="home-page">
    <header class="page-head"><div class="race-heading"><i class="race-heading-icon">${sidebarArtwork("home", "header-home")}</i><div><h1>North Korea Stats</h1></div></div>${feedbackButton("reprocess-latest", "Reprocess latest file", 'data-reprocess-latest title="Reprocess the most recently modified Race or Battle Royale for stats and cycles"', "cycles")}</header>
    <div class="home-watchers">${watcherCard("stats", "RaceStats", "raceFlag", state.config.seasons.raceName)}${watcherCard("cycles", "RaceCycles", "repeatOnce", state.config.seasons.cycleName)}</div>
    <div class="home-results">
      <section class="panel"><header><div class="home-card-heading"><i>${icons.crown}</i><h2>${battleRoyale ? "Latest Battle Royale" : "Latest Race podium"}</h2></div><button class="action home-view-button" data-page="overview">View results</button></header><div class="panel-body">
        ${lastUpdated(game ? (state.lastUpdate ?? game.timestamp) : null)}
        ${
          game
            ? `<div class="table-frame home-table-frame"><div class="table-scroll"><table class="home-summary-table ${battleRoyale ? "battle-royale-results" : "race-results"}"><thead><tr><th>#</th><th>Player</th>${battleRoyale ? "<th>Kills</th><th>Damage</th>" : ""}<th>Points</th>${battleRoyale ? "" : "<th>Season total</th>"}<th>Wins</th></tr></thead><tbody>${
                battleRoyale
                  ? podium
                      .filter(
                        (player): player is GameResult["results"][number] =>
                          player != null,
                      )
                      .map((player) => resultRow(player, true, true))
                      .join("")
                  : podium
                      .map(
                        (player, index) =>
                          `<tr class="p${index + 1}"><td><b class="place p${index + 1}">${index + 1}</b></td><td title="${escapeHtml(player?.playerName ?? "")}" >${escapeHtml(player?.playerName ?? "—")}</td><td class="points">${escapeHtml(player?.seasonPointsEarned ?? "—")}</td><td>${escapeHtml(player?.seasonPointsTotal ?? "—")}</td><td>${escapeHtml(player?.seasonWinsTotal ?? "—")}</td></tr>`,
                      )
                      .join("")
              }</tbody></table></div></div>`
            : '<p class="home-empty">No results scanned yet.</p>'
        }
        <div class="home-card-summary">${summary("Total races", totalRaces, "statRaceFlag")}${summary("Total BRs", totalBRs, "battleRoyale")}${summary("Players", game?.playerCount ?? 0, "racers")}${summary("Session races", state.sessionResults.filter((game) => game.gameType === "race").length, "clock")}${summary("Session BRs", state.sessionResults.filter((game) => game.gameType === "battleRoyale").length, "battleRoyale")}</div>
      </div></section>
      <section class="panel"><header><div class="home-card-heading"><i>${icons.crown}</i><h2>Cycle leaders</h2></div><button class="action home-view-button" data-page="racecycles">View cycles</button></header><div class="panel-body">
        ${lastUpdated(state.cycleLastUpdate)}
        ${
          topCycles.length
            ? `<div class="table-frame home-table-frame"><div class="table-scroll"><table class="home-summary-table"><thead><tr><th>#</th><th>Player</th><th>Cycles</th><th>Next cycle</th></tr></thead><tbody>${topCycles
                .map((player, index) => {
                  return `<tr><td><b class="place">${index + 1}</b></td><td>${escapeHtml(player.playerName)}</td><td class="cycle-total">${player.cycles}</td><td>${cycleProgress(player)}/10</td></tr>`;
                })
                .join("")}</tbody></table></div></div>`
            : '<p class="home-empty">No cycle results yet.</p>'
        }
        <div class="home-card-summary">${summary("Players", state.raceCycles.length, "racers")}${summary("Races", state.totalCycleRaceCount, "statRaceFlag")}${summary(
          "Complete",
          state.raceCycles.reduce((sum, player) => sum + player.cycles, 0),
          "cycles",
        )}</div>
      </div></section>
      <section class="panel home-points-panel" aria-label="Points totals"><div class="panel-body">
        <div class="home-card-summary home-points-summary">${summary("Session points", sessionPoints, "points")}${summary("Season points", seasonPoints, "points")}</div>
      </div></section>
    </div>
    <div class="home-koreajongil" aria-hidden="true"><div class="home-koreajongil-crop"><img src="${new URL("./assets/assets/koreajongil.png", import.meta.url).href}" alt="" draggable="false" /></div></div>
  </div>`;
}

function sidebar(state: Snapshot, currentPage: string): string {
  return `
    <aside class="sidebar">

      <nav>
        <div class="sidebar-heading"><span>Merbz</span><button type="button" class="sidebar-collapse-button" data-collapse-sidebar aria-label="Collapse sidebar" title="Collapse sidebar" aria-expanded="true">${icons.sidebar}</button></div>
        ${navItem("home", currentPage, "Home")}
        ${navItem("overview", currentPage, "RaceStats")}
        ${navItem("racecycles", currentPage, "RaceCycles")}
        ${navItem("history", currentPage, "History")}
         ${navItem("logs", currentPage, "Live log")}

        <span>Integrations</span>
        ${navItem("twitch", currentPage, "Twitch")}
        ${navItem("streamer", currentPage, "Streamer.bot")}
        ${navItem("overlays", currentPage, "Overlays")}
        ${navItem("settings", currentPage, "Settings")}
       
      </nav>

      <div class="sidebar-foot">
        <div class="watcher-statuses connection-statuses">
        <div class="sidebar-watcher" title="Twitch: ${escapeHtml(state.twitchUsername ?? state.twitchStatus)} — ${escapeHtml(state.twitchStatus)}">
          <i class="sidebar-status-icon" aria-hidden="true">${sidebarIcon("status-twitch")}</i>
          <small>Twitch</small>
          <div class="watch-state ${twitchTone(state)}"><i></i><span>${escapeHtml(
            state.twitchUsername && state.twitchStatus === "Connected"
              ? state.twitchUsername
              : state.twitchStatus,
          )}</span></div>
        </div>
       
        <div class="sidebar-watcher" title="Streamer.bot: ${escapeHtml(state.streamerBotStatus)}">
          <i class="sidebar-status-icon" aria-hidden="true">${sidebarIcon("status-streamer")}</i>
          <small>Streamer.bot</small>
          <div class="watch-state ${streamerBotTone(state)}"><i></i><span>${escapeHtml(state.streamerBotStatus)}</span></div>
        </div>
        </div>
        <div class="watcher-statuses">
          ${(["stats", "cycles"] as const)
            .map((kind) => {
              const running =
                trackingIsActive(state, kind) && watcherIsActive(state);
              const label = kind === "stats" ? "Stats" : "Cycles";
              return `<div class="sidebar-watcher" title="${label}: ${running ? "Watching" : "Stopped"}"><i class="sidebar-status-icon" aria-hidden="true">${sidebarIcon(`status-${kind}`)}</i><small>${label}</small><div class="watch-state ${running ? "good" : "bad"}"><i></i><span>${running ? "Watching" : "Stopped"}</span></div></div>`;
            })
            .join("")}
        </div>
      </div>
    </aside>
  `;
}

export function renderApplication(
  state: Snapshot,
  currentPage: string,
  busy: boolean,
  selectedLogFilter: string,
  raceCycleSort: RaceCycleSort,
  editingName = false,
  resultsSort: ResultsSort = { key: "placement", direction: "asc" },
  overlayDirectory = "",
  selectedRaceId = "",
): string {
  const content =
    currentPage === "home"
      ? homePage(state, busy)
      : currentPage === "overview"
        ? overviewPage(state, busy, editingName, resultsSort, selectedRaceId)
        : currentPage === "racecycles"
          ? raceCyclesPage(state, raceCycleSort, editingName, busy)
          : currentPage === "history"
            ? historyPage(state)
            : currentPage === "logs"
              ? logsPage(state, selectedLogFilter)
              : currentPage === "overlays"
                ? overlaysPage(overlayDirectory, (file, kind) =>
                    feedbackButton(
                      `test-overlay-${file}`,
                      "Test",
                      `data-test-overlay="${kind}"`,
                      "play",
                    ),
                  )
                : currentPage === "streamer" || currentPage === "twitch"
                  ? settingsPage(state, currentPage)
                  : settingsPage(state);

  return `
    <div class="app-shell">
      ${sidebar(state, currentPage)}
      <main class="content">
        ${content}
      </main>
    </div>
  `;
}

function logsPage(state: Snapshot, selectedFilter: string): string {
  const logs = state.logs.filter(
    (entry) => selectedFilter === "all" || entry.level === selectedFilter,
  );

  return `
    <section class="log-window">
      <header class="page-head">
        <div class="race-heading"><i class="race-heading-icon">${sidebarArtwork("logs", "header-logs")}</i><div><h1>Live log</h1></div></div>

        <div class="log-actions">
          <select id="log-filter">
            <option value="all">All</option>
            <option value="info">Info</option>
            <option value="warning">Warning</option>
            <option value="error">Error</option>
          </select>
        </div>
      </header>

      <div id="log-list" class="log-list">
        ${
          logs.length
            ? logs
                .map(
                  (entry) => `
                    <div class="log-row ${escapeHtml(entry.level)}">
                      <time>${formatTime(entry.timestamp)}</time>
                      <b>${escapeHtml(formatLabel(entry.level))}</b>
                      <span>${escapeHtml(entry.message)}</span>
                    </div>
                  `,
                )
                .join("")
            : `<div class="empty-state">No matching entries.</div>`
        }
      </div>
    </section>
  `;
}

export function playerKey(result: GameResult["results"][number]): string {
  return `${result.platform.trim().toLowerCase()}:${(result.username.trim() || result.playerName.trim()).toLowerCase()}`;
}

function playerHistorySummary(
  subtitle: string,
  totals: [string, number | string][],
  counts: number[],
): string {
  const ordinal = (place: number) =>
    `${place}${place === 1 ? "st" : place === 2 ? "nd" : place === 3 ? "rd" : "th"}`;
  const medal = `<svg viewBox="0 0 24 30" fill="none" aria-hidden="true"><path d="m6 18-2 10 8-4 8 4-2-10" fill="currentColor" opacity=".45"/><circle cx="12" cy="11" r="9" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="11" r="6" fill="currentColor" opacity=".25"/><path d="m12 6 1.6 3.2 3.5.5-2.5 2.5.6 3.5-3.2-1.7-3.2 1.7.6-3.5L7 9.7l3.4-.5L12 6Z" fill="currentColor"/></svg>`;
  return `<section class="summary-item player-history-summary ${counts.length === 3 ? "player-history-podium" : "player-history-cycle-card"}" aria-label="${escapeHtml(subtitle)}">
    <div class="player-history-profile">
      <div class="player-history-totals">${totals.map(([label, value]) => `<span><small>${escapeHtml(label)}</small><b>${escapeHtml(value)}</b></span>`).join("")}</div>
    </div>
    <div class="player-history-placements" aria-label="Placement totals">${counts.map((count, index) => `<span class="player-history-placement" aria-label="${ordinal(index + 1)} places: ${count}">${index < 3 ? `<i class="player-history-medal">${medal}</i>` : ""}<span><small>${ordinal(index + 1)}</small><b>${count}</b></span></span>`).join("")}</div>
  </section>`;
}

export function playerHistoryContent(
  state: Snapshot,
  kind: "race" | "cycles",
  key: string,
): { title: string; content: string } {
  const player = state.raceCycles.find((player) => player.playerKey === key);
  let name = player?.playerName ?? key;
  const table = (headers: string[], rows: string[]): string =>
    `<div class="table-frame"><div class="table-scroll"><table><thead><tr>${headers.map((header) => `<th>${header}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div></div>`;
  if (kind === "cycles") {
    const rows: string[] = [];
    const counts = Array<number>(10).fill(0);
    let cyclesEarned = 0;
    const participated = new Set(
      state.recentResults
        .filter(
          (game) =>
            game.gameType === "race" &&
            game.results.some((result) => playerKey(result) === key),
        )
        .map((game) => game.id),
    );
    let participation = participated.size;
    let incompleteParticipation = false;
    const seenGames = new Set<string>();
    for (const entry of [...state.cycleHistory].reverse()) {
      if (seenGames.has(entry.gameId)) continue;
      seenGames.add(entry.gameId);
      // Older saved entries have the race fingerprint but no per-player earnings.
      // Display only actual saved matching standings; never migrate or fabricate them.
      const savedGame =
        entry.game ??
        state.recentResults.find((game) => game.id === entry.gameId);
      const savedResult =
        savedGame?.gameType === "race"
          ? savedGame.results.find((result) => playerKey(result) === key)
          : undefined;
      if (savedResult && !participated.has(entry.gameId)) {
        participation++;
        participated.add(entry.gameId);
      }
      if (!savedGame) incompleteParticipation = true;
      let earned = entry.earnings?.find((earned) => earned.playerKey === key);
      if (
        !entry.earnings?.length &&
        savedResult &&
        savedResult.eliminated !== true &&
        savedResult.placement >= 1 &&
        savedResult.placement <= 10
      ) {
        const completion = entry.completions?.find((completion) =>
          [
            savedResult.playerName,
            savedResult.displayName,
            savedResult.username,
          ].some(
            (name) =>
              name.trim().toLowerCase() ===
              completion.playerName.trim().toLowerCase(),
          ),
        );
        earned = {
          playerKey: key,
          playerName: savedResult.playerName,
          placement: savedResult.placement,
          pointsEarned: 1,
          cyclesEarned: completion ? 1 : 0,
          cycleNumber: completion?.cycleNumber ?? 0,
          placementCounts: [],
        };
      }
      if (!earned && !entry.earnings?.length) {
        const knownNames = [
          player?.playerName,
          key.split(":").slice(1).join(":"),
        ].filter(Boolean);
        const completions = entry.completions?.length
          ? entry.completions
          : entry.cycleNumber > 0
            ? [{ playerName: entry.playerName, cycleNumber: entry.cycleNumber }]
            : [];
        const completion = completions.find((completion) =>
          knownNames.some(
            (name) =>
              name!.trim().toLowerCase() ===
              completion.playerName.trim().toLowerCase(),
          ),
        );
        if (completion) {
          name = completion.playerName;
          cyclesEarned += 1;
          rows.push(
            `<tr class="history-achievement"><td>${formatDate(entry.timestamp)}</td><td>${escapeHtml(entry.mapName ?? "Unknown track")}</td><td>—</td><td>—</td><td>Cycle #${completion.cycleNumber} completed</td><td>—</td><td>${entry.playerCount ?? "—"}</td></tr>`,
          );
        }
      }
      if (!earned) continue;
      name = earned.playerName;
      if (earned.placement >= 1 && earned.placement <= 10)
        counts[earned.placement - 1] += earned.pointsEarned;
      cyclesEarned += earned.cyclesEarned;
      rows.push(
        `<tr class="${earned.cyclesEarned ? "history-achievement" : ""}"><td>${formatDate(entry.timestamp)}</td><td>${escapeHtml(entry.mapName ?? savedGame?.mapName ?? "Unknown track")}</td><td>${earned.placement}</td><td>${earned.pointsEarned}</td><td>${earned.cyclesEarned ? `Cycle #${earned.cycleNumber} completed` : "\u2014"}</td><td>${earned.placementCounts.length ? earned.placementCounts.join(" / ") : "\u2014"}</td><td>${entry.playerCount ?? savedGame?.playerCount ?? "\u2014"}</td></tr>`,
      );
    }
    const summary = playerHistorySummary(
      "Cycles · saved history",
      [
        ["Points", counts.reduce((sum, count) => sum + count, 0)],
        ["Cycles", cyclesEarned],
        [
          "Races",
          incompleteParticipation ? `≥${participation}` : participation,
        ],
      ],
      counts,
    );
    return {
      title: `${name} \u2014 Cycles history`,
      content:
        summary +
        (rows.length
          ? table(
              [
                "Date/time",
                "Track",
                "Placement",
                "Points earned",
                "Cycles earned",
                "Placements 1-10",
                "Participants",
              ],
              rows,
            )
          : '<div class="empty-state">No saved point-earning races for this player.</div>'),
    };
  }
  const raceRows: string[] = [];
  const brRows: string[] = [];
  const podiumCounts = [0, 0, 0];
  let earnedPoints = 0;
  let eventPoints = 0;
  const eventIds = new Set(
    state.eventResultIds ?? state.sessionResults.map((game) => game.id),
  );
  for (const game of [...state.recentResults].reverse()) {
    for (const result of game.results.filter(
      (result) => playerKey(result) === key,
    )) {
      name = result.playerName;
      if (
        (game.gameType === "battleRoyale" || result.eliminated !== true) &&
        result.placement >= 1 &&
        result.placement <= 3
      )
        podiumCounts[result.placement - 1]++;
      earnedPoints += result.seasonPointsEarned;
      if (eventIds.has(game.id)) eventPoints += result.seasonPointsEarned;
      const br = game.gameType === "battleRoyale";
      const worldRecord =
        game.hasWorldRecord &&
        [result.playerName, result.username, result.displayName].some(
          (name) =>
            name.trim().toLowerCase() ===
            game.worldRecordPlayer?.trim().toLowerCase(),
        );
      const row = `<tr class="${worldRecord ? "history-achievement" : ""}"><td>${formatDate(game.timestamp)}</td><td>${escapeHtml(game.mapName ?? "Unknown track")}</td><td>${result.placement}</td><td class="race-time">${formatRaceTime(result.finishTime)}</td><td>${result.seasonPointsEarned}</td><td>${result.seasonPointsTotal ?? "\u2014"}</td><td>${result.seasonWinsTotal ?? "\u2014"}</td><td>${game.playerCount}</td><td>${result.eliminated == null ? "\u2014" : result.eliminated ? "Yes" : "No"}</td>${br ? `<td>${escapeHtml(result.rawData?.MatchKills ?? "\u2014")}</td><td>${escapeHtml(result.rawData?.MatchDamageDealt ?? "\u2014")}</td>` : ""}<td>${worldRecord ? "World record" : "\u2014"}</td></tr>`;
      (br ? brRows : raceRows).push(row);
    }
  }
  const headers = [
    "Date/time",
    "Track",
    "Placement",
    "Time",
    "Points earned",
    "Season total",
    "Wins",
    "Participants",
    "Eliminated",
  ];
  const summary = playerHistorySummary(
    "RaceStats · player results",
    [
      ["Total points", earnedPoints],
      ["Event points", eventPoints],
      ["Races", raceRows.length],
      ["BRs", brRows.length],
    ],
    podiumCounts,
  );
  return {
    title: `${name} \u2014 Detailed race results`,
    content:
      summary +
      ((raceRows.length
        ? `<h3>Race results</h3>${table([...headers, "Record"], raceRows)}`
        : "") +
        (brRows.length
          ? `<h3>Battle Royale results</h3>${table([...headers, "Kills", "Damage", "Record"], brRows)}`
          : "") ||
        '<div class="empty-state">No saved races for this player.</div>'),
  };
}
