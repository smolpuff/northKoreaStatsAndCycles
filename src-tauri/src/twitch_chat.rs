//! Optional EventSub listener. Reads only the connected broadcaster's channel;
//! replies use the existing Helix sender and never enter the scoring pipeline.
use crate::{emit_snapshot, log, models::RaceCyclePlayer, twitch, SharedRuntime};
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

#[derive(Default)]
struct Commands {
    seen: VecDeque<String>,
    users: HashMap<String, Instant>,
    sent: VecDeque<Instant>,
}

impl Commands {
    fn accept(&mut self, id: &str, user: &str, now: Instant) -> bool {
        if id.is_empty() || self.seen.iter().any(|seen| seen == id) {
            return false;
        }
        self.seen.push_back(id.into());
        if self.seen.len() > 1024 {
            self.seen.pop_front();
        }
        self.users
            .retain(|_, at| now.duration_since(*at) < Duration::from_secs(30));
        while self
            .sent
            .front()
            .is_some_and(|at| now.duration_since(*at) >= Duration::from_secs(30))
        {
            self.sent.pop_front();
        }
        // Leave room for automatic result messages on the same account.
        if self.users.contains_key(user) || self.sent.len() >= 5 {
            return false;
        }
        self.users.insert(user.into(), now);
        self.sent.push_back(now);
        true
    }
}

fn command<'a>(value: &'a Value, channel: &str) -> Option<(&'a str, &'a str, &'a str)> {
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
    if !event["message"]["text"]
        .as_str()?
        .trim()
        .eq_ignore_ascii_case("!mycycle")
    {
        return None;
    }
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
    Some((event["message_id"].as_str()?, user, login))
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
            && rt.snapshot.config.twitch.my_cycle_command
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
                        "Listening in #{} — viewers can type !mycycle",
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
                if let Some((id, user, login)) = command(&value, &credential.user_id) {
                    if !commands.accept(id, user, Instant::now()) {
                        continue;
                    }
                    let reply = {
                        let rt = runtime
                            .lock()
                            .map_err(|_| "Application state unavailable")?;
                        format_reply(login, &rt.race_state.race_cycles)
                    };
                    // Fetch current credentials before sending (the token may have rotated).
                    let current = twitch::validate_saved()?;
                    if current.user_id != credential.user_id
                        || !enabled(runtime, Some(&credential.login))
                    {
                        return Ok(());
                    }
                    match twitch::send_chat_message(&current, &reply) {
                        Ok(()) => log(runtime, app, "info", "[Twitch] !mycycle reply sent"),
                        Err(error) => {
                            log(
                                runtime,
                                app,
                                "warning",
                                format!("[Twitch] !mycycle reply failed: {error}"),
                            );
                            return Err("Twitch could not send !mycycle reply; reconnecting".into());
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
                    rt.snapshot.config.twitch.my_cycle_command,
                ),
                Err(_) => return,
            };
            if stopped {
                return;
            }
            if !configured {
                status(&runtime, &app, "Chat listener disabled");
            } else if !enabled(&runtime, None) {
                status(&runtime, &app, "Connect Twitch to listen for !mycycle");
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
    fn cooldown_dedup_and_global_limit_are_bounded() {
        let mut commands = Commands::default();
        let now = Instant::now();
        assert!(commands.accept("1", "a", now));
        assert!(!commands.accept("1", "b", now));
        assert!(!commands.accept("2", "a", now));
        for index in 3..7 {
            assert!(commands.accept(&index.to_string(), &index.to_string(), now));
        }
        assert!(!commands.accept("7", "7", now));
        assert!(commands.accept("8", "a", now + Duration::from_secs(31)));
    }
    fn event() -> Value {
        serde_json::json!({"metadata":{"subscription_type":"channel.chat.message","message_timestamp":chrono::Utc::now().to_rfc3339()},"payload":{"event":{
            "message_id":"message-1","broadcaster_user_id":"123","chatter_user_id":"456", "chatter_user_login":"alice",
            "message":{"text":" !MYCYCLE "}}}})
    }
    #[test]
    fn accepts_only_exact_command_from_connected_channel() {
        let mut value = event();
        assert_eq!(command(&value, "123"), Some(("message-1", "456", "alice")));
        assert!(command(&value, "789").is_none());
        value["payload"]["event"]["message"]["text"] = "!mycycle someone_else".into();
        assert!(command(&value, "123").is_none());
        value["payload"]["event"]["message"]["text"] = "!mycycle".into();
        value["payload"]["event"]["source_broadcaster_user_id"] = "789".into();
        assert!(command(&value, "123").is_none());
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
        assert!(command(&value, "123").is_none());
        let config: crate::models::TwitchConfig =
            serde_json::from_str(r#"{"postResults":true}"#).unwrap();
        assert!(!config.my_cycle_command);
        let enabled: crate::models::TwitchConfig =
            serde_json::from_str(r#"{"postResults":true,"myCycleCommand":true}"#).unwrap();
        assert!(enabled.my_cycle_command);
    }
}
