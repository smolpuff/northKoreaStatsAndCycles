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

The window opens at 1000 × 760 and cannot be narrower than 1000 pixels. The sidebar expands and collapses with animation; collapsed navigation and status icons have hover tooltips. Settings toggles save immediately; **Save settings** remains available for other changes.

Content and control icons use native Phosphor Regular SVGs, bundled locally without an icon runtime dependency. Their MIT license is included in `src/assets/Phosphor-LICENSE.txt`. Colored navigation artwork retains its existing design.

## Getting started

1. Run Marbles on Stream and Marbles Stats on the same Windows computer.
2. Start **RaceStats**, **RaceCycles**, or both from the app.
3. Complete a Race or Battle Royale. The app processes supported CSV changes automatically.

Starting the app or a watcher does not process existing files. **Reprocess latest file** reads the most recently modified supported results file manually. Duplicate snapshots do not count twice; manual reprocessing can refresh results and correct points.

Session stats reset when the app opens. Season totals and cycle progress persist until their **Clear Results** action is confirmed. Clearing history is a separate action. The dashboard restores the latest saved result on restart without recounting it.

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

Race results let you customize the overall message, each placement, the separator, and individual 1st/2nd/3rd wording. Use `{placements}` in the overall message and `{player}`, `{placement}`, `{place}`, `{points}`, or `{time}` in entries. Blank templates keep the defaults. The preview and Test button use these settings; long lists split into messages of up to 500 characters with the overall wording repeated.

Twitch tokens are stored in Windows Credential Manager. Posting failures are logged without stopping stats processing.

Settings also has an optional **Promote Korea's mission App in chat** toggle, interval in minutes (default 60), and Test button. It is on by default; turn it off to disable promotions. The toggle saves immediately; save to apply interval changes. The first automatic post waits a full interval while the app is open and Twitch is connected. Disconnecting or changing the interval restarts the timer, and missed intervals never produce a burst of posts.

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

Develop and commit on `dev`. `npm run build:local` creates a local EXE without changing versions or publishing. `npm run release` increments the patch version, promotes the complete committed project to `main`, synchronizes all six version files, commits release notes, and atomically pushes both branches and a new tag. The checkout stays on `dev`; the command never builds or launches locally.

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
