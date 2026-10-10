# AGENTS.md

## Project

Marbles on Stream Stats Tool

Windows-only lightweight Tauri 2 desktop app that watches Marbles on Stream CSV output, parses completed games, tracks stats locally in JSON, updates OBS browser overlays, triggers Streamer.bot actions, and optionally posts results to Twitch chat.

Read `plan.md` before making implementation decisions.

---

## Current Priority

Build the application in the exact three phases described in `plan.md`.

Functionality first.

Do not spend significant time polishing UI until the full end-to-end data flow works.

The first file to support is:

```text
%LOCALAPPDATA%\MarblesOnStream\Saved\SaveGames\LastSeasonRace.csv
```

Resolve `%LOCALAPPDATA%` from the current Windows user at runtime.

Do not hardcode a username.

Treat `LastSeasonRace.csv` as the first and only Marbles parser target until it works reliably end-to-end.

Do not attempt to support the other Marbles CSV files until their formats and purposes are inspected.

---

## Required Stack

Use:

- Tauri 2
- Windows only
- TypeScript / HTML / CSS frontend
- Rust/Tauri backend where native functionality is needed
- JSON persistence only
- WebSocket or SSE for live overlay updates
- Streamer.bot local API for all OBS automation
- optional Twitch OAuth / chat posting

Do not use:

- Electron
- SQLite or any database
- Docker
- cloud services
- StreamElements
- direct OBS WebSocket integration
- unnecessary frontend frameworks
- unnecessary state-management frameworks

Keep the project lightweight.

---

## Development Commands

NEVER, EVER, EVER COMPILE THE APPLICATIOPN AND START IT. I HAVE IT RUNNOGN ION MY OWN.

The repo must support:

```bash
npm install
npm run dev
npm run build
```

`npm run dev` must:

- launch the Tauri app
- start any required frontend dev server
- automatically refresh frontend changes
- use the normal Tauri rebuild flow for Rust/backend changes

`npm run build` must:

- build frontend assets
- build the Tauri release
- produce the Windows executable/package
- include overlay/static assets

Do not invent custom build tooling unless normal Tauri tooling cannot do the job.

---

## Implementation Rules

### Keep the pipeline simple

The core flow must remain:

```text
CSV
→ parser
→ normalized GameResult
→ scoring/stats
→ JSON persistence
→ UI
→ overlays
→ Streamer.bot
→ optional Twitch chat
```

Do not duplicate parser/scoring logic inside integrations.

### No fake CSV schema

Do not invent Marbles CSV headers or fields.

When the real CSV is available:

1. inspect its actual headers
2. inspect several rows
3. determine placement/name/time/record fields
4. implement the parser from confirmed data only

Until then, isolate schema-specific parsing behind a clear parser interface.

### File watching

Use a real filesystem watcher.

Handle:

- repeated file-change events
- partially written files
- temporarily locked files
- duplicate processing
- missing files

Debounce changes and wait for the file to stabilize before parsing.

### Duplicate protection

Each completed game must receive a stable fingerprint.

Do not process the same result twice after:

- duplicate filesystem events
- app restart
- file being touched without a new race

### Persistence

Use JSON only.

Use safe/atomic writes where practical.

Do not store runtime data in packaged read-only resources.

Use a proper writable application-data location.

Do not store Twitch tokens in plain JSON.

### Streamer.bot

The app does not directly control OBS.

Streamer.bot owns ALL OBS behavior.

Expected configurable actions:

```text
Marbles - Game Complete
Marbles - Podium
Marbles - World Record
```

The app only sends normalized game/event data and triggers these actions.

Streamer.bot may update HTML, Browser Sources, text sources, scenes, media, filters, audio, or animations however the user configures it.

Do not implement OBS-specific behavior in the Marbles app.

Podium/results data must be dynamic and data-driven.

Keep the full result as a placements array, while also passing convenient first/second/third arguments.

If Streamer.bot is unavailable:

- continue processing the game
- save stats
- update the UI
- log a warning
- do not crash

### Twitch

Twitch login is optional.

The app must function fully without Twitch.

Only request scopes required for the feature being implemented.

Posting failures must never interrupt stats processing.

---

## UI Requirements

The application is a live stats/monitoring tool, not merely a settings screen.

Main window must show:

- watcher state
- CSV path
- detected game type
- latest processed result
- session stats
- leaderboard
- recent games
- Streamer.bot status
- Twitch status
- overlay server status

Required watcher controls:

```text
Start Watcher
Stop Watcher
```

Required appearance modes:

```text
System
Light
Dark
```

Provide a separate optional Live Log window.

Do not permanently consume dashboard space with logs.

---

## Coding Style

Prefer:

- small modules
- explicit names
- straightforward control flow
- typed data structures
- readable logs
- boring reliable code

Avoid:

- needless generic abstractions
- service locator patterns
- dependency injection frameworks
- excessive trait/interface layers
- speculative plugin architectures
- premature optimization

This is a small local utility.

Treat it like one.

---

## Testing Guidance

Do enough testing to prove the workflow.

Do not create a giant automated test suite before the application works.

Prioritize practical verification:

1. app launches
2. watcher starts/stops
3. file change is detected once
4. CSV is parsed
5. duplicate event is ignored
6. JSON persists
7. UI updates
8. overlays update
9. Streamer.bot action fires
10. Twitch post works when enabled
11. release build runs

Use focused unit tests only where they provide real value, especially:

- CSV parsing
- duplicate fingerprinting
- scoring
- JSON serialization

Do not spend credits/time testing trivial UI glue repeatedly.

---

## Logging

Logs should be useful and concise.

Good:

```text
[Watcher] Watching LastSeasonRace.csv
[Watcher] File changed
[Parser] Parsed 38 players
[Game] New result 8a4f...
[Stats] Updated
[Storage] Saved
[Overlay] Podium updated
[Streamer.bot] Marbles - Podium triggered
[Twitch] Results posted
```

Bad:

- enormous raw object dumps
- repeating the same status every loop
- logging secrets or OAuth tokens

---

## Security

Never log:

- Twitch access tokens
- refresh tokens
- authorization codes
- secrets

Use secure Windows-backed storage for OAuth credentials if required.

Local HTTP services should bind to localhost unless there is a specific reason not to.

---

## Scope Control

Do not add these unless explicitly requested:

- StreamElements
- cloud sync
- multi-user accounts
- auto updater
- remote hosting
- public API
- database migration
- mobile app
- direct OBS control
- complex theming system
- plugin marketplace
- tournament system

Finish the MVP first.

---

## Changelog, commits, and version notes

After every meaningful change, ALWAYS update `CHANGELOG.md` with the resulting behavior, fixes, and relevant validation. Group unreleased changes under `Unreleased`; move them into the actual version section when preparing a release. Do not describe unverified behavior as tested.

Whenever preparing to push or actually pushing, ALWAYS prepare useful Git commit notes: a concise title and a body describing what changed, why, and what was checked. Do not use a generic title as the only description.

For every version update, ALWAYS write user-facing release notes in this app's `version.json` and pass those notes to the release script. Keep the version notes consistent with `CHANGELOG.md`; GitHub publishes them and the updater displays them. Never ship empty notes or carry forward unrelated notes from an older release. Read the existing changelog and changes before drafting notes; do not ask the user to write them.

Keep active development on `beta`; `main` is the release branch. `npm run release` must promote the entire committed beta project to main, synchronize all six version files, move Unreleased changelog notes into the release section, and atomically push beta, main and the new tag. Return/leave the working checkout on beta. Never force-push main or discard either branch's commits.

Use `npm run build:local` for user-run local packaged Windows tests; it must not bump versions or publish. Agents must not compile or launch the application locally unless the user explicitly asks them to run it. `npm run release` builds only on GitHub.

---

## Before Declaring a Phase Complete

Verify the completion criteria in `plan.md`.

Do not claim something works merely because the code compiles.

Run the relevant workflow.

When something cannot be completed because the real Marbles CSV is missing, leave the parser integration point clear and continue with every part that does not depend on the unknown schema.
