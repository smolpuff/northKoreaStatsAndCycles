mod models;
mod marble_cycle;
mod overlays;
mod parser;
mod promotion;
mod records;
mod storage;
mod streamer_bot;
mod lumia;
mod discord;
mod discord_credentials;
mod discord_integration;
mod twitch;
mod twitch_oauth;
mod twitch_chat;
mod updater;
mod streamdeck;
mod secure_token;

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
    record_tracker: records::Tracker,
    announced_records: Vec<String>,
    discord_tx: Option<mpsc::SyncSender<discord::Delivery>>,
    discord_revision: u64,
}

type SharedRuntime = Arc<Mutex<Runtime>>;
static TRACKING_COMMAND_LOCK: Mutex<()> = Mutex::new(());

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
    discord::upgrade_defaults(&mut config.discord);
    config.csv.game_type = GameType::Auto;
    let twitch_defaults = TwitchConfig::default();
    if config.twitch.message_prefix.is_empty() {
        config.twitch.message_prefix = twitch_defaults.message_prefix;
        config.twitch.post_results = true;
    }
    if config.twitch.cycle_message_template.is_empty() {
        config.twitch.cycle_message_template = twitch_defaults.cycle_message_template;
    }
    let recent_results = if storage.path("history.json").exists() {
        storage.read::<Vec<GameResult>>("history.json")?
    } else { Vec::new() };
    // Read current data as saved. Do not migrate or reconstruct totals from history.
    let race_state = if storage.path("race-state.json").exists() {
        storage.read::<RaceState>("race-state.json")?
    } else { RaceState::default() };
    let race_cycles = cycle_players_for_display(&race_state.race_cycles);
    let streamer_bot_status = if config.streamer_bot.enabled {
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
    let latest_result = restored_current_result(&race_state, &recent_results);
    let record_metadata = parser::parse_map_metadata(&PathBuf::from(&config.csv.path)
        .with_file_name("LastCustomRaceMapPlayed.csv")).ok();
    let record_tracker = records::Tracker::new(record_metadata.as_ref());
    let announced_records = storage.read::<Vec<String>>("world-records.json").unwrap_or_default();
    let data_file_logs = ["config.json", "history.json", "race-state.json", "world-records.json"]
        .iter()
        .filter_map(|name| {
            let bytes = std::fs::metadata(storage.path(name)).ok()?.len();
            let size = if bytes >= 1024 * 1024 {
                format!("{:.2} MiB", bytes as f64 / (1024.0 * 1024.0))
            } else {
                format!("{:.2} KiB", bytes as f64 / 1024.0)
            };
            Some(LogEntry {
                timestamp: Utc::now().to_rfc3339(),
                level: "info".into(),
                message: format!("[Storage] Data file {name}: {size} ({bytes} bytes)"),
            })
        })
        .collect();
    Ok(Runtime {
        discord_tx: None,
        discord_revision: 0,
        overlay_writer: overlays::Writer::new(app_data_dir.join("overlays")),
        race_state: race_state.clone(),
        snapshot: AppSnapshot {
            event_result_ids: current_event_result_ids(&race_state, &recent_results),
            cycle_history: cycle_history_for_ui(&race_state.cycle_history),
            total_race_count: race_state.total_race_count,
            total_battle_royale_count: race_state.total_battle_royale_count,
            season_points_earned: race_state.season_points_earned,
            total_cycle_race_count: tracked_cycle_races(&race_state),
            session_results: vec![],
            discord_status: if config.discord.enabled { "Not checked".into() } else { "Disabled".into() },
            discord_message: None,
            lumia_status: if config.lumia.enabled { "Not checked".into() } else { "Disabled".into() },
            config,
            watcher_status: "Stopped".into(),
            stats_tracking_enabled: false,
            cycles_tracking_enabled: false,
            watcher_message: None,
            detected_game_type: latest_result.as_ref().map(|game| game.game_type.clone()),
            last_update: latest_result.as_ref().map(|game| game.timestamp.clone()),
            cycle_last_update: race_state.cycle_last_update.clone(),
            latest_result,
            streamer_bot_status: streamer_bot_status.into(),
            streamer_bot_message: None,
            lumia_message: None,
            twitch_status,
            twitch_message,
            twitch_username,
            twitch_chat_message: "Chat listener disabled".into(),
            session: SessionSummary::default(),
            recent_results,
            race_cycles,
            logs: data_file_logs,
        },
        storage,
        watcher: None,
        watcher_thread: None,
        stop_tx: None,
        connection_checks_stopped: false,
        processing: Arc::new(Mutex::new(())),
        cached_file: None,
        record_tracker,
        announced_records,
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

// Full historical standings stay in race-state.json, not repeated UI updates.
fn cycle_history_for_ui(history: &[CycleHistoryEntry]) -> Vec<CycleHistoryEntry> {
    history.iter().map(|entry| CycleHistoryEntry {
        standings: vec![], game: entry.game.as_ref().map(game_for_ui), earnings: entry.earnings.clone(),
        timestamp: entry.timestamp.clone(), player_name: entry.player_name.clone(), cycle_number: entry.cycle_number,
        map_name: entry.map_name.clone(), game_id: entry.game_id.clone(), winner_name: entry.winner_name.clone(),
        winning_time: entry.winning_time, player_count: entry.player_count, completions: entry.completions.clone(),
    }).collect()
}

fn game_for_ui(game: &GameResult) -> GameResult {
    let mut result = game.clone();
    // Import provenance is retained in local storage; the UI needs match statistics.
    for player in &mut result.results { player.raw_data.retain(|key, _| !key.starts_with("MarbleCycle") || key == "MarbleCycleRaceNumber"); }
    result
}

fn snapshot_for_ui(source: &AppSnapshot) -> AppSnapshot {
    let mut cycles = cycle_history_for_ui(&source.cycle_history);
    let archived: std::collections::HashSet<&str> = source.recent_results.iter().map(|game| game.id.as_str()).collect();
    for entry in &mut cycles { if archived.contains(entry.game_id.as_str()) { entry.game = None; } }
    AppSnapshot {
        event_result_ids: source.event_result_ids.clone(),
        cycle_history: cycles,
        total_cycle_race_count: source.total_cycle_race_count,
        total_race_count: source.total_race_count,
        total_battle_royale_count: source.total_battle_royale_count,
        season_points_earned: source.season_points_earned,
        session_results: source.session_results.clone(),
        config: source.config.clone(),
        watcher_status: source.watcher_status.clone(),
        stats_tracking_enabled: source.stats_tracking_enabled,
        cycles_tracking_enabled: source.cycles_tracking_enabled,
        watcher_message: source.watcher_message.clone(),
        detected_game_type: source.detected_game_type.clone(),
        last_update: source.last_update.clone(),
        cycle_last_update: source.cycle_last_update.clone(),
        latest_result: source.latest_result.clone(),
        streamer_bot_status: source.streamer_bot_status.clone(),
        streamer_bot_message: source.streamer_bot_message.clone(),
        discord_status: source.discord_status.clone(),
        discord_message: source.discord_message.clone(),
        lumia_status: source.lumia_status.clone(),
        lumia_message: source.lumia_message.clone(),
        twitch_status: source.twitch_status.clone(),
        twitch_message: source.twitch_message.clone(),
        twitch_username: source.twitch_username.clone(),
        twitch_chat_message: source.twitch_chat_message.clone(),
        session: source.session.clone(),
        recent_results: source.recent_results.iter().map(game_for_ui).collect(),
        race_cycles: source.race_cycles.clone(),
        logs: source.logs.clone(),
    }
}

fn emit_snapshot(runtime: &SharedRuntime, app: &tauri::AppHandle) {
    let mut warning = None;
    if let Ok(mut rt) = runtime.lock() {
        let snapshot = snapshot_for_ui(&rt.snapshot);
        let error = rt.overlay_writer.update(&snapshot).err();
        if error != rt.overlay_writer.last_error { warning = error.clone(); }
        rt.overlay_writer.last_error = error;
        let _ = app.emit("app-state", &snapshot);
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

fn current_event_result_ids(state: &RaceState, history: &[GameResult]) -> Vec<String> {
    history.iter().filter(|game| state.game_points.get(&game_points_key(game))
        .is_some_and(|points| points.is_some()))
        .map(|game| game.id.clone()).collect()
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

fn restored_current_result(state: &RaceState, history: &[GameResult]) -> Option<GameResult> {
    if state.stats_results_cleared { return None; }
    state.current_result.clone().or_else(|| history.last().cloned())
}

fn persist_history(runtime: &SharedRuntime) -> Result<(), String> {
    let rt = runtime
        .lock()
        .map_err(|_| "Application state unavailable".to_string())?;
    rt.storage.write("history.json", &rt.snapshot.recent_results)?;
    rt.storage.write("race-state.json", &rt.race_state)
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

fn cycle_placement(game: &GameResult, result: &PlayerResult) -> Option<u32> {
    if game.game_type == GameType::Race {
        return (result.eliminated != Some(true) && (1..=10).contains(&result.placement)).then_some(result.placement);
    }
    (game.game_type == GameType::BattleRoyale && result.placement == 1
        && game.results.first().and_then(|p| p.raw_data.get("MarbleCycleBrWinsAsFirst")).is_some_and(|v| v == "true")).then_some(1)
}

fn earns_cycle_placements(game: &GameResult) -> bool {
    game.game_type == GameType::Race || game.results.iter().any(|result| cycle_placement(game, result).is_some())
}

fn update_race_cycles(
    players: &mut Vec<RaceCyclePlayer>,
    game: &GameResult,
) -> Vec<CycleCompletion> {
    let mut completions = Vec::new();
    if !earns_cycle_placements(game) { return completions; }
    let mut seen_players = std::collections::HashSet::new();

    for result in &game.results {
        if game.game_type == GameType::BattleRoyale && cycle_placement(game, result).is_none() { continue; }
        let key = race_cycle_player_key(result);
        let player_index = players
            .iter()
            .position(|player| same_cycle_player(player, &key, &result.player_name))
            .unwrap_or_else(|| {
                players.push(RaceCyclePlayer {
                    total_races: 0, total_races_complete: true,
                    player_key: key,
                    player_name: result.player_name.clone(),
                    placement_counts: vec![0; 10],
                    cycles: 0,
                    current_cycle_positions: Some(Vec::new()),
                    cycle_race_counts: vec![Some(0)],
                });
                players.len() - 1
            });
        if !seen_players.insert(player_index) { continue; }
        let player = &mut players[player_index];
        if !player.total_races_complete { player.total_races = player.total_races.max(player.placement_counts.iter().sum()); }
        if game.game_type == GameType::Race { player.total_races += 1; }
        player.player_name = if result.display_name.trim().is_empty() {
            result.player_name.clone()
        } else {
            result.display_name.clone()
        };
        player.placement_counts.resize(10, 0);
        // Counts are lifetime placements for these current results. Each full layer
        // of positions 1-10 earns a cycle; surplus slots carry into later layers.
        let before = player.placement_counts.iter().copied().min().unwrap_or(0);
        let pending = player.placement_counts.iter().copied().max().unwrap_or(0)
            .saturating_sub(before) as usize;
        player.cycle_race_counts.resize(pending.max(1), None);
        if game.game_type == GameType::Race { for count in player.cycle_race_counts.iter_mut().flatten() { *count += 1; } }
        let Some(placement) = cycle_placement(game, result) else { continue; };
        player.placement_counts[placement as usize - 1] += 1;
        player.cycles = player.placement_counts.iter().copied().min().unwrap_or(0);
        player.current_cycle_positions = Some(player.current_positions());
        if player.cycles > before {
            let races = player.cycle_race_counts.remove(0);
            completions.push(CycleCompletion {
                player_name: player.player_name.clone(), cycle_number: player.cycles, races,
            });
        }
        let remaining = player.placement_counts.iter().copied().max().unwrap_or(0)
            .saturating_sub(player.cycles) as usize;
        if remaining == 0 { player.cycle_race_counts = vec![Some(0)]; }
        else { player.cycle_race_counts.resize(remaining, Some(1)); }
    }

    players.sort_by(models::compare_cycle_players);
    completions
}

fn cycle_players_for_display(players: &[RaceCyclePlayer]) -> Vec<RaceCyclePlayer> {
    players.iter().cloned().map(|mut player| {
        player.cycles = player.completed_cycles();
        player.current_cycle_positions = Some(player.current_positions());
        player
    }).collect()
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
            log(&runtime, &app, "info", format!("[Twitch] Results posted ({message_count} chat messages)"));
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
    if completions.is_empty() || !runtime.lock().map(|rt| rt.snapshot.cycles_tracking_enabled && rt.snapshot.config.twitch.post_cycle_results).unwrap_or(false) {
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
        Ok(rt) => snapshot_for_ui(&rt.snapshot),
        Err(_) => return,
    };
    let config = snapshot.config.streamer_bot.clone();
    if !config.enabled {
        set_streamer_bot_status(runtime, "Disabled", None);
        emit_snapshot(runtime, app);
        return;
    }
    let actions = streamer_bot::prepared_events(&config, &snapshot, game, completions, stats_new);
    if actions.is_empty() { return; }
    let mut failed = false;
    for (action, args) in actions {
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

fn set_lumia_status(runtime: &SharedRuntime, status: &str, message: Option<String>) {
    if let Ok(mut rt) = runtime.lock() { rt.snapshot.lumia_status = status.into(); rt.snapshot.lumia_message = message; }
}
fn deliver_lumia(runtime: &SharedRuntime, app: &tauri::AppHandle, config: &LumiaConfig, command: &str, args: serde_json::Value) -> bool {
    match lumia::trigger_command(config, command, args) {
        Ok(()) => { log(runtime, app, "info", format!("[Lumia] {command} accepted")); true }
        Err(error) => {
            set_lumia_status(runtime, "Unavailable", Some(error.clone()));
            log(runtime, app, "warning", format!("[Lumia] {error}")); false
        }
    }
}
fn send_lumia_events(runtime: &SharedRuntime, app: &tauri::AppHandle, game: &GameResult, completions: &[CycleCompletion], stats_new: bool) {
    let snapshot = match runtime.lock() { Ok(rt) => snapshot_for_ui(&rt.snapshot), Err(_) => return };
    let config = &snapshot.config.lumia;
    if !config.enabled { return; }
    let actions = streamer_bot::prepared_events(&config.event_config(), &snapshot, game, completions, stats_new);
    if actions.is_empty() { return; }
    let mut failed = false;
    for (command, args) in actions {
        if !deliver_lumia(runtime, app, config, &command, args) { failed = true; }
    }
    if !failed { set_lumia_status(runtime, "Connected", None); }
    emit_snapshot(runtime, app);
}

#[tauri::command]
async fn save_lumia_token(app: tauri::AppHandle, runtime: State<'_, SharedRuntime>, config: LumiaConfig, token: String) -> Result<AppSnapshot, String> {
    let runtime = runtime.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        lumia::validate_token(&config, &token)?;
        lumia::save_credential(&token.trim().to_string())?;
        set_lumia_status(&runtime, "Not checked", Some("API token saved securely. Save settings, then test the connection.".into()));
        emit_snapshot(&runtime, &app);
        let snapshot = runtime.lock().map(|rt| snapshot_for_ui(&rt.snapshot)).map_err(|_| "Application state unavailable".into());
        snapshot
    }).await.map_err(|_| "Lumia request worker failed".to_string())?
}
#[tauri::command]
fn remove_lumia_token(app: tauri::AppHandle, runtime: State<'_, SharedRuntime>) -> Result<AppSnapshot, String> {
    // Disable delivery before deleting the credential, preserving it if config persistence fails.
    {
        let mut rt = runtime.lock().map_err(|_| "Application state unavailable")?;
        let mut config = rt.snapshot.config.clone(); config.lumia.enabled = false;
        rt.storage.write("config.json", &config)?; rt.snapshot.config = config;
    }
    lumia::delete_credential()?;
    set_lumia_status(&runtime, "Disabled", Some("API token removed".into()));
    emit_snapshot(&runtime, &app);
    runtime.lock().map(|rt| snapshot_for_ui(&rt.snapshot)).map_err(|_| "Application state unavailable".into())
}
#[tauri::command]
async fn test_lumia(app: tauri::AppHandle, runtime: State<'_, SharedRuntime>, config: LumiaConfig, kind: String) -> Result<AppSnapshot, String> {
    let runtime = runtime.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let result = if kind == "connection" { lumia::test_connection(&config) } else {
            let (command, args) = match kind.as_str() {
                "gameComplete" => (&config.actions.game_complete, streamer_bot::test_args("gameComplete")),
                "worldRecord" => (&config.actions.world_record, streamer_bot::test_args("worldRecord")),
                "cycleComplete" => (&config.actions.cycle_complete, streamer_bot::test_args("cycleComplete")),
                _ => return Err("Unknown Lumia test event".into()),
            };
            lumia::trigger_command(&config, command, args)
        };
        match result {
            Ok(()) => {
                set_lumia_status(&runtime, "Connected", Some("API request accepted".into()));
                log(&runtime, &app, "info", "[Lumia] Test request accepted");
                emit_snapshot(&runtime, &app);
                let snapshot = runtime.lock().map(|rt| snapshot_for_ui(&rt.snapshot)).map_err(|_| "Application state unavailable".into());
                snapshot
            }
            Err(error) => {
                set_lumia_status(&runtime, "Error", Some(error.clone()));
                log(&runtime, &app, "warning", format!("[Lumia] {error}"));
                emit_snapshot(&runtime, &app); Err(error)
            }
        }
    }).await.map_err(|_| "Lumia request worker failed".to_string())?
}
fn start_lumia_checks(runtime: &SharedRuntime, app: &tauri::AppHandle) {
    let shared = runtime.clone(); let app = app.clone();
    thread::spawn(move || loop {
        let config = match shared.lock() {
            Ok(rt) if rt.connection_checks_stopped => return,
            Ok(rt) => rt.snapshot.config.lumia.clone(), Err(_) => return,
        };
        if config.enabled {
            let (status, message) = match lumia::test_connection(&config) {
                Ok(()) => ("Connected", "Connection check succeeded".to_string()),
                Err(error) => ("Unavailable", format!("{error}; retrying in 30 seconds")),
            };
            let changed = match shared.lock() {
                Ok(mut rt) => {
                    if rt.connection_checks_stopped { return; }
                    if !rt.snapshot.config.lumia.enabled || rt.snapshot.config.lumia.port != config.port { false }
                    else {
                        let changed = rt.snapshot.lumia_status != status || rt.snapshot.lumia_message.as_deref() != Some(message.as_str());
                        rt.snapshot.lumia_status = status.into(); rt.snapshot.lumia_message = Some(message.clone()); changed
                    }
                }, Err(_) => return,
            };
            if changed {
                log(&shared, &app, if status == "Connected" { "info" } else { "warning" }, format!("[Lumia] {message}"));
                emit_snapshot(&shared, &app);
            }
        }
        thread::sleep(Duration::from_secs(30));
    });
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
    let race_summary = race.with_file_name("LastSeasonRaceSummary.csv");
    let royale_summary = race.with_file_name("LastSeasonRoyaleSummary.csv");
    let mut changed = Vec::new();
    for path in paths {
        let result = if same_watch_target(path, race) || same_watch_target(path, &race_summary) {
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
    process_file_inner(runtime, app, path, ReadReason::FileChanged, None);
}

// Record writes are independent of result writes: enrich the saved match and send
// only the WR event, never replay race/cycle events or increment any counters.
fn check_world_record(runtime: &SharedRuntime, app: &tauri::AppHandle, race_path: &Path) {
    let processing = match runtime.lock() { Ok(rt) => rt.processing.clone(), Err(_) => return };
    let _guard = match processing.lock() { Ok(guard) => guard, Err(_) => return };
    let path = race_path.with_file_name("LastCustomRaceMapPlayed.csv");
    if !path.exists() { return; }
    let metadata = match stable_file(&path).and_then(|_| parser::parse_map_metadata(&path)) {
        Ok(metadata) => metadata,
        Err(_) => return, // Blank/partly written metadata cannot confirm a WR.
    };
    let stamp = match file_stamp(&path) { Some(stamp) => stamp, None => return };
    let description = format!("[Parser] Parsed LastCustomRaceMapPlayed.csv: {} on {}, {}s",
        metadata.record_holder_name.as_deref().unwrap_or("no record holder"), metadata.map_name,
        metadata.record_time.map(|time| format!("{time:.3}")).unwrap_or_else(|| "unknown".into()));
    let changed = match runtime.lock() {
        Ok(mut rt) => rt.record_tracker.observe(metadata, stamp.modified),
        Err(_) => return,
    };
    if changed { log(runtime, app, "info", description); }
    let confirmed = {
        let mut rt = match runtime.lock() { Ok(rt) => rt, Err(_) => return };
        if !rt.snapshot.stats_tracking_enabled {
            drop(rt);
            if changed { log(runtime, app, "info", "[World Record] Not checked: RaceStats is stopped"); }
            return;
        }
        let mut game = match rt.snapshot.latest_result.clone() { Some(game) => game, None => return };
        // Only a result accepted by RaceStats can claim a record, including a
        // result saved before this delayed metadata event arrived.
        if is_cycle_test_snapshot(&game) || !game_keys(&game).iter().any(|key|
            rt.race_state.processed_ids.contains(key)) {
            drop(rt);
            if changed { log(runtime, app, "info", "[World Record] Waiting for the matching result to be accepted by RaceStats"); }
            return;
        }
        let (key, record) = match rt.record_tracker.matching_record(&game) {
            Some(record) => record,
            None => {
                drop(rt);
                if changed { log(runtime, app, "info", "[World Record] Metadata changed; waiting for matching map, winner and result time"); }
                return;
            }
        };
        if rt.announced_records.contains(&key) { rt.record_tracker.consume(); return; }
        let mut announced = rt.announced_records.clone();
        announced.push(key);
        if let Err(error) = rt.storage.write("world-records.json", &announced) {
            drop(rt);
            log(runtime, app, "warning", format!("[World Record] Unable to save duplicate protection: {error}"));
            return;
        }
        rt.announced_records = announced;
        rt.record_tracker.consume();
        game.has_world_record = true;
        game.world_record_player = record.record_holder_name;
        game.world_record_time = record.record_time;
        refresh_latest_result(&mut rt.snapshot, &game);
        refresh_counted_result(&mut rt.snapshot.recent_results, &game);
        refresh_counted_result(&mut rt.snapshot.session_results, &game);
        rt.race_state.current_result = Some(game.clone());
        let snapshot = snapshot_for_ui(&rt.snapshot);
        if let Err(error) = rt.overlay_writer.alerts(&snapshot, &game, serde_json::json!([]), true) {
            drop(rt);
            log(runtime, app, "warning", format!("[Overlay] Unable to show WR alert: {error}"));
        }
        game
    };
    log(runtime, app, "info", format!("[World Record] Confirmed {} on {}",
        confirmed.world_record_player.as_deref().unwrap_or(""), confirmed.map_name.as_deref().unwrap_or("")));
    if let Err(error) = persist_history(runtime) { log(runtime, app, "warning", format!("[History] Unable to save WR: {error}")); }
    emit_snapshot(runtime, app);
    let snapshot = match runtime.lock() { Ok(rt) => snapshot_for_ui(&rt.snapshot), Err(_) => return };
    let config = snapshot.config.streamer_bot;
    if config.enabled && config.events.world_record {
        let current = match runtime.lock() { Ok(rt) => snapshot_for_ui(&rt.snapshot), Err(_) => return };
        let args = streamer_bot::confirmed_record_args(&current, &confirmed);
        match streamer_bot::trigger_action(&config, &config.actions.world_record, args) {
            Ok(()) => log(runtime, app, "info", format!("[Streamer.bot] Triggered {}", config.actions.world_record)),
            Err(error) => {
                set_streamer_bot_status(runtime, "Unavailable", Some(error.clone()));
                log(runtime, app, "warning", format!("[Streamer.bot] WR action unavailable: {error}"));
            }
        }
    }
    let current = match runtime.lock() { Ok(rt) => snapshot_for_ui(&rt.snapshot), Err(_) => return };
    if current.config.lumia.enabled && current.config.lumia.events.world_record {
        let args = streamer_bot::confirmed_record_args(&current, &confirmed);
        if deliver_lumia(runtime, app, &current.config.lumia, &current.config.lumia.actions.world_record, args) {
            set_lumia_status(runtime, "Connected", None);
        }
        emit_snapshot(runtime, app);
    }
    discord_integration::confirmed_record(runtime, app, &confirmed);
    send_twitch_world_record(runtime, app, confirmed);
}

// Explicit marker used only by Test-Cycle.ps1; normal game snapshots use UUIDs.
fn is_cycle_test_snapshot(game: &GameResult) -> bool {
    game.game_type == GameType::Race
        && game.source_snapshot_id.as_deref().is_some_and(|id| id.starts_with("cycle-test:"))
        && game.map_name.as_deref() == Some("Cycle Test Track")
        && game.results.iter().all(|player| player.season_points_earned == 0)
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

fn prepare_race_commit(
    current: &RaceState, game: &GameResult, stats_enabled: bool, cycles_enabled: bool, timestamp: &str, reason: ReadReason,
) -> Option<(RaceState, bool, Vec<CycleCompletion>)> {
    let stats_enabled = stats_enabled && !is_cycle_test_snapshot(game);
    let keys = game_keys(game);
    let stats_new = stats_enabled && !keys.iter().any(|key| current.processed_ids.contains(key));
    let cycles_new = cycles_enabled && earns_cycle_placements(game) && !keys.iter().any(|key| current.cycle_processed_ids.contains(key));
    let points_key = game_points_key(game);
    let points = game_points_earned(game);
    let previous_points = current.game_points.get(&points_key).copied().flatten();
    let points_changed = stats_enabled && reason == ReadReason::Manual && !stats_new
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
        if game.game_type == GameType::Race { next.total_cycle_race_count += 1; }
        next.cycle_processed_ids.extend(keys);
        next.cycle_last_update = Some(timestamp.into());
        update_race_cycles(&mut next.race_cycles, game)
    } else { vec![] };
    if cycles_new {
        let mut earnings = Vec::new();
        let mut seen = std::collections::HashSet::new();
        for result in &game.results {
            let key = race_cycle_player_key(result);
            if let Some(player) = next.race_cycles.iter().find(|player| same_cycle_player(player, &key, &result.player_name)) {
                if !seen.insert(player.player_key.clone()) || cycle_placement(game, result).is_none() { continue; }
                let previous_cycles = current.race_cycles.iter()
                    .find(|previous| same_cycle_player(previous, &key, &result.player_name))
                    .map(|previous| (0..10).map(|index| previous.placement_counts.get(index).copied().unwrap_or(0)).min().unwrap_or(0))
                    .unwrap_or(0);
                earnings.push(CycleHistoryEarning {
                    player_key: player.player_key.clone(), player_name: player.player_name.clone(),
                    placement: result.placement, points_earned: 1,
                    cycles_earned: player.cycles.saturating_sub(previous_cycles),
                    cycle_number: player.cycles, placement_counts: player.placement_counts.clone(),
                });
            }
        }
        if !earnings.is_empty() && !next.cycle_history.iter().any(|entry|
            entry.game_id == game.id || entry.game.as_ref().is_some_and(|previous|
                game_keys(previous).iter().any(|key| game_keys(game).contains(key)))) {
            let winner = game.results.iter().find(|result| result.placement == 1);
            next.cycle_history.push(CycleHistoryEntry {
                standings: cycle_players_for_display(&next.race_cycles), game: Some(game.clone()), earnings,
                timestamp: game.timestamp.clone(), player_name: String::new(), cycle_number: 0,
                map_name: game.map_name.clone(), game_id: game.id.clone(),
                winner_name: winner.map(|result| result.player_name.clone()),
                winning_time: winner.and_then(|result| result.finish_time),
                player_count: Some(game.player_count),
                completions: cycle_completions.iter().map(|completion| CycleHistoryCompletion {
                    player_name: completion.player_name.clone(), cycle_number: completion.cycle_number,
                }).collect(),
            });
        }
    }
    if stats_enabled {
        next.current_result = Some(game.clone());
        next.stats_results_cleared = false;
    }
    Some((next, stats_new, cycle_completions))
}

fn process_file_inner(runtime: &SharedRuntime, app: &tauri::AppHandle, path: &Path, reason: ReadReason, manual_target: Option<bool>) {
    let processing = match runtime.lock() { Ok(rt) => rt.processing.clone(), Err(_) => return };
    let _processing_guard = match processing.lock() { Ok(guard) => guard, Err(_) => return };
    let selected_path = if reason == ReadReason::Manual { latest_result_path(path) } else { path.to_path_buf() };
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
            log(runtime, app, "info", format!("[Parser] Parsed {}: {} players ({})",
                path.file_name().unwrap_or_default().to_string_lossy(), game.player_count,
                if game.game_type == GameType::BattleRoyale { "Battle Royale" } else { "Race" }));
            // Re-reading the same match must preserve a previously confirmed WR.
            if let Ok(rt) = runtime.lock() {
                if let Some(previous) = rt.snapshot.recent_results.iter().find(|previous|
                    game_points_key(previous) == game_points_key(&game) && previous.has_world_record) {
                    game.has_world_record = true;
                    game.world_record_player = previous.world_record_player.clone();
                    game.world_record_time = previous.world_record_time;
                }
            }
            if game.game_type == GameType::Race {
            let map_path = path.with_file_name("LastCustomRaceMapPlayed.csv");
            match stable_file(&map_path).and_then(|_| parser::parse_map_metadata(&map_path)) {
                Ok(metadata) => {
                    if game.map_name.is_none() {
                        game.map_name = Some(metadata.map_name.clone());
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
                let stats_enabled = manual_target.map_or(rt.snapshot.stats_tracking_enabled, |stats| stats);
                let cycles_enabled = manual_target.map_or(rt.snapshot.cycles_tracking_enabled, |stats| !stats);
                let timestamp = Utc::now().to_rfc3339();
                let mut retained_history = std::mem::take(&mut rt.race_state.cycle_history);
                let prepared = prepare_race_commit(&rt.race_state, &game, stats_enabled, cycles_enabled, &timestamp, reason);
                rt.race_state.cycle_history = std::mem::take(&mut retained_history);
                if let Some((mut next, stats_new, cycle_completions)) = prepared {
                    let new_history = std::mem::take(&mut next.cycle_history);
                    let retained_history_len = rt.race_state.cycle_history.len();
                    next.cycle_history = std::mem::take(&mut rt.race_state.cycle_history);
                    next.cycle_history.extend(new_history);
                    let mut history = rt.snapshot.recent_results.clone();
                    if stats_new {
                        if history.iter().any(|previous| game_points_key(previous) == game_points_key(&game)) {
                            refresh_counted_result(&mut history, &game);
                        } else { history.push(game.clone()); }
                    } else if stats_enabled && reason == ReadReason::Manual {
                        refresh_counted_result(&mut history, &game);
                    }
                    let commit = rt.storage.write("history.json", &history)
                        .and_then(|_| rt.storage.write("race-state.json", &next));
                    if let Err(error) = commit {
                        next.cycle_history.truncate(retained_history_len);
                        rt.race_state.cycle_history = std::mem::take(&mut next.cycle_history);
                        rt.cached_file = None;
                        rt.snapshot.watcher_status = "Error".into();
                        rt.snapshot.watcher_message = Some(error.clone());
                        drop(rt);
                        log(runtime, app, "error", format!("[Storage] Race not committed: {error}"));
                        emit_snapshot(runtime, app);
                        return;
                    }
                    if stats_enabled && !is_cycle_test_snapshot(&game) { refresh_latest_result(&mut rt.snapshot, &game); }
                    rt.snapshot.cycle_history = cycle_history_for_ui(&next.cycle_history);
                    rt.snapshot.total_race_count = next.total_race_count;
                    rt.snapshot.total_battle_royale_count = next.total_battle_royale_count;
                    rt.snapshot.season_points_earned = next.season_points_earned;
                    rt.snapshot.total_cycle_race_count = tracked_cycle_races(&next);
                    rt.snapshot.race_cycles = cycle_players_for_display(&next.race_cycles);
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
                        rt.snapshot.last_update = Some(timestamp);
                    } else if stats_enabled && reason == ReadReason::Manual && !is_cycle_test_snapshot(&game) {
                        refresh_counted_result(&mut rt.snapshot.session_results, &game);
                        refresh_counted_result(&mut rt.snapshot.recent_results, &game);
                    }
                    rt.snapshot.event_result_ids = current_event_result_ids(&rt.race_state, &rt.snapshot.recent_results);
                    rt.snapshot.watcher_status = if rt.watcher.is_some() { "Watching" } else { "Stopped" }.into();
                    rt.snapshot.watcher_message = Some("New game read from file".into());
                    Some((game.player_count, game.id.chars().take(8).collect::<String>(), game.clone(), cycle_completions, stats_new))
                } else {
                    if stats_enabled && reason == ReadReason::Manual && !is_cycle_test_snapshot(&game) {
                        refresh_latest_result(&mut rt.snapshot, &game);
                    }
                    rt.snapshot.watcher_status = if rt.watcher.is_some() { "Watching" } else { "Stopped" }.into();
                    rt.snapshot.watcher_message = Some("File read; no active pipeline needs this race".into());
                    None
                }
            };
            match &saved {
                None => log(runtime, app, "info", "[Game] Duplicate snapshot ignored; counts unchanged"),
                Some((_, id, _, _, _)) => {
                    log(runtime, app, "info", format!("[Game] New result {id}..."));
                    log(runtime, app, "info", "[Stats] Updated active tracking pipelines; state saved");
                }
            }
            emit_snapshot(runtime, app);
            if let Some((_, _, game, cycle_completions, stats_new)) = saved {
                let overlay_error = if let Ok(mut rt) = runtime.lock() {
                    let snapshot = snapshot_for_ui(&rt.snapshot);
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

                discord_integration::game_events(runtime, app, &game, &cycle_completions, stats_new);
                send_streamer_bot_events(runtime, app, &game, &cycle_completions, stats_new);
                send_lumia_events(runtime, app, &game, &cycle_completions, stats_new);
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
async fn get_app_snapshot(runtime: State<'_, SharedRuntime>) -> Result<AppSnapshot, String> {
    let runtime = runtime.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let result = runtime.lock().map(|rt| snapshot_for_ui(&rt.snapshot)).map_err(|_| "Application state unavailable".into());
        result
    }).await.map_err(|error| error.to_string())?
}

fn get_app_snapshot_inner(runtime: State<'_, SharedRuntime>) -> Result<AppSnapshot, String> {
    runtime
        .lock()
        .map(|rt| snapshot_for_ui(&rt.snapshot))
        .map_err(|_| "Application state unavailable".into())
}

#[tauri::command]
fn save_config(
    app: tauri::AppHandle,
    runtime: State<'_, SharedRuntime>,
    config: AppConfig,
) -> Result<AppSnapshot, String> {
    discord::validate_config(&config.discord)?;
    if config.lumia.port == 0 { return Err("Choose a Lumia port from 1 to 65535".into()); }
    if !(1..=1440).contains(&config.twitch.promotion_interval_minutes) {
        return Err("Promotion interval must be between 1 and 1440 minutes".into());
    }
    if !(1..=1440).contains(&config.twitch.promotion_start_delay_minutes) {
        return Err("Promotion start delay must be between 1 and 1440 minutes".into());
    }
    {
        let mut rt = runtime
            .lock()
            .map_err(|_| "Application state unavailable")?;
        rt.storage.write("config.json", &config)?;
        if rt.snapshot.config.discord != config.discord { rt.discord_revision = rt.discord_revision.wrapping_add(1); }
        rt.snapshot.config = config;
        rt.snapshot.streamer_bot_status = if rt.snapshot.config.streamer_bot.enabled {
            "Not checked".into()
        } else {
            "Disabled".into()
        };
        rt.snapshot.streamer_bot_message = None;
        rt.snapshot.lumia_status = if rt.snapshot.config.lumia.enabled { "Not checked".into() } else { "Disabled".into() };
        rt.snapshot.lumia_message = None;
        rt.snapshot.discord_status = if rt.snapshot.config.discord.enabled { "Not checked".into() } else { "Disabled".into() };
        rt.snapshot.discord_message = None;
    }

    log(&runtime, &app, "info", "[Settings] Configuration saved");
    emit_snapshot(&runtime, &app);
    runtime
        .lock()
        .map(|rt| snapshot_for_ui(&rt.snapshot))
        .map_err(|_| "Application state unavailable".into())
}

#[tauri::command]
fn save_theme(app: tauri::AppHandle, runtime: State<'_, SharedRuntime>, theme: AppearanceTheme) -> Result<(), String> {
    {
        let mut rt = runtime.lock().map_err(|_| "Application state unavailable")?;
        let mut config = rt.snapshot.config.clone();
        config.theme = theme;
        rt.storage.write("config.json", &config)?;
        rt.snapshot.config = config;
    }
    emit_snapshot(&runtime, &app);
    Ok(())
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
    get_app_snapshot_inner(runtime)
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

fn csv_text(value: &str) -> String {
    // CSV quoting alone does not prevent spreadsheet formula execution.
    let first = value.trim_start_matches(|c: char| c.is_whitespace() || c == '\u{feff}').chars().next();
    if matches!(first, Some('=' | '+' | '-' | '@' | '\u{ff1d}' | '\u{ff0b}' | '\u{ff0d}' | '\u{ff20}'))
        || value.starts_with(['\t', '\r', '\n']) {
        format!("'{value}")
    } else { value.to_owned() }
}

fn prepare_csv_export(snapshot: &AppSnapshot, kind: &str) -> Result<Vec<u8>, String> {
    let mut writer = csv::WriterBuilder::new().terminator(csv::Terminator::CRLF).from_writer(Vec::new());
    if kind == "cycles" {
        let mut headers: Vec<String> = ["Season", "Rank", "Player", "Player key", "Cycles", "Races", "Race count complete", "Points", "Progress", "Last updated"].iter().map(|s| s.to_string()).collect();
        headers.extend((1..=10).map(|place| format!("{place} place")));
        writer.write_record(headers).map_err(|e| e.to_string())?;
        let mut players = snapshot.race_cycles.clone();
        players.sort_by(models::compare_cycle_players);
        for (index, player) in players.iter().enumerate() {
            let points: u64 = player.placement_counts.iter().sum();
            let races = if player.total_races_complete { player.total_races } else { player.total_races.max(points) };
            let mut row = vec![snapshot.config.seasons.cycle_name.clone(), (index + 1).to_string(), player.player_name.clone(),
                player.player_key.clone(), player.completed_cycles().to_string(), races.to_string(), player.total_races_complete.to_string(),
                points.to_string(), player.cycle_progress().to_string(), snapshot.cycle_last_update.clone().unwrap_or_default()];
            row.extend((0..10).map(|index| player.placement_counts.get(index).copied().unwrap_or(0).to_string()));
            for index in [0, 2, 3, 9] { row[index] = csv_text(&row[index]); }
            writer.write_record(row).map_err(|e| e.to_string())?;
        }
    } else {
        let games = match kind {
            "session" => snapshot.session_results.iter().collect::<Vec<_>>(),
            "race" => vec![snapshot.latest_result.as_ref().ok_or("No race results to export")?],
            _ => return Err("Unknown export type".into()),
        };
        writer.write_record(["Season", "Race ID", "Source ID", "Date/time", "Track", "Game type", "Participants", "Placement", "Player", "Username", "Platform", "Points earned", "Season points", "Finish time seconds", "Eliminated", "World record", "BR kills", "BR damage", "Raw result JSON"]).map_err(|e| e.to_string())?;
        for game in games {
            for player in &game.results {
                let br = game.game_type == GameType::BattleRoyale;
                let record = game.has_world_record && game.world_record_player.as_ref().is_some_and(|name|
                    [&player.player_name, &player.username, &player.display_name].iter().any(|candidate| name.eq_ignore_ascii_case(candidate)));
                let mut row = vec![snapshot.config.seasons.race_name.clone(), game.id.clone(), game.source_snapshot_id.clone().unwrap_or_default(),
                    game.timestamp.clone(), game.map_name.clone().unwrap_or_default(), serde_json::to_string(&game.game_type).map_err(|e| e.to_string())?.trim_matches('"').to_string(),
                    game.player_count.to_string(), player.placement.to_string(), player.player_name.clone(), player.username.clone(), player.platform.clone(),
                    player.season_points_earned.to_string(), player.season_points_total.map(|v| v.to_string()).unwrap_or_default(),
                    player.finish_time.map(|v| v.to_string()).unwrap_or_default(), player.eliminated.map(|v| v.to_string()).unwrap_or_default(), record.to_string(),
                    if br { player.raw_data.get("MatchKills").cloned().unwrap_or_default() } else { String::new() },
                    if br { player.raw_data.get("MatchDamageDealt").cloned().unwrap_or_default() } else { String::new() },
                    serde_json::to_string(&player.raw_data).map_err(|e| e.to_string())?];
                for index in [0, 1, 2, 3, 4, 8, 9, 10, 16, 17, 18] { row[index] = csv_text(&row[index]); }
                writer.write_record(row).map_err(|e| e.to_string())?;
            }
        }
    }
    writer.into_inner().map_err(|e| e.to_string())
}

#[tauri::command]
async fn export_data(app: tauri::AppHandle, runtime: State<'_, SharedRuntime>, kind: String, format: Option<String>) -> Result<Option<String>, String> {
    let format = format.unwrap_or_else(|| "json".into());
    if !matches!(format.as_str(), "json" | "csv") { return Err("Choose JSON or CSV".into()); }
    // Capture the complete export, then release the state lock before showing a dialog.
    let (filename, bytes) = {
        let rt = runtime.lock().map_err(|_| "Application state unavailable")?;
        let (filename, value) = prepare_export(&rt.snapshot, &kind)?;
        if format == "csv" {
            (filename.trim_end_matches(".json").to_string() + ".csv", prepare_csv_export(&rt.snapshot, &kind)?)
        } else { (filename, serde_json::to_vec_pretty(&value).map_err(|e| e.to_string())?) }
    };
    tauri::async_runtime::spawn_blocking(move || {
        let mut dialog = app.dialog().file()
            .set_title("Export results")
            .add_filter(if format == "csv" { "CSV results" } else { "JSON results" }, &[format.as_str()])
            .set_file_name(filename);
        if let Some(window) = app.get_webview_window("main") {
            dialog = dialog.set_parent(&window);
        }
        let Some(selected) = dialog.blocking_save_file() else { return Ok(None); };
        let path = selected.into_path().map_err(|error| error.to_string())?;
        let parent = path.parent().ok_or("Invalid export location")?;
        let filename = path.file_name().and_then(|name| name.to_str()).ok_or("Invalid export file name")?;
        Storage::new(parent.to_path_buf())?.write_bytes(filename, &bytes)?;
        Ok(Some(path.to_string_lossy().into_owned()))
    }).await.map_err(|error| error.to_string())?
}

#[tauri::command]
async fn reread_last_file(app: tauri::AppHandle, runtime: State<'_, SharedRuntime>, kind: String) -> Result<AppSnapshot, String> {
    let stats = match kind.as_str() {
        "stats" => true,
        "cycles" => false,
        _ => return Err("Choose RaceStats or Cycles to reprocess".into()),
    };
    let shared = runtime.inner().clone();
    let path = shared.lock().map_err(|_| "Application state unavailable")?.snapshot.config.csv.path.clone();
    let worker = shared.clone();
    tauri::async_runtime::spawn_blocking(move || {
        process_file_inner(&worker, &app, Path::new(&path), ReadReason::Manual, Some(stats));
        if stats { check_world_record(&worker, &app, Path::new(&path)); }
    })
        .await.map_err(|error| error.to_string())?;
    let snapshot = snapshot_for_ui(&shared.lock().map_err(|_| "Application state unavailable")?.snapshot);
    Ok(snapshot)
}

#[tauri::command]
async fn connect_twitch(
    app: tauri::AppHandle,
    runtime: State<'_, SharedRuntime>,
) -> Result<AppSnapshot, String> {
    let shared = runtime.inner().clone();
    {
        let mut rt = shared.lock().map_err(|_| "Application state unavailable")?;
        if rt.snapshot.twitch_status == "Authorizing" {
            return Err("Twitch sign-in is already open in your browser".into());
        }
        rt.snapshot.twitch_status = "Authorizing".into();
        rt.snapshot.twitch_message = Some("Finishing Twitch authorization".into());
    }
    emit_snapshot(&shared, &app);

    let auth_runtime = shared.clone();
    let auth_app = app.clone();
    let read_chat = shared.lock().map_err(|_| "Application state unavailable")?.snapshot.config.twitch.my_cycle_command;
    let result = tauri::async_runtime::spawn_blocking(move || twitch_oauth::authorize(read_chat, |message| {
        set_twitch_status(&auth_runtime, "Authorizing", Some(message.to_owned()), None);
        emit_snapshot(&auth_runtime, &auth_app);
    }))
    .await
    .unwrap_or_else(|_| Err("Twitch authorization stopped. Try Connect Twitch again.".into()));
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
        .map(|rt| snapshot_for_ui(&rt.snapshot))
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
        Err(error) => set_twitch_status(&shared, twitch::login_error_status(&error), Some(error), None),
    }
    emit_snapshot(&shared, &app);
    let snapshot = shared
        .lock()
        .map(|rt| snapshot_for_ui(&rt.snapshot))
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
        "promotion" => twitch::send_promotion(&config),
        "race" | "cycles" | "worldRecord" => Err("Enable this posting option before testing it".into()),
        _ => Err("Unknown Twitch test".into()),
    }).await.map_err(|error| format!("Twitch test task failed: {error}"))?;
    match result {
        Ok(()) => {
            set_twitch_status(&shared, "Connected", None, None);
            log(&shared, &app, "info", "[Twitch] Test message posted");
            emit_snapshot(&shared, &app);
            get_app_snapshot_inner(runtime)
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
    get_app_snapshot_inner(runtime)
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
            runtime.lock().map(|rt| snapshot_for_ui(&rt.snapshot)).map_err(|_| "Application state unavailable".into())
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
    if let Err(error) = &result {
        set_streamer_bot_status(&runtime, "Error", Some(error.clone()));
        emit_snapshot(&runtime, &app);
    }
    finish_streamer_bot_test(&runtime, &app, result, "Connection test succeeded")
}

#[tauri::command]
fn get_overlay_directory(runtime: State<'_, SharedRuntime>) -> Result<String, String> {
    let rt = runtime.lock().map_err(|error| error.to_string())?;
    overlays::ensure(&rt.overlay_writer.directory)?;
    Ok(rt.overlay_writer.directory.to_string_lossy().into_owned())
}

#[tauri::command]
fn get_overlay_durations(runtime: State<'_, SharedRuntime>) -> Result<overlays::Durations, String> {
    let rt = runtime.lock().map_err(|error| error.to_string())?;
    overlays::durations(&rt.overlay_writer.directory)
}

#[tauri::command]
fn save_overlay_duration(runtime: State<'_, SharedRuntime>, kind: String, seconds: u32) -> Result<overlays::Durations, String> {
    let rt = runtime.lock().map_err(|error| error.to_string())?;
    overlays::ensure(&rt.overlay_writer.directory)?;
    overlays::save_duration(&rt.overlay_writer.directory, &kind, seconds)
}

#[tauri::command]
fn get_overlay_options(runtime: State<'_, SharedRuntime>) -> Result<overlays::Customizations, String> {
    let rt = runtime.lock().map_err(|error| error.to_string())?;
    overlays::customizations(&rt.overlay_writer.directory)
}

#[tauri::command]
fn save_overlay_options(runtime: State<'_, SharedRuntime>, kind: String, options: overlays::OverlayOptions) -> Result<overlays::OverlayOptions, String> {
    let rt = runtime.lock().map_err(|error| error.to_string())?;
    overlays::ensure(&rt.overlay_writer.directory)?;
    overlays::save_options(&rt.overlay_writer.directory, &kind, options)
}

#[tauri::command]
fn reset_overlay_options(runtime: State<'_, SharedRuntime>, kind: String) -> Result<(), String> {
    let rt = runtime.lock().map_err(|error| error.to_string())?;
    overlays::ensure(&rt.overlay_writer.directory)?;
    overlays::reset_options(&rt.overlay_writer.directory, &kind)
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
        if rt.watcher.is_some() { return Ok(snapshot_for_ui(&rt.snapshot)); }
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
    let baseline = parser::parse_map_metadata(&target.with_file_name("LastCustomRaceMapPlayed.csv")).ok();
    if let Ok(mut rt) = runtime.lock() {
        rt.record_tracker = records::Tracker::new(baseline.as_ref());
    }
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
        return Ok(snapshot_for_ui(&rt.snapshot));
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
                let record_path = target_for_thread.with_file_name("LastCustomRaceMapPlayed.csv");
                let record_changed = event.paths.iter().any(|path| same_watch_target(path, &record_path));
                if pending.is_empty() && !record_changed { continue; }
                // Gather every changed source during the debounce, never discard another mode.
                let mut quiet_until = Instant::now() + Duration::from_millis(250);
                let deadline = Instant::now() + Duration::from_secs(2);
                while Instant::now() < quiet_until && Instant::now() < deadline {
                    match event_rx.recv_timeout(Duration::from_millis(50)) {
                        Ok(Ok(next)) if is_content_event(next.kind) => {
                            let changed = changed_result_paths(&next.paths, &target_for_thread);
                            let next_record_changed = next.paths.iter().any(|path| same_watch_target(path, &record_path));
                            if !changed.is_empty() || next_record_changed {
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
                // Always inspect WR metadata after completed results; also handle
                // a late, record-only write without processing that match again.
                check_world_record(&shared, &app_for_thread, &target_for_thread);
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
        snapshot_for_ui(&rt.snapshot)
    };
    log(&runtime, &app, "info", format!("[Watcher] Watching Race and Battle Royale result/metadata files in {}", watch_dir.display()));
    emit_snapshot(&runtime, &app);
    Ok(snapshot)
}

#[tauri::command]
async fn set_tracking_enabled(app: tauri::AppHandle, runtime: State<'_, SharedRuntime>, kind: String, enabled: bool) -> Result<AppSnapshot, String> {
    let runtime = runtime.inner().clone();
    tauri::async_runtime::spawn_blocking(move || set_tracking_enabled_inner(app, runtime, kind, enabled))
        .await.map_err(|error| error.to_string())?
}

fn set_tracking_enabled_inner(
    app: tauri::AppHandle,
    runtime: SharedRuntime,
    kind: String,
    enabled: bool,
) -> Result<AppSnapshot, String> {
    let _command_guard = TRACKING_COMMAND_LOCK.lock().map_err(|_| "Tracker controls unavailable")?;
    if kind != "stats" && kind != "cycles" { return Err("Unknown tracking page".into()); }
    let previous = {
        let mut rt = runtime.lock().map_err(|_| "Application state unavailable")?;
        let previous = if kind == "stats" { rt.snapshot.stats_tracking_enabled } else { rt.snapshot.cycles_tracking_enabled };
        if previous == enabled { return Ok(snapshot_for_ui(&rt.snapshot)); }
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
    let result = runtime.lock().map(|rt| snapshot_for_ui(&rt.snapshot)).map_err(|_| "Application state unavailable".into());
    result
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
    get_app_snapshot_inner(runtime)
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
        rt.snapshot.event_result_ids.clear();
    }

    log(&runtime, &app, "info", "[History] Race history cleared");
    emit_snapshot(&runtime, &app);
    get_app_snapshot_inner(runtime)
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
    get_app_snapshot_inner(runtime)
}

fn clear_session_results(snapshot: &mut AppSnapshot) {
        snapshot.latest_result = None;
        snapshot.session_results.clear();
        snapshot.session = SessionSummary::default();
        snapshot.last_update = None;
        snapshot.detected_game_type = None;
}

#[tauri::command]
async fn fetch_marble_cycle_session(url: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || marble_cycle::fetch(&url)).await.map_err(|e| e.to_string())?
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct MarbleImportReport { snapshot: AppSnapshot, added: usize, cycle_races: usize, skipped: usize }

#[tauri::command]
async fn import_marble_cycle_results(app: tauri::AppHandle, runtime: State<'_, SharedRuntime>, url: String,
    games: Vec<GameResult>, seasons: SeasonConfig, include_br_wins: bool) -> Result<MarbleImportReport, String> {
    let runtime = runtime.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let url = marble_cycle::session_url(&url)?;
        let mut games = games;
        if games.is_empty() || games.len() > 10000 { return Err("Session must contain 1-10000 complete results".into()); }
        for game in &games {
            if !matches!(game.game_type, GameType::Race | GameType::BattleRoyale) || game.results.is_empty()
                || game.results.len() != game.player_count || game.player_count > 10000
                || game.source_snapshot_id.as_deref() != Some(game.id.as_str())
                || marble_cycle::session_url(&format!("https://marblecycle.com/session/{}", game.id)).is_err()
                || game.results.iter().any(|p| p.raw_data.get("MarbleCycleSessionUrl") != Some(&url)
                    || p.raw_data.get("MarbleCycleRaceId") != Some(&game.id)
                    || p.player_name.trim().is_empty() || !(1..=game.player_count as u32).contains(&p.placement)
                    || p.season_points_earned < 0 || p.platform != "Twitch") {
                return Err("Session contains incomplete or invalid normalized results; nothing imported".into());
            }
        }
        for game in &mut games {
            if game.game_type == GameType::BattleRoyale {
                for result in &mut game.results { result.raw_data.insert("MarbleCycleBrWinsAsFirst".into(), include_br_wins.to_string()); }
            }
        }
        let processing = runtime.lock().map_err(|_| "Application state unavailable")?.processing.clone();
        let _guard = processing.lock().map_err(|_| "Results processing unavailable")?;
        let report = {
            let mut rt = runtime.lock().map_err(|_| "Application state unavailable")?;
            if rt.snapshot.config.seasons.cycle_name != seasons.cycle_name {
                return Err("The selected results names changed. Reopen Import for the current season.".into());
            }
            let _ = app.emit("marble-cycle-import-progress", serde_json::json!({ "phase": "Starting import", "current": 0, "total": games.len(), "percent": 0 }));
            let mut prepared = marble_cycle::prepare_with_progress(&rt.race_state, &rt.snapshot.recent_results, &games, |phase, current, total, percent| {
                let _ = app.emit("marble-cycle-import-progress", serde_json::json!({ "phase": phase, "current": current, "total": total, "percent": percent }));
            });
            marble_cycle::validate(&prepared, &games)?;
            prepared.state.cycle_last_update = Some(Utc::now().to_rfc3339());
            // Backup the existing writable JSON state before the multi-file merge.
            let _ = app.emit("marble-cycle-import-progress", serde_json::json!({ "phase": "Saving backup and history", "current": games.len(), "total": games.len(), "percent": 95 }));
            backup_current_results(&rt, "marble-cycle-import")?;
            let previous_history = rt.snapshot.recent_results.clone();
            let history_changed = prepared.history.len() != previous_history.len();
            if history_changed { rt.storage.write("history.json", &prepared.history)?; }
            if let Err(error) = rt.storage.write("race-state.json", &prepared.state) {
                let rollback = if history_changed { rt.storage.write("history.json", &previous_history) } else { Ok(()) };
                return Err(format!("Import not committed: {error}{}", rollback.err().map(|e| format!("; history rollback failed: {e}; restore the import backup")).unwrap_or_default()));
            }
            rt.race_state = prepared.state;
            rt.snapshot.recent_results = prepared.history;
            rt.snapshot.cycle_history = cycle_history_for_ui(&rt.race_state.cycle_history);
            rt.snapshot.race_cycles = cycle_players_for_display(&rt.race_state.race_cycles);
            rt.snapshot.total_race_count = rt.race_state.total_race_count;
            rt.snapshot.total_battle_royale_count = rt.race_state.total_battle_royale_count;
            rt.snapshot.total_cycle_race_count = rt.race_state.total_cycle_race_count;
            rt.snapshot.cycle_last_update = rt.race_state.cycle_last_update.clone();
            rt.snapshot.season_points_earned = rt.race_state.season_points_earned;
            rt.snapshot.event_result_ids = current_event_result_ids(&rt.race_state, &rt.snapshot.recent_results);
            if rt.snapshot.latest_result.as_ref().is_some_and(|game| game.timestamp.is_empty()
                && game.results.first().is_some_and(|player| player.raw_data.contains_key("MarbleCycleSessionUrl"))) {
                rt.snapshot.latest_result = rt.race_state.current_result.clone();
                rt.snapshot.detected_game_type = rt.snapshot.latest_result.as_ref().map(|game| game.game_type.clone());
                rt.snapshot.last_update = rt.snapshot.latest_result.as_ref().map(|game| game.timestamp.clone());
            }
            rt.overlay_writer.invalidate();
            MarbleImportReport { snapshot: snapshot_for_ui(&rt.snapshot), added: prepared.added, cycle_races: prepared.cycle_races, skipped: prepared.skipped }
        };
        log(&runtime, &app, "info", format!("[Import] {} current Cycle results added; {} Race results backfilled into Cycles; {} duplicates skipped", report.added, report.cycle_races, report.skipped));
        emit_snapshot(&runtime, &app);
        let _ = app.emit("marble-cycle-import-progress", serde_json::json!({ "phase": "Import complete", "current": games.len(), "total": games.len(), "percent": 100 }));
        Ok(report)
    }).await.map_err(|e| e.to_string())?
}

fn reset_stats_totals(state: &mut RaceState) {
    state.stats_results_cleared = true;
    state.current_result = None;
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

fn backup_current_results(rt: &Runtime, kind: &str) -> Result<(), String> {
    let name = format!("backups/{}-{}.json", kind, Utc::now().format("%Y%m%d-%H%M%S-%f"));
    std::fs::create_dir_all(rt.storage.path("backups"))
        .map_err(|error| format!("Unable to create backup directory: {error}"))?;
    rt.storage.write(&name, &current_results_backup(rt, kind))
}

fn current_results_backup(rt: &Runtime, kind: &str) -> serde_json::Value {
    serde_json::json!({
        "timestamp": Utc::now().to_rfc3339(), "kind": kind,
        "state": rt.race_state, "sessionResults": rt.snapshot.session_results,
        "history": rt.snapshot.recent_results,
        "latestResult": rt.snapshot.latest_result
    })
}

#[tauri::command]
async fn clear_race_results(app: tauri::AppHandle, runtime: State<'_, SharedRuntime>, backup: bool) -> Result<AppSnapshot, String> {
    clear_results_with_backup(app, runtime.inner().clone(), "race-stats", backup).await
}

#[tauri::command]
async fn clear_race_cycles(app: tauri::AppHandle, runtime: State<'_, SharedRuntime>, backup: bool) -> Result<AppSnapshot, String> {
    clear_results_with_backup(app, runtime.inner().clone(), "cycles", backup).await
}

async fn clear_results_with_backup(app: tauri::AppHandle, runtime: SharedRuntime, kind: &'static str, backup: bool) -> Result<AppSnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let processing = runtime.lock().map_err(|_| "Application state unavailable")?.processing.clone();
        let _guard = processing.lock().map_err(|_| "Results processing unavailable")?;
        let backup_path = if backup {
            let filename = format!("{}-backup-{}.json", kind, Utc::now().format("%Y%m%d-%H%M%S"));
            let mut dialog = app.dialog().file().set_title("Save backup before clearing results")
                .add_filter("JSON backup", &["json"]).set_file_name(filename);
            if let Some(window) = app.get_webview_window("main") { dialog = dialog.set_parent(&window); }
            let Some(selected) = dialog.blocking_save_file() else {
                // Cancelling Save cancels clearing as well.
                let snapshot = snapshot_for_ui(&runtime.lock().map_err(|_| "Application state unavailable")?.snapshot);
                return Ok(snapshot);
            };
            Some(selected.into_path().map_err(|e| e.to_string())?)
        } else { None };
        {
            let mut rt = runtime.lock().map_err(|_| "Application state unavailable")?;
            if let Some(path) = backup_path {
                let parent = path.parent().ok_or("Invalid backup location")?;
                let filename = path.file_name().and_then(|name| name.to_str()).ok_or("Invalid backup filename")?;
                if parent.to_string_lossy().to_lowercase() == rt.storage.data_dir.to_string_lossy().to_lowercase()
                    && ["race-state.json", "history.json", "config.json"].contains(&filename.to_lowercase().as_str()) {
                    return Err("Choose a backup filename outside the live state/history files".into());
                }
                Storage::new(parent.to_path_buf())?.write(filename, &current_results_backup(&rt, kind))?;
            }
            let mut next = rt.race_state.clone();
            if kind == "cycles" {
                reset_cycle_totals(&mut next);
                next.cycle_history.clear();
            } else {
                reset_stats_totals(&mut next);
                rt.storage.write("history.json", &Vec::<GameResult>::new())?;
            }
            if let Err(error) = rt.storage.write("race-state.json", &next) {
                if kind != "cycles" { rt.storage.write("history.json", &rt.snapshot.recent_results)?; }
                return Err(error);
            }
            rt.cached_file = None;
            rt.race_state = next;
            if kind == "cycles" {
                rt.snapshot.race_cycles.clear();
                rt.snapshot.cycle_history.clear();
                rt.snapshot.total_cycle_race_count = 0;
                rt.snapshot.cycle_last_update = None;
            } else {
                rt.snapshot.season_points_earned = 0;
                rt.snapshot.total_race_count = 0;
                rt.snapshot.total_battle_royale_count = 0;
                rt.snapshot.event_result_ids.clear();
                rt.snapshot.recent_results.clear();
                clear_session_results(&mut rt.snapshot);
            }
            rt.overlay_writer.invalidate();
        }
        log(&runtime, &app, "info", format!("[{}] Results, history and cached/processed IDs cleared", kind));
        emit_snapshot(&runtime, &app);
        let snapshot = snapshot_for_ui(&runtime.lock().map_err(|_| "Application state unavailable")?.snapshot);
        Ok(snapshot)
    }).await.map_err(|e| e.to_string())?
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
        if config.enabled {
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
                    if !current.enabled || current.host != config.host || current.port != config.port {
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

#[tauri::command]
async fn check_app_updates(app: tauri::AppHandle, window: tauri::WebviewWindow, runtime: State<'_, SharedRuntime>, updates: State<'_, updater::Updater>, manual: bool) -> Result<updater::UpdateInfo, String> {
    if window.label() != "main" { return Err("Updates are only available in the main window".into()); }
    let enabled = manual || runtime.lock().map_err(|_| "Application state unavailable")?.snapshot.config.auto_update_check_enabled;
    {
        let mut state = updates.state.lock().map_err(|_| "Update state unavailable")?;
        if state.busy { return Err("An update operation is already in progress".into()); }
        state.busy = true;
    }
    let current = app.package_info().version.to_string();
    let result = tauri::async_runtime::spawn_blocking(move || updater::check(current, enabled)).await.map_err(|e| e.to_string()).and_then(|r| r);
    {
        let mut state = updates.state.lock().map_err(|_| "Update state unavailable")?;
        state.busy = false;
        if let Ok(info) = &result {
            if !info.skipped { state.offer = info.update_available.then(|| info.clone()); }
        }
    }
    if let Err(error) = &result { log(&runtime, &app, "warn", &format!("[Updater] Check failed: {error}")); }
    result
}

#[tauri::command]
fn app_update_ready(app: tauri::AppHandle, window: tauri::WebviewWindow) -> Result<serde_json::Value, String> {
    if window.label() != "main" { return Err("Updates are only available in the main window".into()); }
    updater::ready(&app)
}

#[tauri::command]
async fn install_app_update(app: tauri::AppHandle, window: tauri::WebviewWindow, runtime: State<'_, SharedRuntime>, updates: State<'_, updater::Updater>, version: String) -> Result<(), String> {
    if window.label() != "main" { return Err("Updates are only available in the main window".into()); }
    let cancel = Arc::new(std::sync::atomic::AtomicBool::new(false));
    {
        let mut state = updates.state.lock().map_err(|_| "Update state unavailable")?;
        if state.busy { return Err("An update operation is already in progress".into()); }
        if state.offer.as_ref().map(|offer| &offer.latest_version) != Some(&version) {
            return Err("The update offer has changed. Check for updates again.".into());
        }
        state.busy = true;
        state.cancel = Some(cancel.clone());
    }
    let shared = runtime.inner().clone();
    let worker_app = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        log(&shared, &worker_app, "info", "[Updater] Downloading update");
        let mut prepared = updater::prepare(&worker_app, &version, &cancel)?;
        {
            // Cancellation and the transition into installation share one lock.
            let updates = worker_app.state::<updater::Updater>();
            let mut state = updates.state.lock().map_err(|_| "Update state unavailable")?;
            state.cancel = None;
            if cancel.load(std::sync::atomic::Ordering::SeqCst) { return Err("Update cancelled".into()); }
        }
        let _ = worker_app.emit("app-update-status", serde_json::json!({"phase":"preparing"}));
        stop_watcher_inner(&shared);
        let processing = shared.lock().map_err(|_| "Application state unavailable")?.processing.clone();
        let _guard = processing.lock().map_err(|_| "Processing state unavailable")?;
        // The watcher has joined and any manual processing has finished its atomic writes.
        prepared.commit()?;
        log(&shared, &worker_app, "info", "[Updater] Verified update; restarting");
        let _ = worker_app.emit("app-update-status", serde_json::json!({"phase":"restarting"}));
        worker_app.exit(0);
        Ok(())
    }).await.map_err(|e| e.to_string()).and_then(|r| r);
    if let Err(error) = &result {
        if let Ok(mut state) = updates.state.lock() { state.busy = false; state.cancel = None; }
        if error == "Update cancelled" { log(&runtime, &app, "info", "[Updater] Download cancelled"); }
        else { log(&runtime, &app, "warn", &format!("[Updater] Installation failed: {error}")); }
        emit_snapshot(&runtime, &app);
    }
    result
}

#[tauri::command]
fn cancel_app_update(window: tauri::WebviewWindow, updates: State<'_, updater::Updater>) -> Result<(), String> {
    if window.label() != "main" { return Err("Updates are only available in the main window".into()); }
    let state = updates.state.lock().map_err(|_| "Update state unavailable")?;
    let cancel = state.cancel.as_ref().ok_or("Installation has started; please wait for the restart")?;
    cancel.store(true, std::sync::atomic::Ordering::SeqCst);
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .manage(updater::Updater::default())
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
            if let Err(error) = streamdeck::start(&runtime, app.handle()) {
                log(&runtime, app.handle(), "warning", format!("[Stream Deck] Controls unavailable: {error}"));
            }
            emit_snapshot(&runtime, app.handle());
            start_connection_checks(&runtime, app.handle());
            start_lumia_checks(&runtime, app.handle());
            discord_integration::start(&runtime, app.handle());
            promotion::start(&runtime, app.handle());
            twitch_chat::start(&runtime, app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            streamdeck::install_streamdeck_plugin,
            streamdeck::install_dropgate_plugin,
            streamdeck::get_streamdeck_install_status,
            check_app_updates,
            install_app_update,
            cancel_app_update,
            app_update_ready,
            get_app_snapshot,
            save_seasons,
            export_data,
            reread_last_file,
            save_config,
            save_theme,
            connect_twitch,
            validate_twitch_session,
            disconnect_twitch,
            test_twitch_message,
            test_streamer_bot_connection,
            save_lumia_token,
            remove_lumia_token,
            test_lumia,
            discord_integration::save_discord_webhook,
            discord_integration::remove_discord_webhook,
            discord_integration::test_discord,
            get_overlay_directory,
            get_overlay_options,
            save_overlay_options,
            reset_overlay_options,
            get_overlay_durations,
            save_overlay_duration,
            test_overlay,
            test_streamer_bot_action,
            set_tracking_enabled,
            start_watcher,
            stop_watcher,
            clear_history,
            clear_cycle_history,
            fetch_marble_cycle_session,
            import_marble_cycle_results,
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
    #[test]
    fn exported_text_cannot_start_spreadsheet_formulas() {
        for text in ["=1+1", "+SUM(1,2)", "-SUM(1,2)", "@SUM(1,2)", "  =1", "\u{feff}=1", "\u{ff1d}1+1", "\tvalue", "\rvalue", "\nvalue"] {
            assert_eq!(csv_text(text), format!("'{text}"));
        }
        for text in ["Player", "", "Track 1", "123", "player@example.com"] {
            assert_eq!(csv_text(text), text);
        }
    }

    use super::*;

    #[test]
    fn tracking_pipelines_are_independent() {
        let game = streamer_bot::sample_game();
        for (stats_on, cycles_on) in [(false, false), (true, false), (false, true), (true, true)] {
            let committed = prepare_race_commit(&RaceState::default(), &game,
                stats_on, cycles_on, "test", ReadReason::Manual);
            if !stats_on && !cycles_on {
                assert!(committed.is_none());
                continue;
            }
            let (next, stats_new, _) = committed.unwrap();
            assert_eq!(stats_new, stats_on);
            assert_eq!(next.total_race_count, u64::from(stats_on));
            assert_eq!(next.total_cycle_race_count, u64::from(cycles_on));
            assert_eq!(next.race_cycles.is_empty(), !cycles_on);
        }
    }

    #[test]
    fn cycle_test_snapshots_complete_one_cycle_without_race_stats_or_race_events() {
        let mut state = RaceState::default();
        let mut completed = Vec::new();
        for placement in 1..=10 {
            let mut game = streamer_bot::sample_game();
            game.id = format!("cycle-test-game-{placement}");
            game.source_snapshot_id = Some(format!("cycle-test:{placement}"));
            game.map_name = Some("Cycle Test Track".into());
            game.has_world_record = false;
            game.results.truncate(1);
            game.player_count = 1;
            game.results[0].placement = placement;
            game.results[0].season_points_earned = 0;
            let (next, stats_new, completions) = prepare_race_commit(
                &state, &game, true, true, "test", ReadReason::FileChanged).unwrap();
            assert!(!stats_new, "Race event dispatch must stay disabled");
            assert_eq!(next.total_race_count, 0);
            assert_eq!(next.season_points_earned, 0);
            assert!(next.processed_ids.is_empty());
            completed.extend(completions);
            state = next;
        }
        assert_eq!(state.total_cycle_race_count, 10);
        assert_eq!(completed.len(), 1);
        assert_eq!(completed[0].races, Some(10));
        assert_eq!(state.race_cycles[0].cycles, 1);
    }
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
            event_result_ids: vec![],
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
            discord_status: "Disabled".into(),
            discord_message: None,
            lumia_status: "Disabled".into(),
            lumia_message: None,
            twitch_status: "Disconnected".into(),
            twitch_message: None,
            twitch_username: None,
            twitch_chat_message: "Chat listener disabled".into(),
            session: SessionSummary::default(),
            recent_results: vec![],
            race_cycles: vec![],
            logs: vec![],
        }
    }

    #[test]
    fn automation_master_switches_suppress_hooks_without_changing_event_choices() {
        let mut snapshot = test_snapshot(); snapshot.cycles_tracking_enabled = true;
        let game = streamer_bot::sample_game();
        let events = StreamerBotEvents { race_complete: true, world_record: true, cycle_complete: true, mission_promotion: true };
        let streamer = StreamerBotConfig { enabled: false, events: events.clone(), ..StreamerBotConfig::default() };
        let lumia = LumiaConfig { enabled: false, events, ..LumiaConfig::default() };
        let completions = vec![CycleCompletion { player_name: "Test Winner".into(), cycle_number: 2, races: None }];
        assert!(streamer_bot::prepared_events(&streamer, &snapshot, &game, &completions, true).is_empty());
        assert!(streamer_bot::prepared_events(&lumia.event_config(), &snapshot, &game, &completions, true).is_empty());
        assert!(streamer.events.race_complete && lumia.events.cycle_complete);
        assert!(streamer.events.mission_promotion && lumia.events.mission_promotion);
        let mut stored = serde_json::to_value(&streamer).unwrap();
        stored.as_object_mut().unwrap().remove("enabled");
        let legacy: StreamerBotConfig = serde_json::from_value(stored).unwrap();
        assert!(legacy.enabled); assert_eq!(legacy.actions.game_complete, streamer.actions.game_complete);
        let explicit: StreamerBotConfig = serde_json::from_value(serde_json::to_value(&streamer).unwrap()).unwrap();
        assert!(!explicit.enabled); assert!(explicit.events.world_record);
        assert!(!StreamerBotConfig::default().enabled);
    }

    #[test]
    fn automation_providers_prepare_identical_events_for_every_switch_combination() {
        use serde_json::json;
        let mut snapshot = test_snapshot();
        snapshot.config.seasons.race_name = "Race season".into();
        snapshot.config.seasons.cycle_name = "Cycle season".into();
        let completions = vec![
            CycleCompletion { player_name: "Test Winner".into(), cycle_number: 2, races: Some(42) },
            CycleCompletion { player_name: "Test Second".into(), cycle_number: 3, races: None },
        ];
        for game_type in [GameType::Race, GameType::BattleRoyale] {
            let mut game = streamer_bot::sample_game(); game.game_type = game_type;
            game.results[0].raw_data.insert("MatchKills".into(), "5".into());
            snapshot.session_results = vec![game.clone()]; snapshot.season_points_earned = 321;
            for switches in 0..16 {
                let events = StreamerBotEvents { race_complete: switches & 1 != 0, world_record: switches & 2 != 0,
                    cycle_complete: switches & 4 != 0, mission_promotion: switches & 8 != 0 };
                let streamer = StreamerBotConfig { enabled: true, events: events.clone(), ..StreamerBotConfig::default() };
                let lumia = LumiaConfig { enabled: true, events, ..LumiaConfig::default() };
                for stats_new in [false, true] {
                    for cycles_enabled in [false, true] {
                        snapshot.cycles_tracking_enabled = cycles_enabled;
                        let sb = streamer_bot::prepared_events(&streamer, &snapshot, &game, &completions, stats_new);
                        let lm = streamer_bot::prepared_events(&lumia.event_config(), &snapshot, &game, &completions, stats_new);
                        let payloads = |events: &Vec<(String, serde_json::Value)>| events.iter().map(|(_, args)| args.clone()).collect::<Vec<_>>();
                        assert_eq!(payloads(&sb), payloads(&lm));
                        let expected = usize::from(stats_new && streamer.events.race_complete)
                            + usize::from(stats_new && streamer.events.world_record)
                            + if cycles_enabled && streamer.events.cycle_complete { 2 } else { 0 };
                        assert_eq!(sb.len(), expected);
                        for (_, args) in &lm {
                            assert_eq!(args["placements"].as_array().unwrap().len(), 3);
                            assert_eq!(args["firstplace"], "Test Winner");
                            assert_eq!(args["seasonPoints"], 321);
                            assert_eq!(args["cycleSeasonName"], "Cycle season");
                            let packet: serde_json::Value = serde_json::from_str(args["overlayDataJson"].as_str().unwrap()).unwrap();
                            assert_eq!(args["placements"], packet["placements"]);
                            assert_eq!(args["cycleCompletions"].as_array().unwrap().len(), 2);
                        }
                    }
                }
            }
            let record = streamer_bot::confirmed_record_args(&snapshot, &game);
            assert_eq!(record["wrplayer"], "Test Winner");
            assert_eq!(record["placements"].as_array().unwrap().len(), 3);
            assert_eq!(record["cycleCompletions"], json!([]));
            game.has_world_record = false;
            let config = StreamerBotConfig { enabled: true, events: StreamerBotEvents { world_record: true, race_complete: false,
                cycle_complete: false, mission_promotion: false }, ..StreamerBotConfig::default() };
            assert!(streamer_bot::prepared_events(&config, &snapshot, &game, &[], true).is_empty());
        }
    }

    #[test]
    fn ui_snapshot_omits_unused_standings_without_changing_saved_history() {
        let mut source = test_snapshot();
        let game = streamer_bot::sample_game();
        let (state, _, _) = prepare_race_commit(&RaceState::default(), &game, true, true, "", ReadReason::Manual).unwrap();
        source.cycle_history = state.cycle_history.clone();
        source.recent_results = vec![game.clone()];
        let ui = snapshot_for_ui(&source);
        assert!(!source.cycle_history[0].standings.is_empty());
        assert!(ui.cycle_history[0].standings.is_empty());
        assert!(ui.cycle_history[0].game.is_none());
        assert_eq!(ui.cycle_history[0].earnings.len(), source.cycle_history[0].earnings.len());
        assert_eq!(ui.recent_results[0].results.len(), game.results.len());
        source.recent_results.clear();
        assert!(snapshot_for_ui(&source).cycle_history[0].game.is_some());
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
    fn csv_exports_quote_names_and_keep_complete_rows_and_cycle_counts() {
        let mut snapshot = test_snapshot();
        let mut game = streamer_bot::sample_game();
        game.results[0].player_name = "Name, with \"quotes\"\nand newline".into();
        snapshot.session_results = vec![game.clone()];
        let bytes = prepare_csv_export(&snapshot, "session").unwrap();
        let mut reader = csv::Reader::from_reader(bytes.as_slice());
        let rows: Vec<_> = reader.records().map(Result::unwrap).collect();
        assert_eq!(rows.len(), game.results.len());
        assert_eq!(&rows[0][8], game.results[0].player_name.as_str());
        assert_eq!(&rows[0][16], ""); // No BR kills in Race rows.
        assert_eq!(&rows[0][17], "");
        let (state, _, _) = prepare_race_commit(&RaceState::default(), &game, false, true, "", ReadReason::Manual).unwrap();
        snapshot.race_cycles = state.race_cycles;
        let bytes = prepare_csv_export(&snapshot, "cycles").unwrap();
        let mut reader = csv::Reader::from_reader(bytes.as_slice());
        assert_eq!(reader.headers().unwrap().len(), 20);
        let rows: Vec<_> = reader.records().map(Result::unwrap).collect();
        assert_eq!(rows.len(), snapshot.race_cycles.len());
        assert_eq!(&rows[0][5], "1");
        assert!(prepare_csv_export(&snapshot, "unknown").is_err());
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
            total_races: 0, total_races_complete: false,
            player_key: race_cycle_player_key(&game.results[0]),
            player_name: game.results[0].player_name.clone(), placement_counts: counts, cycles: 0, current_cycle_positions: None, cycle_race_counts: vec![],
        });
        let (next, stats_new, completions) = prepare_race_commit(&initial, &game, false, true, "completed-at", ReadReason::Manual).unwrap();
        assert!(!stats_new);
        assert_eq!(completions.len(), 1);
        assert_eq!(next.cycle_history.len(), 1);
        assert_eq!(next.cycle_history[0].completions[0].cycle_number, 1);
        assert_eq!(next.cycle_history[0].timestamp, game.timestamp);
        assert_eq!(next.cycle_history[0].game_id, game.id);
        let restored: RaceState = serde_json::from_str(&serde_json::to_string(&next).unwrap()).unwrap();
        assert_eq!(restored.cycle_history[0].completions[0].player_name, game.results[0].player_name);
        assert!(prepare_race_commit(&restored, &game, false, true, "reread-at", ReadReason::Manual).is_none());
    }

    #[test]
    fn player_event_results_survive_restart_and_reset_independently_of_history() {
        let mut first = streamer_bot::sample_game();
        first.id = "first-event-race".into();
        first.source_snapshot_id = Some("first-event-source".into());
        let mut second = first.clone();
        second.id = "second-event-race".into();
        second.source_snapshot_id = Some("second-event-source".into());
        let history = vec![first.clone(), second.clone()];
        let mut state = prepare_race_commit(&RaceState::default(), &first, true, false, "first", ReadReason::Manual).unwrap().0;
        assert_eq!(current_event_result_ids(&state, &history), vec![first.id.clone()]);
        let restored: RaceState = serde_json::from_str(&serde_json::to_string(&state).unwrap()).unwrap();
        assert_eq!(current_event_result_ids(&restored, &history), vec![first.id.clone()]);
        reset_stats_totals(&mut state);
        assert!(current_event_result_ids(&state, &history).is_empty());
        state = prepare_race_commit(&state, &second, true, false, "second", ReadReason::Manual).unwrap().0;
        assert_eq!(current_event_result_ids(&state, &history), vec![second.id]);
        assert_eq!(history.len(), 2);
    }

    #[test]
    fn startup_restores_saved_latest_without_recounting_and_respects_clearing() {
        let game = streamer_bot::sample_game();
        let history = vec![game.clone()];
        let mut state = RaceState::default();
        assert_eq!(restored_current_result(&state, &history).unwrap().id, game.id);
        assert_eq!(state.total_race_count, 0);
        assert!(state.processed_ids.is_empty());
        state = prepare_race_commit(&state, &game, true, true, "now", ReadReason::Manual).unwrap().0;
        let restored: RaceState = serde_json::from_str(&serde_json::to_string(&state).unwrap()).unwrap();
        assert_eq!(restored_current_result(&restored, &history).unwrap().results.len(), game.results.len());
        assert!(prepare_race_commit(&restored, &game, true, true, "restart", ReadReason::Manual).is_none());
        reset_stats_totals(&mut state);
        let restored: RaceState = serde_json::from_str(&serde_json::to_string(&state).unwrap()).unwrap();
        assert!(restored_current_result(&restored, &history).is_none());
        assert_eq!(history.len(), 1);
        assert!(!restored.cycle_history.is_empty());
    }

    #[test]
    fn placements_carry_forward_through_a_hundred_cycles_and_restart() {
        let mut game = streamer_bot::sample_game();
        game.results = vec![result("Player", 10, 0)];
        let mut players = Vec::new();
        for _ in 0..100 { assert!(update_race_cycles(&mut players, &game).is_empty()); }
        assert_eq!(players[0].placement_counts[9], 100);
        assert_eq!(players[0].cycles, 0);
        players = serde_json::from_str(&serde_json::to_string(&players).unwrap()).unwrap();
        for placement in 1..=9 {
            game.results[0].placement = placement;
            for _ in 0..100 { update_race_cycles(&mut players, &game); }
            assert_eq!(players[0].placement_counts[9], 100);
        }
        assert_eq!(players[0].placement_counts, vec![100; 10]);
        assert_eq!(players[0].cycles, 100);
        game.results[0].placement = 1;
        update_race_cycles(&mut players, &game);
        assert_eq!(players[0].placement_counts[0], 101);
        assert_eq!(players[0].placement_counts[9], 100);
        assert_eq!(players[0].cycles, 100);
        assert_eq!(players[0].current_positions(), vec![1]);
        game.game_type = GameType::BattleRoyale;
        let before = serde_json::to_string(&players).unwrap();
        assert!(update_race_cycles(&mut players, &game).is_empty());
        assert_eq!(serde_json::to_string(&players).unwrap(), before);
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
        assert!(changed_result_paths(&[race.with_file_name("LastCustomRaceMapPlayed.csv")], &race).is_empty());
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
        let mut snapshot = test_snapshot();
        snapshot.total_battle_royale_count = 2;
        snapshot.session_results.push(game);
        snapshot.session.games_played = 1;
        clear_session_results(&mut snapshot);
        assert!(snapshot.session_results.is_empty());
        assert_eq!(snapshot.total_battle_royale_count, 2);
    }

    #[test]
    fn three_first_places_are_preserved_for_three_completed_cycles() {
        let mut game = streamer_bot::sample_game();
        game.results = vec![result("Player", 1, 0)];
        let mut players = Vec::new();
        for _ in 0..3 { update_race_cycles(&mut players, &game); }
        assert_eq!(players[0].cycle_race_counts, vec![Some(3), Some(2), Some(1)]);
        for cycle in 1..=3 {
            for placement in 2..=10 {
                game.results[0].placement = placement;
                let completed = update_race_cycles(&mut players, &game);
                if placement == 10 { assert_eq!(completed[0].cycle_number, cycle); }
                else { assert!(completed.is_empty()); }
            }
            assert_eq!(players[0].placement_counts[0], 3);
            assert_eq!(players[0].cycles, cycle);
            assert_eq!(players[0].current_positions(), if cycle < 3 { vec![1] } else { vec![] });
            players = serde_json::from_str(&serde_json::to_string(&players).unwrap()).unwrap();
        }
    }

    #[test]
    fn histories_keep_full_results_and_survive_independent_resets_without_a_limit() {
        let mut game = streamer_bot::sample_game();
        game.results = vec![result("Player", 1, 0)];
        let mut state = RaceState::default();
        for number in 0..260 {
            game.id = format!("race-{number}");
            game.source_snapshot_id = Some(format!("source-{number}"));
            state = prepare_race_commit(&state, &game, true, true, "now", ReadReason::Manual).unwrap().0;
        }
        assert_eq!(state.cycle_history.len(), 260);
        assert_eq!(state.cycle_history[0].earnings[0].points_earned, 1);
        assert_eq!(state.cycle_history[0].game.as_ref().unwrap().results.len(), 1);
        assert_eq!(state.cycle_history[259].standings[0].placement_counts[0], 260);
        reset_stats_totals(&mut state);
        reset_cycle_totals(&mut state);
        let restored: RaceState = serde_json::from_str(&serde_json::to_string(&state).unwrap()).unwrap();
        assert_eq!(restored.cycle_history.len(), 260);
        assert!(restored.current_result.is_none());
        assert!(restored.race_cycles.is_empty());
        game.id = "outside-top-ten".into();
        game.source_snapshot_id = None;
        game.results[0].placement = 11;
        let next = prepare_race_commit(&restored, &game, false, true, "now", ReadReason::Manual).unwrap().0;
        assert_eq!(next.cycle_history.len(), 260);
        game.game_type = GameType::BattleRoyale;
        assert!(prepare_race_commit(&next, &game, false, true, "now", ReadReason::Manual).is_none());
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
        game.results[1].season_points_earned = 0;
        let mut session = vec![game.clone()];
        assert_eq!(session.iter().map(game_points_earned).sum::<i64>(), 7);
        let (both, _, _) = prepare_race_commit(&race, &game, true, false, "next", ReadReason::Manual).unwrap();
        assert_eq!(both.season_points_earned, 25);
        let restored: RaceState = serde_json::from_str(&serde_json::to_string(&both).unwrap()).unwrap();
        assert_eq!(restored.season_points_earned, 25);
        assert!(prepare_race_commit(&restored, &game, true, false, "duplicate", ReadReason::Manual).is_none());
        game.results[0].season_points_earned = 11;
        assert!(prepare_race_commit(&restored, &game, true, false, "auto-br-edit", ReadReason::FileChanged).is_none());
        let (corrected, stats_new, _) = prepare_race_commit(&restored, &game, true, false, "br-edit", ReadReason::Manual).unwrap();
        assert_eq!(corrected.season_points_earned, 29);
        refresh_counted_result(&mut session, &game);
        assert_eq!(session.len(), 1);
        assert_eq!(session.iter().map(game_points_earned).sum::<i64>(), 11);
        assert_eq!(corrected.total_battle_royale_count, 1);
        assert!(!stats_new);
        // A normal BR does not award cycle placements; a Race-only commit must
        // still leave season points untouched when RaceStats is disabled.
        assert!(prepare_race_commit(&RaceState::default(), &game, false, true, "br-cycles", ReadReason::Manual).is_none());
        let mut cycle_game = game.clone();
        cycle_game.game_type = GameType::Race;
        let (cycles_only, _, _) = prepare_race_commit(&RaceState::default(), &cycle_game, false, true, "cycles", ReadReason::Manual).unwrap();
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
    fn cycles_track_unique_players_across_rows_and_matches() {
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
        game.results[0].player_name = "Other".into();
        game.results[0].display_name = "Other".into();
        game.results[0].username = "other".into();
        update_race_cycles(&mut players, &game);
        assert_eq!(players.len(), 2);
    }

}
