# Release security review: 0.1.2

Reviewed on 2026-10-10 by an independent agent, with a follow-up review after the final auth and sign-in instruction changes. No release-blocking credential leak or exploit was found in the reviewed source. Publication is gated on the GitHub build and Twitch tests passing.

## Authentication and credentials

- Dedicated Twitch Public client: `06di08aqgp56hw5nnnzpaki0025rpa`. Client IDs are public identifiers; no client secret is created or bundled.
- Device authorization requests only `user:write:chat`. Connect Twitch opens Twitch's HTTPS activation page with its code filled in; users approve access themselves.
- The activation URL is limited to Twitch's exact host/path and must carry the expected code. HTTP redirects are disabled for auth requests.
- Tokens are validated against the app ID and required scope before use. Sessions from the previous testing app are rejected.
- Access and rotating refresh tokens stay in Windows Credential Manager. Refresh/connect/disconnect writes are serialized. A rotated token pair is securely saved before further validation so a transient network failure does not discard it.
- Only the short user-facing code enters escaped, temporary UI instructions. Device codes and tokens are excluded from UI, logs, overlays and configuration JSON.
- No tracked environment/key/token/credential filenames or secret candidates were found in the reviewed reachable Git history. Local environment files remain ignored and are not needed by the app.

## Updates and release

- Downloads are limited to the configured repository/tag, use HTTPS, and require exact size, SHA-256 and Windows executable architecture checks.
- The updater runs without elevation, validates replacement paths and the parent executable, and retains a recovery backup until the replacement starts successfully.
- GitHub builds the release and runs Twitch Rust tests before uploading/publishing assets. Existing published versions cannot be replaced by this workflow.
- Local CSV test PowerShell scripts are excluded; the production update helper remains included.

## Limits and validation

Updates trust the GitHub repository and account: the manifest has no independent cryptographic signature. The app's main-webview CSP remains unset; no executable injection was found in the reviewed changed paths, which escape text and restrict overlay bindings. Credential-write serialization is process-local, so simultaneously running multiple app copies can interfere with one-time refresh tokens and require reconnecting.

Static TypeScript/JavaScript/Rust syntax checks and focused overlay runtime checks passed. Twitch accepted the dedicated app's device authorization request without user consent being granted. Browser checks confirmed Results scrolling and celebration confetti. GitHub compiled the Windows executable/installer and passed the Twitch Rust tests before publishing v0.1.2. The published portable executable was downloaded without execution and matched the updater manifest's exact size and SHA-256. Live consent/refresh and actual updater installation still require verification; no app was compiled or launched locally.
