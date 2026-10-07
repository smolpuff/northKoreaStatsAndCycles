# Marbles Stats Tool

Lightweight Windows desktop stats tool for Marbles on Stream. Supports the confirmed Race and Battle Royale CSV formats.

The app watches Marbles CSV output, keeps a local recent-race history, sends enabled race events and result data to your own Streamer.bot actions, and can optionally post results to Twitch chat.

## Current Target

Initial watched file:

```text
%LOCALAPPDATA%\MarblesOnStream\Saved\SaveGames\LastSeasonRace.csv
```

The path must be resolved dynamically for the current Windows user.

The watcher accepts only these source pairs in the configured CSV folder:

- Race: `LastSeasonRace.csv` results and the matching `LastSeasonRaceSummary.csv` track metadata. `LastCustomRaceMapPlayed.csv` supplies optional map records, with a track-name fallback when no race summary is available.
- Battle Royale: `LastSeasonRoyale.csv` results and `LastSeasonRoyaleSummary.csv` final summary/map metadata.

Changes to either file queue that mode's results. Battle Royale requires matching `SnapshotId` values, final status, complete placements, and a matching player count before processing. Repeated writes/touches do not count the same game twice. Both modes use the existing Stats/Cycles controls and integrations; `gameType` identifies the mode in Streamer.bot arguments. Battle Royale times are survival times in seconds; CSV kills/damage remain in each placement's raw data. Starting tracking or manually re-reading selects the most recently modified results file. Unrelated CSVs are ignored.

## Stack

- Tauri 2
- TypeScript / HTML / CSS
- Rust backend where needed
- JSON storage only
- Streamer.bot integration
- optional Twitch integration

No Electron. No database. No cloud backend.

## Development

Requirements:

- Windows 10/11 with WebView2
- Node.js 20 or newer
- Rust stable with the MSVC toolchain
- Visual Studio C++ Build Tools and a Windows SDK

Install dependencies:

```bash
npm install
```

Run development mode:

```bash
npm run dev
```

Development mode must provide automatic frontend refresh and the normal Tauri backend rebuild workflow.

Vite refreshes frontend changes automatically and Tauri handles normal Rust rebuilds. Select **Start Watcher** to begin. Race results and `SeasonPointsEarned` are read directly from the CSV; the app has no configurable or calculated points system. Session counters start empty on every launch. The latest-result panel restores the last saved Race or Battle Royale from history for display only, without parsing CSV files, adding counts or points, or triggering integrations. Recent race history is stored in `history.json` and can be erased with **Clear history**.

## Production Build

```bash
npm run build
```

The release build generates a normal Windows application package/executable.

Document the final actual output locations once the Tauri project is initialized.

Typical Tauri outputs are under:

```text
src-tauri/target/release/marbles-stats.exe
src-tauri/target/release/bundle/nsis/
```

## Independent counting

Home shows **Session points**, the sum of every player's CSV points earned in games counted during this app session, and **Season points**, the saved sum since stats were reset. Both include Race and Battle Royale. Session points reset on launch; **Clear Results** resets both point totals. Automatic edits to an already processed snapshot are ignored, including changed points or placements. Manual Reprocess may refresh the results and correct points by their difference; it never counts the same match twice within a stats period. Existing retained result history seeds the season total when upgrading; subsequent totals persist independently of history retention.

Use **Reprocess latest file** on Home, RaceStats, or RaceCycles to process the most recently modified Race or Battle Royale once for both pipelines, even when their watchers are stopped. The button shows progress and read errors. Duplicate protection prevents recounting a game within the current stats period. Clear Results resets the corresponding totals and duplicate fingerprints, so reprocessing can rebuild that pipeline from the current file. Saved history remains and existing result entries are refreshed rather than duplicated.

RaceStats and RaceCycles have independent Start/Stop controls. Stopping one pauses only that page's counting; the other keeps processing races. The shared source-file watcher stops when both are stopped.

Settings provides separate **Start RaceStats automatically** and **Start RaceCycles automatically** options. These preferences apply at the next launch. Saving settings does not stop active counting.

RaceStats owns session/history results, Total Race Count, race-result Twitch posting, and Race complete / World record dispatch. RaceCycles owns placement counts, completed cycles, its Last updated timestamp, and cycle-completion Twitch posting. Each pipeline keeps its own durable duplicate fingerprints. Starting the app or either watcher does not read or process existing CSV files. Only a supported file change or an explicit Reprocess latest file action reads results; duplicate protection still prevents repeated counting.

## Streamer.bot events

The app sends enabled events to your named Streamer.bot actions using the local [HTTP DoAction API](https://docs.streamer.bot/api/http/requests/do-action). The Overlays page provides five editable HTML templates, small sample previews, copyable live file paths, and short OBS setup instructions. The app creates and updates the live files automatically in its writable application-data folder; no extra Streamer.bot code is required. The app does not connect to OBS. See [overlay setup](public/overlays/README.md) for the numbered instructions.

Race complete and World record each have an independent enable switch, editable action name, and test button. GP complete / standings is a disabled coming-soon option. Your connection and existing Race complete / World record action names are preserved when upgrading. The old separate Podium action is replaced by podium arguments on Race complete.

1. Start Streamer.bot's **Servers/Clients ? HTTP Server**, using the host and port already configured in this app (defaults: 127.0.0.1:7474).
2. Create your enabled actions and enter their exact names on the **Streamer.bot** page. No trigger is needed: this app calls them directly.
3. Enable your selected events, save, then run the connection and event tests. Tests send sample data without counting a race.
4. Inspect **Action Queues ? Action History** to see the arguments.
5. Add your own sub-actions for text, scenes, sources, sounds, animations, scripts, or custom HTML.

| Event | Arguments |
| --- | --- |
| Race complete | {firstplace}, {firstplacepoints}, {firstplacetime} (also secondplace/thirdplace), {playerCount}, {timestamp}, {snapshotId}, {hasWorldRecord}, {placements}, {placementsJson} |
| World record | {wrplayer}, {wrplayerpoints}, {wrrecordtime} |
| Both | {eventType}, {gameId}, {gameType}, {mapName}, {seasonName} |

Custom event actions receive arguments directly, independently of standalone overlays. The app passes player names, points, record times, and cycle data to the configured action through HTTP DoAction. In the action, add the normal OBS Studio > Sources > Set GDI Text sub-action, select your OBS connection, scene and existing text source. Open Variables on the event card, write text such as `GG {wrplayer} (+{wrplayerpoints} points)`, and click **Copy for Streamer.bot**. Paste into the sub-action's Text field: the copy button converts brace labels to Streamer.bot's native argument syntax. Test sends sample values; Streamer.bot resolves them and updates the source. Add show/hide, scene or media sub-actions as needed. Arguments exist in that event action run; switching scenes later does not retrigger it. No pasted-code setup or per-field files are required.

Player placeholders contain display names; username is the platform login. Existing firstName/firstPoints/playerName/recordTime arguments remain compatible, and playerPoints is also supplied for record actions. Earned points come directly from this match's CSV, not season totals. Unknown record-player points are null. Each placementsJson item contains place, name, username, platform, points, seasonTotal, time, and eliminated.

Automatic World record dispatch requires a confirmed new-record flag. The current CSV parser does not produce that flag: existing map record-holder data is not proof of a new record in this race. World record tests work for setting up your action; automatic detection remains pending confirmed source data.

Event switches and connection settings persist in JSON. Disabled events do not fire. Integration failures are logged without interrupting stats, exports, or Twitch. No GP event is sent yet.

## Twitch

Twitch login and chat posting are optional. CSV processing and
Streamer.bot continue working when Twitch is disconnected or unavailable.

### Twitch setup

1. The current development setup uses the Twitch application credentials copied
   from CozyStreamer's `.env.local`. There are no Twitch application fields in
   the Marbles Stats UI.
2. In that Twitch application's Developer Console entry, add this exact OAuth
   redirect URL:

   ```text
   http://localhost:8080/api/public/auth/twitch/callback
   ```

3. Open the app's **Twitch** sidebar page and press **Connect Twitch**. The
   Twitch authorization page opens immediately in your normal Windows browser
   using the same start-and-callback flow as CozyStreamer. There is
   no Client ID input, token input, or device code. Approve only
   `user:write:chat`.
4. Return to the app, customize the message intro if desired, and save settings.
   Result posting is enabled by default.
5. Press **Send test message** to confirm that the authenticated account can
   post into its own channel.

Tokens are stored in Windows Credential Manager and never in `config.json`,
`.env.local`, or logs. A result message looks like:

```text
🏁 Race results: 🥇 rmrfkorea +12344pts, 🥈 PlayerTwo +900pts, 🥉 PlayerThree +700pts
```

Messages include every racer whose CSV `SeasonPointsEarned` value is positive.
Long result lists are split into additional messages before Twitch's
500-character limit.

## RaceCycles

The RaceCycles page persistently tracks each racer's finishes in positions
1 through 10. A cycle completes when the racer has at least one finish in every
one of those positions. Cycle count is the minimum of the ten placement counts,
so surplus finishes automatically carry into later cycles. Data is stored in
`race-cycles.json` independently of the recent-race history cache.

When a new cycle completes, the authenticated Twitch account posts:

```text
🎉 Congrats PLAYER on a cycle! You are great! That's cycle #N! 🎉
```

## Project Instructions

Read these before implementation:

- `AGENTS.md`
- `plan.md`

`plan.md` defines the implementation phases and completion criteria.

`AGENTS.md` defines project constraints and coding rules.

## Current parser scope

Race parsing explicitly maps all confirmed columns: snapshot ID, position, username, display name, platform, name color, four season metrics, race time, and elimination state. The parser is currently locked to Race. Battle Royale and Tilt remain intentionally disabled until real samples are inspected.

### Home and connection monitoring

Home provides independent RaceStats and RaceCycles start/stop controls, session and cycle summaries, the latest podium, and the top three cycle leaders. Both summary cards use compact bordered tables and show their own totals above the results. Cycle leaders are ranked by completed cycles, then placements toward the next cycle; equal progress shares a rank. Sidebar dots show each watcher independently.

When any Streamer.bot event is enabled, its connection is checked on startup and every 30 seconds afterward. Disconnected checks continue indefinitely; there is no retry-attempt setting. The sidebar uses Twitch and Streamer.bot text with connected dots that pulse, and separate Stats/Cycles watcher statuses.

Settings includes ?Start minimized to the Windows taskbar.? The preference is saved in config.json and applied by the native window at the next app startup. Stats and Cycles automatic-start options remain independent of minimization. Cycle tracked-race totals come from durable game fingerprints, excluding source-fingerprint aliases.

### Integration test feedback

Twitch and Streamer.bot share the same connection/event-card layout. Each enabled posting/event section has its own test button. Save controls sit outside the integration panels. Disabled sections dim and their controls are disabled immediately; toggles remain available to enable them.

Tests and settings saves show a green checkmark on their own button for three seconds after success. Failures appear beside the relevant button. Unsaved settings survive status refreshes and button-feedback redraws. Twitch race tests post a sample podium using the current message intro; cycle tests use the current cycle message with Test Player and cycle 1. Tests do not count races or cycles.

Cycle messages support `{races}` for the matches that player entered while completing that particular cycle. Duplicate placements can start overlapping cycles; each keeps its own counter across restarts, and completing one clears only that counter. Matches outside the top ten also count. The count appears only where the template includes `{races}`; no extra text is appended. Existing in-progress cycles without recorded starts report an unavailable count until completed. Cycle-message previews and tests use a sample count of 823.

### History and event defaults

History contains equal-height, independently scrolling Processed races and Processed cycle races tables, each with its own small clear button. Every race counted by Cycles is recorded, including races with no cycle completions. Entries include track, winner, winning time, player count, fingerprint, and any cycle completions. Entries are saved atomically with counts and duplicate fingerprints; clearing history preserves those counts. Legacy completion entries are retained and grouped by race. Up to 250 processed cycle races are retained. The app and watcher startup never read existing CSV results; processing waits for a file change or explicit Reprocess latest file action. Access events and metadata-only events do not trigger parsing, and repeated unchanged notifications are ignored. Manual re-read always reads the file.

Streamer.bot defaults to World record enabled and Race complete disabled, and Cycle complete disabled. Existing explicitly saved event choices are retained. Connection checks and event tests sit beside their controls; Save settings is pink and left-aligned, with temporary green success feedback.

Twitch race posts and previews use gold, silver and bronze medal emoji for placements 1-3, and numbered labels from placement 4 onward. Success feedback and connected indicators share the same bright mint color, shifted slightly toward green.

### World Record chat messages

Enable **Post World Records** on the Twitch page. Customize the message using `{wrplayerpoints}` (record holder's earned points in that race), `{wrplayer}` (display name), `{wrrecordtime}` (seconds, three decimal places), and `{mapName}` (track). The live preview and **Test world record** button use sample data. This option works independently of race-result and cycle posting; automatic posts require a new processed result with a confirmed record. Older settings leave this new option disabled.

## Integration help inside the app

**Help & variables** opens an illustrated help dialog from the Overlays, Streamer.bot and Twitch pages. It covers adding Browser Sources, copying `custom.html` to a new standalone page, the complete HTML shell, multiple values in one page, automatic 3-second updates, normal Streamer.bot GDI text sub-actions, Twitch templates, and troubleshooting. The searchable reference lists verified fields with availability and missing-value semantics, including event-specific, row, legacy and configuration fields. Per-overlay/event variable popups and Twitch posting cards link to the corresponding guide.

The guide explicitly distinguishes HTML braces, app Twitch templates and Streamer.bot's native argument syntax. It documents current limits: latest-match data does not retain separate last-Race/last-BR bindings; arbitrary placements are available as HTML array rows but are not direct Streamer.bot scalar arguments; automatic confirmed WR detection is not implemented for the current CSV.
