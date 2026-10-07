mod models;
mod overlays;
mod parser;
mod storage;
mod streamer_bot;
mod twitch;

use chrono::Utc;
use models::*;
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use std::{
    path::{Path, PathBuf},
    sync::{mpsc, Arc, Mutex},
    thread,
    time::{Duration, Instant, SystemTime},
};
use storage::Storage;
use tauri::{Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;

struct Runtime {
    snapshot: AppSnapshot,
    race_state: RaceState,
    storage: Storage,
    overlay_writer: overlays::Writer,
    watcher: Option<RecommendedWatcher>,
    watcher_thread: Option<thread::JoinHandle<()>>,
    stop_tx: Option<mpsc::Sender<()>>,
    connection_checks_stopped: bool,
    processing: Arc<Mutex<()>>,
    cached_file: Option<(FileStamp, Option<FileStamp>, GameResult)>,
}

type SharedRuntime = Arc<Mutex<Runtime>>;

fn default_csv_path() -> String {
    std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_default()
        .join("MarblesOnStream")
        .join("Saved")
        .join("SaveGames")
        .join("LastSeasonRace.csv")
        .to_string_lossy()
        .into_owned()
}

fn initial_runtime(app: &tauri::AppHandle) -> Result<Runtime, String> {
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let data_dir = app_data_dir.join("data");
    let storage = Storage::new(data_dir)?;
    let mut config = storage
        .read::<AppConfig>("config.json")
        .unwrap_or_else(|_| AppConfig::default_for(default_csv_path()));
    config.csv.game_type = GameType::Auto;
    let twitch_defaults = TwitchConfig::default();
    if config.twitch.message_prefix.is_empty() {
        config.twitch.message_prefix = twitch_defaults.message_prefix;
        config.twitch.post_results = true;
    }
    if config.twitch.cycle_message_template.is_empty() {
        config.twitch.cycle_message_template = twitch_defaults.cycle_message_template;
    }
    let recent_results = storage
        .read::<Vec<GameResult>>("history.json")
        .unwrap_or_default();
    let race_cycles = match storage.read::<Vec<RaceCyclePlayer>>("race-cycles.json") {
        Ok(players) => players,
        Err(_) => match storage.read::<Vec<RaceCyclePlayer>>("rate-cycles.json") {
            Ok(players) => {
                let _ = storage.write("race-cycles.json", &players);
                let _ = storage.remove("rate-cycles.json");
                players
            }
            Err(_) => Vec::new(),
        },
    };
    let mut race_state = if storage.path("race-state.json").exists() {
        storage.read::<RaceState>("race-state.json")?
    } else {
        RaceState {
            cycle_history: vec![],
            total_race_count: recent_results.iter().filter(|game| game.game_type == GameType::Race).count() as u64,
            total_battle_royale_count: recent_results.iter().filter(|game| game.game_type == GameType::BattleRoyale).count() as u64,
            season_points_earned: recent_results.iter().map(game_points_earned).sum(),
            processed_ids: recent_results.iter().flat_map(game_keys).collect(),
            game_points: recent_results.iter().map(|game| (game_points_key(game), Some(game_points_earned(game)))).collect(),
            total_cycle_race_count: recent_results.len() as u64,
            cycle_processed_ids: recent_results.iter().flat_map(game_keys).collect(),
            cycle_last_update: None,
            race_cycles,
        }
    };
    // Existing versions counted both pipelines together; migrate their cycle fingerprints.
    let stored_state = storage.read::<serde_json::Value>("race-state.json").ok();
    if stored_state.as_ref().is_some_and(|value| value.get("seasonPointsEarned").is_none()) {
        race_state.season_points_earned = recent_results.iter().map(game_points_earned).sum();
    }
    if stored_state.as_ref().is_some_and(|value| value.get("gamePoints").is_none()) {
        let points_were_reset = race_state.season_points_earned == 0
            && recent_results.iter().map(game_points_earned).sum::<i64>() != 0;
        race_state.game_points = recent_results.iter().map(|game| (
            game_points_key(game),
            (!points_were_reset).then(|| game_points_earned(game)),
        )).collect();
    }
    if stored_state.as_ref().is_some_and(|value| value.get("totalBattleRoyaleCount").is_none()) {
        migrate_game_totals(&mut race_state, &recent_results);
    }
    if stored_state.as_ref().and_then(|value| value.get("cycleProcessedIds")).is_none() {
        race_state.cycle_processed_ids = race_state.processed_ids.clone();
    }
    if stored_state.as_ref().is_some_and(|value| value.get("totalCycleRaceCount").is_none()) {
        race_state.total_cycle_race_count = race_state.cycle_processed_ids.iter()
            .filter(|key| !key.starts_with("source:")).count() as u64;
    }
    migrate_cycle_history(&mut race_state.cycle_history, &recent_results);
    merge_duplicate_cycle_players(&mut race_state.race_cycles);
    storage.write("race-state.json", &race_state)?;
    let race_cycles = race_state.race_cycles.clone();
    let streamer_bot_status = if config.streamer_bot.has_enabled_events() {
        "Not checked"
    } else {
        "Disabled"
    };
    let (twitch_status, twitch_username, twitch_message) = match twitch::stored_identity() {
        Some(login) => (
            "Saved".to_string(),
            Some(login),
            Some("Saved login will be validated in the background".to_string()),
        ),
        None => ("Disconnected".to_string(), None, None),
    };
    // Restore saved display data only; startup never enters the processing pipeline.
    let latest_result = recent_results.last().cloned();
    Ok(Runtime {
        overlay_writer: overlays::Writer::new(app_data_dir.join("overlays")),
        race_state: race_state.clone(),
        snapshot: AppSnapshot {
            cycle_history: race_state.cycle_history.clone(),
            total_race_count: race_state.total_race_count,
            total_battle_royale_count: race_state.total_battle_royale_count,
            season_points_earned: race_state.season_points_earned,
            total_cycle_race_count: tracked_cycle_races(&race_state),
            session_results: vec![],
            config,
            watcher_status: "Stopped".into(),
            stats_tracking_enabled: false,
            cycles_tracking_enabled: false,
            watcher_message: None,
            detected_game_type: latest_result.as_ref().map(|game| game.game_type.clone()),
            last_update: None,
            cycle_last_update: race_state.cycle_last_update.clone(),
            latest_result,
            streamer_bot_status: streamer_bot_status.into(),
            streamer_bot_message: None,
            twitch_status,
            twitch_message,
            twitch_username,
            session: SessionSummary::default(),
            recent_results,
            race_cycles,
            logs: vec![],
        },
        storage,
        watcher: None,
        watcher_thread: None,
        stop_tx: None,
        connection_checks_stopped: false,
        processing: Arc::new(Mutex::new(())),
        cached_file: None,
    })
}

fn log(runtime: &SharedRuntime, app: &tauri::AppHandle, level: &str, message: impl Into<String>) {
    let entry = LogEntry {
        timestamp: Utc::now().to_rfc3339(),
        level: level.into(),
        message: message.into(),
    };
    if let Ok(mut rt) = runtime.lock() {
        rt.snapshot.logs.push(entry.clone());
        if rt.snapshot.logs.len() > 500 {
            rt.snapshot.logs.remove(0);
        }
    }
    let _ = app.emit("log-entry", &entry);
}

fn emit_snapshot(runtime: &SharedRuntime, app: &tauri::AppHandle) {
    let mut warning = None;
    if let Ok(mut rt) = runtime.lock() {
        let snapshot = rt.snapshot.clone();
        let error = rt.overlay_writer.update(&snapshot).err();
        if error != rt.overlay_writer.last_error { warning = error.clone(); }
        rt.overlay_writer.last_error = error;
        let _ = app.emit("app-state", &rt.snapshot);
    }
    if let Some(error) = warning { log(runtime, app, "warning", format!("[Overlay] Unable to update: {error}")); }
}

fn stable_file(path: &Path) -> Result<(), String> {
    let deadline = Instant::now() + Duration::from_secs(5);
    let mut previous = None;
    let mut stable_checks = 0;
    while Instant::now() < deadline {
        match std::fs::metadata(path) {
            Ok(meta) => {
                let current = (meta.len(), meta.modified().ok());
                if Some(current) == previous {
                    stable_checks += 1;
                } else {
                    stable_checks = 0;
                    previous = Some(current);
                }
                if stable_checks >= 2 && std::fs::File::open(path).is_ok() {
                    return Ok(());
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Err("File Missing".into()),
            Err(_) => {}
        }
        thread::sleep(Duration::from_millis(100));
    }
    Err("File did not become readable and stable within 5 seconds".into())
}

fn record_session_race(snapshot: &mut AppSnapshot) {
    snapshot.session.games_played += 1;
}

fn game_points_earned(game: &GameResult) -> i64 {
    game.results.iter().map(|player| player.season_points_earned).sum()
}

fn game_points_key(game: &GameResult) -> String {
    game_keys(game).last().cloned().unwrap_or_else(|| game.id.clone())
}

fn refresh_counted_result(games: &mut [GameResult], game: &GameResult) {
    let key = game_points_key(game);
    if let Some(previous) = games.iter_mut().find(|previous| game_points_key(previous) == key) {
        let timestamp = previous.timestamp.clone();
        *previous = game.clone();
        previous.timestamp = timestamp;
    }
}

fn refresh_latest_result(snapshot: &mut AppSnapshot, game: &GameResult) {
    snapshot.latest_result = Some(game.clone());
    snapshot.detected_game_type = Some(game.game_type.clone());
}

fn persist_history(runtime: &SharedRuntime) -> Result<(), String> {
    let rt = runtime
        .lock()
        .map_err(|_| "Application state unavailable".to_string())?;
    rt.storage
        .write("history.json", &rt.snapshot.recent_results)
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct CycleCompletion {
    player_name: String,
    cycle_number: u64,
    races: Option<u64>,
}

fn race_cycle_player_key(result: &PlayerResult) -> String {
    let identity = if result.username.trim().is_empty() {
        result.player_name.trim()
    } else {
        result.username.trim()
    };
    format!(
        "{}:{}",
        result.platform.trim().to_ascii_lowercase(),
        identity.to_ascii_lowercase()
    )
}

fn same_cycle_player(player: &RaceCyclePlayer, key: &str, name: &str) -> bool {
    let existing = player.player_key.trim().to_lowercase();
    existing == key.trim().to_lowercase()
        || (existing.split_once(':').map(|(platform, _)| platform)
            == key.split_once(':').map(|(platform, _)| platform)
            && player.player_name.trim().to_lowercase() == name.trim().to_lowercase())
}

fn merge_duplicate_cycle_players(players: &mut Vec<RaceCyclePlayer>) {
    let mut unique: Vec<RaceCyclePlayer> = Vec::new();
    for mut player in players.drain(..) {
        player.player_key = player.player_key.trim().to_lowercase();
        player.player_name = player.player_name.trim().to_owned();
        if let Some(existing) = unique.iter_mut().find(|existing| same_cycle_player(existing, &player.player_key, &player.player_name)) {
            existing.placement_counts.resize(10, 0);
            for (index, count) in player.placement_counts.iter().take(10).enumerate() {
                existing.placement_counts[index] += count;
            }
            existing.cycles = existing.placement_counts.iter().copied().min().unwrap_or(0);
            // Duplicate legacy rows have no reliable shared ordering for elapsed races.
            let active = existing.placement_counts.iter().copied().max().unwrap_or(0).saturating_sub(existing.cycles) as usize;
            existing.cycle_race_counts = vec![None; active.max(1)];
        } else {
            unique.push(player);
        }
    }
    *players = unique;
}

fn update_race_cycles(
    players: &mut Vec<RaceCyclePlayer>,
    game: &GameResult,
) -> Vec<CycleCompletion> {
    let mut completions = Vec::new();
    merge_duplicate_cycle_players(players);
    let mut seen_players = std::collections::HashSet::new();

    for result in &game.results {
        let key = race_cycle_player_key(result);
        let player_index = players
            .iter()
            .position(|player| same_cycle_player(player, &key, &result.player_name))
            .unwrap_or_else(|| {
                players.push(RaceCyclePlayer {
                    player_key: key,
                    player_name: result.player_name.clone(),
                    placement_counts: vec![0; 10],
                    cycles: 0,
                    cycle_race_counts: vec![Some(0)],
                });
                players.len() - 1
            });
        if !seen_players.insert(player_index) { continue; }
        let player = &mut players[player_index];
        player.player_name = if result.display_name.trim().is_empty() {
            result.player_name.clone()
        } else {
            result.display_name.clone()
        };
        player.placement_counts.resize(10, 0);
        let previously_started = player.placement_counts.iter().copied().max().unwrap_or(0).saturating_sub(player.cycles) as usize;
        if player.cycle_race_counts.is_empty() && previously_started == 0 {
            player.cycle_race_counts.push(Some(0));
        }
        // Legacy overlapping cycles have no recorded start; do not invent their elapsed counts.
        player.cycle_race_counts.resize_with(previously_started.max(1), || None);
        for count in player.cycle_race_counts.iter_mut().flatten() { *count += 1; }
        if !(1..=10).contains(&result.placement) { continue; }
        let previous_cycles = player.cycles;
        player.placement_counts[result.placement as usize - 1] += 1;
        let started = player.placement_counts.iter().copied().max().unwrap_or(0).saturating_sub(previous_cycles) as usize;
        // An nth occurrence starts cycle n on this match, while older cycles continue counting.
        player.cycle_race_counts.resize_with(started, || Some(1));
        player.cycles = player
            .placement_counts
            .iter()
            .take(10)
            .copied()
            .min()
            .unwrap_or(0);
        for cycle_number in (previous_cycles + 1)..=player.cycles {
            completions.push(CycleCompletion {
                player_name: player.player_name.clone(),
                cycle_number,
                races: player.cycle_race_counts.remove(0),
            });
        }
    }

    players.sort_by(|left, right| {
        right.cycles.cmp(&left.cycles).then_with(|| {
            left.player_name
                .to_lowercase()
                .cmp(&right.player_name.to_lowercase())
        })
    });
    completions
}

fn same_watch_target(event_path: &Path, target: &Path) -> bool {
    fn normalized(path: &Path) -> String {
        path.to_string_lossy()
            .trim_start_matches(r"\\?\")
            .replace('/', "\\")
            .to_ascii_lowercase()
    }
    normalized(event_path) == normalized(target)
        || (event_path.file_name().is_some()
            && event_path
                .file_name()
                .unwrap()
                .to_string_lossy()
                .eq_ignore_ascii_case(&target.file_name().unwrap_or_default().to_string_lossy()))
}

#[cfg(test)]
fn is_duplicate(results: &[GameResult], candidate: &GameResult) -> bool {
    results.iter().any(|game| {
        game.id == candidate.id
            || (game.source_snapshot_id.is_some()
                && game.source_snapshot_id == candidate.source_snapshot_id)
    })
}

fn set_streamer_bot_status(runtime: &SharedRuntime, status: &str, message: Option<String>) {
    if let Ok(mut rt) = runtime.lock() {
        rt.snapshot.streamer_bot_status = status.into();
        rt.snapshot.streamer_bot_message = message;
    }
}

fn set_twitch_status(
    runtime: &SharedRuntime,
    status: &str,
    message: Option<String>,
    username: Option<String>,
) {
    if let Ok(mut rt) = runtime.lock() {
        rt.snapshot.twitch_status = status.into();
        rt.snapshot.twitch_message = message;
        if username.is_some() || status == "Disconnected" {
            rt.snapshot.twitch_username = username;
        }
    }
}

fn send_twitch_results(runtime: &SharedRuntime, app: &tauri::AppHandle, game: GameResult) {
    let config = match runtime.lock() {
        Ok(rt) => rt.snapshot.config.twitch.clone(),
        Err(_) => return,
    };
    if !config.post_results {
        return;
    }

    let runtime = runtime.clone();
    let app = app.clone();
    thread::spawn(move || match twitch::send_results(&config, &game) {
        Ok(0) => {
            set_twitch_status(
                &runtime,
                "Connected",
                Some("No placed finishers to post".into()),
                None,
            );
            log(
                &runtime,
                &app,
                "info",
                "[Twitch] No placed finishers to post",
            );
            emit_snapshot(&runtime, &app);
        }
        Ok(message_count) => {
            set_twitch_status(
                &runtime,
                "Connected",
                Some(format!(
                    "Latest race posted to chat in {message_count} message{}",
                    if message_count == 1 { "" } else { "s" }
                )),
                None,
            );
            log(&runtime, &app, "info", "[Twitch] Results posted");
            emit_snapshot(&runtime, &app);
        }
        Err(error) => {
            set_twitch_status(&runtime, "Unavailable", Some(error.clone()), None);
            log(
                &runtime,
                &app,
                "warning",
                format!("[Twitch] Results not posted — {error}"),
            );
            emit_snapshot(&runtime, &app);
        }
    });
}

fn send_twitch_world_record(runtime: &SharedRuntime, app: &tauri::AppHandle, game: GameResult) {
    let config = match runtime.lock() { Ok(rt) => rt.snapshot.config.twitch.clone(), Err(_) => return };
    if !config.post_world_records || !game.has_world_record { return; }
    let runtime = runtime.clone();
    let app = app.clone();
    thread::spawn(move || {
        match twitch::send_world_record(&config, &game) {
            Ok(()) => {
                set_twitch_status(&runtime, "Connected", Some("World record posted to chat".into()), None);
                log(&runtime, &app, "info", "[Twitch] World record posted");
            }
            Err(error) => {
                set_twitch_status(&runtime, "Unavailable", Some(error.clone()), None);
                log(&runtime, &app, "warning", format!("[Twitch] World record not posted ? {error}"));
            }
        }
        emit_snapshot(&runtime, &app);
    });
}

fn send_cycle_completions(
    runtime: &SharedRuntime,
    app: &tauri::AppHandle,
    completions: Vec<CycleCompletion>,
) {
    if completions.is_empty() || !runtime.lock().map(|rt| rt.snapshot.config.twitch.post_cycle_results).unwrap_or(false) {
        return;
    }

    let message_template = runtime
        .lock()
        .map(|rt| rt.snapshot.config.twitch.cycle_message_template.clone())
        .unwrap_or_default();

    let runtime = runtime.clone();
    let app = app.clone();
    thread::spawn(move || {
        for completion in completions {
            match twitch::send_cycle_completion(
                &completion.player_name,
                completion.cycle_number,
                completion.races,
                &message_template,
            ) {
                Ok(_) => {
                    set_twitch_status(
                        &runtime,
                        "Connected",
                        Some(format!(
                            "Posted {}'s cycle #{}",
                            completion.player_name, completion.cycle_number
                        )),
                        None,
                    );
                    log(
                        &runtime,
                        &app,
                        "info",
                        format!(
                            "[RaceCycles] Posted {} cycle #{} to Twitch",
                            completion.player_name, completion.cycle_number
                        ),
                    );
                }
                Err(error) => {
                    set_twitch_status(&runtime, "Unavailable", Some(error.clone()), None);
                    log(
                        &runtime,
                        &app,
                        "warning",
                        format!(
                            "[RaceCycles] Could not post {} cycle #{} — {error}",
                            completion.player_name, completion.cycle_number
                        ),
                    );
                }
            }
        }
        emit_snapshot(&runtime, &app);
    });
}

fn send_streamer_bot_events(runtime: &SharedRuntime, app: &tauri::AppHandle, game: &GameResult, completions: &[CycleCompletion], stats_new: bool) {
    let snapshot = match runtime.lock() {
        Ok(rt) => rt.snapshot.clone(),
        Err(_) => return,
    };
    let config = snapshot.config.streamer_bot.clone();
    if !config.has_enabled_events() {
        set_streamer_bot_status(runtime, "Disabled", None);
        emit_snapshot(runtime, app);
        return;
    }
    let mut actions = if stats_new { streamer_bot::event_actions(&config, game, &snapshot.config.seasons.race_name) } else { vec![] };
    if config.events.cycle_complete {
        for completion in completions {
            actions.push((config.actions.cycle_complete.clone(), streamer_bot::cycle_complete_args(
                game, &completion.player_name, completion.cycle_number, completion.races)));
        }
    }
    if actions.is_empty() { return; }
    let mut failed = false;
    for (action, mut args) in actions {
        let completions = serde_json::Value::Array(completions.iter().map(|completion| serde_json::json!({
            "playerName": completion.player_name, "cycleNumber": completion.cycle_number, "races": completion.races,
        })).collect());
        streamer_bot::add_overlay_data(&mut args, &snapshot, game, completions);
        if let Err(error) = streamer_bot::trigger_action(&config, &action, args) {
            set_streamer_bot_status(runtime, "Unavailable", Some(error.clone()));
            log(
                runtime,
                app,
                "warning",
                format!("[Streamer.bot] Unavailable — {error}"),
            );
            emit_snapshot(runtime, app);
            failed = true;
            continue;
        }
        log(
            runtime,
            app,
            "info",
            format!("[Streamer.bot] Triggered {action}"),
        );
    }

    if !failed { set_streamer_bot_status(
        runtime,
        "Connected",
        Some(format!("{}:{}", config.host, config.port)),
    );
    }
    emit_snapshot(runtime, app);
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct FileStamp { path: PathBuf, length: u64, modified: SystemTime }

fn file_stamp(path: &Path) -> Option<FileStamp> {
    let metadata = std::fs::metadata(path).ok()?;
    Some(FileStamp { path: path.to_path_buf(), length: metadata.len(), modified: metadata.modified().ok()? })
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum ReadReason { FileChanged, Manual }

fn is_content_event(kind: notify::EventKind) -> bool {
    use notify::{EventKind, event::ModifyKind};
    matches!(kind, EventKind::Create(_) | EventKind::Remove(_) |
        EventKind::Modify(ModifyKind::Data(_) | ModifyKind::Name(_) | ModifyKind::Any | ModifyKind::Other))
}

// Exact supported filenames only; companion changes queue their results file.
fn changed_result_paths(paths: &[PathBuf], race: &Path) -> Vec<PathBuf> {
    let royale = race.with_file_name("LastSeasonRoyale.csv");
    let race_map = race.with_file_name("LastCustomRaceMapPlayed.csv");
    let race_summary = race.with_file_name("LastSeasonRaceSummary.csv");
    let royale_summary = race.with_file_name("LastSeasonRoyaleSummary.csv");
    let mut changed = Vec::new();
    for path in paths {
        let result = if same_watch_target(path, race) || same_watch_target(path, &race_map) || same_watch_target(path, &race_summary) {
            Some(race.to_path_buf())
        } else if same_watch_target(path, &royale) || same_watch_target(path, &royale_summary) {
            Some(royale.clone())
        } else { None };
        if let Some(result) = result {
            if !changed.contains(&result) { changed.push(result); }
        }
    }
    changed
}

fn latest_result_path(race: &Path) -> PathBuf {
    let royale = race.with_file_name("LastSeasonRoyale.csv");
    match (file_stamp(race), file_stamp(&royale)) {
        (Some(race_stamp), Some(royale_stamp)) if royale_stamp.modified > race_stamp.modified => royale,
        (None, Some(_)) => royale,
        _ => race.to_path_buf(),
    }
}

fn process_file(runtime: &SharedRuntime, app: &tauri::AppHandle, path: &Path) {
    process_file_inner(runtime, app, path, ReadReason::FileChanged);
}

fn game_keys(game: &GameResult) -> Vec<String> {
    let mut keys = vec![format!("game:{}", game.id)];
    if let Some(id) = &game.source_snapshot_id {
        keys.push(if game.game_type == GameType::BattleRoyale { format!("source:royale:{id}") } else { format!("source:{id}") });
    }
    keys
}

// Season counters reset independently of lifetime duplicate protection.
fn tracked_cycle_races(state: &RaceState) -> u64 {
    state.total_cycle_race_count
}

fn migrate_game_totals(state: &mut RaceState, history: &[GameResult]) {
    // Older versions included BRs in the Race total. Source IDs remain after history is cleared.
    let source_count = state.processed_ids.iter().filter(|key| key.starts_with("source:royale:")).count() as u64;
    let history_count = history.iter().filter(|game| game.game_type == GameType::BattleRoyale).count() as u64;
    state.total_battle_royale_count = source_count.max(history_count).min(state.total_race_count);
    state.total_race_count = state.total_race_count.saturating_sub(state.total_battle_royale_count);
}

// Preserve old completion records, combining those from the same race. Only
// enrich them with metadata from actual saved results; do not invent past reads.
fn migrate_cycle_history(history: &mut Vec<CycleHistoryEntry>, games: &[GameResult]) {
    if !history.iter().any(|entry| entry.cycle_number > 0) { return; }
    let mut migrated: Vec<CycleHistoryEntry> = Vec::new();
    for mut entry in std::mem::take(history) {
        if entry.cycle_number > 0 {
            entry.completions.push(CycleHistoryCompletion {
                player_name: entry.player_name.clone(), cycle_number: entry.cycle_number,
            });
            entry.player_name.clear();
            entry.cycle_number = 0;
        }
        if let Some(game) = games.iter().find(|game| game.id == entry.game_id) {
            let winner = game.results.iter().find(|result| result.placement == 1);
            entry.winner_name = winner.map(|result| result.player_name.clone());
            entry.winning_time = winner.and_then(|result| result.finish_time);
            entry.player_count = Some(game.player_count);
        }
        if let Some(previous) = migrated.iter_mut().find(|previous| previous.game_id == entry.game_id) {
            previous.completions.extend(entry.completions);
        } else { migrated.push(entry); }
    }
    *history = migrated;
}

fn prepare_race_commit(
    current: &RaceState, game: &GameResult, stats_enabled: bool, cycles_enabled: bool, timestamp: &str, reason: ReadReason,
) -> Option<(RaceState, bool, Vec<CycleCompletion>)> {
    let keys = game_keys(game);
    let stats_new = stats_enabled && !keys.iter().any(|key| current.processed_ids.contains(key));
    let cycles_new = cycles_enabled && !keys.iter().any(|key| current.cycle_processed_ids.contains(key));
    let points_key = game_points_key(game);
    let points = game_points_earned(game);
    let previous_points = current.game_points.get(&points_key).copied().flatten();
    let points_changed = reason == ReadReason::Manual && !stats_new
        && previous_points.is_some_and(|previous| previous != points);
    if !stats_new && !cycles_new && !points_changed { return None; }
    let mut next = current.clone();
    if stats_new {
        next.season_points_earned += points;
        next.game_points.insert(points_key.clone(), Some(points));
        if game.game_type == GameType::BattleRoyale { next.total_battle_royale_count += 1; }
        else { next.total_race_count += 1; }
        next.processed_ids.extend(keys.clone());
    } else if let Some(previous) = previous_points.filter(|_| points_changed) {
        next.season_points_earned += points - previous;
        next.game_points.insert(points_key, Some(points));
    }
    let cycle_completions = if cycles_new {
        next.total_cycle_race_count += 1;
        next.cycle_processed_ids.extend(keys);
        next.cycle_last_update = Some(timestamp.into());
        update_race_cycles(&mut next.race_cycles, game)
    } else { vec![] };
    if cycles_new {
        let winner = game.results.iter().find(|result| result.placement == 1);
        next.cycle_history.push(CycleHistoryEntry {
            timestamp: timestamp.into(), player_name: String::new(), cycle_number: 0,
            map_name: game.map_name.clone(), game_id: game.id.clone(),
            winner_name: winner.map(|result| result.player_name.clone()),
            winning_time: winner.and_then(|result| result.finish_time),
            player_count: Some(game.player_count),
            completions: cycle_completions.iter().map(|completion| CycleHistoryCompletion {
                player_name: completion.player_name.clone(), cycle_number: completion.cycle_number,
            }).collect(),
        });
    }
    if next.cycle_history.len() > 250 {
        let excess = next.cycle_history.len() - 250;
        next.cycle_history.drain(..excess);
    }
    Some((next, stats_new, cycle_completions))
}

fn process_file_inner(runtime: &SharedRuntime, app: &tauri::AppHandle, path: &Path, reason: ReadReason) {
    let processing = match runtime.lock() { Ok(rt) => rt.processing.clone(), Err(_) => return };
    let _processing_guard = match processing.lock() { Ok(guard) => guard, Err(_) => return };
    let selected_path = if reason != ReadReason::FileChanged { latest_result_path(path) } else { path.to_path_buf() };
    let path = selected_path.as_path();
    let companion = path.with_file_name(if same_watch_target(path, &path.with_file_name("LastSeasonRoyale.csv")) {
        "LastSeasonRoyaleSummary.csv"
    } else if path.with_file_name("LastSeasonRaceSummary.csv").exists() {
        "LastSeasonRaceSummary.csv"
    } else { "LastCustomRaceMapPlayed.csv" });
    let stamp = file_stamp(path);
    let companion_stamp = file_stamp(&companion);
    let cached = runtime.lock().ok().and_then(|rt| rt.cached_file.clone())
        .filter(|(previous, previous_companion, _)| stamp.as_ref() == Some(previous) && *previous_companion == companion_stamp);
    if reason == ReadReason::FileChanged && cached.is_some() { return; }
    if let Ok(mut rt) = runtime.lock() {
        rt.snapshot.watcher_status = "Processing".into();
        rt.snapshot.watcher_message = Some("Reading the latest game result".into());
    }
    emit_snapshot(runtime, app);
    log(runtime, app, "info", match reason {
        ReadReason::FileChanged => "[Watcher] File changed",
        ReadReason::Manual => "[Parser] Manual re-read requested",
    });
    if let Err(message) = stable_file(path) {
        if let Ok(mut rt) = runtime.lock() {
            rt.snapshot.watcher_status = if message == "File Missing" {
                "File Missing"
            } else {
                "Error"
            }
            .into();
            rt.snapshot.watcher_message = Some(message.clone());
        }
        log(runtime, app, "error", format!("[Watcher] {message}"));
        emit_snapshot(runtime, app);
        return;
    }
    log(runtime, app, "info", "[Parser] Reading stable CSV");
    let read_stamp = file_stamp(path);
    let read_companion_stamp = file_stamp(&companion);
    let parsed = {
            let royale = same_watch_target(path, &path.with_file_name("LastSeasonRoyale.csv"));
            let mut parsed = if companion.exists() {
                stable_file(&companion).and_then(|_| parser::parse_file(path))
            } else { parser::parse_file(path) };
            // Either file may be written first. Wait for the final matching pair.
            if royale || companion.file_name().and_then(|name| name.to_str()) == Some("LastSeasonRaceSummary.csv") {
                for _ in 0..8 {
                    if parsed.is_ok() { break; }
                    thread::sleep(Duration::from_millis(250));
                    parsed = stable_file(path)
                        .and_then(|_| stable_file(&companion))
                        .and_then(|_| parser::parse_file(path));
                }
            }
            parsed
    };
    match parsed {
        Ok(mut game) => {
            if game.game_type == GameType::Race {
            let map_path = path.with_file_name("LastCustomRaceMapPlayed.csv");
            match stable_file(&map_path).and_then(|_| parser::parse_map_metadata(&map_path)) {
                Ok(metadata) => {
                    if game.map_name.is_none() {
                        game.map_name = Some(metadata.map_name.clone());
                    }
                    if game.map_name.as_deref() == Some(metadata.map_name.as_str()) {
                        game.world_record_time = metadata.record_time;
                        game.world_record_player = metadata.record_holder_name;
                    }
                    log(
                        runtime,
                        app,
                        "info",
                        format!("[Parser] Map: {}", metadata.map_name),
                    );
                }
                Err(error) if game.map_name.is_none() => log(
                    runtime,
                    app,
                    "warning",
                    format!("[Parser] Map metadata unavailable — {error}"),
                ),
                Err(_) => {},
            }
            }
                if let (Some(stamp), Ok(mut rt)) = (read_stamp, runtime.lock()) {
                    rt.cached_file = if Some(&stamp) == file_stamp(path).as_ref() && read_companion_stamp == file_stamp(&companion) {
                        Some((stamp, read_companion_stamp, game.clone()))
                    } else { None };
                }
            let saved = {
                let mut rt = match runtime.lock() {
                    Ok(rt) => rt,
                    Err(_) => return,
                };
                let stats_enabled = rt.snapshot.stats_tracking_enabled || reason == ReadReason::Manual;
                let cycles_enabled = rt.snapshot.cycles_tracking_enabled || reason == ReadReason::Manual;
                let timestamp = Utc::now().to_rfc3339();
                if let Some((next, stats_new, cycle_completions)) = prepare_race_commit(&rt.race_state, &game, stats_enabled, cycles_enabled, &timestamp, reason) {
                    if let Err(error) = rt.storage.write("race-state.json", &next) {
                        rt.cached_file = None;
                        rt.snapshot.watcher_status = "Error".into();
                        rt.snapshot.watcher_message = Some(error.clone());
                        drop(rt);
                        log(runtime, app, "error", format!("[Storage] Race not committed: {error}"));
                        emit_snapshot(runtime, app);
                        return;
                    }
                    refresh_latest_result(&mut rt.snapshot, &game);
                    rt.snapshot.cycle_history = next.cycle_history.clone();
                    rt.snapshot.total_race_count = next.total_race_count;
                    rt.snapshot.total_battle_royale_count = next.total_battle_royale_count;
                    rt.snapshot.season_points_earned = next.season_points_earned;
                    rt.snapshot.total_cycle_race_count = tracked_cycle_races(&next);
                    rt.snapshot.race_cycles = next.race_cycles.clone();
                    rt.snapshot.cycle_last_update = next.cycle_last_update.clone();
                    rt.race_state = next;
                    if stats_new {
                        record_session_race(&mut rt.snapshot);
                        rt.snapshot.session_results.push(game.clone());
                        if rt.snapshot.recent_results.iter().any(|previous| game_points_key(previous) == game_points_key(&game)) {
                            refresh_counted_result(&mut rt.snapshot.recent_results, &game);
                        } else {
                            rt.snapshot.recent_results.push(game.clone());
                        }
                        if rt.snapshot.recent_results.len() > 250 { rt.snapshot.recent_results.remove(0); }
                        rt.snapshot.last_update = Some(timestamp);
                    } else if reason == ReadReason::Manual {
                        refresh_counted_result(&mut rt.snapshot.session_results, &game);
                        refresh_counted_result(&mut rt.snapshot.recent_results, &game);
                    }
                    rt.snapshot.watcher_status = if rt.watcher.is_some() { "Watching" } else { "Stopped" }.into();
                    rt.snapshot.watcher_message = Some("New game read from file".into());
                    Some((game.player_count, game.id.chars().take(8).collect::<String>(), game.clone(), cycle_completions, stats_new))
                } else {
                    if reason == ReadReason::Manual {
                        refresh_latest_result(&mut rt.snapshot, &game);
                    }
                    rt.snapshot.watcher_status = if rt.watcher.is_some() { "Watching" } else { "Stopped" }.into();
                    rt.snapshot.watcher_message = Some("File read; no active pipeline needs this race".into());
                    None
                }
            };
            match &saved {
                None => log(runtime, app, "info", "[Game] Duplicate snapshot ignored; counts unchanged"),
                Some((count, id, _, _, _)) => {
                    log(
                        runtime,
                        app,
                        "info",
                        format!("[Parser] Parsed {count} players"),
                    );
                    log(runtime, app, "info", format!("[Game] New result {id}..."));
                }
            }
            emit_snapshot(runtime, app);
            if let Some((_, _, game, cycle_completions, stats_new)) = saved {
                let overlay_error = if let Ok(mut rt) = runtime.lock() {
                    let snapshot = rt.snapshot.clone();
                    let completions = serde_json::json!(cycle_completions.iter().map(|completion| serde_json::json!({
                        "playerName": completion.player_name, "cycleNumber": completion.cycle_number, "races": completion.races,
                    })).collect::<Vec<_>>());
                    rt.overlay_writer.alerts(&snapshot, &game, completions, stats_new).err()
                } else { None };
                if let Some(error) = overlay_error { log(runtime, app, "warning", format!("[Overlay] Unable to show alert: {error}")); }
                if let Err(error) = persist_history(runtime) {
                    log(
                        runtime,
                        app,
                        "warning",
                        format!("[History] Unable to save — {error}"),
                    );
                }

                send_streamer_bot_events(runtime, app, &game, &cycle_completions, stats_new);
                if stats_new {
                    send_twitch_world_record(runtime, app, game.clone());
                    send_twitch_results(runtime, app, game);
                }
                send_cycle_completions(runtime, app, cycle_completions);
            }

            return;
        }
        Err(message) => {
            if let Ok(mut rt) = runtime.lock() {
                rt.snapshot.watcher_status = "Error".into();
                rt.snapshot.watcher_message = Some(message.clone());
            }
            log(runtime, app, "error", format!("[Parser] {message}"));
        }
    }
    emit_snapshot(runtime, app);
}

fn stop_watcher_inner(runtime: &SharedRuntime) {
    let (stop, thread) = if let Ok(mut rt) = runtime.lock() {
        (rt.stop_tx.take(), rt.watcher_thread.take())
    } else {
        (None, None)
    };
    if let Some(tx) = stop {
        let _ = tx.send(());
    }
    if let Some(handle) = thread {
        let _ = handle.join();
    }
    if let Ok(mut rt) = runtime.lock() {
        rt.watcher.take();
        rt.snapshot.watcher_status = "Stopped".into();
        rt.snapshot.stats_tracking_enabled = false;
        rt.snapshot.cycles_tracking_enabled = false;
        rt.snapshot.watcher_message = None;
    }
}

#[tauri::command]
fn get_app_snapshot(runtime: State<'_, SharedRuntime>) -> Result<AppSnapshot, String> {
    runtime
        .lock()
        .map(|rt| rt.snapshot.clone())
        .map_err(|_| "Application state unavailable".into())
}

#[tauri::command]
fn save_config(
    app: tauri::AppHandle,
    runtime: State<'_, SharedRuntime>,
    config: AppConfig,
) -> Result<AppSnapshot, String> {
    {
        let mut rt = runtime
            .lock()
            .map_err(|_| "Application state unavailable")?;
        rt.storage.write("config.json", &config)?;
        rt.snapshot.config = config;
        rt.snapshot.streamer_bot_status = if rt.snapshot.config.streamer_bot.has_enabled_events() {
            "Not checked".into()
        } else {
            "Disabled".into()
        };
        rt.snapshot.streamer_bot_message = None;
    }

    log(&runtime, &app, "info", "[Settings] Configuration saved");
    emit_snapshot(&runtime, &app);
    runtime
        .lock()
        .map(|rt| rt.snapshot.clone())
        .map_err(|_| "Application state unavailable".into())
}

#[tauri::command]
fn save_seasons(app: tauri::AppHandle, runtime: State<'_, SharedRuntime>, seasons: SeasonConfig) -> Result<AppSnapshot, String> {
    {
        let mut rt = runtime.lock().map_err(|_| "Application state unavailable")?;
        let mut config = rt.snapshot.config.clone();
        config.seasons = seasons;
        rt.storage.write("config.json", &config)?;
        rt.snapshot.config = config;
    }
    emit_snapshot(&runtime, &app);
    get_app_snapshot(runtime)
}

fn prepare_export(snapshot: &AppSnapshot, kind: &str) -> Result<(String, serde_json::Value), String> {
    let (name, value) = match kind {
        "race" => (&snapshot.config.seasons.race_name, serde_json::json!({
            "seasonName": snapshot.config.seasons.race_name,
            "sourceFile": snapshot.config.csv.path,
            "exportedAt": Utc::now().to_rfc3339(),
            "game": snapshot.latest_result.as_ref().ok_or("No race results to export")?,
        })),
        "session" => (&snapshot.config.seasons.race_name, serde_json::json!({
            "seasonName": snapshot.config.seasons.race_name,
            "sourceFile": snapshot.config.csv.path,
            "exportedAt": Utc::now().to_rfc3339(),
            "session": snapshot.session,
            "games": snapshot.session_results,
        })),
        "cycles" => (&snapshot.config.seasons.cycle_name, serde_json::json!({
            "seasonName": snapshot.config.seasons.cycle_name,
            "sourceFile": snapshot.config.csv.path,
            "exportedAt": Utc::now().to_rfc3339(),
            "players": snapshot.race_cycles,
            "lastUpdated": snapshot.cycle_last_update,
        })),
        _ => return Err("Unknown export type".into()),
    };
    let safe_name: String = name.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' { c } else { '_' }).take(80).collect();
    let filename = format!("{kind}-{safe_name}-{}.json", Utc::now().format("%Y%m%d-%H%M%S-%f"));
    Ok((filename, value))
}

#[tauri::command]
async fn export_data(app: tauri::AppHandle, runtime: State<'_, SharedRuntime>, kind: String) -> Result<Option<String>, String> {
    // Capture the complete export, then release the state lock before showing a dialog.
    let (filename, value) = {
        let rt = runtime.lock().map_err(|_| "Application state unavailable")?;
        prepare_export(&rt.snapshot, &kind)?
    };
    tauri::async_runtime::spawn_blocking(move || {
        let mut dialog = app.dialog().file()
            .set_title("Export results")
            .add_filter("JSON results", &["json"])
            .set_file_name(filename);
        if let Some(window) = app.get_webview_window("main") {
            dialog = dialog.set_parent(&window);
        }
        let Some(selected) = dialog.blocking_save_file() else { return Ok(None); };
        let path = selected.into_path().map_err(|error| error.to_string())?;
        let parent = path.parent().ok_or("Invalid export location")?;
        let filename = path.file_name().and_then(|name| name.to_str()).ok_or("Invalid export file name")?;
        Storage::new(parent.to_path_buf())?.write(filename, &value)?;
        Ok(Some(path.to_string_lossy().into_owned()))
    }).await.map_err(|error| error.to_string())?
}

#[tauri::command]
async fn reread_last_file(app: tauri::AppHandle, runtime: State<'_, SharedRuntime>) -> Result<AppSnapshot, String> {
    let shared = runtime.inner().clone();
    let path = shared.lock().map_err(|_| "Application state unavailable")?.snapshot.config.csv.path.clone();
    let worker = shared.clone();
    tauri::async_runtime::spawn_blocking(move || process_file_inner(&worker, &app, Path::new(&path), ReadReason::Manual))
        .await.map_err(|error| error.to_string())?;
    let snapshot = shared.lock().map_err(|_| "Application state unavailable")?.snapshot.clone();
    Ok(snapshot)
}

#[tauri::command]
fn open_twitch_authorization(desktop_id: String) -> Result<(), String> {
    twitch::open_authorization(&desktop_id)
}

#[tauri::command]
async fn complete_twitch_oauth(
    app: tauri::AppHandle,
    runtime: State<'_, SharedRuntime>,
    access_token: String,
    client_id: String,
) -> Result<AppSnapshot, String> {
    let shared = runtime.inner().clone();
    {
        let mut rt = shared.lock().map_err(|_| "Application state unavailable")?;
        rt.snapshot.twitch_status = "Authorizing".into();
        rt.snapshot.twitch_message = Some("Finishing Twitch authorization".into());
    }
    emit_snapshot(&shared, &app);

    let result = tauri::async_runtime::spawn_blocking(move || {
        twitch::complete_authorization(access_token, client_id)
    })
    .await
    .map_err(|error| format!("Twitch authorization task failed: {error}"))?;
    match result {
        Ok(credential) => {
            set_twitch_status(
                &shared,
                "Connected",
                Some("Authorized to post race results".into()),
                Some(credential.login),
            );
            log(&shared, &app, "info", "[Twitch] Account connected");
        }
        Err(error) => {
            set_twitch_status(&shared, "Unavailable", Some(error.clone()), None);
            log(
                &shared,
                &app,
                "warning",
                format!("[Twitch] Authorization failed — {error}"),
            );
        }
    }
    emit_snapshot(&shared, &app);
    let snapshot = shared
        .lock()
        .map(|rt| rt.snapshot.clone())
        .map_err(|_| "Application state unavailable".to_string())?;
    Ok(snapshot)
}

#[tauri::command]
async fn validate_twitch_session(
    app: tauri::AppHandle,
    runtime: State<'_, SharedRuntime>,
) -> Result<AppSnapshot, String> {
    let shared = runtime.inner().clone();
    let result = tauri::async_runtime::spawn_blocking(twitch::validate_saved)
        .await
        .map_err(|error| format!("Twitch validation task failed: {error}"))?;
    match result {
        Ok(credential) => set_twitch_status(
            &shared,
            "Connected",
            Some("Ready to spam.".into()),
            Some(credential.login),
        ),
        Err(error) => set_twitch_status(&shared, "Expired", Some(error), None),
    }
    emit_snapshot(&shared, &app);
    let snapshot = shared
        .lock()
        .map(|rt| rt.snapshot.clone())
        .map_err(|_| "Application state unavailable".to_string())?;
    Ok(snapshot)
}

#[tauri::command]
async fn test_twitch_message(
    app: tauri::AppHandle,
    runtime: State<'_, SharedRuntime>,
    kind: String,
    config: TwitchConfig,
) -> Result<AppSnapshot, String> {
    let shared = runtime.inner().clone();
    let game = streamer_bot::sample_game();
    let result = tauri::async_runtime::spawn_blocking(move || match kind.as_str() {
        "race" if config.post_results => twitch::send_results(&config, &game).and_then(|count| {
            if count > 0 { Ok(()) } else { Err("The last race has no point-scoring racers to post".into()) }
        }),
        "cycles" if config.post_cycle_results => twitch::send_cycle_completion("Test Player", 1, Some(823), &config.cycle_message_template).map(|_| ()),
        "worldRecord" if config.post_world_records => twitch::send_world_record(&config, &game),
        "race" | "cycles" | "worldRecord" => Err("Enable this posting option before testing it".into()),
        _ => Err("Unknown Twitch test".into()),
    }).await.map_err(|error| format!("Twitch test task failed: {error}"))?;
    match result {
        Ok(()) => {
            set_twitch_status(&shared, "Connected", None, None);
            log(&shared, &app, "info", "[Twitch] Test message posted");
            emit_snapshot(&shared, &app);
            get_app_snapshot(runtime)
        }
        Err(error) => {
            log(&shared, &app, "warning", format!("[Twitch] Test message failed ? {error}"));
            Err(error)
        }
    }
}

#[tauri::command]
fn disconnect_twitch(
    app: tauri::AppHandle,
    runtime: State<'_, SharedRuntime>,
) -> Result<AppSnapshot, String> {
    twitch::disconnect()?;
    set_twitch_status(&runtime, "Disconnected", None, None);
    log(&runtime, &app, "info", "[Twitch] Account disconnected");
    emit_snapshot(&runtime, &app);
    get_app_snapshot(runtime)
}

fn finish_streamer_bot_test(
    runtime: &SharedRuntime,
    app: &tauri::AppHandle,
    result: Result<(), String>,
    success_message: &str,
) -> Result<AppSnapshot, String> {
    match result {
        Ok(()) => {
            set_streamer_bot_status(runtime, "Connected", None);
            log(runtime, app, "info", format!("[Streamer.bot] {success_message}"));
            emit_snapshot(runtime, app);
            runtime.lock().map(|rt| rt.snapshot.clone()).map_err(|_| "Application state unavailable".into())
        }
        Err(error) => {
            log(runtime, app, "warning", format!("[Streamer.bot] {error}"));
            Err(error)
        }
    }
}

#[tauri::command]
fn test_streamer_bot_connection(
    app: tauri::AppHandle,
    runtime: State<'_, SharedRuntime>,
    config: StreamerBotConfig,
) -> Result<AppSnapshot, String> {
    let result = streamer_bot::test_connection(&config);
    finish_streamer_bot_test(&runtime, &app, result, "Connection test succeeded")
}

#[tauri::command]
fn get_overlay_directory(runtime: State<'_, SharedRuntime>) -> Result<String, String> {
    let rt = runtime.lock().map_err(|error| error.to_string())?;
    overlays::ensure(&rt.overlay_writer.directory)?;
    Ok(rt.overlay_writer.directory.to_string_lossy().into_owned())
}

#[tauri::command]
fn test_overlay(runtime: State<'_, SharedRuntime>, kind: String) -> Result<(), String> {
    if !matches!(kind.as_str(), "gameComplete" | "worldRecord" | "cycleComplete" | "results" | "podium" | "points") { return Err("Unknown overlay test".into()); }
    let mut rt = runtime.lock().map_err(|error| error.to_string())?;
    rt.overlay_writer.sample(&kind)
}

#[tauri::command]
fn test_streamer_bot_action(
    app: tauri::AppHandle,
    runtime: State<'_, SharedRuntime>,
    config: StreamerBotConfig,
    kind: String,
) -> Result<AppSnapshot, String> {
    let (action, args) = match kind.as_str() {
        "gameComplete" => (
            config.actions.game_complete.clone(),
            streamer_bot::test_args("gameComplete"),
        ),
        "worldRecord" => (
            config.actions.world_record.clone(),
            streamer_bot::test_args("worldRecord"),
        ),
        "cycleComplete" => (config.actions.cycle_complete.clone(), streamer_bot::test_args("cycleComplete")),
        _ => return Err("Unknown Streamer.bot test action".into()),
    };
    let result = streamer_bot::trigger_action(&config, &action, args);
    finish_streamer_bot_test(
        &runtime,
        &app,
        result,
        &format!("Test action sent: {action}"),
    )
}

fn start_watcher_inner(
    app: &tauri::AppHandle,
    runtime: &SharedRuntime,
) -> Result<AppSnapshot, String> {
    {
        let rt = runtime.lock().map_err(|_| "Application state unavailable")?;
        if rt.watcher.is_some() { return Ok(rt.snapshot.clone()); }
    }
    let path = {
        runtime
            .lock()
            .map_err(|_| "Application state unavailable")?
            .snapshot
            .config
            .csv
            .path
            .clone()
    };
    let target = PathBuf::from(&path);
    let watch_dir = target
        .parent()
        .ok_or("CSV path has no parent directory")?
        .to_path_buf();
    if !watch_dir.exists() {
        let mut rt = runtime
            .lock()
            .map_err(|_| "Application state unavailable")?;
        rt.snapshot.watcher_status = "File Missing".into();
        rt.snapshot.watcher_message =
            Some(format!("Folder does not exist: {}", watch_dir.display()));
        return Ok(rt.snapshot.clone());
    }
    let (event_tx, event_rx) = mpsc::channel();
    let mut watcher = notify::recommended_watcher(move |event| {
        let _ = event_tx.send(event);
    })
    .map_err(|e| e.to_string())?;
    watcher
        .watch(&watch_dir, RecursiveMode::NonRecursive)
        .map_err(|e| e.to_string())?;
    let (stop_tx, stop_rx) = mpsc::channel();
    let shared = runtime.clone();
    let app_for_thread = app.clone();
    let target_for_thread = target.clone();
    let handle = thread::spawn(move || loop {
        match stop_rx.try_recv() {
            Ok(()) | Err(mpsc::TryRecvError::Disconnected) => break,
            Err(mpsc::TryRecvError::Empty) => {}
        }
        match event_rx.recv_timeout(Duration::from_millis(250)) {
            Ok(Ok(event)) if is_content_event(event.kind) => {
                let mut pending = changed_result_paths(&event.paths, &target_for_thread);
                if pending.is_empty() { continue; }
                // Gather every changed source during the debounce, never discard another mode.
                let mut quiet_until = Instant::now() + Duration::from_millis(250);
                let deadline = Instant::now() + Duration::from_secs(2);
                while Instant::now() < quiet_until && Instant::now() < deadline {
                    match event_rx.recv_timeout(Duration::from_millis(50)) {
                        Ok(Ok(next)) if is_content_event(next.kind) => {
                            let changed = changed_result_paths(&next.paths, &target_for_thread);
                            if !changed.is_empty() {
                                quiet_until = Instant::now() + Duration::from_millis(250);
                                for result in changed {
                                    if !pending.contains(&result) { pending.push(result); }
                                }
                            }
                        }
                        Ok(Err(error)) => log(&shared, &app_for_thread, "warning", format!("[Watcher] {error}")),
                        _ => {}
                    }
                }
                // Older results first, so the newest completed game is displayed last.
                pending.sort_by_key(|path| file_stamp(path).map(|stamp| stamp.modified));
                for result in pending {
                    if stop_rx.try_recv().is_ok() { return; }
                    process_file(&shared, &app_for_thread, &result);
                }
            }
            Ok(Err(e)) => log(
                &shared,
                &app_for_thread,
                "warning",
                format!("[Watcher] {e}"),
            ),
            _ => {}
        }
    });
    let snapshot = {
        let mut rt = runtime
            .lock()
            .map_err(|_| "Application state unavailable")?;
        rt.watcher = Some(watcher);
        rt.stop_tx = Some(stop_tx);
        rt.watcher_thread = Some(handle);
        rt.snapshot.watcher_status = if target.exists() || target.with_file_name("LastSeasonRoyale.csv").exists() {
            "Watching"
        } else {
            "File Missing"
        }
        .into();
        rt.snapshot.watcher_message = None;
        rt.snapshot.clone()
    };
    log(&runtime, &app, "info", format!("[Watcher] Watching Race and Battle Royale result/metadata files in {}", watch_dir.display()));
    emit_snapshot(&runtime, &app);
    Ok(snapshot)
}

#[tauri::command]
fn set_tracking_enabled(
    app: tauri::AppHandle,
    runtime: State<'_, SharedRuntime>,
    kind: String,
    enabled: bool,
) -> Result<AppSnapshot, String> {
    if kind != "stats" && kind != "cycles" { return Err("Unknown tracking page".into()); }
    let previous = {
        let mut rt = runtime.lock().map_err(|_| "Application state unavailable")?;
        let previous = if kind == "stats" { rt.snapshot.stats_tracking_enabled } else { rt.snapshot.cycles_tracking_enabled };
        if previous == enabled { return Ok(rt.snapshot.clone()); }
        if kind == "stats" { rt.snapshot.stats_tracking_enabled = enabled; }
        else { rt.snapshot.cycles_tracking_enabled = enabled; }
        previous
    };
    if enabled {
        if let Err(error) = start_watcher_inner(&app, &runtime) {
            let mut rt = runtime.lock().map_err(|_| "Application state unavailable")?;
            if kind == "stats" { rt.snapshot.stats_tracking_enabled = previous; }
            else { rt.snapshot.cycles_tracking_enabled = previous; }
            return Err(error);
        }
    } else {
        let both_stopped = {
            let rt = runtime.lock().map_err(|_| "Application state unavailable")?;
            !rt.snapshot.stats_tracking_enabled && !rt.snapshot.cycles_tracking_enabled
        };
        if both_stopped { stop_watcher_inner(&runtime); }
    }
    log(&runtime, &app, "info", format!("[{}] {}", if kind == "stats" { "RaceStats" } else { "RaceCycles" }, if enabled { "Started" } else { "Stopped" }));
    emit_snapshot(&runtime, &app);
    get_app_snapshot(runtime)
}

// Retained for callers using the original shared watcher command.
#[tauri::command]
fn start_watcher(app: tauri::AppHandle, runtime: State<'_, SharedRuntime>) -> Result<AppSnapshot, String> {
    {
        let mut rt = runtime.lock().map_err(|_| "Application state unavailable")?;
        rt.snapshot.stats_tracking_enabled = true;
        rt.snapshot.cycles_tracking_enabled = true;
    }
    start_watcher_inner(&app, &runtime)
}

#[tauri::command]
fn stop_watcher(
    app: tauri::AppHandle,
    runtime: State<'_, SharedRuntime>,
) -> Result<AppSnapshot, String> {
    stop_watcher_inner(&runtime);
    log(&runtime, &app, "info", "[Watcher] Stopped");
    emit_snapshot(&runtime, &app);
    get_app_snapshot(runtime)
}

#[tauri::command]
fn clear_history(
    app: tauri::AppHandle,
    runtime: State<'_, SharedRuntime>,
) -> Result<AppSnapshot, String> {
    {
        let mut rt = runtime
            .lock()
            .map_err(|_| "Application state unavailable")?;
        rt.storage.remove("history.json")?;
        rt.snapshot.recent_results.clear();
        rt.snapshot.latest_result = None;
        rt.snapshot.last_update = None;
        rt.snapshot.detected_game_type = None;

    }

    log(&runtime, &app, "info", "[History] Race history cleared");
    emit_snapshot(&runtime, &app);
    get_app_snapshot(runtime)
}

#[tauri::command]
fn clear_cycle_history(app: tauri::AppHandle, runtime: State<'_, SharedRuntime>) -> Result<AppSnapshot, String> {
    {
        let mut rt = runtime.lock().map_err(|_| "Application state unavailable")?;
        let mut next = rt.race_state.clone();
        next.cycle_history.clear();
        rt.storage.write("race-state.json", &next)?;
        rt.race_state = next;
        rt.snapshot.cycle_history.clear();
    }
    log(&runtime, &app, "info", "[History] Cycle history cleared");
    emit_snapshot(&runtime, &app);
    get_app_snapshot(runtime)
}

fn clear_session_results(snapshot: &mut AppSnapshot) {
        snapshot.latest_result = None;
        snapshot.session_results.clear();
        snapshot.session = SessionSummary::default();
        snapshot.last_update = None;
        snapshot.detected_game_type = None;
}

fn reset_stats_totals(state: &mut RaceState) {
    state.total_race_count = 0;
    state.total_battle_royale_count = 0;
    state.season_points_earned = 0;
    state.game_points.clear();
    state.processed_ids.clear();
}

fn reset_cycle_totals(state: &mut RaceState) {
    state.race_cycles.clear();
    state.total_cycle_race_count = 0;
    state.cycle_last_update = None;
    state.cycle_processed_ids.clear();
}

#[tauri::command]
fn clear_race_results(app: tauri::AppHandle, runtime: State<'_, SharedRuntime>) -> Result<AppSnapshot, String> {
    {
        let mut rt = runtime.lock().map_err(|_| "Application state unavailable")?;
        let mut next = rt.race_state.clone();
        reset_stats_totals(&mut next);
        rt.storage.write("race-state.json", &next)?;
        rt.race_state = next;
        rt.snapshot.season_points_earned = 0;
        rt.snapshot.total_race_count = 0;
        rt.snapshot.total_battle_royale_count = 0;
        clear_session_results(&mut rt.snapshot);
        rt.overlay_writer.invalidate();
    }

    log(&runtime, &app, "info", "[RaceStats] Results and current session cleared");
    emit_snapshot(&runtime, &app);
    get_app_snapshot(runtime)
}

#[tauri::command]
fn clear_race_cycles(
    app: tauri::AppHandle,
    runtime: State<'_, SharedRuntime>,
) -> Result<AppSnapshot, String> {
    {
        let mut rt = runtime
            .lock()
            .map_err(|_| "Application state unavailable")?;
        let mut next = rt.race_state.clone();
        reset_cycle_totals(&mut next);
        rt.storage.write("race-state.json", &next)?;
        rt.race_state = next;
        rt.snapshot.race_cycles.clear();
        rt.snapshot.total_cycle_race_count = 0;
        rt.snapshot.cycle_last_update = None;
        rt.overlay_writer.invalidate();
    }
    log(
        &runtime,
        &app,
        "info",
        "[RaceCycles] Placement history reset for a new season",
    );
    emit_snapshot(&runtime, &app);
    get_app_snapshot(runtime)
}

fn start_connection_checks(runtime: &SharedRuntime, app: &tauri::AppHandle) {
    let shared = runtime.clone();
    let app = app.clone();
    thread::spawn(move || loop {
        let config = match shared.lock() {
            Ok(rt) if rt.connection_checks_stopped => return,
            Ok(rt) => rt.snapshot.config.streamer_bot.clone(),
            Err(_) => return,
        };
        if config.has_enabled_events() {
            let result = streamer_bot::test_connection(&config);
            let (status, message) = match result {
                Ok(()) => ("Connected", "Connection check succeeded".to_string()),
                Err(error) => ("Unavailable", format!("{error}; retrying in 30 seconds")),
            };
            // Discard an in-flight check if the user changed connection settings.
            let changed = match shared.lock() {
                Ok(mut rt) => {
                    let current = &rt.snapshot.config.streamer_bot;
                    if rt.connection_checks_stopped { return; }
                    if !current.has_enabled_events() || current.host != config.host || current.port != config.port {
                        false
                    } else {
                        let changed = rt.snapshot.streamer_bot_status != status
                            || rt.snapshot.streamer_bot_message.as_deref() != Some(message.as_str());
                        rt.snapshot.streamer_bot_status = status.into();
                        rt.snapshot.streamer_bot_message = Some(message.clone());
                        changed
                    }
                }
                Err(_) => return,
            };
            if changed {
                log(&shared, &app, if status == "Connected" { "info" } else { "warning" }, format!("[Streamer.bot] {message}"));
                emit_snapshot(&shared, &app);
            }
        }
        thread::sleep(Duration::from_secs(30));
    });
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let runtime = Arc::new(Mutex::new(
                initial_runtime(app.handle()).map_err(std::io::Error::other)?,
            ));
            let start_minimized = runtime.lock().map_err(|_| std::io::Error::other("Runtime lock poisoned"))?.snapshot.config.start_minimized;
            if start_minimized {
                if let Some(window) = app.get_webview_window("main") {
                    window.minimize()?;
                }
            }
            app.manage(runtime.clone());
            emit_snapshot(&runtime, app.handle());
            start_connection_checks(&runtime, app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_app_snapshot,
            save_seasons,
            export_data,
            reread_last_file,
            save_config,
            open_twitch_authorization,
            complete_twitch_oauth,
            validate_twitch_session,
            disconnect_twitch,
            test_twitch_message,
            test_streamer_bot_connection,
            get_overlay_directory,
            test_overlay,
            test_streamer_bot_action,
            set_tracking_enabled,
            start_watcher,
            stop_watcher,
            clear_history,
            clear_cycle_history,
            clear_race_results,
            clear_race_cycles
        ])
        .on_window_event(|window, event| {
            if window.label() == "main" && matches!(event, tauri::WindowEvent::Destroyed) {
                let runtime = window.state::<SharedRuntime>();
                if let Ok(mut rt) = runtime.lock() { rt.connection_checks_stopped = true; }
                stop_watcher_inner(&runtime);
                window.app_handle().exit(0);
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Marbles Stats");
}

#[cfg(test)]
mod pipeline_tests {
    use super::*;
    use std::collections::HashMap;

    fn result(name: &str, placement: u32, season_points_earned: i64) -> PlayerResult {
        PlayerResult {
            player_name: name.into(),
            username: name.into(),
            display_name: name.into(),
            platform: "Twitch".into(),
            name_color_hex: Some("FFFFFFFF".into()),
            placement,
            season_points_earned,
            season_points_total: None,
            season_wins_total: None,
            season_matches_played_total: None,
            finish_time: None,
            eliminated: Some(false),
            raw_data: HashMap::new(),
        }
    }

    fn test_snapshot() -> AppSnapshot {
        let config = AppConfig::default_for("race.csv".into());
        AppSnapshot {
            cycle_history: vec![],
            total_race_count: 0,
            total_battle_royale_count: 0,
            season_points_earned: 0,
            total_cycle_race_count: 0,
            session_results: vec![],
            config,
            watcher_status: "Stopped".into(),
            stats_tracking_enabled: false,
            cycles_tracking_enabled: false,
            watcher_message: None,
            detected_game_type: None,
            last_update: None,
            cycle_last_update: None,
            latest_result: None,
            streamer_bot_status: "Disabled".into(),
            streamer_bot_message: None,
            twitch_status: "Disconnected".into(),
            twitch_message: None,
            twitch_username: None,
            session: SessionSummary::default(),
            recent_results: vec![],
            race_cycles: vec![],
            logs: vec![],
        }
    }

    #[test]
    fn session_stats_and_duplicate_check_work_in_memory() {
        let mut snapshot = test_snapshot();
        let game = GameResult {
            id: "stable-id".into(),
            source_snapshot_id: Some("snapshot".into()),
            timestamp: "2026-01-01T00:00:00Z".into(),
            game_type: GameType::Race,
            player_count: 2,
            results: vec![result("Winner", 1, 10), result("Runner", 2, 8)],
            has_world_record: false,
            world_record_player: None,
            world_record_time: None,
            map_name: None,
        };
        assert!(!is_duplicate(&snapshot.recent_results, &game));
        record_session_race(&mut snapshot);
        snapshot.recent_results.push(game.clone());
        assert!(is_duplicate(&snapshot.recent_results, &game));
        let mut same_snapshot = game.clone();
        same_snapshot.id = "different-content-fingerprint".into();
        assert!(is_duplicate(&snapshot.recent_results, &same_snapshot));
        assert_eq!(snapshot.session.games_played, 1);

        let podium = streamer_bot::podium_args(&game);
        assert_eq!(podium["firstName"], "Winner");
        assert_eq!(podium["firstPoints"], 10);
    }

    #[test]
    fn exports_full_session_and_clears_only_session_results() {
        let mut snapshot = test_snapshot();
        snapshot.config.seasons.race_name = "Autumn races".into();
        snapshot.config.seasons.cycle_name = "Autumn cycles".into();
        let game = GameResult {
            id: "first-race".into(), source_snapshot_id: Some("first-source".into()),
            timestamp: "2026-10-04T20:00:00Z".into(), game_type: GameType::Race,
            player_count: 2, results: vec![result("Winner", 1, 10), result("Second", 2, 8)],
            has_world_record: false, world_record_player: None, world_record_time: None, map_name: None,
        };
        let mut second = game.clone();
        second.id = "second-race".into();
        snapshot.latest_result = Some(second.clone());
        snapshot.session_results = vec![game.clone(), second];
        snapshot.session.games_played = 2;
        snapshot.recent_results = vec![game.clone()];
        snapshot.total_race_count = 10;
        update_race_cycles(&mut snapshot.race_cycles, &game);

        let (_, race) = prepare_export(&snapshot, "race").unwrap();
        assert_eq!(race["game"]["id"], "second-race");
        let (_, session) = prepare_export(&snapshot, "session").unwrap();
        assert_eq!(session["games"].as_array().unwrap().len(), 2);
        assert_eq!(session["games"][0]["results"].as_array().unwrap().len(), 2);
        assert_eq!(session["seasonName"], "Autumn races");
        let (_, cycles) = prepare_export(&snapshot, "cycles").unwrap();
        assert_eq!(cycles["players"].as_array().unwrap().len(), snapshot.race_cycles.len());
        assert_eq!(cycles["seasonName"], "Autumn cycles");

        clear_session_results(&mut snapshot);
        assert!(snapshot.latest_result.is_none());
        assert!(snapshot.session_results.is_empty());
        assert_eq!(snapshot.session.games_played, 0);
        assert_eq!(snapshot.total_race_count, 10);
        assert_eq!(snapshot.recent_results.len(), 1);
        assert!(!snapshot.race_cycles.is_empty());
        assert!(prepare_export(&snapshot, "race").is_err());
    }

    #[test]
    fn stopped_pipelines_do_not_count_and_resuming_deduplicates_independently() {
        let game = GameResult {
            id: "tracking-race".into(), source_snapshot_id: Some("tracking-snapshot".into()),
            timestamp: "2026-01-01T00:00:00Z".into(), game_type: GameType::Race,
            player_count: 1, results: vec![result("Racer", 1, 10)],
            has_world_record: false, world_record_player: None, world_record_time: None, map_name: None,
        };
        let initial = RaceState::default();
        assert!(prepare_race_commit(&initial, &game, false, false, "first", ReadReason::Manual).is_none());
        let (cycles_only, stats_new, _) = prepare_race_commit(&initial, &game, false, true, "first", ReadReason::Manual).unwrap();
        assert!(!stats_new);
        assert_eq!(cycles_only.total_race_count, 0);
        assert!(cycles_only.processed_ids.is_empty());
        assert_eq!(cycles_only.race_cycles[0].placement_counts[0], 1);
        assert_eq!(cycles_only.cycle_last_update.as_deref(), Some("first"));
        let (both, stats_new, _) = prepare_race_commit(&cycles_only, &game, true, true, "second", ReadReason::Manual).unwrap();
        assert!(stats_new);
        assert_eq!(both.total_race_count, 1);
        assert_eq!(both.race_cycles[0].placement_counts[0], 1);
        assert_eq!(both.cycle_last_update.as_deref(), Some("first"));
        let restored: RaceState = serde_json::from_str(&serde_json::to_string(&both).unwrap()).unwrap();
        assert!(prepare_race_commit(&restored, &game, true, true, "third", ReadReason::Manual).is_none());
        let (stats_only, _, _) = prepare_race_commit(&initial, &game, true, false, "first", ReadReason::Manual).unwrap();
        assert!(stats_only.race_cycles.is_empty());
        assert!(stats_only.cycle_processed_ids.is_empty());
        let (cycles_resumed, stats_new, _) = prepare_race_commit(&stats_only, &game, true, true, "second", ReadReason::Manual).unwrap();
        assert!(!stats_new);
        assert_eq!(cycles_resumed.total_race_count, 1);
        assert_eq!(cycles_resumed.race_cycles[0].placement_counts[0], 1);
    }

    #[test]
    fn cycle_history_records_races_without_completions() {
        let game = streamer_bot::sample_game();
        let (next, stats_new, completions) = prepare_race_commit(&RaceState::default(), &game, false, true, "processed-at", ReadReason::Manual).unwrap();
        assert!(!stats_new);
        assert!(completions.is_empty());
        assert_eq!(next.cycle_history.len(), 1);
        assert_eq!(next.cycle_history[0].player_count, Some(game.player_count));
        assert_eq!(next.cycle_history[0].winner_name.as_deref(), Some(game.results[0].player_name.as_str()));
        assert!(next.cycle_history[0].completions.is_empty());
        assert!(prepare_race_commit(&next, &game, false, true, "duplicate", ReadReason::Manual).is_none());
    }

    #[test]
    fn watcher_ignores_access_and_metadata_events() {
        use notify::{EventKind, event::{AccessKind, DataChange, MetadataKind, ModifyKind}};
        assert!(!is_content_event(EventKind::Access(AccessKind::Read)));
        assert!(!is_content_event(EventKind::Modify(ModifyKind::Metadata(MetadataKind::Any))));
        assert!(is_content_event(EventKind::Modify(ModifyKind::Data(DataChange::Content))));
    }

    #[test]
    fn cycle_completion_history_persists_and_deduplicates_with_the_race() {
        let game = streamer_bot::sample_game();
        let mut initial = RaceState::default();
        let mut counts = vec![1; 10];
        counts[0] = 0;
        initial.race_cycles.push(RaceCyclePlayer {
            player_key: race_cycle_player_key(&game.results[0]),
            player_name: game.results[0].player_name.clone(), placement_counts: counts, cycles: 0, cycle_race_counts: vec![],
        });
        let (next, stats_new, completions) = prepare_race_commit(&initial, &game, false, true, "completed-at", ReadReason::Manual).unwrap();
        assert!(!stats_new);
        assert_eq!(completions.len(), 1);
        assert_eq!(next.cycle_history.len(), 1);
        assert_eq!(next.cycle_history[0].completions[0].cycle_number, 1);
        assert_eq!(next.cycle_history[0].timestamp, "completed-at");
        assert_eq!(next.cycle_history[0].game_id, game.id);
        let restored: RaceState = serde_json::from_str(&serde_json::to_string(&next).unwrap()).unwrap();
        assert_eq!(restored.cycle_history[0].completions[0].player_name, game.results[0].player_name);
        assert!(prepare_race_commit(&restored, &game, false, true, "reread-at", ReadReason::Manual).is_none());
    }

    #[test]
    fn race_cycles_roll_extra_placements_into_later_cycles() {
        let game_for = |placement| GameResult {
            id: format!("race-{placement}"),
            source_snapshot_id: None,
            timestamp: "2026-01-01T00:00:00Z".into(),
            game_type: GameType::Race,
            player_count: 1,
            results: vec![result("CycleRacer", placement, 0)],
            has_world_record: false,
            world_record_player: None,
            world_record_time: None,
            map_name: None,
        };
        let mut players = Vec::new();
        // Participation outside the top ten still contributes to the cycle duration.
        assert!(update_race_cycles(&mut players, &game_for(11)).is_empty());

        for placement in 1..=9 {
            assert!(update_race_cycles(&mut players, &game_for(placement)).is_empty());
        }
        assert_eq!(
            update_race_cycles(&mut players, &game_for(10)),
            vec![CycleCompletion {
                player_name: "CycleRacer".into(),
                cycle_number: 1,
                races: Some(11),
            }]
        );

        update_race_cycles(&mut players, &game_for(2));
        update_race_cycles(&mut players, &game_for(2));
        for placement in [1, 3, 4, 5, 6, 7, 8, 9] {
            assert!(update_race_cycles(&mut players, &game_for(placement)).is_empty());
        }
        assert_eq!(
            update_race_cycles(&mut players, &game_for(10)),
            vec![CycleCompletion {
                player_name: "CycleRacer".into(),
                cycle_number: 2,
                races: Some(11),
            }]
        );
        assert_eq!(players[0].cycles, 2);
        assert_eq!(players[0].placement_counts[1], 3);
    }
    #[test]
    fn routes_only_confirmed_source_pairs_without_losing_either_mode() {
        let race = PathBuf::from("savegames/LastSeasonRace.csv");
        let royale = race.with_file_name("LastSeasonRoyale.csv");
        let paths = vec![race.clone(), race.with_file_name("LastCustomRaceMapPlayed.csv"),
            race.with_file_name("LastSeasonRaceSummary.csv"),
            royale.clone(), race.with_file_name("LastSeasonRoyaleSummary.csv"),
            race.with_file_name("Other.csv")];
        assert_eq!(changed_result_paths(&paths, &race), vec![race.clone(), royale.clone()]);
        assert_eq!(changed_result_paths(&[race.with_file_name("LastSeasonRoyaleSummary.csv")], &race), vec![royale]);
        assert!(changed_result_paths(&[race.with_file_name("Other.csv")], &race).is_empty());
    }

    #[test]
    fn latest_result_refreshes_when_stats_are_stopped_without_recounting() {
        let mut snapshot = test_snapshot();
        snapshot.cycles_tracking_enabled = true;
        let mut game = GameResult {
            id: "race-preview".into(), source_snapshot_id: None,
            timestamp: "2026-10-05T20:00:00Z".into(), game_type: GameType::Race,
            player_count: 1, results: vec![result("RaceWinner", 1, 10)],
            has_world_record: false, world_record_player: None, world_record_time: None,
            map_name: Some("Race map".into()),
        };
        refresh_latest_result(&mut snapshot, &game);
        game.id = "royale-preview".into();
        game.game_type = GameType::BattleRoyale;
        game.results[0].player_name = "RoyaleWinner".into();
        game.map_name = Some("Royale map".into());
        refresh_latest_result(&mut snapshot, &game);
        refresh_latest_result(&mut snapshot, &game);
        assert_eq!(snapshot.latest_result.as_ref().unwrap().id, "royale-preview");
        assert_eq!(snapshot.detected_game_type, Some(GameType::BattleRoyale));
        assert_eq!(snapshot.session.games_played, 0);
        assert_eq!(snapshot.total_race_count, 0);
        assert!(snapshot.session_results.is_empty());
        assert!(snapshot.recent_results.is_empty());
        assert!(snapshot.race_cycles.is_empty());
    }

    #[test]
    fn battle_royale_totals_are_separate_persisted_and_duplicate_safe() {
        let game = GameResult {
            id: "br-count".into(), source_snapshot_id: Some("br-source".into()),
            timestamp: "2026-10-05T20:00:00Z".into(), game_type: GameType::BattleRoyale,
            player_count: 1, results: vec![result("Winner", 1, 10)],
            has_world_record: false, world_record_player: None, world_record_time: None, map_name: None,
        };
        let (next, _, _) = prepare_race_commit(&RaceState::default(), &game, true, false, "now", ReadReason::Manual).unwrap();
        assert_eq!(next.total_race_count, 0);
        assert_eq!(next.total_battle_royale_count, 1);
        let restored: RaceState = serde_json::from_str(&serde_json::to_string(&next).unwrap()).unwrap();
        assert!(prepare_race_commit(&restored, &game, true, false, "later", ReadReason::Manual).is_none());
        let mut legacy = RaceState { total_race_count: 7, processed_ids: vec![
            "source:royale:first".into(), "source:royale:second".into()], ..RaceState::default() };
        migrate_game_totals(&mut legacy, &[]);
        assert_eq!(legacy.total_race_count, 5);
        assert_eq!(legacy.total_battle_royale_count, 2);
        let mut snapshot = test_snapshot();
        snapshot.total_battle_royale_count = 2;
        snapshot.session_results.push(game);
        snapshot.session.games_played = 1;
        clear_session_results(&mut snapshot);
        assert!(snapshot.session_results.is_empty());
        assert_eq!(snapshot.total_battle_royale_count, 2);
    }

    #[test]
    fn overlapping_cycles_keep_independent_elapsed_match_counts() {
        let mut game = GameResult {
            id: "overlapping".into(), source_snapshot_id: None,
            timestamp: "2026-10-05T20:00:00Z".into(), game_type: GameType::Race,
            player_count: 1, results: vec![result("Player", 1, 0)],
            has_world_record: false, world_record_player: None, world_record_time: None, map_name: None,
        };
        let mut players = Vec::new();
        for _ in 0..3 { assert!(update_race_cycles(&mut players, &game).is_empty()); }
        assert_eq!(players[0].cycle_race_counts, vec![Some(3), Some(2), Some(1)]);
        for (cycle, expected) in [(1, 12), (2, 20), (3, 28)] {
            for placement in 2..=10 {
                game.results[0].placement = placement;
                let completed = update_race_cycles(&mut players, &game);
                if placement == 10 {
                    assert_eq!(completed, vec![CycleCompletion {
                        player_name: "Player".into(), cycle_number: cycle, races: Some(expected),
                    }]);
                } else { assert!(completed.is_empty()); }
            }
            // An application restart must preserve every other in-progress counter.
            players = serde_json::from_str(&serde_json::to_string(&players).unwrap()).unwrap();
        }
        assert!(players[0].cycle_race_counts.is_empty());
        game.results[0].placement = 11;
        assert!(update_race_cycles(&mut players, &game).is_empty());
        assert_eq!(players[0].cycle_race_counts, vec![Some(1)]);
    }

    #[test]
    fn season_points_sum_all_players_and_both_modes_without_duplicates() {
        let mut game = GameResult {
            id: "race-points".into(), source_snapshot_id: Some("race-points-source".into()),
            timestamp: "2026-10-05T20:00:00Z".into(), game_type: GameType::Race,
            player_count: 3, results: vec![result("First", 1, 10), result("Second", 2, 8), result("Third", 3, 0)],
            has_world_record: false, world_record_player: None, world_record_time: None, map_name: None,
        };
        let (race, _, _) = prepare_race_commit(&RaceState::default(), &game, true, false, "now", ReadReason::Manual).unwrap();
        assert_eq!(race.season_points_earned, 18);
        assert!(prepare_race_commit(&race, &game, true, false, "again", ReadReason::Manual).is_none());
        game.id = "br-points".into();
        game.source_snapshot_id = Some("br-points-source".into());
        game.game_type = GameType::BattleRoyale;
        game.results[0].season_points_earned = 7;
        let (both, _, _) = prepare_race_commit(&race, &game, true, false, "next", ReadReason::Manual).unwrap();
        assert_eq!(both.season_points_earned, 33);
        let restored: RaceState = serde_json::from_str(&serde_json::to_string(&both).unwrap()).unwrap();
        assert_eq!(restored.season_points_earned, 33);
        assert!(prepare_race_commit(&restored, &game, true, false, "duplicate", ReadReason::Manual).is_none());
        game.results[0].season_points_earned = 11;
        assert!(prepare_race_commit(&restored, &game, true, false, "auto-br-edit", ReadReason::FileChanged).is_none());
        let (corrected, stats_new, _) = prepare_race_commit(&restored, &game, true, false, "br-edit", ReadReason::Manual).unwrap();
        assert_eq!(corrected.season_points_earned, 37);
        assert_eq!(corrected.total_battle_royale_count, 1);
        assert!(!stats_new);
        let (cycles_only, _, _) = prepare_race_commit(&RaceState::default(), &game, false, true, "cycles", ReadReason::Manual).unwrap();
        assert_eq!(cycles_only.season_points_earned, 0);
    }

    #[test]
    fn edited_match_points_update_without_recounting_or_replaying_cycles() {
        let mut game = GameResult {
            id: "points-edit".into(), source_snapshot_id: Some("same-match".into()),
            timestamp: "2026-10-05T20:00:00Z".into(), game_type: GameType::Race,
            player_count: 1, results: vec![result("Winner", 1, 0)],
            has_world_record: false, world_record_player: None, world_record_time: None, map_name: None,
        };
        let (initial, _, _) = prepare_race_commit(&RaceState::default(), &game, true, true, "first", ReadReason::Manual).unwrap();
        game.results[0].season_points_earned = 112;
        game.id = "changed-fingerprint-same-snapshot".into();
        assert!(prepare_race_commit(&initial, &game, true, true, "auto-edit", ReadReason::FileChanged).is_none());
        let (updated, stats_new, completions) = prepare_race_commit(&initial, &game, true, true, "edit", ReadReason::Manual).unwrap();
        assert_eq!(updated.season_points_earned, 112);
        assert_eq!(updated.total_race_count, 1);
        assert_eq!(updated.race_cycles[0].placement_counts, initial.race_cycles[0].placement_counts);
        assert!(!stats_new);
        assert!(completions.is_empty());
        let restored: RaceState = serde_json::from_str(&serde_json::to_string(&updated).unwrap()).unwrap();
        assert!(prepare_race_commit(&restored, &game, true, true, "duplicate", ReadReason::Manual).is_none());
        game.results[0].season_points_earned = 14;
        let (reduced, _, _) = prepare_race_commit(&restored, &game, true, true, "corrected", ReadReason::Manual).unwrap();
        assert_eq!(reduced.season_points_earned, 14);
        let mut session = vec![game.clone()];
        game.results[0].season_points_earned = 20;
        refresh_counted_result(&mut session, &game);
        assert_eq!(session.len(), 1);
        assert_eq!(game_points_earned(&session[0]), 20);
        let mut reset = reduced;
        reset.season_points_earned = 0;
        reset.game_points.values_mut().for_each(|points| *points = None);
        assert!(prepare_race_commit(&reset, &game, true, true, "after-reset", ReadReason::Manual).is_none());
    }

    #[test]
    fn resets_clear_totals_and_allow_reprocessing_once() {
        let mut game = streamer_bot::sample_game();
        let (mut state, _, _) = prepare_race_commit(&RaceState::default(), &game, true, true, "first", ReadReason::Manual).unwrap();
        assert_eq!(tracked_cycle_races(&state), 1);
        reset_stats_totals(&mut state);
        assert_eq!(state.total_race_count, 0);
        assert_eq!(state.total_battle_royale_count, 0);
        assert_eq!(state.season_points_earned, 0);
        assert_eq!(tracked_cycle_races(&state), 1);
        reset_cycle_totals(&mut state);
        assert!(state.race_cycles.is_empty());
        assert!(state.cycle_last_update.is_none());
        assert_eq!(tracked_cycle_races(&state), 0);
        let restored: RaceState = serde_json::from_str(&serde_json::to_string(&state).unwrap()).unwrap();
        let (reprocessed, stats_new, _) = prepare_race_commit(&restored, &game, true, true, "reprocess", ReadReason::Manual).unwrap();
        assert!(stats_new);
        assert_eq!(tracked_cycle_races(&reprocessed), 1);
        assert_eq!(reprocessed.total_race_count, 1);
        assert!(!reprocessed.race_cycles.is_empty());
        assert!(prepare_race_commit(&reprocessed, &game, true, true, "reprocess-again", ReadReason::Manual).is_none());
        game.id = "new-after-reset".into();
        game.source_snapshot_id = Some("new-after-reset".into());
        let (next, stats_new, _) = prepare_race_commit(&restored, &game, true, true, "new-file", ReadReason::Manual).unwrap();
        assert!(stats_new);
        assert_eq!(next.total_race_count, 1);
        assert_eq!(tracked_cycle_races(&next), 1);
        assert_eq!(next.season_points_earned, game_points_earned(&game));
    }

    #[test]
    fn cycles_track_unique_players_across_rows_matches_and_saved_duplicates() {
        let mut game = streamer_bot::sample_game();
        game.results = vec![result("Player", 1, 0), result("PLAYER", 2, 0)];
        let mut players = Vec::new();
        update_race_cycles(&mut players, &game);
        assert_eq!(players.len(), 1);
        assert_eq!(players[0].placement_counts.iter().sum::<u64>(), 1);
        game.results = vec![result("player", 2, 0)];
        game.results[0].username = "changed-export-identity".into();
        update_race_cycles(&mut players, &game);
        assert_eq!(players.len(), 1);
        assert_eq!(players[0].placement_counts[0], 1);
        assert_eq!(players[0].placement_counts[1], 1);
        let mut duplicate = players[0].clone();
        duplicate.player_key = " Twitch:PLAYER ".into();
        duplicate.player_name = " PLAYER ".into();
        players.push(duplicate);
        merge_duplicate_cycle_players(&mut players);
        assert_eq!(players.len(), 1);
        assert_eq!(players[0].placement_counts[0], 2);
        game.results[0].player_name = "Other".into();
        game.results[0].display_name = "Other".into();
        game.results[0].username = "other".into();
        update_race_cycles(&mut players, &game);
        assert_eq!(players.len(), 2);
    }

}
