# Marbles Stats

A lightweight Windows app for tracking **Marbles on Stream** results, points, and RaceCycles, with live OBS overlays and optional stream integrations.

## Features

- Race and Battle Royale results, leaderboards, and session/season stats.
- RaceCycles progress, completion history, and imports.
- Compact OBS overlays and full-screen World Record/Cycle celebrations.
- Optional Twitch chat, Streamer.bot, Lumia Stream, and Discord integration.
- Local JSON storage, CSV exports, and in-app updates.

## Download

Download **marbles-stats.exe** from the [latest release](https://github.com/smolpuff/northKoreaStatsAndCycles/releases/latest) and run it. Windows only; no separate installer.

## Getting started

1. Run Marbles on Stream and complete a Race or Battle Royale.
2. Open Marbles Stats and start RaceStats, RaceCycles, or both.
3. Add the HTML files from **Overlays** as OBS Browser Sources, using the source sizes shown in the app.
4. Enable any integrations you want. Each integration has a built-in setup guide and test controls.

The app watches Marbles CSV files in:

```text
%LOCALAPPDATA%\MarblesOnStream\Saved\SaveGames
```

Integrations are optional. Stats and overlays work without them. Detailed overlay instructions are in [the overlay guide](public/overlays/README.md); integration setup and message variables are available in the app's **Help & variables**.

## Development

Built with **Tauri 2, Rust, TypeScript, and Vite**. Requires Node.js, Rust, and the Windows build tools for Tauri.

```bash
npm install
npm run dev
```

Create a local Windows executable with `npm run build:local`. Run backend tests with `npm test`.

Development happens on `dev`; `main` is the release branch. `npm run release` handles versioning and promotion. GitHub Actions builds and publishes releases.

## Data and credentials

Stats and settings stay on your computer as JSON files. Integration credentials are stored in Windows Credential Manager. Twitch, Discord, Streamer.bot, and Lumia Stream are configured independently.
