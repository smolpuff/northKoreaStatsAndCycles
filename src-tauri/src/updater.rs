//! Repository-scoped desktop updates. No parser or integration work happens here.
use reqwest::{blocking::Client, redirect::Policy, Url};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs::{self, File, OpenOptions},
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex,
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{Emitter, Manager};

const REPOSITORY: &str = "smolpuff/northKoreaStatsAndCycles";
const VERSION_URL: &str =
    "https://raw.githubusercontent.com/smolpuff/northKoreaStatsAndCycles/main/version.json";
const MAX_DOWNLOAD: u64 = 2 * 1024 * 1024 * 1024;

#[derive(Default)]
pub struct Updater {
    pub state: Mutex<UpdateState>,
}
#[derive(Default)]
pub struct UpdateState {
    pub busy: bool,
    pub offer: Option<UpdateInfo>,
    pub cancel: Option<Arc<AtomicBool>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub current_version: String,
    pub latest_version: String,
    pub update_available: bool,
    pub notes: Vec<String>,
    pub skipped: bool,
}
#[derive(Deserialize)]
struct VersionFile {
    version: String,
    #[serde(default)]
    notes: serde_json::Value,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    schema_version: u32,
    version: String,
    artifacts: HashMap<String, Artifact>,
}
#[derive(Clone, Deserialize)]
struct Artifact {
    url: String,
    size: u64,
    sha256: String,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Transaction {
    target: PathBuf,
    directory: PathBuf,
    token: String,
    version: String,
    owner_pid: u32,
}

fn version_parts(value: &str) -> Result<[u64; 3], String> {
    let parts: Vec<_> = value.split('.').collect();
    if parts.len() != 3
        || parts
            .iter()
            .any(|part| part.is_empty() || !part.bytes().all(|c| c.is_ascii_digit()))
    {
        return Err("Update version must be major.minor.patch".into());
    }
    Ok([
        parts[0].parse().map_err(|_| "Invalid major version")?,
        parts[1].parse().map_err(|_| "Invalid minor version")?,
        parts[2].parse().map_err(|_| "Invalid patch version")?,
    ])
}

fn trusted_url(url: &Url) -> bool {
    url.scheme() == "https"
        && url.port().is_none()
        && url.username().is_empty()
        && url.password().is_none()
        && matches!(
            url.host_str(),
            Some(
                "github.com"
                    | "raw.githubusercontent.com"
                    | "release-assets.githubusercontent.com"
                    | "objects.githubusercontent.com"
            )
        )
}
fn client(timeout: Duration) -> Result<Client, String> {
    Client::builder()
        .timeout(timeout)
        .user_agent("Marbles-Stats-Updater")
        .redirect(Policy::custom(|attempt| {
            if attempt.previous().len() >= 5 || !trusted_url(attempt.url()) {
                attempt.error("Untrusted update redirect")
            } else {
                attempt.follow()
            }
        }))
        .build()
        .map_err(|e| e.to_string())
}
fn read_json<T: DeserializeOwned>(client: &Client, url: &str) -> Result<T, String> {
    let parsed = Url::parse(url).map_err(|e| e.to_string())?;
    if !trusted_url(&parsed) {
        return Err("Untrusted update URL".into());
    }
    let response = client
        .get(parsed)
        .header("Cache-Control", "no-cache")
        .send()
        .and_then(|r| r.error_for_status())
        .map_err(|e| e.to_string())?;
    let mut bytes = Vec::new();
    response
        .take(1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > 1024 * 1024 {
        return Err("Update metadata is too large".into());
    }
    serde_json::from_slice(&bytes).map_err(|e| format!("Invalid update metadata: {e}"))
}
pub fn check(current: String, enabled: bool) -> Result<UpdateInfo, String> {
    if !enabled {
        return Ok(UpdateInfo {
            current_version: current,
            latest_version: String::new(),
            update_available: false,
            notes: vec![],
            skipped: true,
        });
    }
    let metadata: VersionFile = read_json(&client(Duration::from_secs(8))?, VERSION_URL)?;
    let available = version_parts(&metadata.version)? > version_parts(&current)?;
    if available {
        // main/version.json is pushed before CI finishes. Draft downloads are
        // private, so require the tagged manifest before offering installation.
        let manifest = release_manifest(&metadata.version)
            .map_err(|error| format!("Release v{} is not ready to download yet; GitHub may still be building it. {error}", metadata.version))?;
        let arch = if cfg!(target_arch = "aarch64") { "arm64" } else { "x64" };
        let artifact = manifest.artifacts.get(&format!("win32-{arch}"))
            .ok_or("No update available for this architecture")?;
        artifact_url(&artifact.url, &metadata.version)?;
    }
    let notes = match metadata.notes {
        serde_json::Value::Array(values) => values
            .iter()
            .filter_map(|v| v.as_str())
            .map(str::to_owned)
            .collect(),
        serde_json::Value::String(text) => text.lines().map(str::to_owned).collect(),
        _ => vec![],
    };
    Ok(UpdateInfo {
        current_version: current,
        latest_version: metadata.version,
        update_available: available,
        notes,
        skipped: false,
    })
}
fn release_manifest(version: &str) -> Result<Manifest, String> {
    version_parts(version)?;
    let url = format!("https://github.com/{REPOSITORY}/releases/download/v{version}/desktop-update.json");
    let manifest: Manifest = read_json(&client(Duration::from_secs(8))?, &url)?;
    if manifest.schema_version != 1 || manifest.version != version {
        return Err("Update metadata does not match the offered version".into());
    }
    Ok(manifest)
}
fn artifact_url(value: &str, version: &str) -> Result<(), String> {
    version_parts(version)?;
    let url = Url::parse(value).map_err(|e| e.to_string())?;
    let prefix = format!("/{REPOSITORY}/releases/download/v{version}/");
    let name = url.path().strip_prefix(&prefix).unwrap_or("");
    if !trusted_url(&url)
        || url.host_str() != Some("github.com")
        || url.query().is_some()
        || url.fragment().is_some()
        || name.is_empty()
        || name.contains('/')
        || !name.ends_with(".exe")
    {
        return Err("The update must be an EXE from this repository's tagged release".into());
    }
    Ok(())
}
fn status(app: &tauri::AppHandle, phase: &str, percent: u64) {
    let _ = app.emit(
        "app-update-status",
        serde_json::json!({"phase":phase,"percent":percent}),
    );
}
fn ensure_not_cancelled(cancel: &AtomicBool) -> Result<(), String> {
    if cancel.load(Ordering::SeqCst) {
        Err("Update cancelled".into())
    } else {
        Ok(())
    }
}

fn download(
    app: &tauri::AppHandle,
    artifact: &Artifact,
    destination: &Path,
    cancel: &AtomicBool,
) -> Result<(), String> {
    let app = app.clone();
    let artifact = artifact.clone();
    let download_path = destination.to_owned();
    let destination = download_path.clone();
    let (tx, rx) = mpsc::channel();
    let task = tauri::async_runtime::spawn(async move {
        let result = download_async(&app, &artifact, &destination).await;
        let _ = tx.send(result);
    });
    loop {
        if let Err(error) = ensure_not_cancelled(cancel) {
            // Abort drops the HTTP response even if the server stopped sending bytes.
            task.abort();
            let _ = tauri::async_runtime::block_on(task);
            let _ = fs::remove_file(&download_path);
            return Err(error);
        }
        match rx.recv_timeout(Duration::from_millis(100)) {
            Ok(result) => return result,
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                return Err("Update download task stopped".into())
            }
        }
    }
}

async fn download_async(
    app: &tauri::AppHandle,
    artifact: &Artifact,
    destination: &Path,
) -> Result<(), String> {
    if artifact.size == 0
        || artifact.size > MAX_DOWNLOAD
        || artifact.sha256.len() != 64
        || !artifact.sha256.bytes().all(|c| c.is_ascii_hexdigit())
    {
        return Err("Invalid update size or checksum".into());
    }
    let http = reqwest::Client::builder()
        .timeout(Duration::from_secs(600))
        .read_timeout(Duration::from_secs(20))
        .user_agent("Marbles-Stats-Updater")
        .redirect(Policy::custom(|attempt| {
            if attempt.previous().len() >= 5 || !trusted_url(attempt.url()) {
                attempt.error("Untrusted update redirect")
            } else {
                attempt.follow()
            }
        }))
        .build()
        .map_err(|e| e.to_string())?;
    let mut response = http
        .get(&artifact.url)
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| e.to_string())?;
    if response
        .content_length()
        .is_some_and(|size| size != artifact.size)
    {
        return Err("Update download size mismatch".into());
    }
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(destination)
        .map_err(|e| e.to_string())?;
    let mut hash = Sha256::new();
    let mut received = 0u64;
    let mut last_percent = 101;
    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        received += chunk.len() as u64;
        if received > artifact.size {
            return Err("Update exceeds expected size".into());
        }
        hash.update(&chunk);
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        let percent = received * 100 / artifact.size;
        if percent != last_percent {
            status(app, "downloading", percent);
            last_percent = percent;
        }
    }
    file.sync_all().map_err(|e| e.to_string())?;
    status(app, "verifying", 100);
    if received != artifact.size || hex::encode(hash.finalize()) != artifact.sha256.to_lowercase() {
        return Err(
            "Update size or SHA-256 verification failed. The app has not been replaced.".into(),
        );
    }
    validate_exe(destination)
}
fn validate_exe(path: &Path) -> Result<(), String> {
    let mut file = File::open(path).map_err(|e| e.to_string())?;
    let size = file.metadata().map_err(|e| e.to_string())?.len();
    let mut header = [0u8; 64];
    file.read_exact(&mut header).map_err(|e| e.to_string())?;
    let offset = u32::from_le_bytes(header[60..64].try_into().unwrap()) as u64;
    if &header[..2] != b"MZ" || offset < 64 || offset + 24 > size {
        return Err("Invalid Windows update executable".into());
    }
    file.seek(SeekFrom::Start(offset))
        .map_err(|e| e.to_string())?;
    let mut pe = [0u8; 24];
    file.read_exact(&mut pe).map_err(|e| e.to_string())?;
    let expected = if cfg!(target_arch = "aarch64") {
        0xaa64
    } else {
        0x8664
    };
    if &pe[..4] != b"PE\0\0" || u16::from_le_bytes([pe[4], pe[5]]) != expected {
        return Err("Update executable has the wrong architecture".into());
    }
    Ok(())
}

fn canonical_path(path: &Path) -> Result<PathBuf, String> {
    let path = fs::canonicalize(path).map_err(|e| e.to_string())?;
    // Windows canonicalize uses extended paths; PowerShell's process launcher
    // expects ordinary drive/UNC paths, so use the same form in both processes.
    let text = path.to_string_lossy();
    if let Some(unc) = text.strip_prefix(r"\\?\UNC\") {
        return Ok(PathBuf::from(format!(r"\\{unc}")));
    }
    if let Some(local) = text.strip_prefix(r"\\?\") {
        return Ok(PathBuf::from(local));
    }
    Ok(path)
}

pub struct PreparedUpdate {
    record: Transaction,
    helper: Child,
    committed: bool,
}
impl PreparedUpdate {
    pub fn commit(&mut self) -> Result<(), String> {
        // The helper checks the contents before replacing the executable.
        fs::write(self.record.directory.join("commit"), &self.record.token)
            .map_err(|e| e.to_string())?;
        self.committed = true;
        Ok(())
    }
}
impl Drop for PreparedUpdate {
    fn drop(&mut self) {
        if !self.committed {
            let _ = fs::write(self.record.directory.join("cancel"), "");
            let _ = self.helper.kill();
            let _ = self.helper.wait();
            // Keep transaction artifacts for diagnostics; never delete the backup here.
            unlock(&self.record);
        }
    }
}
fn lock_path(record: &Transaction) -> PathBuf {
    record.target.parent().unwrap().join(format!(
        ".{}.update-lock",
        record.target.file_name().unwrap().to_string_lossy()
    ))
}
fn unlock(record: &Transaction) {
    let lock = lock_path(record);
    if fs::read_to_string(lock.join("token")).ok().as_deref() == Some(&record.token) {
        let _ = fs::remove_file(lock.join("token"));
        let _ = fs::remove_dir(lock);
    }
}
pub fn prepare(
    app: &tauri::AppHandle,
    version: &str,
    cancel: &AtomicBool,
) -> Result<PreparedUpdate, String> {
    ensure_not_cancelled(cancel)?;
    if cfg!(debug_assertions) {
        return Err("Run the packaged release app to install updates".into());
    }
    version_parts(version)?;
    let target = canonical_path(&std::env::current_exe().map_err(|e| e.to_string())?)?;
    let data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    if let Some(previous) = read_transaction(&data, &target) {
        if previous.directory.join("backup.exe").exists() {
            return Err(recovery_message(&previous));
        }
    }
    let token = hex::encode(Sha256::digest(
        format!(
            "{}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map_err(|e| e.to_string())?
                .as_nanos(),
            target.display()
        )
        .as_bytes(),
    ))[..32]
        .to_owned();
    let directory = target
        .parent()
        .ok_or("Missing application folder")?
        .join(format!(
            ".{}.update-{token}",
            target
                .file_name()
                .ok_or("Missing executable name")?
                .to_string_lossy()
        ));
    let record = Transaction {
        target,
        directory,
        token,
        version: version.to_owned(),
        owner_pid: std::process::id(),
    };
    let lock = lock_path(&record);
    fs::create_dir(&lock).map_err(|_| "Another update is active, or the app folder is not writable. Close other copies and check folder permissions.".to_string())?;
    if let Err(e) = fs::write(lock.join("token"), &record.token) {
        let _ = fs::remove_dir(&lock);
        return Err(e.to_string());
    }
    let result = (|| {
        fs::create_dir(&record.directory).map_err(|e| e.to_string())?;
        let receipt = serde_json::to_vec(&record).map_err(|e| e.to_string())?;
        fs::write(record.directory.join("transaction.json"), &receipt)
            .map_err(|e| e.to_string())?;
        let pending_receipt = data.join("desktop-update-transaction.json.tmp");
        fs::write(&pending_receipt, &receipt).map_err(|e| e.to_string())?;
        crate::storage::replace_file(
            &pending_receipt,
            &data.join("desktop-update-transaction.json"),
        )
        .map_err(|e| e.to_string())?;
        fs::write(
            record.directory.join("RECOVERY.txt"),
            recovery_message(&record),
        )
        .map_err(|e| e.to_string())?;
        status(app, "downloading", 0);
        let manifest = release_manifest(version)?;
        ensure_not_cancelled(cancel)?;
        let arch = if cfg!(target_arch = "aarch64") {
            "arm64"
        } else {
            "x64"
        };
        let artifact = manifest
            .artifacts
            .get(&format!("win32-{arch}"))
            .ok_or("No update available for this architecture")?;
        artifact_url(&artifact.url, version)?;
        download(
            app,
            artifact,
            &record.directory.join("download.exe"),
            cancel,
        )?;
        ensure_not_cancelled(cancel)?;
        let script = record.directory.join("helper.ps1");
        fs::write(&script, include_str!("windows-update-helper.ps1")).map_err(|e| e.to_string())?;
        let system_root =
            std::env::var_os("SystemRoot").ok_or("Missing Windows system directory")?;
        let mut command = Command::new(
            PathBuf::from(system_root).join("System32/WindowsPowerShell/v1.0/powershell.exe"),
        );
        command
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
            ])
            .arg(&script)
            .arg("-Transaction")
            .arg(&record.directory)
            .arg("-ParentProcessId")
            .arg(record.owner_pid.to_string())
            .current_dir(&record.directory)
            .stdin(Stdio::null());
        let log = File::create(record.directory.join("helper.log")).map_err(|e| e.to_string())?;
        command
            .stdout(log.try_clone().map_err(|e| e.to_string())?)
            .stderr(log);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000); // CREATE_NO_WINDOW
        }
        let mut helper = command.spawn().map_err(|e| e.to_string())?;
        let deadline = Instant::now() + Duration::from_secs(10);
        while !record.directory.join("ready").exists() {
            if let Err(error) = ensure_not_cancelled(cancel) {
                let _ = helper.kill();
                let _ = helper.wait();
                return Err(error);
            }
            if Instant::now() > deadline || helper.try_wait().map_err(|e| e.to_string())?.is_some()
            {
                let _ = helper.kill();
                let _ = helper.wait();
                return Err(
                    "The update helper could not start. See helper.log in the update folder."
                        .into(),
                );
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        Ok(helper)
    })();
    match result {
        Ok(helper) => Ok(PreparedUpdate {
            record,
            helper,
            committed: false,
        }),
        Err(error) => {
            unlock(&record);
            Err(error)
        }
    }
}
fn read_transaction(data: &Path, target: &Path) -> Option<Transaction> {
    let bytes = fs::read(data.join("desktop-update-transaction.json")).ok()?;
    let record: Transaction = serde_json::from_slice(&bytes).ok()?;
    let prefix = format!(".{}.update-", target.file_name()?.to_string_lossy());
    if record.target != target
        || record.directory.parent() != target.parent()
        || !record
            .directory
            .file_name()?
            .to_string_lossy()
            .starts_with(&prefix)
        || record.token.len() != 32
        || !record.token.bytes().all(|c| c.is_ascii_hexdigit())
        || version_parts(&record.version).is_err()
        || canonical_path(&record.directory).ok()? != record.directory
        || fs::read(record.directory.join("transaction.json")).ok()? != bytes
    {
        return None;
    }
    Some(record)
}
fn recovery_message(record: &Transaction) -> String {
    format!("The previous update needs checking. Close all app copies before restoring {} to {}. Keep the backup until the app works. See {}.",
        record.directory.join("backup.exe").display(), record.target.display(), record.directory.join("helper.log").display())
}
pub fn ready(app: &tauri::AppHandle) -> Result<serde_json::Value, String> {
    let version = app.package_info().version.to_string();
    let target = canonical_path(&std::env::current_exe().map_err(|e| e.to_string())?)?;
    let data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let mut recovery = None;
    if let Some(record) = read_transaction(&data, &target) {
        let state = fs::read_to_string(record.directory.join("state")).unwrap_or_default();
        let expected = format!("{} {}", record.token, version);
        let healthy = fs::read_to_string(record.directory.join("healthy"))
            .ok()
            .as_deref()
            == Some(&expected);
        if record.version == version
            && std::env::args().any(|arg| arg == format!("--marbles-update-token={}", record.token))
            && matches!(state.trim(), "opening" | "startup_timeout")
        {
            fs::write(record.directory.join("healthy.next"), &expected)
                .map_err(|e| e.to_string())?;
            crate::storage::replace_file(
                &record.directory.join("healthy.next"),
                &record.directory.join("healthy"),
            )
            .map_err(|e| e.to_string())?;
        } else if state.trim() != "complete" && !healthy {
            recovery = Some(if record.directory.join("backup.exe").exists() {
                recovery_message(&record)
            } else {
                "The previous update did not complete. Your original app was kept; you can retry."
                    .into()
            });
        }
    }
    Ok(serde_json::json!({"currentVersion":version,"recovery":recovery}))
}
