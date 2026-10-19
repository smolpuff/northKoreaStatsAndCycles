# Marbles Stats

A lightweight Windows app for tracking **Marbles on Stream** results, points, and RaceCycles, with live OBS overlays and optional stream integrations.

## Features

- Race and Battle Royale results, leaderboards, and session/season stats.
- RaceCycles progress, completion history, and imports.
- Compact OBS overlays and full-screen World Record/Cycle celebrations.
- Optional Twitch chat, Streamer.bot, Lumia Stream, and Discord integration. Discord uses one shared Race / BR results event, plus Cycle complete and World record events. Discord results list only positive point earners, one player per line, with no configurable separator. Discord result headings use `🏁 Race finished | Map name results (38)` (Battle Royale for BR); cycle headings name the player, and cycle messages include their tracked total races at completion (marked at least when incomplete); result lines include points and race-only finish times. The plain footer shows the original match date/time in the computer's local time with its UTC offset.
- Installable Stream Deck plugin with RaceStats and RaceCycles start/stop keys and live status.
- Viewer `!mycycle` command in your Twitch channel for personal RaceCycles stats.
- Local JSON storage, CSV exports, and in-app updates.

## Download

Download **marbles-stats.exe** from the [latest release](https://github.com/smolpuff/northKoreaStatsAndCycles/releases/latest) and run it. Windows only; no separate installer.

## Getting started

1. Run Marbles on Stream and complete a Race or Battle Royale.
2. Open Marbles Stats and start RaceStats, RaceCycles, or both.
3. Add the HTML files from **Overlays** as OBS Browser Sources, using the source sizes shown in the app.
4. Enable any integrations you want. Integration pages provide their relevant connection settings and controls.

The app watches Marbles CSV files in:

```text
%LOCALAPPDATA%\MarblesOnStream\Saved\SaveGames
```

Integrations are optional. Stats and overlays work without them. Detailed overlay instructions are in [the overlay guide](public/overlays/README.md); integration setup and message variables are available in the app's **Help & variables**.

On **Stream Deck**, click **Install Marbles Stats plugin** to open the bundled installer in Elgato Stream Deck (Windows, Stream Deck 7.0+). Confirm installation, then find **Marbles Stats Controls** in Stream Deck and drag **RaceStats Start / Stop** and **RaceCycles Start / Stop** onto physical keys. Keep Marbles Stats open or minimized. Keys use small application sidebar SVG icons, with green running, red stopped, yellow attention and grey disconnected background gradients and borders shared with MoS Drop Gate. A small status tag sits below each icon. They reconnect automatically after the app restarts. The page shows one compact sample per plugin. Existing install buttons check local plugin manifests and switch to Update or Reinstall when appropriate; hover for the installed version. **MoS Drop** is a separate plugin with its own **Install MoS Drop plugin** button. Its matching Twitch key includes a status light. Connect Twitch in the key settings after installation.

For `!mycycle`, enable **Viewer command: !mycycle** under Twitch, then connect Twitch (disconnect/reconnect once if already connected). Keep the app open; viewers can request their saved progress in that account's channel.

## Development

Built with **Tauri 2, Rust, TypeScript, and Vite**. Requires Node.js, Rust, and the Windows build tools for Tauri.

```bash
npm install
npm run dev
```

Create a local Windows executable with `npm run build:local`. Run backend tests with `npm test`.

Stream Deck plugin source lives in [streamdeck](streamdeck/README.md). `npm run streamdeck:pack` validates and regenerates its installer with Elgato's CLI; normal frontend/release builds do this automatically. `npm run streamdeck:check` checks plugin behavior without launching either app.

Development happens on `dev`; `main` is the release branch. `npm run release` handles versioning and promotion. GitHub Actions builds and publishes releases.

## Data and credentials

Stats and settings stay on your computer as JSON files. Integration credentials are stored in Windows Credential Manager. Twitch, Discord, Streamer.bot, and Lumia Stream are configured independently.

Overlay customization includes font size (75-200%). Cycle status defaults to larger text at 680 x 482 and shows next-cycle progress while preserving stacked placements. Mission app promotion is a Twitch chat setting only. Confirmed world-record holders are highlighted in app results and Results/Podium overlays. The Wins column uses Marbles' CSV season-win totals; a dash means that CSV value is unavailable.

The app uses Twitch approval and stores only its own authorized tokens in Windows Credential Manager. It does not import browser or other applications' Twitch credentials. Native commands are restricted to the local main window; overlay previews use bundled scripts under a Content Security Policy. CSV exports treat formula-like names/labels as text. Update downloads are verified against repository metadata and rechecked before launch; releases are not independently publisher-signed. Run `npm run security:check` for source/configuration and mocked plugin security regressions without building or starting the app. Packaged validation remains separate.

Mission App promotion has separate Start delay and Post every settings. Start delay defaults to 30 minutes (set 15 if preferred) and begins when promotion is enabled and Twitch is connected. The watcher controls do not start or reset it. App restarts, Twitch reconnections/account changes, disabling/re-enabling promotion and saved timing changes restart the delay; later posts follow the repeat interval. Test promotion sends immediately.
