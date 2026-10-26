# North Korea Stats & Cycles

[![Build checks](https://github.com/smolpuff/northKoreaStatsAndCycles/actions/workflows/checks.yml/badge.svg?branch=dev)](https://github.com/smolpuff/northKoreaStatsAndCycles/actions/workflows/checks.yml)
[![Latest release](https://img.shields.io/github/v/release/smolpuff/northKoreaStatsAndCycles)](https://github.com/smolpuff/northKoreaStatsAndCycles/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/smolpuff/northKoreaStatsAndCycles/total)](https://github.com/smolpuff/northKoreaStatsAndCycles/releases)
[![Windows](https://img.shields.io/badge/platform-Windows-0078D4)](https://github.com/smolpuff/northKoreaStatsAndCycles/releases/latest)

Track **Marbles on Stream** race stats and cycles automatically from your game results. Ingetration support for Twitch chat functions, streamer.bot, lumina stream, discord hooks, custom overlay support and more. Includes optional Stream Deck plugin for safely dropping in MoS.

## TILT SUPPORT COMING. JUST NEED FREE TIME.

## Features

- **RaceStats** — Race and Battle Royale results, points, and leaderboards.
- **Session tools** — Import and Export at the top right of RaceStats, followed by the Latest Results event picker, with player search in its results header. Cycles Import and Export stay together at the right of its watcher row. RaceStats Import is a disabled placeholder. Cycles supports Marble Cycle session downloads up to 100 MB and always imports BR wins as cycle 1st places.
- **RaceCycles** — track placements 1–10, cycle progress, and completion history.
- **Overlays** — customizable results, podiums, cycle progress, and celebrations.
- **Viewer commands** - optional Twitch `!mycycles` for cycle progress and `!mystats` for session participation/points and saved all-time totals; independent cooldowns per viewer and per command.
- **Integrations** — Twitch chat, Discord, Streamer.bot, and Lumia Stream.
- **Stream Deck** — tracker controls and bundled MoS DropGate v0.4.4.6 with custom icons, colors, and the separate mosCompGate action.

## Download

**[Download the latest Windows release](https://github.com/smolpuff/northKoreaStatsAndCycles/releases/latest)** and run `marbles-stats.exe`.

## Quick start

1. Open the app and start **RaceStats**, **RaceCycles**, or both. or none. lol.
2. Complete a Race or Battle Royale in Marbles on Stream. Results update automatically.
3. Set up overlays and any integrations you want in the app.

The default game-results folder is `%LOCALAPPDATA%\MarblesOnStream\Saved\SaveGames`. Twitch and other integrations are optional.

See the [overlay guide](public/overlays/README.md), [Stream Deck guide](streamdeck/README.md), or in-app help for setup details.

## Development

Built with Tauri 2, Rust, TypeScript, and Vite. Requires Node.js 26.12.1 or newer, Rust, and Windows build tools. `.node-version` and `.nvmrc` pin 26.12.1, including the October 2026 Brotli security fix; both CI workflows use that pin.

```sh
npm install
npm run dev
```

- `npm run build:local` — build a local Windows executable.
- `npm test` — run backend tests.
- `npm run security:check` — check security boundaries without launching the app.

Development uses `dev`; releases use `main`.

Default settings: automatic RaceStats start, automatic RaceCycles start, and Start minimized are off. Automatic update checks and mission app promotional chat messages are on. Promotional messages require Twitch to be connected and wait 30 minutes before the first post, then repeat every 60 minutes. Saved settings retain your choices.

Saved stats remain JSON. Startup loads them in the background while the window shows its loading screen. Unused historical leaderboard copies are omitted; game results, player earnings and current totals remain available. The first successful compacted save keeps the original as `race-state-before-history-compaction.json` in the app data folder.

All JSON settings, records, history, backups and JSON exports use compact formatting and buffered atomic writes. Overlay data and alert files use the same save path; unchanged overlay packets are not rewritten. CSV exports retain spreadsheet escaping and CRLF rows.

Mission app promotion text is editable under Settings > Options; use `{url}` for the Mission App link and check the live preview before saving. Compact timing controls sit above the equal-width editor and preview. Twitch Race/BR result headers include the map name by default.

Use the **smile icon** button beside Twitch message fields to search your own channel's custom Twitch emotes and insert one at the cursor. This also works in mission promotion messages. Uses your existing Twitch login without an additional emote permission; unsaved message drafts are preserved.

Twitch emote pickers are available only for Twitch chat messages, including the optional mission promotion labeled **Promote Korea's Mission App on stream**. Promotion sends Twitch chat only. All Twitch player placeholders automatically use `@username`; existing `@{player}` templates also produce a single mention. Race/BR posts use **Each placement** for every position; older separate podium overrides are ignored. Discord, Lumia, Streamer.bot and overlays retain their own formats.

RaceStats and RaceCycles controls show pending feedback independently. Live Log shows newest entries first with compact timestamps, scanned filenames, Race/BR winners and cycle completions. The window uses a transparent custom title bar with minimize, maximize/restore and close controls. Lumia shows setup guidance and **Configure Lumia** until an API token is saved securely; **Remove API token** appears only after setup. The MoS DropGate preview bundles the real `rmrfkoHeart` emote for offline display.
