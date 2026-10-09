use crate::models::{AppSnapshot, GameResult, StreamerBotConfig};
use serde_json::{json, Value};
use std::time::Duration;

const NETWORK_TIMEOUT: Duration = Duration::from_millis(1500);

fn http_error(config: &StreamerBotConfig, status: u16) -> String {
    if config.port == 8080 && status == 400 {
        return "Port 8080 is Streamer.bot's WebSocket server. Start Servers/Clients â†’ HTTP Server and use its port (default 7474).".into();
    }
    format!("Streamer.bot returned HTTP {status}")
}

fn endpoint(config: &StreamerBotConfig) -> Result<String, String> {
    let host = config.host.trim();
    if host.is_empty() || host.contains(['\r', '\n']) {
        return Err("Streamer.bot host is invalid".into());
    }
    Ok(format!("{host}:{}", config.port))
}

fn request(
    config: &StreamerBotConfig,
    method: &str,
    path: &str,
    body: Option<&[u8]>,
) -> Result<reqwest::blocking::Response, String> {
    let client = reqwest::blocking::Client::builder()
        .no_proxy()
        .connect_timeout(NETWORK_TIMEOUT)
        .timeout(NETWORK_TIMEOUT)
        .build().map_err(|error| format!("Unable to create Streamer.bot client: {error}"))?;
    let method = reqwest::Method::from_bytes(method.as_bytes()).map_err(|error| error.to_string())?;
    let mut request = client.request(method, format!("http://{}{path}", endpoint(config)?))
        .header("Accept", "application/json")
        .header("Content-Type", "application/json");
    if let Some(body) = body { request = request.body(body.to_vec()); }
    request.send().map_err(|error| format!("Unable to connect to Streamer.bot: {error}"))
}

fn get_actions(config: &StreamerBotConfig) -> Result<Value, String> {
    let response = request(config, "GET", "/GetActions", None)?;
    let status = response.status().as_u16();
    if status != 200 { return Err(http_error(config, status)); }
    response.json().map_err(|error| format!("Invalid Streamer.bot action list: {error}"))
}

fn enabled_action_id(actions: &Value, action_name: &str) -> Result<String, String> {
    let name = action_name.trim();
    if name.is_empty() { return Err("Streamer.bot action name is empty".into()); }
    let actions = actions["actions"].as_array()
        .ok_or("Streamer.bot did not return an actions list")?;
    let action = actions.iter().find(|action| action["name"].as_str() == Some(name))
        .ok_or_else(|| format!("Streamer.bot action '{name}' does not exist"))?;
    match action["enabled"].as_bool() {
        Some(true) => {},
        Some(false) => return Err(format!("Streamer.bot action '{name}' is disabled. Enable it in Streamer.bot.")),
        None => return Err(format!("Streamer.bot did not report whether action '{name}' is enabled; its state cannot be verified.")),
    }
    action["id"].as_str().filter(|id| !id.is_empty()).map(str::to_owned)
        .ok_or_else(|| format!("Streamer.bot action '{name}' has no ID"))
}

pub fn test_connection(config: &StreamerBotConfig) -> Result<(), String> {
    get_actions(config).map(|_| ())
}

pub fn trigger_action(
    config: &StreamerBotConfig,
    action_name: &str,
    args: Value,
) -> Result<(), String> {
    if action_name.trim().is_empty() { return Err("Streamer.bot action name is empty".into()); }
    // A successful HTTP response alone does not prove that a disabled action ran.
    let id = enabled_action_id(&get_actions(config)?, action_name)?;
    let body = serde_json::to_vec(&json!({ "action": { "id": id }, "args": args }))
        .map_err(|error| error.to_string())?;
    let status = request(config, "POST", "/DoAction", Some(&body))?.status().as_u16();
    if status == 204 || status == 200 { Ok(()) } else { Err(http_error(config, status)) }
}

fn placements(game: &GameResult) -> Vec<Value> {
    game.results
        .iter()
        .map(|result| {
            json!({
                "place": result.placement,
                "name": result.player_name,
                "username": result.username,
                "platform": result.platform,
                "points": result.season_points_earned,
                "seasonTotal": result.season_points_total,
                "time": result.finish_time,
                "eliminated": result.eliminated,
                "kills": result.raw_data.get("MatchKills").and_then(|value| value.parse::<u64>().ok()),
                "damage": result.raw_data.get("MatchDamageDealt").and_then(|value| value.parse::<f64>().ok()),
            })
        })
        .collect()
}

// Scalar arguments let normal Streamer.bot sub-actions use player fields directly.
fn add_player_args(args: &mut Value, prefix: &str, player: Option<&crate::models::PlayerResult>) {
    args[format!("{prefix}username")] = json!(player.map(|p| p.username.as_str()).unwrap_or(""));
    args[format!("{prefix}platform")] = json!(player.map(|p| p.platform.as_str()).unwrap_or(""));
    args[format!("{prefix}placement")] = json!(player.map(|p| p.placement));
    args[format!("{prefix}seasontotal")] = json!(player.and_then(|p| p.season_points_total));
    args[format!("{prefix}kills")] = json!(player.and_then(|p| p.raw_data.get("MatchKills")).and_then(|v| v.parse::<u64>().ok()));
    args[format!("{prefix}damage")] = json!(player.and_then(|p| p.raw_data.get("MatchDamageDealt")).and_then(|v| v.parse::<f64>().ok()));
    args[format!("{prefix}eliminated")] = json!(player.and_then(|p| p.eliminated));
}

pub fn game_complete_args(game: &GameResult) -> Value {
    let placements = placements(game);
    let mut args = json!({
        "eventType": "raceComplete",
        "race": match game.game_type { crate::models::GameType::BattleRoyale => "Battle Royale", crate::models::GameType::Tilt => "Tilt", _ => "Race" },
        "gameId": game.id,
        "snapshotId": game.source_snapshot_id,
        "gameType": game.game_type,
        "playerCount": game.player_count,
        "timestamp": game.timestamp,
        "mapName": game.map_name,
        "hasWorldRecord": game.has_world_record,
        "placementsJson": serde_json::to_string(&placements).unwrap_or_default(),
        "placements": placements,
    });
    let podium = podium_args(game);
    if let (Some(args), Some(podium)) = (args.as_object_mut(), podium.as_object()) {
        args.extend(podium.clone());
    }
    args
}

pub fn podium_args(game: &GameResult) -> Value {
    let placements = placements(game);
    let player = |index: usize| game.results.iter().find(|result| result.placement == (index + 1) as u32);
    let mut args = json!({
        "gameId": game.id,
        "gameType": game.game_type,
        "firstplace": player(0).map(|result| result.player_name.as_str()).unwrap_or(""),
        "firstplacepoints": player(0).map(|result| result.season_points_earned).unwrap_or(0),
        "firstplacetime": player(0).and_then(|result| result.finish_time),
        "secondplace": player(1).map(|result| result.player_name.as_str()).unwrap_or(""),
        "secondplacepoints": player(1).map(|result| result.season_points_earned).unwrap_or(0),
        "secondplacetime": player(1).and_then(|result| result.finish_time),
        "thirdplace": player(2).map(|result| result.player_name.as_str()).unwrap_or(""),
        "thirdplacepoints": player(2).map(|result| result.season_points_earned).unwrap_or(0),
        "thirdplacetime": player(2).and_then(|result| result.finish_time),
        "firstName": player(0).map(|result| result.player_name.as_str()).unwrap_or(""),
        "firstPoints": player(0).map(|result| result.season_points_earned).unwrap_or(0),
        "firstUsername": player(0).map(|result| result.username.as_str()).unwrap_or(""),
        "firstTime": player(0).and_then(|result| result.finish_time),
        "secondName": player(1).map(|result| result.player_name.as_str()).unwrap_or(""),
        "secondPoints": player(1).map(|result| result.season_points_earned).unwrap_or(0),
        "secondUsername": player(1).map(|result| result.username.as_str()).unwrap_or(""),
        "secondTime": player(1).and_then(|result| result.finish_time),
        "thirdName": player(2).map(|result| result.player_name.as_str()).unwrap_or(""),
        "thirdPoints": player(2).map(|result| result.season_points_earned).unwrap_or(0),
        "thirdUsername": player(2).map(|result| result.username.as_str()).unwrap_or(""),
        "thirdTime": player(2).and_then(|result| result.finish_time),
        "placementsJson": serde_json::to_string(&placements).unwrap_or_default(),
        "placements": placements,
    });
    for (index, prefix) in ["firstplace", "secondplace", "thirdplace"].iter().enumerate() {
        add_player_args(&mut args, prefix, player(index));
    }
    args
}

pub fn world_record_args(game: &GameResult) -> Value {
    let record_player = game.world_record_player.as_deref().and_then(|name| {
        game.results.iter().find(|player| player.player_name.eq_ignore_ascii_case(name) || player.username.eq_ignore_ascii_case(name))
    });
    let username = record_player.map(|player| player.username.as_str()).unwrap_or("");
    let points = record_player.map(|player| player.season_points_earned);
    let name = record_player.map(|player| player.player_name.as_str()).or(game.world_record_player.as_deref());
    let mut args = json!({
        "eventType": "worldRecord",
        "gameId": game.id,
        "gameType": game.game_type,
        "playerName": game.world_record_player,
        "playerUsername": username,
        "playerPoints": points,
        "wrplayer": name,
        "wrplayerpoints": points,
        "wrrecordtime": game.world_record_time,
        "player": name,
        "playerpoints": points,
        "recordtime": game.world_record_time,
        "recordTime": game.world_record_time,
        "mapName": game.map_name,
    });
    add_player_args(&mut args, "wrplayer", record_player);
    args
}

pub fn event_actions(config: &StreamerBotConfig, game: &GameResult, season_name: &str) -> Vec<(String, Value)> {
    let mut actions = vec![];
    if config.events.race_complete {
        actions.push((config.actions.game_complete.clone(), game_complete_args(game)));
    }
    if config.events.world_record && game.has_world_record {
        actions.push((config.actions.world_record.clone(), world_record_args(game)));
    }
    for (_, args) in &mut actions {
        args["seasonName"] = json!(season_name);
    }
    actions
}

pub fn cycle_complete_args(game: &GameResult, player: &str, cycle: u64, races: Option<u64>) -> Value {
    let result = game.results.iter().find(|result| result.player_name.eq_ignore_ascii_case(player) || result.username.eq_ignore_ascii_case(player));
    let mut args = json!({"eventType":"cycleComplete", "eventId":format!("cycle:{}:{}:{}", game.id, player, cycle), "gameId":game.id, "cycleplayer":player,
        "cyclenumber":cycle, "cycleraces":races, "cycleplayerpoints":result.map(|p| p.season_points_earned)});
    add_player_args(&mut args, "cycleplayer", result);
    args
}

pub fn overlay_data(snapshot: &AppSnapshot, game: Option<&GameResult>, args: &Value, completions: Value) -> Value {
    let mut data = game.map(game_complete_args).unwrap_or_else(|| json!({"eventType":"stateUpdate", "placements":[], "playerCount":0, "mapName":null}));
    if let (Some(data), Some(args)) = (data.as_object_mut(), args.as_object()) {
        data.extend(args.clone());
    }
    let sum_points = |game: &GameResult| game.results.iter().map(|player| player.season_points_earned).sum::<i64>();
    let mut identities = std::collections::HashSet::new();
    for game in &snapshot.session_results {
        for player in &game.results {
            let name = if player.username.trim().is_empty() { &player.player_name } else { &player.username };
            identities.insert(format!("{}:{}", player.platform.trim().to_lowercase(), name.trim().to_lowercase()));
        }
    }
    let mut leaders = snapshot.race_cycles.clone();
    leaders.sort_by(crate::models::compare_cycle_players);
    leaders.truncate(3);
    data["eventId"] = args.get("eventId").cloned().unwrap_or_else(|| json!(format!("{}:{}", args["eventType"].as_str().unwrap_or("raceComplete"), game.map(|game| game.id.as_str()).unwrap_or("empty"))));
    data["seasonName"] = json!(snapshot.config.seasons.race_name);
    data["cycleSeasonName"] = json!(snapshot.config.seasons.cycle_name);
    data["matchPoints"] = json!(game.map(sum_points).unwrap_or(0));
    data["sessionPoints"] = json!(snapshot.session_results.iter().map(sum_points).sum::<i64>());
    data["seasonPoints"] = json!(snapshot.season_points_earned);
    data["sessionRaces"] = json!(snapshot.session_results.iter().filter(|game| game.game_type == crate::models::GameType::Race).count());
    data["sessionBRs"] = json!(snapshot.session_results.iter().filter(|game| game.game_type == crate::models::GameType::BattleRoyale).count());
    data["sessionPlayers"] = json!(identities.len());
    data["cyclePlayers"] = json!(snapshot.race_cycles.len());
    data["cycleRaces"] = json!(snapshot.total_cycle_race_count);
    data["cycleLeaders"] = json!(leaders.iter().map(|player| {
        let mut row = json!(player);
        row["currentCyclePositions"] = json!(player.current_positions());
        row["cycleProgress"] = json!(player.cycle_progress());
        row
    }).collect::<Vec<_>>());
    data["cycleCompletions"] = completions;
    data
}

pub fn add_overlay_data(args: &mut Value, snapshot: &AppSnapshot, game: &GameResult, completions: Value) {
    let data = overlay_data(snapshot, Some(game), args, completions);
    if let (Some(args), Some(data)) = (args.as_object_mut(), data.as_object()) {
        args.extend(data.clone());
    }
    args["overlayDataJson"] = json!(serde_json::to_string(&data).unwrap_or_default());
}

pub(crate) fn sample_game() -> GameResult {
    use crate::models::{GameType, PlayerResult};
    GameResult {
        id: "test-game".into(), source_snapshot_id: Some("test-snapshot".into()),
        timestamp: "2026-01-01T00:00:00Z".into(), game_type: GameType::Race, player_count: 3,
        results: ["Test Winner", "Test Second", "Test Third"].iter().enumerate().map(|(index, name)| PlayerResult {
            player_name: (*name).into(), username: format!("test_player_{}", index + 1),
            display_name: (*name).into(), platform: "Twitch".into(), name_color_hex: None,
            placement: (index + 1) as u32, season_points_earned: 10 - index as i64 * 2,
            season_points_total: None, season_wins_total: None, season_matches_played_total: None,
            finish_time: Some(42.123 + index as f64), eliminated: Some(false), raw_data: Default::default(),
        }).collect(),
        has_world_record: true, world_record_player: Some("Test Winner".into()),
        world_record_time: Some(42.123), map_name: Some("Test Map".into()),
    }
}

pub fn test_args(kind: &str) -> Value {
    let mut game = sample_game();
    let mut args = if kind == "worldRecord" {
        world_record_args(&game)
    } else if kind == "cycleComplete" {
        game.has_world_record = false;
        cycle_complete_args(&game, "Test Winner", 1, Some(823))
    } else {
        game.has_world_record = false;
        game_complete_args(&game)
    };
    args["seasonName"] = json!("Test season");
    args["isTest"] = json!(true);
    // Tests use the same overlay envelope and never alter real app stats.
    let placements = placements(&game);
    let mut data = game_complete_args(&game);
    if let (Some(data), Some(args)) = (data.as_object_mut(), args.as_object()) {
        data.extend(args.clone());
    }
    data["placements"] = json!(placements);
    data["eventId"] = json!(format!("test:{}:{}", kind, chrono::Utc::now().timestamp_millis()));
    data["matchPoints"] = json!(24);
    data["sessionPoints"] = json!(240);
    data["seasonPoints"] = json!(1200);
    data["sessionRaces"] = json!(7);
    data["sessionBRs"] = json!(2);
    data["sessionPlayers"] = json!(30);
    data["cycleSeasonName"] = json!("Test season");
    data["cyclePlayers"] = json!(30);
    data["cycleRaces"] = json!(9);
    data["cycleLeaders"] = json!([{"playerName":"Test Winner","cycles":1,"placementCounts":[2,2,1,1,2,1,1,1,1,2],"currentCyclePositions":[1,2,5,10],"cycleProgress":4}]);
    data["cycleCompletions"] = json!([{"playerName":"Test Winner","cycleNumber":1,"races":823}]);
    if let (Some(args), Some(data)) = (args.as_object_mut(), data.as_object()) {
        args.extend(data.clone());
    }
    args["overlayDataJson"] = json!(serde_json::to_string(&data).unwrap_or_default());
    args
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn action_preflight_requires_existing_enabled_action() {
        let actions = json!({"actions": [
            {"id": "enabled-id", "name": "Enabled action", "enabled": true},
            {"id": "disabled-id", "name": "Disabled action", "enabled": false},
            {"id": "unknown-id", "name": "Unknown state"}
        ]});
        assert_eq!(enabled_action_id(&actions, "Enabled action").unwrap(), "enabled-id");
        assert!(enabled_action_id(&actions, "Disabled action").unwrap_err().contains("is disabled"));
        assert!(enabled_action_id(&actions, "Missing action").unwrap_err().contains("does not exist"));
        assert!(enabled_action_id(&actions, "Unknown state").unwrap_err().contains("cannot be verified"));
        assert!(enabled_action_id(&actions, "").is_err());
        assert!(enabled_action_id(&json!({}), "Enabled action").is_err());
    }

    #[test]
    fn overlay_test_packets_include_common_and_record_fields_without_recursion() {
        for kind in ["gameComplete", "worldRecord", "cycleComplete"] {
            let args = test_args(kind);
            let packet: Value = serde_json::from_str(args["overlayDataJson"].as_str().unwrap()).unwrap();
            assert_eq!(packet["matchPoints"], 24);
            assert_eq!(packet["sessionPoints"], 240);
            assert_eq!(args["sessionPoints"], packet["sessionPoints"]);
            assert_eq!(packet["firstplacepoints"], 10);
            assert_eq!(packet["placements"].as_array().unwrap().len(), 3);
            assert_eq!(packet["cycleCompletions"][0]["races"], 823);
            assert!(packet.get("overlayDataJson").is_none());
            if kind == "cycleComplete" {
                assert_eq!(packet["eventType"], "cycleComplete");
                assert_eq!(packet["cycleplayer"], "Test Winner");
                assert_eq!(packet["cyclenumber"], 1);
                assert_eq!(packet["cycleraces"], 823);
            }
            if kind == "worldRecord" {
                assert_eq!(packet["eventType"], "worldRecord");
                assert_eq!(packet["wrplayerpoints"], 10);
                assert_eq!(packet["wrrecordtime"], 42.123);
            }
        }
    }

    #[test]
    fn event_player_fields_are_direct_action_arguments() {
        let mut game = sample_game();
        game.game_type = crate::models::GameType::BattleRoyale;
        game.results[0].raw_data.insert("MatchKills".into(), "3".into());
        game.results[0].raw_data.insert("MatchDamageDealt".into(), "2189".into());
        let args = game_complete_args(&game);
        assert_eq!(args["race"], "Battle Royale");
        assert_eq!(args["firstplacekills"], 3);
        assert_eq!(args["firstplacedamage"], 2189.0);
        assert_eq!(args["firstplaceusername"], "test_player_1");
        assert_eq!(world_record_args(&game)["wrplayerplacement"], 1);
        let cycle = cycle_complete_args(&game, "test_player_1", 2, Some(823));
        assert_eq!(cycle["cycleplayerpoints"], 10);
        assert_eq!(cycle["cycleplayerusername"], "test_player_1");
    }

    #[test]
    fn event_switches_are_independent_and_require_a_confirmed_record() {
        let mut config = StreamerBotConfig::default();
        let mut game = sample_game();
        config.events.world_record = false;
        assert!(!config.has_enabled_events());
        assert!(event_actions(&config, &game, "Season 72").is_empty());
        config.events.world_record = true;
        assert!(config.has_enabled_events());
        config.events.race_complete = false;
        let actions = event_actions(&config, &game, "Season 72");
        assert_eq!(actions.len(), 1);
        assert_eq!(actions[0].0, config.actions.world_record);
        assert_eq!(actions[0].1["playerUsername"], "test_player_1");
        game.has_world_record = false;
        assert!(event_actions(&config, &game, "Season 72").is_empty());
        config.events.race_complete = true;
        config.events.world_record = false;
        game.has_world_record = true;
        let actions = event_actions(&config, &game, "Season 72");
        assert_eq!(actions.len(), 1);
        assert_eq!(actions[0].0, config.actions.game_complete);
        assert_eq!(actions[0].1["seasonName"], "Season 72");
        assert_eq!(actions[0].1["firstName"], "Test Winner");
        assert_eq!(actions[0].1["firstTime"], 42.123);
        assert_eq!(actions[0].1["placements"].as_array().unwrap().len(), 3);
        let placements: Value = serde_json::from_str(actions[0].1["placementsJson"].as_str().unwrap()).unwrap();
        assert_eq!(placements, actions[0].1["placements"]);
        config.events.race_complete = false;
        assert!(event_actions(&config, &game, "Season 72").is_empty());
    }

    #[test]
    fn old_settings_keep_connection_and_action_names() {
        let config: StreamerBotConfig = serde_json::from_value(json!({
            "enabled": true, "host": "127.0.0.1", "port": 7474,
            "actions": {"gameComplete": "My Race", "podium": "Old Podium", "worldRecord": "My Record"}
        })).unwrap();
        assert_eq!(config.actions.game_complete, "My Race");
        assert_eq!(config.actions.world_record, "My Record");
        assert_eq!(config.actions.cycle_complete, "Marbles - Cycle Complete");
        assert!(!config.events.cycle_complete);
        assert!(!config.events.race_complete && config.events.world_record);
    }

    #[test]
    fn overlay_player_arguments_include_earned_points_and_actual_places() {
        let mut game = sample_game();
        game.results.reverse();
        let args = game_complete_args(&game);
        assert_eq!(args["firstplace"], "Test Winner");
        assert_eq!(args["firstplacepoints"], 10);
        assert_eq!(args["secondplace"], "Test Second");
        assert_eq!(args["secondplacepoints"], 8);
        assert_eq!(args["thirdplace"], "Test Third");
        assert_eq!(args["thirdplacepoints"], 6);
        game.world_record_player = Some("test_player_2".into());
        let record = world_record_args(&game);
        assert_eq!(record["wrplayer"], "Test Second");
        assert_eq!(record["wrplayerpoints"], 8);
        assert_eq!(record["playerPoints"], 8);
        assert_eq!(record["wrrecordtime"], 42.123);
        game.world_record_player = Some("Unmatched record holder".into());
        assert!(world_record_args(&game)["wrplayerpoints"].is_null());
    }
}
