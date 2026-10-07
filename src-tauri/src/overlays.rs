use std::{fs, path::{Path, PathBuf}};
use crate::{models::{AppSnapshot, GameResult}, streamer_bot, storage};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

// Embedded defaults live in writable app data; custom HTML/CSS/config edits are preserved.
const FILES: &[(&str, &str)] = &[
    ("custom.html", include_str!("../../public/overlays/custom.html")),
    ("results.html", include_str!("../../public/overlays/results.html")),
    ("podium.html", include_str!("../../public/overlays/podium.html")),
    ("world-record.html", include_str!("../../public/overlays/world-record.html")),
    ("points.html", include_str!("../../public/overlays/points.html")),
    ("cycle-complete.html", include_str!("../../public/overlays/cycle-complete.html")),
    ("overlay.css", include_str!("../../public/overlays/overlay.css")),
    ("overlay.js", include_str!("../../public/overlays/overlay.js")),
    ("overlay-config.js", include_str!("../../public/overlays/overlay-config.js")),
    ("overlay-data.js", include_str!("../../public/overlays/overlay-data.js")),
    ("world-record-data.js", include_str!("../../public/overlays/world-record-data.js")),
    ("cycle-complete-data.js", include_str!("../../public/overlays/cycle-complete-data.js")),
    ("README.md", include_str!("../../public/overlays/README.md")),
    ("preview.html", include_str!("../../public/overlays/preview.html")),
    ("preview.js", include_str!("../../public/overlays/preview.js")),
    ("preview-data.js", include_str!("../../public/overlays/preview-data.js")),
];

// Install missing defaults and update unmodified defaults; preserve custom edits.
pub fn ensure(directory: &Path) -> Result<(), String> {
    fs::create_dir_all(directory).map_err(|error| error.to_string())?;
    let manifest_path = directory.join("template-defaults.json");
    let previous: std::collections::BTreeMap<String, String> = fs::read(&manifest_path).ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok()).unwrap_or_default();
    // Retire removed defaults, preserving any copies the user customized.
    for name in ["cycles.html", "session.html"] {
        let path = directory.join(name);
        if previous.get(name).is_some_and(|old| {
            fs::read(&path).ok().is_some_and(|bytes| hex::encode(Sha256::digest(&bytes)) == *old)
        }) {
            fs::remove_file(&path).map_err(|error| error.to_string())?;
        }
    }
    let mut defaults = std::collections::BTreeMap::new();
    for (name, content) in FILES {
        let path = directory.join(name);
        let hash = hex::encode(Sha256::digest(content.as_bytes()));
        let unchanged_default = !matches!(*name, "overlay-data.js" | "world-record-data.js" | "cycle-complete-data.js") && previous.get(*name).is_some_and(|old| {
            fs::read(&path).ok().is_some_and(|bytes| hex::encode(Sha256::digest(&bytes)) == *old)
        });
        if !path.exists() || (unchanged_default && previous.get(*name) != Some(&hash)) {
            fs::write(&path, content).map_err(|error| format!("Unable to create {name}: {error}"))?;
        }
        defaults.insert((*name).to_string(), hash);
    }
    let manifest = serde_json::to_vec_pretty(&defaults).map_err(|error| error.to_string())?;
    if fs::read(&manifest_path).ok().as_deref() != Some(manifest.as_slice()) {
        let temporary = directory.join("template-defaults.json.tmp");
        fs::write(&temporary, manifest).map_err(|error| error.to_string())?;
        storage::replace_file(&temporary, &manifest_path).map_err(|error| error.to_string())?;
    }
    Ok(())
}

pub struct Writer {
    pub directory: PathBuf,
    last_packet: String,
    initialized: bool,
    pub last_error: Option<String>,
}
impl Writer {
    pub fn invalidate(&mut self) { self.last_packet.clear(); }
    pub fn new(directory: PathBuf) -> Self {
        Self { directory, last_packet: String::new(), initialized: false, last_error: None }
    }
    fn prepare(&mut self) -> Result<(), String> {
        if !self.initialized { ensure(&self.directory)?; self.initialized = true; }
        Ok(())
    }
    fn write(&mut self, name: &str, data: &Value) -> Result<(), String> {
        self.prepare()?;
        let text = format!("window.MarblesOverlay.update({});", data);
        let destination = self.directory.join(name);
        let temporary = destination.with_extension("js.tmp");
        fs::write(&temporary, text).map_err(|error| error.to_string())?;
        storage::replace_file(&temporary, &destination).map_err(|error| error.to_string())
    }
    pub fn update(&mut self, snapshot: &AppSnapshot) -> Result<(), String> {
        self.prepare()?;
        let data = streamer_bot::overlay_data(snapshot, snapshot.latest_result.as_ref(), &json!({"eventType":"stateUpdate"}), json!([]));
        let packet = data.to_string();
        if packet != self.last_packet || !self.directory.join("overlay-data.js").exists() {
            self.write("overlay-data.js", &data)?;
            self.last_packet = packet;
        }
        Ok(())
    }
    pub fn alerts(&mut self, snapshot: &AppSnapshot, game: &GameResult, completions: Value, new_match: bool) -> Result<(), String> {
        if new_match && game.has_world_record {
            let mut data = streamer_bot::overlay_data(snapshot, Some(game), &streamer_bot::world_record_args(game), completions.clone());
            data["receivedAt"] = json!(chrono::Utc::now().to_rfc3339());
            self.write("world-record-data.js", &data)?;
        }
        if completions.as_array().is_some_and(|items| !items.is_empty()) {
            let mut data = streamer_bot::overlay_data(snapshot, Some(game), &streamer_bot::game_complete_args(game), completions);
            data["receivedAt"] = json!(chrono::Utc::now().to_rfc3339());
            self.write("cycle-complete-data.js", &data)?;
        }
        Ok(())
    }
    pub fn sample(&mut self, kind: &str) -> Result<(), String> {
        let event = match kind { "worldRecord" | "cycleComplete" => kind, _ => "gameComplete" };
        let args = streamer_bot::test_args(event);
        let mut data: Value = serde_json::from_str(args["overlayDataJson"].as_str().ok_or("Missing sample data")?).map_err(|error| error.to_string())?;
        data["receivedAt"] = json!(chrono::Utc::now().to_rfc3339());
        match event {
            "worldRecord" => self.write("world-record-data.js", &data),
            "cycleComplete" => self.write("cycle-complete-data.js", &data),
            _ => self.write("overlay-data.js", &data),
        }
    }
}
