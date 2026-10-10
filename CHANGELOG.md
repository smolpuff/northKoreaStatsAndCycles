# Changelog

## Unreleased

## 0.2.0 - 2026-10-10

- Set both the default and minimum window width to 1000 pixels.
- Move development to the beta branch. The release command promotes the full committed project to main, synchronizes all six version files, commits release notes, tags and atomically pushes both branches for GitHub to build and publish.
- Add npm run build:local for local Windows executable/installer testing without version changes, commits or publishing. Keep npm run dev for the existing live development flow.
- Add an exact-version release option and use the Unreleased changelog as the default release notes. Normal releases increment the patch version; a release can select a minor bump or an explicit version.

Validation: release-script checks used isolated local Git repositories to prove full-source promotion and atomic pushes, synchronized versions/notes/changelog, dry-run, dirty/wrong-branch/existing-tag guards, preservation of independent main commits, and failed-push recovery. The actual npm release command promoted beta to main and tagged 0.2.0. GitHub built the Windows executable/installer and passed Twitch Rust tests before publishing. The downloaded portable update matched the manifest's exact size and SHA-256 and was confirmed as Windows x64. Live updater installation remains a manual check. No application was compiled or launched locally.

## 0.1.2 - 2026-10-10

- Registered a dedicated Twitch Public application, Marbles Stats and Cycles, and replaced development-only auth with Twitch device authorization. No client secret, .env.local, public auth server or callback listener is required. Only chat-posting permission is requested.
- Store access and rotating refresh tokens in Windows Credential Manager, refresh expired access tokens automatically, reject sessions from the previous testing app, and show compact sign-in errors with clear instructions explaining the code supplied by this app. Token use requires Twitch validation against this app's ID and scope; credential writes are serialized.
- Fixed all six overlay previews: hover starts/stops animation and Open preview plays automatically. Added a ready handshake, preserved playing iframes during status/feedback redraws, and made repeated celebrations replay reliably. Explicit samples animate even with Windows reduced motion enabled; live overlays retain that preference.
- Increased default window width to 1000 pixels; minimum width remains 900.
- Excluded local PowerShell CSV test helpers, removed deleted frontend tests and unused source SVG files, and removed their obsolete workflow/README references. The production updater helper remains bundled.
- Added remote Twitch Rust tests as a publication gate, corrected a stale cycle-message test expectation, and recorded an independent credentials/auth/updater review in SECURITY-REVIEW.md.

Validation: TypeScript, JavaScript and Rust syntax checks passed. Focused mocked runtime checks covered all six overlay previews, popup readiness, Race/BR switching, replay, status redraw preservation and feedback reset. Twitch accepted the dedicated Public client ID in a device authorization request; no user authorization was approved. Browser checks also confirmed Results scrolling and celebration confetti. Independent review found no release-blocking credential leak or exploit. GitHub built the Windows executable/installer and passed the Twitch Rust tests before publishing v0.1.2. The downloaded portable executable matched the updater manifest's exact size and SHA-256. Live sign-in and updater installation still require testing. No application was compiled or launched locally.

## 0.1.1 - 2026-10-10

- Added app-specific version checks, verified downloads, cancellation, executable replacement and restart, with a recovery backup and compact animated update progress.
- Added a tag-triggered GitHub Windows build that publishes an installer, portable executable, updater manifest and release notes. The release command requires version notes, includes them in its commit body, synchronizes all six version files and pushes the next version without a local build.
- Added Default, Dark and I hate my retinas mode themes, animated sidebar collapse, consistent dialog animations and updated icons.
- Added fully editable race-result messages, with prefilled one-line fields and a five-place preview. Twitch message accordions now start closed.
- Added the fixed hourly Mission Manager promotion and an optional Streamer.bot promotion event. Promotion is the final separate Settings section; update controls sit with general options.
- Settings toggles save immediately while retaining Save Settings. The smaller update check button, version, check result and last-check time share one row, with the last-check time aligned right. Removed the update test button and corrected white overlay preview backgrounds.
- Centered the expand button in the collapsed sidebar, added immediate button/status hover tooltips and removed the broken dashboard rocket animation. Set the default window to 900 x 760 and the minimum width to 900.
- Improved inline error layouts, overlay templates, cycle displays and promotional artwork.

Validation: TypeScript checks and focused JavaScript checks passed. GitHub release build passed; download verification was not performed; the running app has not been compiled or launched locally.
