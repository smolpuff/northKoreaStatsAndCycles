# Marbles Stats

A lightweight Windows desktop app for tracking Marbles on Stream races and Battle Royales. Built with Tauri 2, Rust, and TypeScript.

## Features

- Live results, podiums, player counts, and session/season points.
- RaceCycles tracking for players collecting finishes in positions 1 through 10.
- Local match history and CSV exports.
- Editable HTML overlays for OBS: results, podium, points, and WR/cycle celebrations.
- Optional Streamer.bot event hooks and customizable Twitch chat messages.

Stats are stored locally in JSON. Twitch and Streamer.bot are optional.

Settings includes the app version, automatic update checks and a manual **Check for updates** button. Updates verify the download before replacing the executable and restarting.

Download `marbles-stats.exe` from the latest GitHub release and run it. This is the single application download; no installer is needed. The accompanying `desktop-update.json` is metadata used automatically by the app's updater.

Develop and commit the complete project on `dev`. Run `npm run build:local` for a local Windows executable; it does not change versions or publish anything. Run `npm run release` to increment the patch version, promote dev to `main`, synchronize all version files, commit/tag/push both branches and let GitHub build and publish. Release notes come from your local Unreleased changelog or explicit `--notes` / `--notes-file` arguments; a fresh clone needs explicit notes because working documentation is kept out of Git. The checkout stays on dev. Preview with `npm.cmd --% run release -- --dry-run`; choose a specific release with `npm.cmd --% run release -- --version 0.2.0`. The release command never builds or launches locally.

Settings also offers **Default** (colorful gradients), **Dark** (Windows-style charcoal), and **I hate my retinas mode** (plain light gray). Theme changes apply and save automatically across restarts. Icon colors stay the same.

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

**Desktop sign-in:** Marbles Stats and Cycles has its own Twitch Public application ID. Connect Twitch opens Twitch's device approval page in your browser; approve there and return to the app. Sign-in requests only `user:write:chat`, validates the resulting account with Twitch, and saves access and rotating refresh tokens in Windows Credential Manager. Tokens refresh without a client secret; revoked or expired authorization requires connecting again.

No `.env.local`, hosted auth server, callback listener or client secret is required in development or in the packaged app. The registration retains a localhost redirect URL, but device authorization does not use it. Restart the development app after these backend changes before testing sign-in.

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

### Project layout

| Directory | Purpose |
| --- | --- |
| `src/` | Desktop UI and in-app help |
| `src-tauri/src/` | CSV parsing, watching, persistence, and integrations |
| `src-tauri/tests/fixtures/` | Parser fixtures |
| `public/overlays/` | Bundled HTML templates, scripts, and styles |
| `scripts/` | Version release and updater-manifest scripts |

Runtime stats and editable live overlays are stored in the writable application-data directory, outside the repository. Dependencies, builds, local credentials, and temporary files are excluded by `.gitignore`.

## Current limitations

- WR detection requires changed `LastCustomRaceMapPlayed.csv` metadata matching the latest completed match's map and winner. It uses `RecordHolderName`, `RecordTime`, and `DateSet`; `StreamerRecordHolder` is ignored. Race times must match within 0.001 seconds, and CSV writes must be within two minutes. Blank rows, existing records on startup, and repeated records do not trigger alerts. Late WR writes do not recount the match.
- Race and Battle Royale are supported; Tilt is not implemented.
- Normal HTML overlay data follows the latest match. Separate retained last-Race and last-BR bindings are not available.

The Streamer.bot page also offers a separate Mission app promotion hook (off by default), using the same Settings interval without requiring Twitch. Its default action is `Marbles - Mission Promotion`. Arguments are `promotionMessage`, `downloadUrl`, `intervalMinutes`, `eventType` (`missionPromotion`), and `isTest`. Enabling both routes posts through Twitch and triggers the action independently.
