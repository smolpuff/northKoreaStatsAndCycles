use crate::models::{GameResult, GameType, TwitchConfig};
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;

const CREDENTIAL_TARGET: &str = "MarblesStats/TwitchOAuth";
const REQUIRED_SCOPE: &str = "user:write:chat";
const MAX_CHAT_MESSAGE_CHARS: usize = 500;

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct StoredTwitchCredential {
    access_token: String,
    client_id: String,
    pub user_id: String,
    pub login: String,
}

#[derive(Debug, Deserialize)]
struct TokenValidation {
    client_id: String,
    login: String,
    user_id: String,
    scopes: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct ChatResponse {
    data: Vec<ChatMessageResult>,
}

#[derive(Debug, Deserialize)]
struct ChatMessageResult {
    is_sent: bool,
    drop_reason: Option<ChatDropReason>,
}

#[derive(Debug, Deserialize)]
struct ChatDropReason {
    message: String,
}

pub fn complete_authorization(
    access_token: String,
    client_id: String,
) -> Result<StoredTwitchCredential, String> {
    if access_token.trim().is_empty() || client_id.trim().is_empty() {
        return Err("Twitch authorization returned incomplete credentials".into());
    }
    let client = http_client()?;
    let validation = validate_access_token(&client, &access_token)?;
    verify_authorization(&validation, &client_id)?;
    let credential = StoredTwitchCredential {
        access_token,
        client_id,
        user_id: validation.user_id,
        login: validation.login,
    };
    save_credential(&credential)?;
    Ok(credential)
}

#[cfg(windows)]
pub fn open_authorization(desktop_id: &str) -> Result<(), String> {
    use std::{os::windows::ffi::OsStrExt, ptr};
    use windows_sys::Win32::{UI::Shell::ShellExecuteW, UI::WindowsAndMessaging::SW_SHOWNORMAL};

    if desktop_id.is_empty()
        || desktop_id.len() > 64
        || !desktop_id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '-')
    {
        return Err("Invalid Twitch authorization request".into());
    }

    let address =
        format!("http://localhost:8080/api/public/auth/twitch/start?next=%2F&desktop={desktop_id}");
    let address: Vec<u16> = std::ffi::OsStr::new(&address)
        .encode_wide()
        .chain(Some(0))
        .collect();
    let operation: Vec<u16> = std::ffi::OsStr::new("open")
        .encode_wide()
        .chain(Some(0))
        .collect();
    let result = unsafe {
        ShellExecuteW(
            ptr::null_mut(),
            operation.as_ptr(),
            address.as_ptr(),
            ptr::null(),
            ptr::null(),
            SW_SHOWNORMAL,
        )
    };
    if result as isize <= 32 {
        Err("Windows could not open Twitch authorization".into())
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
pub fn open_authorization(_desktop_id: &str) -> Result<(), String> {
    Err("Twitch authorization is supported on Windows only".into())
}

pub fn stored_identity() -> Option<String> {
    load_credential()
        .ok()
        .flatten()
        .map(|credential| credential.login)
}

pub fn validate_saved() -> Result<StoredTwitchCredential, String> {
    let mut credential = load_credential()?.ok_or("No Twitch account is connected")?;
    let client = http_client()?;
    let validation = validate_access_token(&client, &credential.access_token)
        .map_err(|_| "Twitch login expired; click Connect Twitch again".to_string())?;
    verify_authorization(&validation, &credential.client_id)?;
    credential.user_id = validation.user_id;
    credential.login = validation.login;
    save_credential(&credential)?;
    Ok(credential)
}

pub fn disconnect() -> Result<(), String> {
    delete_credential()
}

pub fn send_results(config: &TwitchConfig, game: &GameResult) -> Result<usize, String> {
    if !config.post_results {
        return Ok(0);
    }
    let credential = validate_saved()?;
    let messages = format_race_result_messages(game, &config.message_prefix);
    for message in &messages {
        send_chat_message(&credential, message)?;
    }
    Ok(messages.len())
}

pub fn format_world_record_message(game: &GameResult, template: &str) -> String {
    let player = game.world_record_player.as_deref().and_then(|name| game.results.iter().find(|p|
        p.player_name.eq_ignore_ascii_case(name) || p.username.eq_ignore_ascii_case(name)));
    let name = player.map(|p| p.player_name.as_str()).or(game.world_record_player.as_deref()).unwrap_or("Unknown player");
    let points = player.map(|p| p.season_points_earned.to_string()).unwrap_or_else(|| "unknown".into());
    let time = game.world_record_time.map(|time| format!("{time:.3}")).unwrap_or_else(|| "unknown".into());
    let fallback = crate::models::default_world_record_message();
    let template = if template.trim().is_empty() { &fallback } else { template.trim() };
    // Resolve only original template tokens; player names are never templates.
    let fields = [("{wrplayer}", name), ("{wrplayerpoints}", points.as_str()), ("{wrrecordtime}", time.as_str()), ("{mapName}", game.map_name.as_deref().unwrap_or("Unknown track"))];
    let mut message = String::new();
    let mut rest = template;
    while !rest.is_empty() {
        if let Some((token, value)) = fields.iter().find(|(token, _)| rest.starts_with(*token)) {
            message.push_str(value);
            rest = &rest[token.len()..];
        } else {
            let character = rest.chars().next().unwrap();
            message.push(character);
            rest = &rest[character.len_utf8()..];
        }
    }
    message.chars().take(MAX_CHAT_MESSAGE_CHARS).collect()
}

pub fn send_world_record(config: &TwitchConfig, game: &GameResult) -> Result<(), String> {
    if !config.post_world_records || !game.has_world_record { return Ok(()); }
    let credential = validate_saved()?;
    send_chat_message(&credential, &format_world_record_message(game, &config.world_record_message_template))
}

pub fn format_cycle_completion_message(
    player_name: &str,
    cycle_number: u64,
    races: Option<u64>,
    message_template: &str,
) -> String {
    let fallback = "🎉 Congrats {player} on a cycle! You are great! That's cycle #{cycle}! 🎉";
    let template = if message_template.trim().is_empty() {
        fallback
    } else {
        message_template.trim()
    };
    let message = template
        .replace("{player}", player_name.trim())
        .replace("{cycle}", &cycle_number.to_string())
        .replace("{races}", &races.map(|count| count.to_string()).unwrap_or_else(|| "unknown".into()));
    message.chars().take(MAX_CHAT_MESSAGE_CHARS).collect()
}

pub fn send_cycle_completion(
    player_name: &str,
    cycle_number: u64,
    races: Option<u64>,
    message_template: &str,
) -> Result<String, String> {
    let credential = validate_saved()?;
    let message = format_cycle_completion_message(player_name, cycle_number, races, message_template);
    send_chat_message(&credential, &message)?;
    Ok(message)
}

pub fn format_race_result_messages(game: &GameResult, message_prefix: &str) -> Vec<String> {
    let match_type = match game.game_type {
        GameType::BattleRoyale => "Battle Royale",
        GameType::Tilt => "Tilt",
        _ => "Race",
    };
    let prefix = message_prefix.trim().replace("{race}", match_type)
        .chars().take(120).collect::<String>();
    let message_start = if prefix.is_empty() {
        String::new()
    } else {
        format!("{prefix} ")
    };
    let mut messages = Vec::new();
    let mut current = message_start.clone();
    let mut entries_in_current = 0;

    let has_scoring_players = game.results.iter().any(|result| result.season_points_earned > 0);
    let fallback_places = if game.game_type == GameType::BattleRoyale { 1 } else { 3 };
    for result in game.results.iter().filter(|result| {
        if has_scoring_players { result.season_points_earned > 0 }
        else { result.placement > 0 && result.placement <= fallback_places && result.eliminated != Some(true) }
    }) {
        let place = match result.placement {
            1 => "\u{1f947}".into(),
            2 => "\u{1f948}".into(),
            3 => "\u{1f949}".into(),
            placement => format!("#{placement}"),
        };
        let entry = if has_scoring_players {
            format!("{place} {} +{}pts", result.player_name, result.season_points_earned)
        } else {
            // Blank CSV points must not suppress the completed match or invent points.
            format!("{place} {}", result.player_name)
        };
        let separator = if entries_in_current == 0 { "" } else { " | " };
        let candidate_length =
            current.chars().count() + separator.chars().count() + entry.chars().count();

        if entries_in_current > 0 && candidate_length > MAX_CHAT_MESSAGE_CHARS {
            messages.push(current);
            current = message_start.clone();
            entries_in_current = 0;
        }

        let separator = if entries_in_current == 0 { "" } else { " | " };
        current.push_str(separator);
        current.push_str(&entry);
        entries_in_current += 1;
    }

    if entries_in_current > 0 {
        messages.push(current);
    }
    messages
}

fn send_chat_message(credential: &StoredTwitchCredential, message: &str) -> Result<(), String> {
    let client = http_client()?;
    let response = client
        .post("https://api.twitch.tv/helix/chat/messages")
        .bearer_auth(&credential.access_token)
        .header("Client-Id", &credential.client_id)
        .json(&serde_json::json!({
            "broadcaster_id": credential.user_id,
            "sender_id": credential.user_id,
            "message": message,
        }))
        .send()
        .map_err(|error| format!("Unable to post Twitch results: {error}"))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("Twitch rejected the chat message ({status})"));
    }
    let result = response
        .json::<ChatResponse>()
        .map_err(|error| format!("Invalid Twitch chat response: {error}"))?
        .data
        .into_iter()
        .next()
        .ok_or("Twitch returned no message result")?;
    if !result.is_sent {
        return Err(result
            .drop_reason
            .map(|reason| reason.message)
            .unwrap_or_else(|| "Twitch dropped the chat message".into()));
    }
    Ok(())
}

fn http_client() -> Result<Client, String> {
    Client::builder()
        .connect_timeout(Duration::from_secs(8))
        .timeout(Duration::from_secs(15))
        .user_agent("MarblesStats/0.1")
        .build()
        .map_err(|error| format!("Unable to initialize Twitch connection: {error}"))
}

fn validate_access_token(client: &Client, access_token: &str) -> Result<TokenValidation, String> {
    client
        .get("https://id.twitch.tv/oauth2/validate")
        .header("Authorization", format!("OAuth {access_token}"))
        .send()
        .map_err(|error| format!("Unable to validate Twitch login: {error}"))?
        .error_for_status()
        .map_err(|_| "Saved Twitch login has expired".to_string())?
        .json::<TokenValidation>()
        .map_err(|error| format!("Invalid Twitch validation response: {error}"))
}

fn verify_authorization(validation: &TokenValidation, client_id: &str) -> Result<(), String> {
    if validation.client_id != client_id {
        return Err("Twitch returned a token for a different application".into());
    }
    if !validation
        .scopes
        .iter()
        .any(|scope| scope == REQUIRED_SCOPE)
    {
        return Err("Twitch login is missing the user:write:chat permission".into());
    }
    Ok(())
}

#[cfg(windows)]
fn save_credential(value: &StoredTwitchCredential) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Security::Credentials::{
        CredWriteW, CREDENTIALW, CRED_PERSIST_LOCAL_MACHINE, CRED_TYPE_GENERIC,
    };

    let mut blob = serde_json::to_vec(value)
        .map_err(|error| format!("Unable to protect Twitch login: {error}"))?;
    let mut target: Vec<u16> = std::ffi::OsStr::new(CREDENTIAL_TARGET)
        .encode_wide()
        .chain(Some(0))
        .collect();
    let mut username: Vec<u16> = std::ffi::OsStr::new(&value.login)
        .encode_wide()
        .chain(Some(0))
        .collect();
    let credential = CREDENTIALW {
        Type: CRED_TYPE_GENERIC,
        TargetName: target.as_mut_ptr(),
        CredentialBlobSize: blob.len() as u32,
        CredentialBlob: blob.as_mut_ptr(),
        Persist: CRED_PERSIST_LOCAL_MACHINE,
        UserName: username.as_mut_ptr(),
        ..Default::default()
    };
    let result = unsafe { CredWriteW(&credential, 0) };
    blob.fill(0);
    if result == 0 {
        Err(format!(
            "Windows Credential Manager could not save the Twitch login: {}",
            std::io::Error::last_os_error()
        ))
    } else {
        Ok(())
    }
}

#[cfg(windows)]
fn load_credential() -> Result<Option<StoredTwitchCredential>, String> {
    use std::{os::windows::ffi::OsStrExt, ptr};
    use windows_sys::Win32::Security::Credentials::{
        CredFree, CredReadW, CREDENTIALW, CRED_TYPE_GENERIC,
    };

    let target: Vec<u16> = std::ffi::OsStr::new(CREDENTIAL_TARGET)
        .encode_wide()
        .chain(Some(0))
        .collect();
    let mut raw: *mut CREDENTIALW = ptr::null_mut();
    let result = unsafe { CredReadW(target.as_ptr(), CRED_TYPE_GENERIC, 0, &mut raw) };
    if result == 0 {
        let error = std::io::Error::last_os_error();
        return if error.raw_os_error() == Some(1168) {
            Ok(None)
        } else {
            Err(format!("Unable to read the saved Twitch login: {error}"))
        };
    }

    let parsed = unsafe {
        let credential = &*raw;
        let bytes = std::slice::from_raw_parts(
            credential.CredentialBlob,
            credential.CredentialBlobSize as usize,
        );
        serde_json::from_slice::<StoredTwitchCredential>(bytes)
    };
    unsafe { CredFree(raw.cast()) };
    parsed
        .map(Some)
        .map_err(|error| format!("The saved Twitch login is invalid: {error}"))
}

#[cfg(windows)]
fn delete_credential() -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Security::Credentials::{CredDeleteW, CRED_TYPE_GENERIC};

    let target: Vec<u16> = std::ffi::OsStr::new(CREDENTIAL_TARGET)
        .encode_wide()
        .chain(Some(0))
        .collect();
    let result = unsafe { CredDeleteW(target.as_ptr(), CRED_TYPE_GENERIC, 0) };
    if result == 0 {
        let error = std::io::Error::last_os_error();
        if error.raw_os_error() != Some(1168) {
            return Err(format!("Unable to remove the Twitch login: {error}"));
        }
    }
    Ok(())
}

#[cfg(not(windows))]
fn save_credential(_value: &StoredTwitchCredential) -> Result<(), String> {
    Err("Secure Twitch login storage is supported on Windows only".into())
}

#[cfg(not(windows))]
fn load_credential() -> Result<Option<StoredTwitchCredential>, String> {
    Ok(None)
}

#[cfg(not(windows))]
fn delete_credential() -> Result<(), String> {
    Ok(())
}

#[cfg(test)]
mod tests {

    #[test]
    fn world_record_message_uses_record_holder_points_and_brace_fields() {
        let mut game = crate::streamer_bot::sample_game();
        game.world_record_player = Some("TEST_PLAYER_2".into());
        game.world_record_time = Some(41.25);
        assert_eq!(super::format_world_record_message(&game, "{mapName}: {wrplayer} {wrrecordtime}s +{wrplayerpoints} pts"), "Test Map: Test Second 41.250s +8 pts");
        game.results[1].player_name = "{wrplayerpoints}".into();
        assert_eq!(super::format_world_record_message(&game, "{wrplayer} +{wrplayerpoints}"), "{wrplayerpoints} +8");
        game.world_record_player = Some("Missing player".into());
        assert_eq!(super::format_world_record_message(&game, "{wrplayerpoints}"), "unknown");
        assert_eq!(super::format_world_record_message(&game, &"x".repeat(600)).chars().count(), 500);
        assert!(super::format_world_record_message(&game, "").contains("points on Test Map"));
    }

    #[test]
    fn old_twitch_settings_keep_world_record_posting_disabled() {
        let config: crate::models::TwitchConfig = serde_json::from_str(r#"{"postResults":true}"#).unwrap();
        assert!(!config.post_world_records);
        assert!(config.world_record_message_template.contains("{wrplayerpoints}"));
    }
    use super::*;
    use crate::models::{GameType, PlayerResult};
    use std::collections::HashMap;

    fn result(name: &str, placement: u32, points: i64) -> PlayerResult {
        PlayerResult {
            player_name: name.into(),
            username: name.into(),
            display_name: name.into(),
            platform: "Twitch".into(),
            name_color_hex: None,
            placement,
            season_points_earned: points,
            season_points_total: None,
            season_wins_total: None,
            season_matches_played_total: None,
            finish_time: None,
            eliminated: None,
            raw_data: HashMap::new(),
        }
    }

    #[test]
    fn formats_chat_results_from_csv_points() {
        let mut game = GameResult {
            id: "test".into(),
            source_snapshot_id: None,
            timestamp: "2026-01-01T00:00:00Z".into(),
            game_type: GameType::Race,
            player_count: 3,
            results: vec![
                result("rmrfkorea", 1, 12344),
                result("Second", 2, 900),
                result("Third", 3, 700),
                result("NoPoints", 4, 0),
            ],
            has_world_record: false,
            world_record_player: None,
            world_record_time: None,
            map_name: None,
        };
        assert_eq!(
            format_race_result_messages(&game, "🏁 Race results:"),
            vec!["\u{1f3c1} Race results: \u{1f947} rmrfkorea +12344pts | \u{1f948} Second +900pts | \u{1f949} Third +700pts"]
        );
        assert!(format_race_result_messages(&game, "{race} winner:")[0].starts_with("Race winner:"));
        game.game_type = GameType::BattleRoyale;
        assert!(format_race_result_messages(&game, "{race} winner:")[0].starts_with("Battle Royale winner:"));
    }

    #[test]
    fn posts_podium_when_csv_has_no_earned_points() {
        let mut game = crate::streamer_bot::sample_game();
        game.results = vec![result("Winner", 1, 0), result("Second", 2, 0),
            result("Third", 3, 0), result("Fourth", 4, 0)];
        game.player_count = game.results.len();
        game.game_type = GameType::Race;
        let messages = format_race_result_messages(&game, "{race} results:");
        assert_eq!(messages.len(), 1);
        assert!(messages[0].contains("Winner"));
        assert!(messages[0].contains("Second"));
        assert!(messages[0].contains("Third"));
        assert!(!messages[0].contains("Fourth"));
        assert!(!messages[0].contains("pts"));
        game.game_type = GameType::BattleRoyale;
        let messages = format_race_result_messages(&game, "{race} winner:");
        assert!(messages[0].starts_with("Battle Royale winner:"));
        assert!(messages[0].contains("Winner"));
        assert!(!messages[0].contains("Second"));
        game.results.clear();
        assert!(format_race_result_messages(&game, "{race} results:").is_empty());
    }

    #[test]
    fn splits_long_point_scoring_results_into_twitch_sized_messages() {
        let results = (1..=20)
            .map(|placement| {
                result(
                    &format!("Player_{placement}_with_a_long_display_name"),
                    placement,
                    25,
                )
            })
            .collect::<Vec<_>>();
        let game = GameResult {
            id: "long-test".into(),
            source_snapshot_id: None,
            timestamp: "2026-01-01T00:00:00Z".into(),
            game_type: GameType::Race,
            player_count: results.len(),
            results,
            has_world_record: false,
            world_record_player: None,
            world_record_time: None,
            map_name: None,
        };

        let messages = format_race_result_messages(&game, "🏁 Race results:");
        assert!(messages.len() >= 2);
        assert!(messages
            .iter()
            .all(|message| message.chars().count() <= MAX_CHAT_MESSAGE_CHARS));
        assert!(messages.iter().any(|message| message.contains("Player_20")));
    }

    #[test]
    fn formats_custom_cycle_message_placeholders() {
        assert_eq!(format_cycle_completion_message("Player", 2, Some(823), "{player}: cycle {cycle}, {races} races"),
            "Player: cycle 2, 823 races");
        assert_eq!(format_cycle_completion_message("Player", 2, None, "Cycle complete!"), "Cycle complete!");
        assert_eq!(format_cycle_completion_message("Player", 2, Some(823), "rmrfkoBurn rmrfkoBurn Congrats {player}! Cycle #{cycle}!"),
            "rmrfkoBurn rmrfkoBurn Congrats Player! Cycle #2!");
        assert_eq!(format_cycle_completion_message("Player", 2, None, "{player}: {races} races"), "Player: unknown races");
        assert_eq!(
            format_cycle_completion_message(
                "rmrfkorea",
                3,
                Some(823),
                "✨ {player} completed cycle #{cycle}! ✨"
            ),
            "✨ rmrfkorea completed cycle #3! ✨ Only took 823 races for this cycle!"
        );
    }
}
