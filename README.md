# Marbles Stats

A lightweight Windows desktop app for tracking Marbles on Stream races and Battle Royales. Built with Tauri 2, Rust, and TypeScript.

## Features

- Live results, podiums, player counts, and session/season points.
- RaceCycles tracking for players collecting finishes in positions 1 through 10.
- Local match history and CSV exports.
- Editable HTML overlays for OBS: results, podium, points, and WR/cycle celebrations.
- Optional Streamer.bot event hooks and customizable Twitch chat messages.

Stats are stored locally in JSON. Twitch and Streamer.bot are optional.

Settings shows the installed version, update status and last check time beside **Check for updates**. Automatic checks are enabled by default and run when the app opens, then daily while it stays open. Manual checks work with automatic checks disabled. Choose **Download and install** to download, verify, replace the executable and restart; your stats and settings stay in place.

Download `marbles-stats.exe` from the latest GitHub release and run it. This is the single application download; no installer is needed. Update checks read the repository's `version.json`; verified download metadata lives in `updates/v<version>.json` in the repository, rather than in release downloads.

If you are using 0.2.0 or earlier, download the new EXE once and replace your old copy while the app is closed. Those older builds use the former release-attachment metadata. New builds use the repo metadata for subsequent in-app updates.

Settings also offers **Default** (colorful gradients), **Dark** (Windows-style charcoal), and **I hate my retinas mode** (plain light gray). Theme changes apply and save automatically across restarts. Icon colors stay the same.

The window opens at 1000 × 760 and cannot be narrower than 1000 pixels. The sidebar expands and collapses with animation; navigation and status icons have tooltips only when collapsed, with no tooltips while expanded. Settings toggles save immediately; **Save settings** remains available for other changes.

Content and control icons use native Phosphor Regular SVGs, bundled locally without an icon runtime dependency. Their MIT license is included in `src/assets/Phosphor-LICENSE.txt`. Colored navigation artwork retains its existing design.

## Getting started

1. Run Marbles on Stream and Marbles Stats on the same Windows computer.
2. Start **RaceStats**, **RaceCycles**, or both from the app.
3. Complete a Race or Battle Royale. The app processes supported CSV changes automatically.

Starting the app or a watcher does not process existing files. **Reprocess latest file** reads the most recently modified supported results file manually. Duplicate snapshots do not count twice; manual reprocessing can refresh results and correct points.

Cycles counts **Race only**. Every placement from 1st through 10th adds one point to that position's accumulated count. Completed cycles are the minimum of those ten counts: three 1sts and one each of 2nd-10th means one completed cycle, with the two extra 1sts still filled for future cycles. Counts never reset on completion.

RaceStats keeps every processed Race/BR's full standings in local `history.json`. Cycles independently saves point-earning races, complete results, cycle standings and per-player placement/point/achievement details in `race-state.json`; races without a top-ten point do not create Cycles history entries. Neither history has a 250-entry cutoff. Click a player in either table to open that feature's separate history dialog. Cycles highlights completed cycles; RaceStats highlights world records. RaceStats includes matching player search, participant count and a **Latest / previous results** selector labelled by date/time and track.

Cycles player history shows summary cards for saved points, cycles earned and placements 1-10 above the per-track results. Existing older Cycles records display matching saved race standings when available; fields that were never saved remain unavailable, without migrating data. New Cycles entries contain their own complete standings and do not depend on RaceStats history. RaceStats player history shows Race and BR results separately, with Kills/Damage only for BR.

Both histories show the player name once in the large dialog heading with the player icon beside it, followed by compact stats cards and smaller tables. RaceStats cards show saved 1st/2nd/3rd counts, total points from retained history, and event points from counted results since the last **Clear Results**; event membership survives restart and is independent of session counters. RaceStats keeps **Export session** beside search and Clear Results. Both it and Cycles **Export** offer **JSON** or **CSV**, followed by Save As. Cycles CSV includes ranked players, cycles, participation, points, progress and counts for places 1?10; session CSV includes one participant per game row with available result details and BR-only kills/damage. Its result-info strip stays side by side with natural widths and the last item filling the remaining space.

RaceStats player cards also show Race and BR participation separately. Only the main RaceStats Race/BR results table shows **Wins** from the saved CSV `SeasonWinsTotal`; missing totals show a dash, and the RaceStats Wins column is sortable. All three themes retain gold, silver and bronze podium row backgrounds. Cycles cards show saved Race participation, including finishes outside the top ten, and the main Cycles table has a sortable **Races** column. **Race #** above that table is the current Cycles race counter. New data stores complete participation counts; older records without full rosters show a minimum known count (`≥`) instead of an invented total.

### Import Marble Cycle history

On **Cycles**, click **Import from MarblesCycles** beside Reprocess and paste a complete `https://marblecycle.com/session/<session ID>` URL. **Import** is ghosted until the URL is valid, then turns pink. Click it once to retrieve every source table and merge into the current named Cycles results only. The progress bar shows retrieval and processed-result counts, then a checkmark and **Import complete** with **Close**. It creates no season and runs no migration.

**Count BR wins as Cycles 1st places** is unchecked by default. MarbleCycles includes BR results in its Cycles totals; this option counts only BR wins as 1st places in our existing Cycles system. Other BR placements remain excluded, and BR participation never increases Race counts. Enabling the option on a repeat import can backfill previously excluded BR wins once; disabling it does not remove placements already earned. DNFs remain in complete race history and participation totals but earn no Cycles placement.

Imports keep original race IDs, sequence numbers, names, placements, earned points, eliminations and available winner times. The public session format does not expose original dates, tracks, individual finish times or WR status. Missing dates/tracks stay unavailable; no import-date substitution is made. Source race sequence determines order for these undated results, before existing dated results; exact chronological interleaving cannot be recovered without the missing original timestamps.

Import reuses the existing Race-only cumulative Cycles scoring. It replays known current-cycle races around the backfill and retains placements that lack complete saved race data as a baseline. Source results are retained inside point-earning Cycles history entries; no RaceStats results, points, counts or history are created. The BR-win option stores corresponding winner earnings in that same Cycles history. Existing displayed current results and season names are preserved. Stable race IDs prevent repeated awards within current Cycles. Archive membership does not block refilling current results after a clear. Different race IDs remain distinct even when their complete results match. Re-importing repairs previously omitted races and incorrect imported DNF flags, and removes RaceStats records created by older importer versions while preserving normally recorded dated races. The importer verifies every source ID, participant count and placement before saving. Last updated reflects the import operation; original race dates remain unavailable. A timestamped local backup includes state and both histories before merging. Historical imports refresh standings/overlays without replaying old chat posts or Streamer.bot celebration actions.

Both **Clear Results** dialogs offer a backup before clearing. Checking backup opens **Save As** so you choose the JSON location before anything is cleared. Cancelling Save As cancels clearing; a failed backup leaves results intact. Import additionally creates an automatic timestamped JSON backup in the writable app-data `backups` folder. Clear Results deletes that page?s current results, history and cached/processed result IDs. The other page remains independent. No data migrations run.

Session stats reset when the app opens. Season totals and cycle progress persist until their **Clear Results** action is confirmed. Clear Results also empties the corresponding history and cache; standalone history clearing controls remain available. The dashboard restores the latest saved result on restart without recounting it.

## OBS overlays

Open **Overlays** in the app, copy an overlay's path, and add it as an OBS **Browser Source** with **Local file** enabled. Keep the app running; overlays check for updated data every three seconds.

Results, Podium, and Points remain visible. World record and Cycle completed are temporary celebrations with their own Test buttons. You can edit the live HTML/CSS or copy `custom.html` to create your own overlay.

Hover over an overlay thumbnail to play its sample animation. **Open preview** plays an animated sample without requiring a real match or sending chat messages.

The app's **Help & variables** guide includes illustrated setup steps, custom HTML examples, and the full variable reference. See [overlay documentation](public/overlays/README.md) for additional details.

## Streamer.bot

Enable Streamer.bot's HTTP Server and enter its host and port in the app. Create actions for the events you want, then enter their exact names:

- **Race complete:** `Marbles - Game Complete`
- **World record:** `Marbles - World Record`
- **Cycle complete:** `Marbles - Cycle Complete`

No Streamer.bot trigger is needed. Marbles Stats calls the configured action and supplies event arguments; your sub-actions control OBS text, scenes, media, sounds, and other behavior.

Open **Variables** on an event card for its fields and examples. **Copy for Streamer.bot** converts the app's brace notation into Streamer.bot's native argument syntax. Standalone HTML overlays work independently of these event hooks.

## Twitch

Connect your account from the **Twitch** page and enable the messages you want. Toggles save immediately; save template edits with **Save settings**. Race results, cycle completions, and world records have separate templates and test controls. Messages are sent to the connected account's own channel.

The app validates the saved Twitch login on startup, every 30 minutes while open, and before posting. Access tokens nearing expiry are refreshed automatically and rotated credentials remain in Windows Credential Manager. Temporary network/service failures keep the saved login and show **Unavailable**, rather than incorrectly reporting **Expired**. Twitch can still invalidate authorization, and Public-client refresh tokens expire after 30 days; a rejected refresh requires reconnecting. Sign-in is not permanent. See [Twitch's refresh-token documentation](https://dev.twitch.tv/docs/authentication/refresh-tokens/).

Race results let you customize the overall message, each placement, the separator, and individual 1st/2nd/3rd wording. Use `{placements}` in the overall message and `{player}`, `{placement}`, `{place}`, `{points}`, or `{time}` in entries. Blank templates keep the defaults. The preview and Test button use these settings; long lists split into messages of up to 500 characters with the overall wording repeated.

Twitch tokens are stored in Windows Credential Manager. Posting failures are logged without stopping stats processing.

Settings also has an optional **Promote Korea's mission App in chat** toggle, interval in minutes (default 60), and Test button. It is off by default for new settings and older settings without this field; saved explicit choices are preserved. The toggle saves immediately; save to apply interval changes. The first automatic post waits a full interval while the app is open and Twitch is connected. Disconnecting or changing the interval restarts the timer, and missed intervals never produce a burst of posts.

**Desktop sign-in:** Marbles Stats and Cycles has its own Twitch Public application ID. Connect Twitch opens Twitch's device approval page in your browser; approve there and return to the app. Sign-in requests only `user:write:chat`, validates the resulting account with Twitch, and saves access and rotating refresh tokens in Windows Credential Manager. Tokens refresh without a client secret; revoked or expired authorization requires connecting again.

No `.env.local`, hosted auth server, callback listener or client secret is required in development or in the packaged app. The sign-in instructions explain the app-provided code; approve the request on Twitch's page. The registration retains a localhost redirect URL, but device authorization does not use it.

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
npm run build:local
```

Build output:

```text
src-tauri/target/release/marbles-stats.exe
```

### Checks

```bash
npx tsc --noEmit
npm test
```

`npm test` runs the Rust tests.

### Release

Develop and commit code on `dev`; it never publishes packages. `npm run build:local` creates a local EXE without changing versions or publishing. When a release is requested, `npm run release` first promotes the complete committed project to `main`, then creates the version commit and release tag on `main`, synchronizes all six version files, and atomically pushes both branches and the tag. It returns the checkout to `dev`; the command never builds or launches locally. GitHub rejects release tags outside `main`, and manual releases must select `main`.

```powershell
npm run release:check
npm.cmd --% run release -- --dry-run
npm run release
```

For a minor release use `npm.cmd --% run release -- --bump minor`; for an exact version use `npm.cmd --% run release -- --version <new-version>`. PowerShell requires `npm.cmd --%` for argument forwarding. Other shells can use `npm run release -- ...`.

Notes come from the local Unreleased changelog or repeated `--notes` / `--notes-file` arguments. A fresh clone needs explicit notes because working documentation stays out of Git. The script requires clean committed source, consistent versions and preservation of remote `dev`/`main` commits; it refuses existing tags and never force-pushes main.

GitHub builds Windows x64 and runs Twitch tests before publishing `marbles-stats.exe`. After the EXE is public, it commits the version-specific URL, byte size and SHA-256 to `updates/` on `main` and merges that metadata into `dev`. Checks wait for that metadata before offering an update. GitHub's automatic source archives are separate from the application download.

If pushing fails, retry the exact command printed by the release script instead of bumping again. If the GitHub build fails, fix it and rerun the failed job. Prefer a new version to replacing published binaries so installed apps can detect the update.

### Project layout

| Directory | Purpose |
| --- | --- |
| `src/` | Desktop UI and in-app help |
| `src-tauri/src/` | CSV parsing, watching, persistence, and integrations |
| `src-tauri/tests/fixtures/` | Parser fixtures |
| `public/overlays/` | Bundled HTML templates, scripts, and styles |
| `scripts/` | Version release and updater-manifest scripts |
| `updates/` | Verified download metadata for published versions |

Runtime stats and editable live overlays are stored in the writable application-data directory, outside the repository. Dependencies, builds, local credentials, and temporary files are excluded by `.gitignore`.

## Current limitations


- WR detection requires changed `LastCustomRaceMapPlayed.csv` metadata matching the latest completed match's map and winner. It uses `RecordHolderName`, `RecordTime`, and `DateSet`; `StreamerRecordHolder` is ignored. Race times must match within 0.001 seconds, and CSV writes must be within two minutes. Blank rows, existing records on startup, and repeated records do not trigger alerts. Late WR writes do not recount the match.
- Race and Battle Royale are supported; Tilt is not implemented.
- Normal HTML overlay data follows the latest match. Separate retained last-Race and last-BR bindings are not available.

The Streamer.bot page also offers a separate Mission app promotion hook (off by default), using the same Settings interval without requiring Twitch. Its default action is `Marbles - Mission Promotion`. Arguments are `promotionMessage`, `downloadUrl`, `intervalMinutes`, `eventType` (`missionPromotion`), and `isTest`. Enabling both routes posts through Twitch and triggers the action independently.

Historical race/state JSON uses compact encoding with the same data and atomic replacement. Complete historical standings remain on disk; UI snapshots omit unused standings and repeated race payloads. Watcher start/stop and initial snapshot preparation run off the window thread.

Reprocess on RaceStats reads the newest Race/BR file and updates RaceStats only. Reprocess on Cycles reads the configured Race CSV and updates Cycles only. These manual actions work with the selected watcher stopped and retain duplicate protection. The dashboard has no Reprocess button.
