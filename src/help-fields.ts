/** Verified against streamer_bot.rs, overlays.rs and public/overlays/overlay.js.
 * Keys are case-sensitive. Array/object entries describe data, not scalar text arguments.
 */
export type HelpField = [key: string, description: string];
export interface HelpFieldGroup {
  title: string;
  availability: string;
  fields: HelpField[];
}

export const commonHelpFields: HelpFieldGroup = {
  title: "Match and totals",
  availability: "All three Streamer.bot events and normal HTML overlay data. Match fields can be absent before a result exists.",
  fields: [
    ["race", "Readable match type: Race or Battle Royale."],
    ["gameType", "Machine match type: race or battleRoyale."],
    ["mapName", "Track/map name; unavailable names are null."],
    ["playerCount", "Number of players in this match."],
    ["matchPoints", "Sum of every player's earned points in this match."],
    ["sessionPoints", "Earned Race + BR points in matches counted this app session."],
    ["seasonPoints", "Earned Race + BR points counted since RaceStats was reset; not a player's CSV season total."],
    ["sessionRaces", "Number of races counted this app session."],
    ["sessionBRs", "Number of Battle Royales counted this app session."],
    ["sessionPlayers", "Unique players in this session's counted matches, identified by platform and account name."],
    ["seasonName", "Your RaceStats season label."],
    ["cycleSeasonName", "Your RaceCycles season label."],
    ["cyclePlayers", "Unique tracked RaceCycles players."],
    ["cycleRaces", "Matches counted by RaceCycles since its reset (including BR when processed by that pipeline)."],
    ["hasWorldRecord", "Confirmed new-record flag. Current CSV parsing does not confirm new records, so real matches currently send false."],
    ["gameId", "Stable match identifier."],
    ["snapshotId", "Source CSV snapshot identifier; can be null."],
    ["timestamp", "Normalized result timestamp."],
    ["eventId", "Packet/event identifier. Cycle events have a player/cycle-specific ID."],
    ["eventType", "raceComplete, worldRecord or cycleComplete for hooks; stateUpdate for normal overlay state."],
  ],
};

const playerSuffixes: HelpField[] = [
  ["username", "Account username; empty if unavailable."],
  ["platform", "Account platform; empty if unavailable."],
  ["placement", "Placement number; null if the player cannot be found."],
  ["seasontotal", "That player's CSV season total; null if unavailable."],
  ["kills", "BR MatchKills value; null when unavailable."],
  ["damage", "BR MatchDamageDealt value; null when unavailable."],
  ["eliminated", "CSV eliminated flag; null if unavailable."],
];
const expandPlayer = (prefix: string): HelpField[] => playerSuffixes.map(([suffix, meaning]) => [prefix + suffix, meaning]);

export const podiumHelpFields: HelpFieldGroup = {
  title: "First, second and third",
  availability: "All Streamer.bot events and HTML packets with a match. These use actual placement numbers, rather than CSV row order.",
  fields: ["first", "second", "third"].flatMap(prefix => [
    [prefix + "place", "Player name for this placement; empty if no such player."],
    [prefix + "placepoints", "Points this player earned in this match; zero if no such player."],
    [prefix + "placetime", "Race finish time in seconds; null when unavailable, including BR."],
    ...expandPlayer(prefix + "place"),
  ] as HelpField[]),
};

export const recordHelpFields: HelpFieldGroup = {
  title: "World record player",
  availability: "World record hook and world-record-data.js only. Not included in normal overlay-data.js. Automatic detection uses changed LastCustomRaceMapPlayed.csv records matching the completed match's map and winner; Race winning times must also match. RecordHolderName is used, not the streamer's local record. Tests supply sample data.",
  fields: [
    ["wrplayer", "Record player's display name, or record-holder name if not matched to the result."],
    ["wrplayerpoints", "Record player's earned points in this match; null if the record holder cannot be matched."],
    ["wrrecordtime", "Record time in seconds; null if unavailable."],
    ...expandPlayer("wrplayer"),
  ],
};

export const cycleHelpFields: HelpFieldGroup = {
  title: "Cycle completion",
  availability: "Cycle hook: one action run per completed player/cycle. Player points and suffix fields below belong to that hook only. Cycle HTML alerts instead expose cycleCompletions rows and joined cycleplayer/cyclenumber/cycleraces labels. Normal state data has no completions.",
  fields: [
    ["cycleplayer", "Player who completed this cycle. On cycle HTML alerts, multiple completion names are joined with commas."],
    ["cyclenumber", "Player's completed cycle number; HTML alerts join multiple numbers with commas."],
    ["cycleraces", "Player's matches entered while collecting this set of positions 1–10, including repeated placements. Unknown legacy counts are null. HTML alerts join multiple players' counts with commas."],
    ["cycleplayerpoints", "Points earned in the completing match. Only a cycle hook supplies this convenient field."],
    ...expandPlayer("cycleplayer"),
  ],
};

export const structuredHelpFields: HelpFieldGroup = {
  title: "Structured data",
  availability: "Arrays/objects require a repeater or custom processing; they are not simple text values. Streamer.bot does not receive dotted array entries as individually named arguments.",
  fields: [
    ["placements", "Full player-result array. HTML sorts it by place before binding; Streamer.bot preserves normalized result order."],
    ["placementsJson", "JSON string of the full player-result array."],
    ["cycleCompletions", "New completions for this match: playerName, cycleNumber and races. Normal overlay state sends an empty array."],
    ["cycleStandings", "All RaceCycles players in standings order, with the same fields as cycleLeaders. Used by the Cycle status overlay."],
    ["cycleLeaders", "Up to three RaceCycles leaders, ordered by completed cycles, then progress, then name. Contains playerKey, playerName, cycles, placementCounts, currentCyclePositions, cycleProgress and cycleRaceCounts."],
    ["overlayDataJson", "Streamer.bot only: JSON string of the complete event packet, without recursive overlayDataJson."],
    ["isTest", "Sample hook/overlay packets only: true. This field is absent in real event packets."],
  ],
};

export const placementRowHelpFields: HelpFieldGroup = {
  title: "Player rows",
  availability: "Inside data-repeat=placements HTML templates; also in placements/placementsJson for custom processing. Dotted HTML paths such as placements.0.name select a row in placement order. Row indexes are zero-based and are not placement numbers.",
  fields: [
    ["place", "Player placement number."], ["name", "Player display name."],
    ["username", "Account username."], ["platform", "Account platform."],
    ["points", "Points earned in this match."], ["seasonTotal", "Player CSV season total; null if unavailable."],
    ["time", "Race finish time in seconds; null if unavailable."],
    ["eliminated", "CSV eliminated flag; null if unavailable."],
    ["kills", "BR kills; null if unavailable."], ["damage", "BR damage; null if unavailable."],
  ],
};

export const cycleRowHelpFields: HelpFieldGroup = {
  title: "Cycle completion rows",
  availability: "Inside data-repeat=cycleCompletions HTML templates or structured cycleCompletions event data.",
  fields: [["playerName", "Completing player's name."], ["cycleNumber", "Completed cycle number."],
    ["races", "Matches taken for that individual cycle; null when legacy counting data is unavailable."]],
};

export const cycleLeaderHelpFields: HelpFieldGroup = {
  title: "Cycle leader rows",
  availability: "Inside data-repeat=cycleStandings (Cycle status overlay), data-repeat=cycleLeaders or structured cycle data.",
  fields: [["playerKey", "Tracked player identity."], ["playerName", "Player name."], ["cycles", "Completed cycles."],
    ["placementCounts", "Array of counts for places 1–10; use a dotted index or custom processing."],
    ["currentCyclePositions", "Distinct finishing positions 1–10 collected in the current progress set. After all ten are collected, the player's next match starts a fresh set; places above 10 add no slot."],
    ["cycleProgress", "Current occupied-slot count, 0–10. Repeated positions count once. The completed 10/10 set restarts on that player's next match."],
    ["cycleRaceCounts", "One-entry array containing the matches entered in the current position set, including repeats; unknown legacy duration is null."]],
};

export const overlayDerivedHelpFields: HelpFieldGroup = {
  title: "HTML-only helper values",
  availability: "Added by overlay.js; not Streamer.bot arguments. Boolean helpers are most useful with data-show or data-class.",
  fields: [["brand", "overlay-config.js title."], ["br", "True for Battle Royale."], ["isRace", "True when gameType is not battleRoyale."],
    ["hasRecordPoints", "True when wrplayerpoints is available."],
    ["playerKey", "Player-row key formed from platform and username/name."], ["winner", "Player row is place 1."],
    ["dead", "Player row is BR and not place 1."], ["ordinary", "Player row is not place 1 and is not BR."],
    ["completionKey", "Cycle-row key formed from name and cycle number."], ["hasRaceCount", "Cycle row has a known races value."],
    ["receivedAt", "Alert-file timestamp used for expiry; WR/cycle packets only."],
  ],
};

export const legacyHelpFields: HelpFieldGroup = {
  title: "Compatibility aliases",
  availability: "Existing event packets retain these aliases. Prefer the named placement and wr-prefixed fields for new templates.",
  fields: [
    ...["first", "second", "third"].flatMap(prefix => [
      [prefix + "Name", "Alias of " + prefix + "place."], [prefix + "Points", "Alias of " + prefix + "placepoints."],
      [prefix + "Username", "Alias of " + prefix + "placeusername."], [prefix + "Time", "Alias of " + prefix + "placetime."],
    ] as HelpField[]),
    ["playerName", "WR only: raw record-holder name; may differ from matched wrplayer display name."],
    ["playerUsername", "WR only: alias of wrplayerusername."], ["playerPoints", "WR only: alias of wrplayerpoints."],
    ["player", "WR only: alias of wrplayer."], ["playerpoints", "WR only: alias of wrplayerpoints."],
    ["recordtime", "WR only: alias of wrrecordtime."], ["recordTime", "WR only: alias of wrrecordtime."],
  ],
};

export const overlayConfigHelpFields: HelpFieldGroup = {
  title: "overlay-config.js settings",
  availability: "Configuration properties, not brace variables. Save the file and refresh the OBS Browser Source after changing settings.",
  fields: [["title", "Brand label (default Marbles Stats)."], ["visibleRows", "Visible results window, clamped to 1–25 (default 6); does not limit supplied players."],
    ["maxResults", "Legacy fallback for visibleRows; does not limit supplied players."],
    ["scrollPixelsPerSecond", "Results scroll speed, clamped to 5–150 (default 20)."], ["scrollPauseSeconds", "Pause at each end of scrolling (default 2)."],
    ["scale", "CSS overlay scale (default 1)."], ["animate", "False disables binder motion; system reduced-motion preference also disables it."],
    ["countMilliseconds", "Number animation duration, clamped to 0–5000 (default 750)."],
    ["worldRecordSeconds", "WR alert lifetime measured from receivedAt (default 10); 0 keeps it visible. Saved duration in the overlay card overrides this setting."],
    ["cycleSeconds", "Cycle alert lifetime measured from receivedAt (default 10); 0 keeps it visible. Saved duration in the overlay card overrides this setting."],
    ["accent", "Accent CSS colour."], ["teal", "Teal CSS colour."], ["gold", "Gold CSS colour."]],
};

export const allHelpFieldGroups: HelpFieldGroup[] = [commonHelpFields, podiumHelpFields, recordHelpFields,
  cycleHelpFields, structuredHelpFields, placementRowHelpFields, cycleRowHelpFields, cycleLeaderHelpFields,
  overlayDerivedHelpFields, legacyHelpFields, overlayConfigHelpFields];
