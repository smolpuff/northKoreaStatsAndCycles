use std::{fs, path::{Path, PathBuf}};
use crate::{models::{AppSnapshot, GameResult}, streamer_bot, storage};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

// Embedded defaults live in writable app data; custom HTML/CSS/config edits are preserved.
const FILES: &[(&str, &str)] = &[
    ("custom.html", include_str!("../../public/overlays/custom.html")),
    ("cycle-status.html", include_str!("../../public/overlays/cycle-status.html")),
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
            storage::Storage::new(directory.to_path_buf())?.write_bytes(name, content.as_bytes())?;
        }
        defaults.insert((*name).to_string(), hash);
    }
    if previous != defaults || !manifest_path.exists() {
        storage::Storage::new(directory.to_path_buf())?.write("template-defaults.json", &defaults)?;
    }
    Ok(())
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct Durations {
    pub world_record_seconds: u32,
    pub cycle_seconds: u32,
}
impl Default for Durations {
    fn default() -> Self { Self { world_record_seconds: 10, cycle_seconds: 10 } }
}
pub fn durations(directory: &Path) -> Result<Durations, String> {
    let path = directory.join("overlay-durations.json");
    match fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|error| error.to_string()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Durations::default()),
        Err(error) => Err(error.to_string()),
    }
}
fn duration_prefix(directory: &Path) -> Result<String, String> {
    let value = if directory.join("overlay-durations.json").exists() {
        serde_json::to_value(durations(directory)?).map_err(|error| error.to_string())?
    } else { Value::Null };
    Ok(format!("window.MarblesOverlayDurations = {};\n", value))
}
pub fn save_duration(directory: &Path, kind: &str, seconds: u32) -> Result<Durations, String> {
    if !(1..=300).contains(&seconds) { return Err("Choose a duration from 1 to 300 seconds".into()); }
    let mut settings = durations(directory)?;
    match kind {
        "world-record" => settings.world_record_seconds = seconds,
        "cycle-complete" => settings.cycle_seconds = seconds,
        _ => return Err("Unknown celebration overlay".into()),
    }
    storage::Storage::new(directory.to_path_buf())?.write("overlay-durations.json", &settings)?;
    let prefix = options_prefix(directory)?;
    for name in ["overlay-data.js", "world-record-data.js", "cycle-complete-data.js"] {
        let path = directory.join(name);
        let text = fs::read_to_string(&path).map_err(|error| error.to_string())?;
        if let Some(start) = text.find("window.MarblesOverlay.update(") {
            write_overlay_parts(directory, name, &prefix, &text[start..])?;
        }
    }
    Ok(settings)
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OverlayOptions {
    #[serde(default = "default_font_scale")]
    pub font_scale: u32,
    pub width: u32,
    pub height: u32,
    pub opacity: u32,
    pub background: String,
    pub text: String,
    pub secondary: String,
    pub accent: String,
    pub gold: String,
    pub teal: String,
    #[serde(default = "default_border_start")]
    pub border_start: String,
    #[serde(default = "default_border_end")]
    pub border_end: String,
    pub header_visible: bool,
    pub header_text: String,
    pub duration_seconds: u32,
    pub visible_rows: u32,
    pub scroll_pixels_per_second: u32,
}
fn default_font_scale() -> u32 { 100 }
fn default_border_start() -> String { "#493064".into() }
fn default_border_end() -> String { "#28395d".into() }
pub type Customizations = std::collections::BTreeMap<String, OverlayOptions>;
fn known_overlay(kind: &str) -> bool {
    matches!(kind, "results" | "cycle-status" | "podium" | "points" | "world-record" | "cycle-complete")
}
pub fn customizations(directory: &Path) -> Result<Customizations, String> {
    match fs::read(directory.join("overlay-customizations.json")) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|error| error.to_string()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Customizations::new()),
        Err(error) => Err(error.to_string()),
    }
}
fn options_prefix(directory: &Path) -> Result<String, String> {
    let settings = serde_json::to_string(&customizations(directory)?).map_err(|error| error.to_string())?;
    Ok(format!("{}window.MarblesOverlayOptions = {};\n", duration_prefix(directory)?, settings))
}
fn refresh_customizations(directory: &Path) -> Result<(), String> {
    let prefix = options_prefix(directory)?;
    for name in ["overlay-data.js", "world-record-data.js", "cycle-complete-data.js"] {
        let path = directory.join(name);
        let text = fs::read_to_string(&path).map_err(|error| error.to_string())?;
        if let Some(start) = text.find("window.MarblesOverlay.update(") {
            write_overlay_parts(directory, name, &prefix, &text[start..])?;
        }
    }
    Ok(())
}
pub fn save_options(directory: &Path, kind: &str, mut options: OverlayOptions) -> Result<OverlayOptions, String> {
    if !known_overlay(kind) { return Err("Unknown overlay".into()); }
    let minimum_height = if matches!(kind, "world-record" | "cycle-complete") { 180 } else { 100 };
    if !(280..=3840).contains(&options.width) || (!matches!(kind, "results" | "cycle-status") && !(minimum_height..=2160).contains(&options.height)) || options.opacity > 100 {
        return Err("Check the width, height and opacity limits".into());
    }
    if !(75..=200).contains(&options.font_scale) { return Err("Choose a font size from 75% to 200%".into()); }
    if options.header_text.chars().count() > 100 || !(1..=25).contains(&options.visible_rows) || !(5..=100).contains(&options.scroll_pixels_per_second) {
        return Err("Check the header text, visible players and scroll speed".into());
    }
    if matches!(kind, "world-record" | "cycle-complete") && !(1..=300).contains(&options.duration_seconds) {
        return Err("Choose a duration from 1 to 300 seconds".into());
    }
    for color in [&options.background, &options.text, &options.secondary, &options.accent, &options.gold, &options.teal, &options.border_start, &options.border_end] {
        if color.len() != 7 || !color.starts_with('#') || !color.as_bytes()[1..].iter().all(|byte| byte.is_ascii_hexdigit()) {
            return Err("Colors must use #RRGGBB".into());
        }
    }
    if matches!(kind, "results" | "cycle-status") {
        let header_height = if options.header_visible { 90 } else { 50 };
        let row_height = (26 * options.font_scale).div_ceil(100);
        options.height = options.visible_rows * row_height + (header_height * options.font_scale).div_ceil(100);
    }
    let mut settings = customizations(directory)?;
    settings.insert(kind.to_string(), options.clone());
    storage::Storage::new(directory.to_path_buf())?.write("overlay-customizations.json", &settings)?;
    refresh_customizations(directory)?;
    Ok(options)
}
pub fn reset_options(directory: &Path, kind: &str) -> Result<(), String> {
    if !known_overlay(kind) { return Err("Unknown overlay".into()); }
    let mut settings = customizations(directory)?;
    settings.remove(kind);
    storage::Storage::new(directory.to_path_buf())?.write("overlay-customizations.json", &settings)?;
    // Remove any old per-alert duration override when restoring its defaults.
    if directory.join("overlay-durations.json").exists() && matches!(kind, "world-record" | "cycle-complete") {
        save_duration(directory, kind, 10)?;
    }
    refresh_customizations(directory)
}

fn write_overlay_parts(directory: &Path, name: &str, prefix: &str, body: &str) -> Result<(), String> {
    storage::Storage::new(directory.to_path_buf())?.write_with(name, |writer| {
        writer.write_all(prefix.as_bytes()).and_then(|_| writer.write_all(body.as_bytes()))
            .map_err(|error| error.to_string())
    })
}

pub struct Writer {
    pub directory: PathBuf,
    last_packet: Option<Value>,
    initialized: bool,
    pub last_error: Option<String>,
}
impl Writer {
    pub fn invalidate(&mut self) { self.last_packet = None; }
    pub fn new(directory: PathBuf) -> Self {
        Self { directory, last_packet: None, initialized: false, last_error: None }
    }
    fn prepare(&mut self) -> Result<(), String> {
        if !self.initialized { ensure(&self.directory)?; self.initialized = true; }
        Ok(())
    }
    fn write(&mut self, name: &str, data: &Value) -> Result<(), String> {
        self.prepare()?;
        let prefix = options_prefix(&self.directory)?;
        storage::Storage::new(self.directory.clone())?.write_with(name, |writer| {
            writer.write_all(prefix.as_bytes()).and_then(|_| writer.write_all(b"window.MarblesOverlay.update("))
                .map_err(|error| error.to_string())?;
            serde_json::to_writer(&mut *writer, data).map_err(|error| error.to_string())?;
            writer.write_all(b");").map_err(|error| error.to_string())
        })
    }
    pub fn update(&mut self, snapshot: &AppSnapshot) -> Result<(), String> {
        self.prepare()?;
        let data = streamer_bot::overlay_data(snapshot, snapshot.latest_result.as_ref(), &json!({"eventType":"stateUpdate"}), json!([]));
        self.update_packet(data)
    }
    fn update_packet(&mut self, data: Value) -> Result<(), String> {
        if self.last_packet.as_ref() != Some(&data) || !self.directory.join("overlay-data.js").exists() {
            self.write("overlay-data.js", &data)?;
            self.last_packet = Some(data);
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn overlay_packets_stream_once_skip_unchanged_and_refresh_after_invalidation() {
        let directory = std::env::temp_dir().join(format!("marbles-overlay-storage-{}-{}",
            std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        let mut writer = Writer::new(directory.clone());
        let packet = json!({"players": [{"name":"Player", "kills":0, "damage":89}], "points":42});
        writer.update_packet(packet.clone()).unwrap();
        let destination = directory.join("overlay-data.js");
        let first = fs::read_to_string(&destination).unwrap();
        let body = first.split_once("window.MarblesOverlay.update(").unwrap().1.strip_suffix(");").unwrap();
        assert_eq!(serde_json::from_str::<Value>(body).unwrap(), packet);
        assert!(first.contains("window.MarblesOverlayOptions ="));
        fs::write(&destination, "unchanged packet must not rewrite this marker").unwrap();
        writer.update_packet(packet.clone()).unwrap();
        assert_eq!(fs::read_to_string(&destination).unwrap(), "unchanged packet must not rewrite this marker");
        writer.invalidate();
        writer.update_packet(packet.clone()).unwrap();
        assert_eq!(fs::read_to_string(&destination).unwrap(), first);
        fs::remove_file(&destination).unwrap();
        writer.update_packet(packet).unwrap();
        assert_eq!(fs::read_to_string(&destination).unwrap(), first);
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn saved_overlay_options_accept_legacy_fonts_and_round_trip_font_size() {
        let legacy = json!({"width":440,"height":350,"opacity":80,"background":"#071324",
            "text":"#f5f5ff","secondary":"#b8c4e8","accent":"#ff0081","gold":"#ffe024",
            "teal":"#00efaa","headerVisible":true,"headerText":"","durationSeconds":0,
            "visibleRows":10,"scrollPixelsPerSecond":8});
        let mut options: OverlayOptions = serde_json::from_value(legacy).unwrap();
        assert_eq!(options.font_scale, 100);
        options.font_scale = 135;
        let saved = serde_json::to_value(&options).unwrap();
        assert_eq!(saved["fontScale"], 135);
        assert_eq!(serde_json::from_value::<OverlayOptions>(saved).unwrap().font_scale, 135);
    }
}
