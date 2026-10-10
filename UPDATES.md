# Desktop updates

The updater follows mos-mission-manager's Windows flow: check a repository-specific version file, offer release notes, download the verified executable, finish processing, replace the executable and restart. A backup is kept until the new dashboard reports ready. Stats, credentials, settings and overlays remain in the existing application data directory.

Settings shows the installed version beside its manual **Check for updates** button, an automatic check switch and last check time. Toggles save immediately. Like mission manager, automatic checks default to enabled and first run after 24 hours open, then daily. A manual check also works with automatic checking disabled. Installation always requires **Download and install** in the existing styled popup. Progress and failures appear in that popup.

## Publish a Windows update

Commit the full app changes on `dev` and add user-facing notes under `Unreleased` in CHANGELOG.md, then run:

```powershell
npm run release
```

Each run promotes the complete committed dev project to main, increments the patch version and synchronizes `version.json`, `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, and `src-tauri/tauri.conf.json`. It moves Unreleased notes into the new changelog section, commits the release, creates `v<version>`, and atomically pushes dev, main and that tag to `smolpuff/northKoreaStatsAndCycles`. The local checkout stays on dev, with both branches synchronized to the release. It requires a clean working tree and refuses a mismatched remote, conflicting versions, an existing tag, or missing commits from remote main/dev. It never force-pushes main, builds or launches the app locally.

Useful variations:

```powershell
npm.cmd --% run release -- --dry-run
npm.cmd --% run release -- --version 0.2.0
npm.cmd --% run release -- --bump minor --notes "A bigger update"
npm.cmd --% run release -- --bump major --notes-file release-notes.txt
npm run release:check
```

The PowerShell examples use `npm.cmd --%` to preserve flags passed through npm. Other shells can use `npm run release -- ...`. `--notes` can be repeated; `--notes-file` uses each non-empty line. Without explicit notes, the command uses bullet points from Unreleased and refuses to publish without notes. `--version 0.2` is normalized to `0.2.0`; exact versions must be newer. Dry-run only reports the planned promotion, bump and push, without writing files, committing, tagging, fetching or pushing.

For local packaged tests, run `npm run build:local`. This is the standard Tauri Windows build and produces the executable and NSIS installer under `src-tauri/target/release/`. It does not change branches/versions, commit, tag or push. `npm run dev` keeps the existing live development workflow; `npm run build` remains supported for GitHub and local builds.

Pushing a `v*` tag starts **Build Desktop Release** on GitHub's Windows runner. The workflow validates every version against the tag, installs dependencies, builds the Windows x64 Tauri app and NSIS installer, and creates the SHA-256 updater manifest. It uploads all downloads to a draft before publishing:

- `Marbles-Stats-<version>-x64-setup.exe`: normal first-install package.
- `marbles-stats.exe`: portable app and the exact executable used by the in-app updater.
- `desktop-update.json`: verified updater metadata for that tagged release.

GitHub release notes include your supplied notes plus GitHub's generated change list. The workflow uses the repository's built-in `GITHUB_TOKEN` with `contents: write`; no separate publishing token is required. This follows the tag-triggered release pattern from Mission Manager and [Tauri's GitHub build guidance](https://v2.tauri.app/distribute/pipelines/github/).

The root version file stays at `https://raw.githubusercontent.com/smolpuff/northKoreaStatsAndCycles/main/version.json`, separate from Mission Manager. A pushed version is offered by the app only after its tagged updater manifest is publicly downloadable. While CI is building, the check reports that the release is not ready rather than offering an unavailable installer.

If the Git push fails, the script keeps the local release commit/tag on dev and prints the exact atomic retry command; do not bump again. If GitHub fails, fix the issue and rerun the workflow for that tag using **Actions → Build Desktop Release → Run workflow**, or rerun the failed job. A draft may be reused. Normal runs reject replacing published binaries; the manual workflow's explicit replace_existing option is reserved for a specifically requested same-version rebuild and retains build/test gates. Prefer a new version so installed apps detect the update. Build files are also retained as workflow artifacts for recovery.

Only Windows x64 is built by this workflow. The updater still understands ARM64 manifests, but an ARM64 release requires adding its separate build and combining the manifest entries before publication.

Downloads are restricted to this repository's tagged GitHub releases, including trusted GitHub asset redirects. Size, SHA-256, PE header and CPU architecture are checked before the running app is stopped. Development builds refuse installation. The executable's folder must be writable; no elevation is requested. Normal per-user NSIS installs and portable release executables can use this flow.

## Recovery and verification

**Test update popup** in Settings previews the styled update dialog with example version/notes. Its pink **Simulate update** button walks through download progress, verification and restart stages without downloading, replacing or restarting anything. During an update the popup hides the notes and shows a compact progress view. **Cancel** (or Escape) aborts the download before installation begins. Cancellation becomes unavailable when installation starts. After publishing a genuinely newer release and its version file, use **Check for updates** for the real install test in a disposable packaged copy.

Transactions live next to the executable in `.marbles-stats.exe.update-<token>`, with `helper.log`, `state`, `RECOVERY.txt` and (until successful startup) `backup.exe`. If startup cannot be confirmed, the backup is retained and the next dashboard reports recovery information in Settings. Close all app/helper copies before restoring a backup or removing a stale `.marbles-stats.exe.update-lock`. No automatic deletion of transaction directories occurs.

Verify using packaged releases in a disposable writable folder: manual up-to-date check, disabled automatic checks, a newer release offer with notes, Later/Escape, download progress, corrupted checksum rejection, replacement/restart and backup removal only after dashboard startup. Also check offline failure and folder permission failure leave the app usable. Do not test replacement against the development executable or the currently active production copy.
