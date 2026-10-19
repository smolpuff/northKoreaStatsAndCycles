//! Discord wiring stays downstream of persistence and never blocks the watcher.
use crate::{discord, emit_snapshot, log, models::*, snapshot_for_ui, streamer_bot, SharedRuntime};
use serde_json::json;
use std::{
    sync::mpsc,
    thread,
    time::{Duration, Instant},
};
use tauri::State;

fn status(runtime: &SharedRuntime, state: &str, message: Option<String>) {
    if let Ok(mut rt) = runtime.lock() {
        if !rt.snapshot.config.discord.enabled {
            rt.snapshot.discord_status = "Disabled".into();
            rt.snapshot.discord_message = None;
        } else {
            rt.snapshot.discord_status = state.into();
            rt.snapshot.discord_message = message;
        }
    }
}
fn is_current(runtime: &SharedRuntime, item: &discord::Delivery) -> bool {
    runtime.lock().is_ok_and(|rt| {
        rt.snapshot.config.discord.enabled
            && rt.discord_revision == item.revision
            && rt.snapshot.config.discord.events.get(&item.kind) == Some(&item.event)
    })
}
pub fn start(runtime: &SharedRuntime, app: &tauri::AppHandle) {
    start_connection_checks(runtime, app);
    let (tx, rx) = mpsc::sync_channel::<discord::Delivery>(128);
    if let Ok(mut rt) = runtime.lock() {
        rt.discord_tx = Some(tx);
    }
    let runtime = runtime.clone();
    let app = app.clone();
    thread::spawn(move || {
        while let Ok(item) = rx.recv() {
            if !is_current(&runtime, &item) {
                continue;
            }
            match discord::post(&item.event.target, &item.body, || {
                is_current(&runtime, &item)
            }) {
                Ok(true) => {
                    status(
                        &runtime,
                        "Connected",
                        Some(format!("Posted to #{}", item.event.target)),
                    );
                    log(
                        &runtime,
                        &app,
                        "info",
                        format!("[Discord] {} posted to #{}", item.kind, item.event.target),
                    );
                }
                Ok(false) => continue,
                Err(error) => {
                    status(&runtime, "Unavailable", Some(error.clone()));
                    log(&runtime, &app, "warning", format!("[Discord] {error}"));
                }
            }
            emit_snapshot(&runtime, &app);
        }
    });
}
fn start_connection_checks(runtime: &SharedRuntime, app: &tauri::AppHandle) {
    let runtime = runtime.clone();
    let app = app.clone();
    thread::spawn(move || {
        let mut revision = None;
        let mut next_check = Instant::now();
        loop {
            let (enabled, current_revision) = match runtime.lock() {
                Ok(rt) if rt.connection_checks_stopped => return,
                Ok(rt) => (rt.snapshot.config.discord.enabled, rt.discord_revision),
                Err(_) => return,
            };
            if enabled && (revision != Some(current_revision) || Instant::now() >= next_check) {
                let (state, message) = match discord::test_connection() {
                    Ok(()) => ("Connected", "Discord connection active".to_string()),
                    Err(error) => ("Unavailable", format!("{error}; retrying in 30 seconds")),
                };
                let changed = match runtime.lock() {
                    Ok(mut rt)
                        if rt.snapshot.config.discord.enabled
                            && rt.discord_revision == current_revision
                            && !rt.connection_checks_stopped =>
                    {
                        let changed = rt.snapshot.discord_status != state;
                        rt.snapshot.discord_status = state.into();
                        rt.snapshot.discord_message = Some(message.clone());
                        changed
                    }
                    _ => false,
                };
                if changed {
                    log(
                        &runtime,
                        &app,
                        if state == "Connected" {
                            "info"
                        } else {
                            "warning"
                        },
                        format!("[Discord] {message}"),
                    );
                    emit_snapshot(&runtime, &app);
                }
                revision = Some(current_revision);
                next_check = Instant::now() + Duration::from_secs(30);
            }
            if !enabled {
                revision = None;
            }
            thread::sleep(Duration::from_millis(250));
        }
    });
}
fn queue(
    runtime: &SharedRuntime,
    app: &tauri::AppHandle,
    config: &DiscordConfig,
    kind: &str,
    args: &serde_json::Value,
) {
    match discord::deliveries(config, kind, args) {
        Ok(items) => {
            let sender = runtime
                .lock()
                .ok()
                .and_then(|rt| rt.discord_tx.clone().map(|tx| (tx, rt.discord_revision)));
            for mut item in items {
                if let Some((_, revision)) = &sender {
                    item.revision = *revision;
                }
                if sender
                    .as_ref()
                    .is_none_or(|(tx, _)| tx.try_send(item).is_err())
                {
                    status(
                        runtime,
                        "Unavailable",
                        Some("Discord delivery queue is full; a post was skipped".into()),
                    );
                    log(
                        runtime,
                        app,
                        "warning",
                        "[Discord] Delivery queue unavailable or full; a post was skipped",
                    );
                    break;
                }
            }
        }
        Err(error) => {
            status(runtime, "Unavailable", Some(error.clone()));
            log(runtime, app, "warning", format!("[Discord] {error}"));
        }
    }
}
pub fn game_events(
    runtime: &SharedRuntime,
    app: &tauri::AppHandle,
    game: &GameResult,
    completions: &[crate::CycleCompletion],
    stats_new: bool,
) {
    let snapshot = match runtime.lock() {
        Ok(rt) => snapshot_for_ui(&rt.snapshot),
        Err(_) => return,
    };
    if !snapshot.config.discord.enabled {
        return;
    }
    let mut config = StreamerBotConfig::default();
    config.enabled = true;
    config.events = StreamerBotEvents {
        race_complete: true,
        world_record: true,
        cycle_complete: true,
        mission_promotion: false,
    };
    for (_, args) in streamer_bot::prepared_events(&config, &snapshot, game, completions, stats_new)
    {
        let kind = match args["eventType"].as_str() {
            Some("worldRecord") => "worldRecord",
            Some("cycleComplete") => "cycleComplete",
            _ => match game.game_type {
                GameType::BattleRoyale => "battleRoyale",
                GameType::Tilt => continue,
                _ => "race",
            },
        };
        queue(runtime, app, &snapshot.config.discord, kind, &args);
    }
}
pub fn confirmed_record(runtime: &SharedRuntime, app: &tauri::AppHandle, game: &GameResult) {
    let snapshot = match runtime.lock() {
        Ok(rt) => snapshot_for_ui(&rt.snapshot),
        Err(_) => return,
    };
    queue(
        runtime,
        app,
        &snapshot.config.discord,
        "worldRecord",
        &streamer_bot::confirmed_record_args(&snapshot, game),
    );
}
fn snapshot(runtime: &SharedRuntime) -> Result<AppSnapshot, String> {
    runtime
        .lock()
        .map(|rt| snapshot_for_ui(&rt.snapshot))
        .map_err(|_| "Application state unavailable".into())
}

#[tauri::command]
pub async fn save_discord_webhook(
    app: tauri::AppHandle,
    runtime: State<'_, SharedRuntime>,
    config: DiscordConfig,
    target: String,
    url: String,
) -> Result<AppSnapshot, String> {
    let runtime = runtime.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        discord::validate_config(&config)?;
        if !config.targets.contains(&target) {
            return Err("Choose a saved Discord channel target".into());
        }
        discord::save_webhook(&target, &url)?;
        {
            let mut rt = runtime
                .lock()
                .map_err(|_| "Application state unavailable")?;
            let mut settings = rt.snapshot.config.clone();
            settings.discord = config;
            rt.storage.write("config.json", &settings)?;
            rt.snapshot.config = settings;
            rt.discord_revision = rt.discord_revision.wrapping_add(1);
        }
        status(
            &runtime,
            "Connected",
            Some(format!("Webhook for #{target} verified and saved securely")),
        );
        emit_snapshot(&runtime, &app);
        snapshot(&runtime)
    })
    .await
    .map_err(|_| "Discord request worker failed".to_string())?
}
#[tauri::command]
pub fn remove_discord_webhook(
    app: tauri::AppHandle,
    runtime: State<'_, SharedRuntime>,
    mut config: DiscordConfig,
    target: String,
) -> Result<AppSnapshot, String> {
    discord::validate_config(&config)?;
    if !config.targets.contains(&target) {
        return Err("Unknown Discord target".into());
    }
    if config.targets.len() > 1 {
        config.targets.retain(|entry| entry != &target);
    }
    let fallback = config.targets[0].clone();
    for event in config
        .events
        .values_mut()
        .filter(|event| event.target == target)
    {
        event.enabled = false;
        event.target = fallback.clone();
    }
    {
        let mut rt = runtime
            .lock()
            .map_err(|_| "Application state unavailable")?;
        let mut settings = rt.snapshot.config.clone();
        settings.discord = config;
        rt.storage.write("config.json", &settings)?;
        rt.snapshot.config = settings;
        rt.discord_revision = rt.discord_revision.wrapping_add(1);
    }
    discord::remove_webhook(&target)?;
    status(
        &runtime,
        "Not checked",
        Some("Webhook removed; affected event posts were switched off".into()),
    );
    emit_snapshot(&runtime, &app);
    snapshot(&runtime)
}
#[tauri::command]
pub async fn test_discord(
    app: tauri::AppHandle,
    runtime: State<'_, SharedRuntime>,
    config: DiscordConfig,
    kind: String,
    target: Option<String>,
) -> Result<AppSnapshot, String> {
    let runtime = runtime.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let result = (|| -> Result<(), String> {
            if kind == "connection" {
                discord::test_connection()?;
            } else if kind == "webhook" {
                let target = target.as_deref().ok_or("Choose a Discord channel target")?;
                if !config.targets.iter().any(|entry| entry == target) {
                    return Err("Unknown Discord target".into());
                }
                discord::test_webhook(target)?;
            } else {
                discord::validate_config(&config)?;
                if !config.enabled {
                    return Err("Enable Discord before testing an event post".into());
                }
                let event = config.events.get(&kind).ok_or("Unknown Discord event")?;
                if !event.enabled {
                    return Err("Enable this Discord event before testing it".into());
                }
                let mut game = streamer_bot::sample_game();
                game.timestamp = chrono::Utc::now().to_rfc3339();
                game.game_type = match kind.as_str() {
                    "battleRoyale" => GameType::BattleRoyale,
                    _ => GameType::Race,
                };
                let mut args = match kind.as_str() {
                    "worldRecord" | "cycleComplete" => streamer_bot::test_args(&kind),
                    _ => streamer_bot::game_complete_args(&game),
                };
                let revision = runtime
                    .lock()
                    .map_err(|_| "Application state unavailable")?
                    .discord_revision;
                let snapshot = snapshot(&runtime)?;
                streamer_bot::add_overlay_data(&mut args, &snapshot, &game, json!([]));
                args["isTest"] = json!(true);
                if kind == "cycleComplete" {
                    args["cycleStandings"] = json!([]);
                    args["totalRaces"] = json!(1200);
                }
                args["timestamp"] = json!(game.timestamp);
                for content in discord::messages(event, &args)? {
                    let active = || {
                        runtime.lock().is_ok_and(|rt| {
                            rt.snapshot.config.discord.enabled && rt.discord_revision == revision
                        })
                    };
                    let body = discord::message_body(&kind, &content, &args)?;
                    if !discord::post(&event.target, &body, active)? {
                        return Err(
                            "Discord test cancelled because the integration was disabled".into(),
                        );
                    }
                }
            }
            Ok(())
        })();
        match result {
            Ok(()) => {
                status(
                    &runtime,
                    "Connected",
                    Some(if kind == "connection" {
                        "Discord connection active (no message posted)".into()
                    } else if kind == "webhook" {
                        "Webhook verified (no message posted)".into()
                    } else {
                        "Sample message confirmed by Discord".into()
                    }),
                );
                log(
                    &runtime,
                    &app,
                    "info",
                    if kind == "connection" {
                        "[Discord] Connection active"
                    } else if kind == "webhook" {
                        "[Discord] Webhook verified"
                    } else {
                        "[Discord] Sample message posted"
                    },
                );
                emit_snapshot(&runtime, &app);
                snapshot(&runtime)
            }
            Err(error) => {
                status(&runtime, "Unavailable", Some(error.clone()));
                log(&runtime, &app, "warning", format!("[Discord] {error}"));
                emit_snapshot(&runtime, &app);
                Err(error)
            }
        }
    })
    .await
    .map_err(|_| "Discord request worker failed".to_string())?
}
