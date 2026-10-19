//! Private, loopback-only connection for the bundled Stream Deck plugin.
use crate::{log, set_tracking_enabled_inner, storage::Storage, SharedRuntime};
use serde::{Deserialize, Serialize};
use std::{
    net::{TcpListener, TcpStream},
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
    thread,
    time::{Duration, Instant},
};
use tauri::Manager;
use tungstenite::{
    handshake::server::{ErrorResponse, Request, Response},
    Message,
};

#[cfg(not(debug_assertions))]
const INSTALLER: &[u8] =
    include_bytes!("../../public/streamdeck/com.marblesstats.controls.streamDeckPlugin");
#[cfg(not(debug_assertions))]
const DROP_GATE_INSTALLER: &[u8] =
    include_bytes!("../../public/streamdeck/com.mosdropgate.plugin.streamDeckPlugin");

#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PluginInstaller {
    Controls,
    Dropgate,
}

#[derive(Serialize)]
pub struct InstalledPlugin {
    installed: Option<bool>,
    version: Option<String>,
}

#[derive(Serialize)]
pub struct InstalledPlugins {
    controls: InstalledPlugin,
    dropgate: InstalledPlugin,
}

fn installed_plugin(directory: &std::path::Path, uuid: &str) -> InstalledPlugin {
    let unknown = || InstalledPlugin { installed: None, version: None };
    let path = directory.join(format!("{uuid}.sdPlugin")).join("manifest.json");
    let bytes = match std::fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return InstalledPlugin { installed: Some(false), version: None };
        }
        Err(_) => return unknown(),
    };
    let Ok(manifest) = serde_json::from_slice::<serde_json::Value>(&bytes) else {
        return unknown();
    };
    if manifest["UUID"].as_str() != Some(uuid) {
        return unknown();
    }
    InstalledPlugin {
        installed: Some(true),
        version: manifest["Version"].as_str().map(str::to_owned),
    }
}

#[tauri::command]
pub fn get_streamdeck_install_status(window: tauri::WebviewWindow) -> Result<InstalledPlugins, String> {
    if window.label() != "main" {
        return Err("Check installed plugins from the main window".into());
    }
    let app_data = std::env::var_os("APPDATA").ok_or("Windows application data is unavailable")?;
    let directory = std::path::PathBuf::from(app_data).join("Elgato/StreamDeck/Plugins");
    Ok(InstalledPlugins {
        controls: installed_plugin(&directory, "com.marblesstats.controls"),
        dropgate: installed_plugin(&directory, "com.mosdropgate.plugin"),
    })
}

#[derive(Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct TrackerState {
    stats_enabled: bool,
    cycles_enabled: bool,
    watcher_status: String,
}

#[derive(Deserialize)]
#[serde(tag = "type", deny_unknown_fields)]
enum Command {
    #[serde(rename = "authenticate")]
    Authenticate { token: String },
    #[serde(rename = "setTracking")]
    SetTracking {
        id: u32,
        kind: String,
        enabled: bool,
    },
}

fn state(runtime: &SharedRuntime) -> Result<TrackerState, String> {
    let rt = runtime
        .lock()
        .map_err(|_| "Application state unavailable")?;
    Ok(TrackerState {
        stats_enabled: rt.snapshot.stats_tracking_enabled,
        cycles_enabled: rt.snapshot.cycles_tracking_enabled,
        watcher_status: rt.snapshot.watcher_status.clone(),
    })
}

fn allow_plugin(request: &Request, response: Response) -> Result<Response, ErrorResponse> {
    // Browsers send Origin. Only the local Node plugin may connect; no web API.
    if request.uri().path() != "/streamdeck" || request.headers().contains_key("origin") {
        let mut error = ErrorResponse::new(Some("Stream Deck plugin connection required".into()));
        *error.status_mut() = tungstenite::http::StatusCode::FORBIDDEN;
        return Err(error);
    }
    Ok(response)
}

fn serve(
    stream: TcpStream,
    token: &str,
    runtime: &SharedRuntime,
    app: &tauri::AppHandle,
) -> Result<(), String> {
    stream
        .set_read_timeout(Some(Duration::from_secs(3)))
        .map_err(|e| e.to_string())?;
    stream
        .set_write_timeout(Some(Duration::from_secs(2)))
        .map_err(|e| e.to_string())?;
    let config = tungstenite::protocol::WebSocketConfig::default()
        .read_buffer_size(4096)
        .write_buffer_size(0)
        .max_write_buffer_size(16384)
        .max_message_size(Some(4096))
        .max_frame_size(Some(4096));
    let mut socket = tungstenite::accept_hdr_with_config(stream, allow_plugin, Some(config))
        .map_err(|_| "Handshake rejected")?;
    let first = socket.read().map_err(|_| "Authentication required")?;
    if !matches!(first, Message::Text(ref text) if matches!(serde_json::from_str::<Command>(text), Ok(Command::Authenticate { token: supplied }) if supplied == token))
    {
        return Err("Authentication rejected".into());
    }
    socket
        .get_mut()
        .set_read_timeout(Some(Duration::from_millis(250)))
        .map_err(|e| e.to_string())?;
    let mut previous = None;
    let mut heartbeat = Instant::now();
    log(runtime, app, "info", "[Stream Deck] Plugin connected");
    loop {
        let current = state(runtime)?;
        if previous.as_ref() != Some(&current) || heartbeat.elapsed() >= Duration::from_secs(2) {
            socket
                .send(Message::text(
                    serde_json::json!({"type":"state", "state":current}).to_string(),
                ))
                .map_err(|_| "Plugin disconnected")?;
            previous = Some(current);
            heartbeat = Instant::now();
        }
        match socket.read() {
            Ok(Message::Text(text)) => {
                let Ok(Command::SetTracking { id, kind, enabled }) =
                    serde_json::from_str::<Command>(&text)
                else {
                    return Err("Invalid control message".into());
                };
                if kind != "stats" && kind != "cycles" {
                    return Err("Unknown tracker".into());
                }
                let result =
                    set_tracking_enabled_inner(app.clone(), runtime.clone(), kind, enabled);
                if let Err(error) = &result {
                    log(
                        runtime,
                        app,
                        "warning",
                        format!("[Stream Deck] Tracker command failed: {error}"),
                    );
                }
                let response = serde_json::json!({"type":"result", "id":id, "ok":result.is_ok(), "error":result.err(), "state":state(runtime)?});
                socket
                    .send(Message::text(response.to_string()))
                    .map_err(|_| "Plugin disconnected")?;
            }
            Ok(Message::Close(_)) => break,
            Ok(_) => {}
            Err(tungstenite::Error::Io(error))
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                ) => {}
            Err(_) => break,
        }
    }
    Ok(())
}

pub fn start(runtime: &SharedRuntime, app: &tauri::AppHandle) -> Result<(), String> {
    let listener =
        TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0)).map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let token = crate::secure_token::generate()?;
    let storage = Storage::new(app.path().app_data_dir().map_err(|e| e.to_string())?)?;
    storage.write(
        "streamdeck-connection.json",
        &serde_json::json!({"version":1, "port":port, "token":token}),
    )?;
    let runtime = runtime.clone();
    let app = app.clone();
    thread::spawn(move || {
        let clients = Arc::new(AtomicUsize::new(0));
        for stream in listener.incoming() {
            let Ok(stream) = stream else {
                break;
            };
            if clients.load(Ordering::SeqCst) >= 4 {
                continue;
            }
            clients.fetch_add(1, Ordering::SeqCst);
            let (runtime, app, token, clients) =
                (runtime.clone(), app.clone(), token.clone(), clients.clone());
            thread::spawn(move || {
                let _ = serve(stream, &token, &runtime, &app);
                clients.fetch_sub(1, Ordering::SeqCst);
            });
        }
    });
    Ok(())
}

#[tauri::command]
pub fn install_dropgate_plugin(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<(), String> {
    install_streamdeck_plugin(app, window, Some(PluginInstaller::Dropgate))
}

#[tauri::command]
pub fn install_streamdeck_plugin(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    plugin: Option<PluginInstaller>,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Install from the main window".into());
    }
    let storage = Storage::new(
        app.path()
            .app_data_dir()
            .map_err(|e| e.to_string())?
            .join("streamdeck"),
    )?;
    let plugin = plugin.unwrap_or(PluginInstaller::Controls);
    let name = match plugin {
        PluginInstaller::Controls => "com.marblesstats.controls.streamDeckPlugin",
        PluginInstaller::Dropgate => "com.mosdropgate.plugin.streamDeckPlugin",
    };
    // Development packaging changes must not reopen stale embedded bytes.
    #[cfg(debug_assertions)]
    let installer = std::fs::read(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../public/streamdeck")
            .join(name),
    )
    .map_err(|e| format!("Unable to read the plugin installer: {e}"))?;
    #[cfg(debug_assertions)]
    storage.write_bytes(name, &installer)?;
    #[cfg(not(debug_assertions))]
    storage.write_bytes(name, match plugin {
        PluginInstaller::Controls => INSTALLER,
        PluginInstaller::Dropgate => DROP_GATE_INSTALLER,
    })?;
    open_installer(&storage.path(name))
}

#[cfg(windows)]
fn open_installer(path: &std::path::Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL};
    let file: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    let open: Vec<u16> = "open".encode_utf16().chain(Some(0)).collect();
    let result = unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            open.as_ptr(),
            file.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            SW_SHOWNORMAL,
        )
    };
    if result as isize <= 32 {
        return Err("Windows could not open the plugin installer. Install the Elgato Stream Deck desktop app, then try again.".into());
    }
    Ok(())
}

#[cfg(not(windows))]
fn open_installer(_path: &std::path::Path) -> Result<(), String> {
    Err("Stream Deck controls require Windows".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn installed_plugin_distinguishes_missing_valid_and_invalid_manifests() {
        let suffix = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let root = std::env::temp_dir().join(format!("marbles-streamdeck-{}-{suffix}", std::process::id()));
        let uuid = "com.marblesstats.controls";
        let plugin = root.join(format!("{uuid}.sdPlugin"));
        let manifest = plugin.join("manifest.json");
        assert_eq!(installed_plugin(&root, uuid).installed, Some(false));
        std::fs::create_dir_all(&plugin).unwrap();
        std::fs::write(&manifest, r#"{"UUID":"com.marblesstats.controls","Version":"1.0.5.0"}"#).unwrap();
        let status = installed_plugin(&root, uuid);
        assert_eq!(status.installed, Some(true));
        assert_eq!(status.version.as_deref(), Some("1.0.5.0"));
        std::fs::write(&manifest, "partial JSON").unwrap();
        assert_eq!(installed_plugin(&root, uuid).installed, None);
        std::fs::write(&manifest, r#"{"UUID":"different.plugin","Version":"1.0.5.0"}"#).unwrap();
        assert_eq!(installed_plugin(&root, uuid).installed, None);
        std::fs::remove_file(manifest).unwrap();
        std::fs::remove_dir(plugin).unwrap();
        std::fs::remove_dir(root).unwrap();
    }
    #[test]
    fn bridge_rejects_browser_origins_and_wrong_paths() {
        for uri in ["/", "/streamdeck"] {
            let request = Request::builder()
                .uri(uri)
                .header("origin", "https://example.com")
                .body(())
                .unwrap();
            assert!(allow_plugin(&request, Response::new(())).is_err());
        }
        let request = Request::builder().uri("/streamdeck").body(()).unwrap();
        assert!(allow_plugin(&request, Response::new(())).is_ok());
        let request = Request::builder().uri("/other").body(()).unwrap();
        assert!(allow_plugin(&request, Response::new(())).is_err());
    }
    #[test]
    fn bridge_commands_are_explicit_and_strict() {
        assert!(matches!(
            serde_json::from_str::<Command>(
                r#"{"type":"setTracking","id":1,"kind":"stats","enabled":true}"#
            ),
            Ok(Command::SetTracking { enabled: true, .. })
        ));
        assert!(
            serde_json::from_str::<Command>(r#"{"type":"setTracking","id":1,"kind":"stats"}"#)
                .is_err()
        );
        assert!(serde_json::from_str::<Command>(
            r#"{"type":"setTracking","id":1,"kind":"stats","enabled":true,"command":"anything"}"#
        )
        .is_err());
    }
}
