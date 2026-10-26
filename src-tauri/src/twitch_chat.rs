//! Optional EventSub listener. Reads only the connected broadcaster's channel;
//! replies use the existing Helix sender and never enter the scoring pipeline.
use crate::{
    emit_snapshot, log,
    models::{GameResult, GameType, RaceCyclePlayer, TwitchConfig},
    twitch, SharedRuntime,
};
use serde_json::Value;
use std::{
    collections::{HashMap, VecDeque},
    net::{TcpStream, ToSocketAddrs},
    thread,
    time::{Duration, Instant},
};
use tungstenite::{stream::MaybeTlsStream, Message, WebSocket};

const ENDPOINT: &str = "wss://eventsub.wss.twitch.tv/ws";
type Socket = WebSocket<MaybeTlsStream<TcpStream>>;

pub fn format_reply(login: &str, players: &[RaceCyclePlayer]) -> String {
    let key = format!("twitch:{}", login.to_ascii_lowercase());
    let Some(player) = players
        .iter()
        .find(|player| player.player_key.eq_ignore_ascii_case(&key))
    else {
        return format!("Cycle data for @{login} - No RaceCycles data yet. Join a race while RaceCycles tracking is on!");
    };
    let positions = player.current_positions();
    let missing = (1..=10u8)
        .filter(|place| !positions.contains(place))
        .map(|place| place.to_string())
        .collect::<Vec<_>>()
        .join(", ");
    let races = if player.total_races_complete {
        player.total_races.to_string()
    } else {
        let placements = player
            .placement_counts
            .iter()
            .take(10)
            .fold(0u64, |sum, count| sum.saturating_add(*count));
        format!("at least {}", player.total_races.max(placements))
    };
    format!("Cycle data for @{login} - Total Races: {races}. Completed Cycles: {}. Current Progress: {}/10. Need: {missing}",
        player.completed_cycles(), positions.len())
}

// Use committed RaceStats results, never cumulative CSV season totals or cycle imports.
fn stats_totals(login: &str, games: &[GameResult]) -> (u64, u64, i64) {
    let mut stream_races = 0;
    let mut races = 0;
    let mut points = 0i64;
    for game in games {
        let race = game.game_type == GameType::Race;
        if race {
            stream_races += 1;
        }
        if let Some(player) = game.results.iter().find(|player| {
            player.platform.eq_ignore_ascii_case("twitch")
                && player.username.eq_ignore_ascii_case(login)
        }) {
            if race {
                races += 1;
            }
            points = points.saturating_add(player.season_points_earned);
        }
    }
    (races, stream_races, points)
}

fn format_stats_reply(login: &str, session: &[GameResult], history: &[GameResult]) -> String {
    let (races, stream_races, points) = stats_totals(login, session);
    let (total_races, _, total_points) = stats_totals(login, history);
    format!("@{login} | This session: {races} of {stream_races} stream races, {points} points | All-time tracked: {total_races} races, {total_points} points")
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
enum ViewerCommand {
    Cycles,
    Stats,
}

impl ViewerCommand {
    fn enabled(self, config: &TwitchConfig) -> bool {
        match self {
            Self::Cycles => config.my_cycle_command,
            Self::Stats => config.my_stats_command,
        }
    }
    fn name(self) -> &'static str {
        match self {
            Self::Cycles => "!mycycles",
            Self::Stats => "!mystats",
        }
    }
}

#[derive(Default)]
struct Commands {
    seen: VecDeque<String>,
    users: HashMap<(String, ViewerCommand), Instant>,
}

impl Commands {
    fn accept(&mut self, id: &str, user: &str, kind: ViewerCommand, now: Instant) -> bool {
        if id.is_empty() || self.seen.iter().any(|seen| seen == id) {
            return false;
        }
        self.seen.push_back(id.into());
        if self.seen.len() > 1024 {
            self.seen.pop_front();
        }
        self.users
            .retain(|_, at| now.duration_since(*at) < Duration::from_secs(30));
        // A viewer only consumes their own cooldown for this command.
        let key = (user.to_owned(), kind);
        if self.users.contains_key(&key) {
            return false;
        }
        self.users.insert(key, now);
        true
    }
}

pub fn validate_command_aliases(config: &TwitchConfig) -> Result<(), String> {
    let cycles = config.my_cycle_command_alias.trim();
    let stats = config.my_stats_command_alias.trim();
    for alias in [cycles, stats] {
        if alias.is_empty() { continue; }
        if !alias.starts_with('!') || !(2..=33).contains(&alias.len())
            || !alias[1..].bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_') {
            return Err("Secondary commands must start with ! followed by 1-32 letters, numbers or underscores".into());
        }
    }
    if cycles.eq_ignore_ascii_case("!mystats") || stats.eq_ignore_ascii_case("!mycycles")
        || (!cycles.is_empty() && cycles.eq_ignore_ascii_case(stats)) {
        return Err("Choose different secondary commands for cycles and stats".into());
    }
    Ok(())
}

fn command<'a>(
    value: &'a Value,
    channel: &str,
    config: &TwitchConfig,
) -> Option<(&'a str, &'a str, &'a str, ViewerCommand)> {
    if value["metadata"]["subscription_type"] != "channel.chat.message" {
        return None;
    }
    let timestamp =
        chrono::DateTime::parse_from_rfc3339(value["metadata"]["message_timestamp"].as_str()?)
            .ok()?;
    let age = chrono::Utc::now()
        .signed_duration_since(timestamp)
        .num_seconds();
    if !(-30..=120).contains(&age) {
        return None;
    }
    let event = &value["payload"]["event"];
    if event["broadcaster_user_id"].as_str()? != channel {
        return None;
    }
    // Shared Chat messages originating in another stream are not local commands.
    if event["source_broadcaster_user_id"]
        .as_str()
        .is_some_and(|source| source != channel)
    {
        return None;
    }
    let text = event["message"]["text"].as_str()?.trim();
    let kind = if text.eq_ignore_ascii_case("!mycycles")
        || (!config.my_cycle_command_alias.trim().is_empty() && text.eq_ignore_ascii_case(config.my_cycle_command_alias.trim())) {
        ViewerCommand::Cycles
    } else if text.eq_ignore_ascii_case("!mystats")
        || (!config.my_stats_command_alias.trim().is_empty() && text.eq_ignore_ascii_case(config.my_stats_command_alias.trim())) {
        ViewerCommand::Stats
    } else { return None; };
    let login = event["chatter_user_login"].as_str()?;
    if login.is_empty()
        || login.len() > 25
        || !login
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_')
    {
        return None;
    }
    let user = event["chatter_user_id"].as_str()?;
    if user.is_empty() {
        return None;
    }
    Some((event["message_id"].as_str()?, user, login, kind))
}

fn reconnect_url(address: &str) -> bool {
    reqwest::Url::parse(address).is_ok_and(|url| {
        url.scheme() == "wss"
            && url.host_str() == Some("eventsub.wss.twitch.tv")
            && url.port().is_none()
            && url.username().is_empty()
            && url.password().is_none()
            && url.fragment().is_none()
            && url.path() == "/ws"
    })
}

fn connect(address: &str) -> Result<Socket, String> {
    if !reconnect_url(address) {
        return Err("Twitch returned an unexpected chat reconnect address".into());
    }
    let addresses = ("eventsub.wss.twitch.tv", 443)
        .to_socket_addrs()
        .map_err(|_| "Cannot resolve Twitch chat server")?;
    let deadline = Instant::now() + Duration::from_secs(8);
    let mut tcp = None;
    for address in addresses {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            break;
        }
        if let Ok(stream) = TcpStream::connect_timeout(&address, remaining) {
            tcp = Some(stream);
            break;
        }
    }
    let tcp = tcp.ok_or("Unable to connect to Twitch chat")?;
    tcp.set_read_timeout(Some(Duration::from_secs(8)))
        .map_err(|_| "Cannot configure Twitch handshake timeout")?;
    tcp.set_write_timeout(Some(Duration::from_secs(8)))
        .map_err(|_| "Cannot configure Twitch handshake timeout")?;
    let (mut socket, _) = tungstenite::client_tls(address, tcp)
        .map_err(|_| "Unable to establish secure Twitch chat connection")?;
    let tcp = match socket.get_mut() {
        MaybeTlsStream::Plain(tcp) => tcp,
        MaybeTlsStream::Rustls(tls) => &mut tls.sock,
        _ => return Err("Unsupported Twitch chat connection".into()),
    };
    tcp.set_read_timeout(Some(Duration::from_secs(1)))
        .map_err(|_| "Cannot configure Twitch chat read timeout")?;
    tcp.set_write_timeout(Some(Duration::from_secs(8)))
        .map_err(|_| "Cannot configure Twitch chat write timeout")?;
    socket.set_config(|config| {
        config.max_message_size = Some(512 * 1024);
        config.max_frame_size = Some(512 * 1024);
    });
    Ok(socket)
}

fn enabled(runtime: &SharedRuntime, login: Option<&str>) -> bool {
    runtime.lock().is_ok_and(|rt| {
        !rt.connection_checks_stopped
            && (rt.snapshot.config.twitch.my_cycle_command
                || rt.snapshot.config.twitch.my_stats_command)
            && rt.snapshot.twitch_status == "Connected"
            && login.is_none_or(|login| rt.snapshot.twitch_username.as_deref() == Some(login))
    })
}

fn status(runtime: &SharedRuntime, app: &tauri::AppHandle, message: &str) {
    let changed = if let Ok(mut rt) = runtime.lock() {
        if rt.snapshot.twitch_chat_message == message {
            false
        } else {
            rt.snapshot.twitch_chat_message = message.into();
            true
        }
    } else {
        false
    };
    if changed {
        emit_snapshot(runtime, app);
    }
}

fn listen(
    runtime: &SharedRuntime,
    app: &tauri::AppHandle,
    commands: &mut Commands,
) -> Result<(), String> {
    let mut credential = twitch::chat_credential()?;
    if !enabled(runtime, Some(&credential.login)) {
        return Ok(());
    }
    let mut socket = connect(ENDPOINT)?;
    let mut pending: Option<Socket> = None;
    let mut pending_since = Instant::now();
    let mut last_event = Instant::now();
    let mut timeout = Duration::from_secs(15);
    let mut validated = Instant::now();
    let mut subscribed = false;
    while enabled(runtime, Some(&credential.login)) {
        // Periodic validation also refreshes rotating credentials securely.
        if validated.elapsed() >= Duration::from_secs(3600) {
            let refreshed = twitch::chat_credential()?;
            if refreshed.user_id != credential.user_id {
                return Ok(());
            }
            credential = refreshed;
            validated = Instant::now();
        }
        if last_event.elapsed() > timeout + Duration::from_secs(2) {
            return Err("Twitch chat keepalive timed out; reconnecting".into());
        }
        if pending.is_some() && pending_since.elapsed() > Duration::from_secs(25) {
            return Err("Twitch chat reconnect timed out".into());
        }
        let active = pending.as_mut().unwrap_or(&mut socket);
        let message = match active.read() {
            Ok(Message::Text(text)) => text,
            Ok(Message::Ping(_)) => {
                active.flush().map_err(|_| "Twitch chat pong failed")?;
                continue;
            }
            Ok(Message::Close(_)) => return Err("Twitch chat closed; reconnecting".into()),
            Ok(_) => continue,
            Err(tungstenite::Error::Io(error))
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                ) =>
            {
                continue
            }
            Err(_) => return Err("Twitch chat disconnected; reconnecting".into()),
        };
        let value: Value =
            serde_json::from_str(&message).map_err(|_| "Twitch returned invalid chat data")?;
        last_event = Instant::now();
        match value["metadata"]["message_type"].as_str().unwrap_or("") {
            "session_welcome" => {
                timeout = Duration::from_secs(
                    value["payload"]["session"]["keepalive_timeout_seconds"]
                        .as_u64()
                        .unwrap_or(10)
                        .clamp(10, 600),
                );
                if let Some(new_socket) = pending.take() {
                    let _ = socket.close(None);
                    socket = new_socket; // Existing subscription transfers with the session.
                } else if !subscribed {
                    let session = value["payload"]["session"]["id"]
                        .as_str()
                        .ok_or("Twitch chat session ID missing")?;
                    twitch::subscribe_chat(&credential, session)?;
                    subscribed = true;
                }
                status(
                    runtime,
                    app,
                    &format!(
                        "Listening in #{} — enabled viewer commands are ready",
                        credential.login
                    ),
                );
            }
            "session_reconnect" => {
                let address = value["payload"]["session"]["reconnect_url"]
                    .as_str()
                    .ok_or("Twitch reconnect address missing")?;
                pending = Some(connect(address)?);
                pending_since = Instant::now();
            }
            "revocation" => {
                return Err(
                    "Twitch chat permission revoked; disconnect and reconnect Twitch".into(),
                )
            }
            "notification" if subscribed => {
                let config = runtime.lock().map_err(|_| "Application state unavailable")?.snapshot.config.twitch.clone();
                if let Some((id, user, login, kind)) = command(&value, &credential.user_id, &config) {
                    let reply = {
                        let rt = runtime
                            .lock()
                            .map_err(|_| "Application state unavailable")?;
                        if !kind.enabled(&rt.snapshot.config.twitch)
                            || !commands.accept(id, user, kind, Instant::now())
                        {
                            continue;
                        }
                        match kind {
                            ViewerCommand::Cycles => {
                                format_reply(login, &rt.race_state.race_cycles)
                            }
                            ViewerCommand::Stats => format_stats_reply(
                                login,
                                &rt.snapshot.session_results,
                                &rt.snapshot.recent_results,
                            ),
                        }
                    };
                    // Fetch current credentials before sending (the token may have rotated).
                    let current = twitch::validate_saved()?;
                    if current.user_id != credential.user_id
                        || !enabled(runtime, Some(&credential.login))
                    {
                        return Ok(());
                    }
                    if !runtime
                        .lock()
                        .is_ok_and(|rt| kind.enabled(&rt.snapshot.config.twitch))
                    {
                        continue;
                    }
                    match twitch::send_chat_message(&current, &reply) {
                        Ok(()) => log(
                            runtime,
                            app,
                            "info",
                            format!("[Twitch] {} reply sent", kind.name()),
                        ),
                        Err(error) => {
                            log(
                                runtime,
                                app,
                                "warning",
                                format!("[Twitch] {} reply failed: {error}", kind.name()),
                            );
                            return Err(format!(
                                "Twitch could not send {} reply; reconnecting",
                                kind.name()
                            ));
                        }
                    }
                }
            }
            _ => {}
        }
    }
    let _ = socket.close(None);
    Ok(())
}

pub fn start(runtime: &SharedRuntime, app: &tauri::AppHandle) {
    let runtime = runtime.clone();
    let app = app.clone();
    thread::spawn(move || {
        let mut commands = Commands::default();
        loop {
            let (stopped, configured) = match runtime.lock() {
                Ok(rt) => (
                    rt.connection_checks_stopped,
                    rt.snapshot.config.twitch.my_cycle_command
                        || rt.snapshot.config.twitch.my_stats_command,
                ),
                Err(_) => return,
            };
            if stopped {
                return;
            }
            if !configured {
                status(&runtime, &app, "Chat listener disabled");
            } else if !enabled(&runtime, None) {
                status(&runtime, &app, "Connect Twitch to use viewer commands");
            } else {
                status(&runtime, &app, "Connecting to Twitch chat…");
                if let Err(error) = listen(&runtime, &app, &mut commands) {
                    status(&runtime, &app, &error);
                    // Interruptible retry; toggling off/disconnecting stops it promptly.
                    for _ in 0..30 {
                        if !enabled(&runtime, None) {
                            break;
                        }
                        thread::sleep(Duration::from_secs(1));
                    }
                }
            }
            thread::sleep(Duration::from_secs(1));
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    fn player() -> RaceCyclePlayer {
        RaceCyclePlayer {
            player_key: "twitch:mandalynnmayhem".into(),
            player_name: "MandalynnMayhem".into(),
            total_races: 577,
            total_races_complete: true,
            placement_counts: vec![11, 10, 11, 10, 11, 11, 11, 11, 11, 11],
            cycles: 999,
            current_cycle_positions: None,
            cycle_race_counts: vec![],
        }
    }
    #[test]
    fn reply_uses_real_cycle_counts_and_missing_placements() {
        assert_eq!(format_reply("mandalynnmayhem", &[player()]), "Cycle data for @mandalynnmayhem - Total Races: 577. Completed Cycles: 10. Current Progress: 8/10. Need: 2, 4");
    }
    #[test]
    fn lookup_is_case_insensitive_and_platform_specific() {
        assert!(format_reply("MANDALYNNMAYHEM", &[player()]).contains("Completed Cycles: 10"));
        let mut other = player();
        other.player_key = "youtube:mandalynnmayhem".into();
        assert!(format_reply("mandalynnmayhem", &[other]).contains("No RaceCycles data yet"));
    }
    #[test]
    fn legacy_totals_are_reported_as_lower_bounds() {
        let mut legacy = player();
        legacy.total_races_complete = false;
        legacy.total_races = 0;
        assert!(format_reply("mandalynnmayhem", &[legacy]).contains("Total Races: at least 108"));
    }
    #[test]
    fn completed_cycle_starts_fresh_progress() {
        let mut complete = player();
        complete.placement_counts = vec![11; 10];
        assert!(format_reply("mandalynnmayhem", &[complete]).contains(
            "Completed Cycles: 11. Current Progress: 0/10. Need: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10"
        ));
    }
    #[test]
    fn cooldown_and_dedup_do_not_block_other_viewers() {
        let mut commands = Commands::default();
        let now = Instant::now();
        assert!(commands.accept("1", "a", ViewerCommand::Cycles, now));
        assert!(!commands.accept("1", "b", ViewerCommand::Cycles, now));
        assert!(!commands.accept("2", "a", ViewerCommand::Cycles, now));
        for index in 3..103 {
            assert!(commands.accept(&index.to_string(), &index.to_string(), ViewerCommand::Cycles, now));
        }
        assert!(!commands.accept("103", "7", ViewerCommand::Cycles, now));
        assert!(commands.accept("104", "a", ViewerCommand::Cycles, now + Duration::from_secs(31)));
    }
    fn event() -> Value {
        serde_json::json!({"metadata":{"subscription_type":"channel.chat.message","message_timestamp":chrono::Utc::now().to_rfc3339()},"payload":{"event":{
            "message_id":"message-1","broadcaster_user_id":"123","chatter_user_id":"456", "chatter_user_login":"alice",
            "message":{"text":" !MYCYCLE "}}}})
    }
    #[test]
    fn accepts_only_exact_command_from_connected_channel() {
        let mut value = event();
        assert_eq!(
            command(&value, "123", &TwitchConfig::default()),
            Some(("message-1", "456", "alice", ViewerCommand::Cycles))
        );
        assert!(command(&value, "789", &TwitchConfig::default()).is_none());
        value["payload"]["event"]["message"]["text"] = "!mycycle someone_else".into();
        assert!(command(&value, "123", &TwitchConfig::default()).is_none());
        value["payload"]["event"]["message"]["text"] = "!mycycle".into();
        value["payload"]["event"]["source_broadcaster_user_id"] = "789".into();
        assert!(command(&value, "123", &TwitchConfig::default()).is_none());
    }
    #[test]
    fn command_cooldowns_are_independent_and_cycle_aliases_share_a_limit() {
        let mut commands = Commands::default();
        let now = Instant::now();
        let mut value = event();
        for (index, text, expected) in [
            (0, "!mycycles", ViewerCommand::Cycles),
            (1, " !MYSTATS ", ViewerCommand::Stats),
            (2, "!mycycle", ViewerCommand::Cycles),
            (3, "!mystat", ViewerCommand::Stats),
        ] {
            value["payload"]["event"]["message"]["text"] = text.into();
            value["payload"]["event"]["message_id"] = format!("message-{index}").into();
            let (id, user, _, kind) = command(&value, "123", &TwitchConfig::default()).unwrap();
            assert_eq!(kind, expected);
            assert_eq!(commands.accept(id, user, kind, now), index < 2);
        }
        value["payload"]["event"]["message"]["text"] = "!mystats someone_else".into();
        assert!(command(&value, "123", &TwitchConfig::default()).is_none());
        let mut config = TwitchConfig::default();
        config.my_stats_command = true;
        assert!(ViewerCommand::Stats.enabled(&config));
        assert!(!ViewerCommand::Cycles.enabled(&config));
    }

    #[test]
    fn stats_reply_does_not_suppress_the_same_viewers_cycle_reply() {
        let mut commands = Commands::default();
        let now = Instant::now();
        assert!(commands.accept("stats", "viewer", ViewerCommand::Stats, now));
        assert!(commands.accept("cycles", "viewer", ViewerCommand::Cycles, now));
        assert!(!commands.accept("cycles-alias", "viewer", ViewerCommand::Cycles, now));
        assert!(!commands.accept("stats-again", "viewer", ViewerCommand::Stats, now));
        assert!(!commands.accept("cycles", "other-viewer", ViewerCommand::Stats, now));
        assert!(commands.accept("cycles-later", "viewer", ViewerCommand::Cycles, now + Duration::from_secs(31)));
    }

    #[test]
    fn configurable_aliases_keep_primary_commands_and_reject_collisions() {
        let mut config = TwitchConfig::default();
        config.my_cycle_command_alias = "!progress".into();
        config.my_stats_command_alias = "!points".into();
        validate_command_aliases(&config).unwrap();
        let mut value = event();
        for (text, expected) in [("!PROGRESS", ViewerCommand::Cycles), ("!points", ViewerCommand::Stats),
            ("!mycycles", ViewerCommand::Cycles), ("!mystats", ViewerCommand::Stats)] {
            value["payload"]["event"]["message"]["text"] = text.into();
            assert_eq!(command(&value, "123", &config).unwrap().3, expected);
        }
        for text in ["!mycycle", "!mystat", "!points alice", "hello !points"] {
            value["payload"]["event"]["message"]["text"] = text.into();
            assert!(command(&value, "123", &config).is_none());
        }
        config.my_cycle_command_alias.clear();
        config.my_stats_command_alias.clear();
        validate_command_aliases(&config).unwrap();
        for text in ["!mycycle", "!mystat"] {
            value["payload"]["event"]["message"]["text"] = text.into();
            assert!(command(&value, "123", &config).is_none());
        }
        for invalid in ["oops", "!", "!two words", "!?", "!mystats"] {
            config.my_cycle_command_alias = invalid.into();
            assert!(validate_command_aliases(&config).is_err());
        }
        config.my_cycle_command_alias = "!same".into();
        config.my_stats_command_alias = "!SAME".into();
        assert!(validate_command_aliases(&config).is_err());
    }

    fn stats_game(id: &str, kind: &str, login: &str, platform: &str, points: i64) -> GameResult {
        serde_json::from_value(serde_json::json!({
            "id": id, "timestamp": "2026-10-19T12:00:00Z", "gameType": kind,
            "playerCount": 1, "hasWorldRecord": false,
            "results": [{ "playerName": "Different display name", "username": login,
                "displayName": "Different display name", "platform": platform,
                "placement": 1, "seasonPointsEarned": points, "seasonPointsTotal": 9999,
                "rawData": {} }]
        }))
        .unwrap()
    }

    #[test]
    fn stats_use_session_participation_and_saved_earnings_by_twitch_login() {
        let race = stats_game("race", "race", "ALICE", "Twitch", 10);
        let other = stats_game("other", "race", "alice", "YouTube", 90);
        let br = stats_game("br", "battleRoyale", "alice", "Twitch", 7);
        let zero = stats_game("zero", "race", "alice", "Twitch", 0);
        let older = stats_game("older", "race", "alice", "Twitch", 5);
        let session = vec![race, other, br, zero];
        let mut history = session.clone();
        history.push(older);
        assert_eq!(format_stats_reply("alice", &session, &history),
            "@alice | This session: 2 of 3 stream races, 17 points | All-time tracked: 3 races, 22 points");
        assert_eq!(format_stats_reply("newviewer", &session, &history),
            "@newviewer | This session: 0 of 3 stream races, 0 points | All-time tracked: 0 races, 0 points");
        assert_eq!(format_stats_reply("alice", &[], &history),
            "@alice | This session: 0 of 0 stream races, 0 points | All-time tracked: 3 races, 22 points");
    }

    #[test]
    fn reconnect_accepts_only_twitch_wss() {
        assert!(reconnect_url(ENDPOINT));
        assert!(reconnect_url(
            "wss://eventsub.wss.twitch.tv/ws?reconnect=abc"
        ));
        for address in [
            "ws://eventsub.wss.twitch.tv/ws",
            "wss://evil.example/ws",
            "wss://eventsub.wss.twitch.tv.evil.example/ws",
            "wss://user@eventsub.wss.twitch.tv/ws",
        ] {
            assert!(!reconnect_url(address));
        }
    }
    #[test]
    fn stale_notifications_and_legacy_config_do_not_enable_replies() {
        let mut value = event();
        value["metadata"]["message_timestamp"] = "2000-01-01T00:00:00Z".into();
        assert!(command(&value, "123", &TwitchConfig::default()).is_none());
        let config: crate::models::TwitchConfig =
            serde_json::from_str(r#"{"postResults":true}"#).unwrap();
        assert_eq!(config.my_cycle_command_alias, "!mycycle");
        assert_eq!(config.my_stats_command_alias, "!mystat");
        assert!(!config.my_cycle_command);
        assert!(!config.my_stats_command);
        let enabled: crate::models::TwitchConfig =
            serde_json::from_str(r#"{"postResults":true,"myCycleCommand":true}"#).unwrap();
        assert!(enabled.my_cycle_command);
        assert!(!enabled.my_stats_command);
        let stats: TwitchConfig =
            serde_json::from_str(r#"{"postResults":true,"myStatsCommand":true}"#).unwrap();
        assert!(stats.my_stats_command);
        assert!(!stats.my_cycle_command);
    }
}
