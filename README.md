# Marbles Stats

A lightweight Windows desktop app for tracking Marbles on Stream races and Battle Royales. Built with Tauri 2, Rust, and TypeScript.

## Features

- Live results, podiums, player counts, and session/season points.
- RaceCycles tracking for players collecting finishes in positions 1 through 10.
- Local match history and CSV exports.
- Editable HTML overlays for OBS: results, podium, points, and WR/cycle celebrations.
- Optional Streamer.bot event hooks and customizable Twitch chat messages.

Stats are stored locally in JSON. Twitch and Streamer.bot are optional.

Settings includes the app version, automatic update checks and a manual **Check for updates** button. See [desktop update publishing and recovery](UPDATES.md).

To release, commit your changes on `main`, then run `npm.cmd --% run release -- --notes "What changed"` in PowerShell. It increments the version, commits/tags/pushes it, and GitHub builds the Windows installer, portable EXE and updater manifest. Preview with `npm.cmd --% run release -- --dry-run`. No local app build is performed by the release script.

Settings also offers **Default** (colorful gradients), **Dark** (Windows-style charcoal), and **I hate my retinas mode** (plain light gray). Theme changes apply and save automatically across restarts. Icon colors stay the same.

Content and control icons use native Phosphor Regular SVGs, bundled locally without an icon runtime dependency. Their MIT license is included in `src/assets/Phosphor-LICENSE.txt`. Colored navigation artwork retains its existing design.

## Getting started

1. Run Marbles on Stream and Marbles Stats on the same Windows computer.
2. Start **RaceStats**, **RaceCycles**, or both from the app.
3. Complete a Race or Battle Royale. The app processes supported CSV changes automatically.

The default source folder is resolved for the current Windows user:

```text
%LOCALAPPDATA%\MarblesOnStream\Saved\SaveGames
```

| Match type | Results | Track/map metadata |
| --- | --- | --- |
| Race | `LastSeasonRace.csv` | `LastSeasonRaceSummary.csv` |
| Battle Royale | `LastSeasonRoyale.csv` | `LastSeasonRoyaleSummary.csv` |

`LastCustomRaceMapPlayed.csv` also supplies optional race map/record metadata and a track-name fallback. Unrelated CSV files are ignored.

Starting the app or a watcher does not process existing files. **Reprocess latest file** reads the most recently modified supported results file manually. Duplicate snapshots do not count twice; manual reprocessing can refresh results and correct points.

Session stats reset when the app opens. Season totals and cycle progress persist until their **Clear Results** action is confirmed. Clearing history is a separate action. The dashboard restores the latest saved result on restart without recounting it.

## OBS overlays

Open **Overlays** in the app, copy an overlay's path, and add it as an OBS **Browser Source** with **Local file** enabled. Keep the app running; overlays check for updated data every three seconds.

Results, Podium, and Points remain visible. World record and Cycle completed are temporary celebrations with their own Test buttons. You can edit the live HTML/CSS or copy `custom.html` to create your own overlay.

The app's **Help & variables** guide includes illustrated setup steps, custom HTML examples, and the full variable reference. See [overlay documentation](public/overlays/README.md) for additional details.

## Streamer.bot

Enable Streamer.bot's HTTP Server and enter its host and port in the app. Create actions for the events you want, then enter their exact names:

- **Race complete:** `Marbles - Game Complete`
- **World record:** `Marbles - World Record`
- **Cycle complete:** `Marbles - Cycle Complete`

No Streamer.bot trigger is needed. Marbles Stats calls the configured action and supplies event arguments; your sub-actions control OBS text, scenes, media, sounds, and other behavior.

Open **Variables** on an event card for its fields and examples. **Copy for Streamer.bot** converts the app's brace notation into Streamer.bot's native argument syntax. Standalone HTML overlays work independently of these event hooks.

## Twitch

Connect your account from the **Twitch** page, enable the messages you want, and save. Race results, cycle completions, and world records have separate templates and test controls. Messages are sent to the connected account's own channel.

Race results let you customize the overall message, each placement, the separator, and individual 1st/2nd/3rd wording. Use `{placements}` in the overall message and `{player}`, `{placement}`, `{place}`, `{points}`, or `{time}` in entries. Blank templates keep the defaults. The preview and Test button use these settings; long lists split into messages of up to 500 characters with the overall wording repeated.

Twitch tokens are stored in Windows Credential Manager. Posting failures are logged without stopping stats processing.

Settings also has an optional **Promote Korea's mission App in chat** toggle, interval in minutes (default 60), and Test button. It is on by default; turn it off to disable promotions. The toggle saves immediately; save to apply interval changes. The first automatic post waits a full interval while the app is open and Twitch is connected. Disconnecting or changing the interval restarts the timer, and missed intervals never produce a burst of posts.

**Development OAuth setup:** provide `TWITCH_APP_CLIENT_ID` and `TWITCH_APP_CLIENT_SECRET` in an ignored `.env.local` file. Register this redirect URI for that Twitch application:

```text
http://localhost:8080/api/public/auth/twitch/callback
```

Current sign-in depends on the local OAuth service supplied by the Vite development server. Packaged sign-in is not yet self-contained.

## Development

### Requirements

- Windows 10 or 11 with Microsoft Edge WebView2.
- Node.js 20.19+ on the 20.x branch, or 22.12+.
- Rust stable with the MSVC toolchain.
- Visual Studio C++ Build Tools and a Windows SDK.

```bash
npm install
npm run dev
```

Vite refreshes frontend changes; Tauri rebuilds Rust changes through its normal development workflow.

### Build

```bash
npm run build
```

Build output:

```text
src-tauri/target/release/marbles-stats.exe
src-tauri/target/release/bundle/nsis/
```

### Checks

```bash
npx tsc --noEmit
npm test
```

`npm test` runs the Rust tests. Focused frontend checks are also available in `tests/`, for example `node tests/confirm-dialog.mjs`.

### Test a race and world record

With RaceStats watching, run this from the repository in PowerShell:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Test-WorldRecord.ps1
```

Each run writes five fake players, a new snapshot ID, and a matching custom-map WR. The winner earns 10 points and always matches `RecordHolderName` and `RecordTime`. The WR file arrives one second after the race files to exercise delayed detection. These matches count in stats and can trigger enabled overlays, Streamer.bot actions, and Twitch posts. The script backs up the original three files once in `MarblesStats-WR-Test-Backup` beside the CSVs; avoid running a real game while testing.

Stop the watcher before restoring the original files:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Test-WorldRecord.ps1 -Restore
```

Optional parameters: `-Winner "YourName"`, `-Players 10`, `-RecordDelayMilliseconds 0`, or `-SaveDirectory "C:\path\to\test\folder"`. Restoring files does not remove test matches already counted in app stats.

For a cycle completion, start RaceCycles and run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Test-Cycle.ps1
```

It writes 20 cycle-only snapshots in randomized placement order, waiting for the app to save each update before writing the next. The first twelve updates contain nine distinct positions and three repeats (including second place twice); update 13 supplies the missing position. The remaining seven updates collect seven distinct positions in a new set. From an empty set, this demonstrates completion on update 13 and progress restarting afterward. Use a fresh `-Player "NewTestPlayer"` name to observe that exact sequence without clearing existing stats; an existing player may already have progress. All players earn zero points. It confirms that a new cycle was saved before reporting success. If RaceCycles does not accept a snapshot within 15 seconds, it stops and reports the unprocessed placement. The WR file is untouched. Only the cycle completion overlay, hook, and enabled cycle chat message fire. Marked test snapshots do not update RaceStats totals or dashboard race results, or send race-result messages. Original race files are backed up; stop the watcher and run with `-Restore` to restore them. Optional `-Player "YourName"`, `-SaveDirectory`, `-TimeoutSeconds`, and `-IntervalMilliseconds` parameters are available; the interval is an optional extra pause after each accepted placement. `-StateFile` can select the app state JSON when testing an alternate installation. Test cycle progress already counted remains after restoring files.

### Project layout

| Directory | Purpose |
| --- | --- |
| `src/` | Desktop UI and in-app help |
| `src-tauri/src/` | CSV parsing, watching, persistence, and integrations |
| `src-tauri/tests/fixtures/` | Parser fixtures |
| `public/overlays/` | Bundled HTML templates, scripts, and styles |
| `tests/` | Focused frontend and overlay checks |
| `scripts/` | Manual CSV test helpers |

Runtime stats and editable live overlays are stored in the writable application-data directory, outside the repository. Dependencies, builds, local credentials, and temporary files are excluded by `.gitignore`.

## Current limitations

- WR detection requires changed `LastCustomRaceMapPlayed.csv` metadata matching the latest completed match's map and winner. It uses `RecordHolderName`, `RecordTime`, and `DateSet`; `StreamerRecordHolder` is ignored. Race times must match within 0.001 seconds, and CSV writes must be within two minutes. Blank rows, existing records on startup, and repeated records do not trigger alerts. Late WR writes do not recount the match.
- Race and Battle Royale are supported; Tilt is not implemented.
- Normal HTML overlay data follows the latest match. Separate retained last-Race and last-BR bindings are not available.

The Streamer.bot page also offers a separate Mission app promotion hook (off by default), using the same Settings interval without requiring Twitch. Its default action is `Marbles - Mission Promotion`. Arguments are `promotionMessage`, `downloadUrl`, `intervalMinutes`, `eventType` (`missionPromotion`), and `isTest`. Enabling both routes posts through Twitch and triggers the action independently.
