use crate::models::{GameResult, GameType, PlayerResult};
use chrono::{DateTime, Utc};
use sha2::{Digest, Sha256};
use std::{collections::HashMap, path::Path, time::SystemTime};

const REQUIRED_RACE_HEADERS: [&str; 12] = [
    "SnapshotId",
    "Position",
    "Username",
    "DisplayName",
    "Platform",
    "NameColorHex",
    "SeasonPointsEarned",
    "SeasonPointsTotal",
    "SeasonWinsTotal",
    "SeasonMatchesPlayedTotal",
    "TimeInRaceSeconds",
    "Eliminated",
];

#[derive(Clone, Debug, PartialEq)]
pub struct MapMetadata {
    pub map_name: String,
    pub record_time: Option<f64>,
    pub record_holder_name: Option<String>,
}

pub fn parse_file(path: &Path) -> Result<GameResult, String> {
    let modified = std::fs::metadata(path)
        .and_then(|m| m.modified())
        .unwrap_or(SystemTime::now());
    let timestamp: DateTime<Utc> = modified.into();
    let mut reader = csv::ReaderBuilder::new()
        .flexible(true)
        .from_path(path)
        .map_err(|e| format!("Unable to open CSV: {e}"))?;
    let headers = reader
        .headers()
        .map_err(|e| format!("Unable to read CSV headers: {e}"))?
        .clone();
    let game_type = detect_game_type(&headers)?;
    let mut game = parse_results(reader, headers, timestamp.to_rfc3339(), game_type)?;
    if game.game_type == GameType::BattleRoyale {
        apply_royale_summary(
            &mut game,
            &path.with_file_name("LastSeasonRoyaleSummary.csv"),
        )?;
    } else if game.game_type == GameType::Race {
        let summary = path.with_file_name("LastSeasonRaceSummary.csv");
        if summary.exists() {
            apply_game_summary(&mut game, &summary, false)?;
        }
    }
    Ok(game)
}

pub fn parse_map_metadata(path: &Path) -> Result<MapMetadata, String> {
    let mut reader = csv::ReaderBuilder::new()
        .flexible(true)
        .from_path(path)
        .map_err(|e| format!("Unable to open map CSV: {e}"))?;
    let headers = reader
        .headers()
        .map_err(|e| format!("Unable to read map CSV headers: {e}"))?
        .clone();
    for required in ["MapName", "RecordTime", "RecordHolderName"] {
        if !headers.iter().any(|header| header == required) {
            return Err(format!("Map CSV is missing required header {required}"));
        }
    }
    let record = reader
        .records()
        .next()
        .ok_or_else(|| "Map CSV contains no data row".to_string())?
        .map_err(|e| format!("Invalid map CSV row: {e}"))?;
    let values: HashMap<&str, &str> = headers.iter().zip(record.iter()).collect();
    let get = |name: &str| values.get(name).copied().unwrap_or("").trim();
    let map_name = get("MapName").to_owned();
    if map_name.is_empty() {
        return Err("Map CSV has no MapName".into());
    }
    let record_time = if get("RecordTime").is_empty() {
        None
    } else {
        Some(
            get("RecordTime")
                .parse::<f64>()
                .map_err(|_| format!("Invalid RecordTime '{}'", get("RecordTime")))?,
        )
    };
    let record_holder_name =
        (!get("RecordHolderName").is_empty()).then(|| get("RecordHolderName").to_owned());
    Ok(MapMetadata {
        map_name,
        record_time,
        record_holder_name,
    })
}

const REQUIRED_ROYALE_HEADERS: [&str; 14] = [
    "SnapshotId",
    "Position",
    "Username",
    "DisplayName",
    "Platform",
    "NameColorHex",
    "SurvivalTimeSeconds",
    "Eliminated",
    "MatchKills",
    "MatchDamageDealt",
    "SeasonPointsEarned",
    "SeasonPointsTotal",
    "SeasonWinsTotal",
    "SeasonMatchesPlayedTotal",
];

fn apply_royale_summary(game: &mut GameResult, path: &Path) -> Result<(), String> {
    apply_game_summary(game, path, true)
}

fn apply_game_summary(game: &mut GameResult, path: &Path, royale: bool) -> Result<(), String> {
    let mut reader =
        csv::Reader::from_path(path).map_err(|e| format!("Unable to read game summary: {e}"))?;
    let headers = reader.headers().map_err(|e| e.to_string())?.clone();
    for required in [
        "SnapshotId",
        "GeneratedAtUtc",
        "Status",
        "GameMode",
        "MapName",
        "PlayerCount",
    ] {
        if !headers.iter().any(|header| header == required) {
            return Err(format!("Game summary missing {required}"));
        }
    }
    let row = reader
        .records()
        .next()
        .ok_or("Game summary has no row")?
        .map_err(|e| e.to_string())?;
    let values: HashMap<&str, &str> = headers.iter().zip(row.iter()).collect();
    let get = |key: &str| values.get(key).copied().unwrap_or("").trim();
    let mode_matches = if royale { get("GameMode") == "Royale" } else { get("GameMode").contains("Race") };
    if get("Status") != "Final" || !mode_matches {
        return Err("Game summary is not a final result of the expected match type".into());
    }
    if game.source_snapshot_id.as_deref() != Some(get("SnapshotId")) || get("SnapshotId").is_empty()
    {
        return Err("Results and summary snapshot IDs do not match yet".into());
    }
    if get("PlayerCount").parse::<usize>().ok() != Some(game.player_count) {
        return Err("Results are incomplete: player count does not match summary".into());
    }
    if get("MapName").is_empty() {
        return Err("Game summary has no MapName".into());
    }
    chrono::DateTime::parse_from_rfc3339(get("GeneratedAtUtc"))
        .map_err(|_| "Invalid game summary GeneratedAtUtc")?;
    game.timestamp = get("GeneratedAtUtc").to_owned();
    game.map_name = Some(get("MapName").to_owned());
    Ok(())
}

fn detect_game_type(headers: &csv::StringRecord) -> Result<GameType, String> {
    if REQUIRED_ROYALE_HEADERS
        .iter()
        .all(|required| headers.iter().any(|h| h == *required))
    {
        return Ok(GameType::BattleRoyale);
    }
    if REQUIRED_RACE_HEADERS
        .iter()
        .all(|required| headers.iter().any(|h| h == *required))
    {
        Ok(GameType::Race)
    } else {
        Err(format!(
            "Unknown CSV schema. Required Race or Battle Royale headers were not found. Headers: {}",
            headers.iter().collect::<Vec<_>>().join(", ")
        ))
    }
}

fn parse_results(
    mut reader: csv::Reader<std::fs::File>,
    headers: csv::StringRecord,
    timestamp: String,
    game_type: GameType,
) -> Result<GameResult, String> {
    let mut results = Vec::new();
    let mut snapshot_ids = Vec::new();
    for record in reader.records() {
        let record = record.map_err(|e| format!("Invalid CSV row: {e}"))?;
        let raw_data: HashMap<String, String> = headers
            .iter()
            .zip(record.iter())
            .map(|(h, v)| (h.to_owned(), v.to_owned()))
            .collect();
        let get = |name: &str| raw_data.get(name).map(String::as_str).unwrap_or("").trim();
        let placement = get("Position")
            .parse::<u32>()
            .map_err(|_| format!("Invalid Position '{}'", get("Position")))?;
        let username = get("Username").to_owned();
        let display_name = get("DisplayName").to_owned();
        let player_name = if display_name.is_empty() {
            username.clone()
        } else {
            display_name.clone()
        };
        if player_name.is_empty() {
            return Err("CSV row has no DisplayName or Username".into());
        }
        let parse_optional_i64 = |name: &str| -> Result<Option<i64>, String> {
            let value = get(name);
            if value.is_empty() {
                Ok(None)
            } else {
                value
                    .parse()
                    .map(Some)
                    .map_err(|_| format!("Invalid {name} '{value}'"))
            }
        };
        let parse_optional_u64 = |name: &str| -> Result<Option<u64>, String> {
            let value = get(name);
            if value.is_empty() {
                Ok(None)
            } else {
                value
                    .parse()
                    .map(Some)
                    .map_err(|_| format!("Invalid {name} '{value}'"))
            }
        };
        let time_field = if game_type == GameType::BattleRoyale {
            "SurvivalTimeSeconds"
        } else {
            "TimeInRaceSeconds"
        };
        let finish_time = if get(time_field).is_empty() {
            None
        } else {
            Some(
                get(time_field)
                    .parse::<f64>()
                    .map_err(|_| format!("Invalid {time_field}"))?,
            )
        };
        let eliminated = match get("Eliminated").to_ascii_lowercase().as_str() {
            "true" => Some(true),
            "false" => Some(false),
            "" => None,
            value => return Err(format!("Invalid Eliminated value '{value}'")),
        };
        if game_type == GameType::BattleRoyale && get("SnapshotId").is_empty() {
            return Err("Royale result row has no SnapshotId".into());
        }
        if !get("SnapshotId").is_empty() {
            snapshot_ids.push(get("SnapshotId").to_owned());
        }
        let season_points_earned = if get("SeasonPointsEarned").is_empty() {
            0
        } else {
            get("SeasonPointsEarned").parse::<i64>().map_err(|_| {
                format!("Invalid SeasonPointsEarned '{}'", get("SeasonPointsEarned"))
            })?
        };
        results.push(PlayerResult {
            player_name,
            username,
            display_name,
            platform: get("Platform").to_owned(),
            name_color_hex: (!get("NameColorHex").is_empty())
                .then(|| get("NameColorHex").to_owned()),
            placement,
            season_points_earned,
            season_points_total: parse_optional_i64("SeasonPointsTotal")?,
            season_wins_total: parse_optional_u64("SeasonWinsTotal")?,
            season_matches_played_total: parse_optional_u64("SeasonMatchesPlayedTotal")?,
            finish_time,
            eliminated,
            raw_data,
        });
    }
    if results.is_empty() {
        return Err("CSV contains no result rows".into());
    }
    results.sort_by_key(|r| r.placement);
    if game_type == GameType::BattleRoyale
        && results
            .iter()
            .enumerate()
            .any(|(index, result)| result.placement as usize != index + 1)
    {
        return Err("Royale placements are incomplete or duplicated".into());
    }
    snapshot_ids.sort();
    snapshot_ids.dedup();
    let source_snapshot_id = (snapshot_ids.len() == 1).then(|| snapshot_ids[0].clone());
    let id = fingerprint(&results, source_snapshot_id.as_deref(), &game_type);
    Ok(GameResult {
        id,
        source_snapshot_id,
        timestamp,
        game_type,
        player_count: results.len(),
        results,
        has_world_record: false,
        world_record_player: None,
        world_record_time: None,
        map_name: None,
    })
}

fn fingerprint(
    results: &[PlayerResult],
    snapshot_id: Option<&str>,
    game_type: &GameType,
) -> String {
    let mut hash = Sha256::new();
    hash.update(if *game_type == GameType::BattleRoyale {
        b"royale\0".as_slice()
    } else {
        b"race\0".as_slice()
    });
    if let Some(value) = snapshot_id {
        hash.update(value.as_bytes());
        hash.update(b"\0");
    }
    for result in results {
        hash.update(result.placement.to_le_bytes());
        hash.update(result.player_name.trim().to_ascii_lowercase().as_bytes());
        hash.update(b"\0");
        if let Some(time) = result.finish_time {
            hash.update(time.to_bits().to_le_bytes());
        }
    }
    hex::encode(hash.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    #[test]
    fn parses_confirmed_race_schema_and_reads_season_points() {
        let file = std::env::temp_dir().join(format!(
            "marbles-parser-{}.csv",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::write(&file, "SnapshotId,Position,Username,DisplayName,Platform,NameColorHex,SeasonPointsEarned,SeasonPointsTotal,SeasonWinsTotal,SeasonMatchesPlayedTotal,TimeInRaceSeconds,Eliminated\nsnap,3,out,EliminatedPlayer,Twitch,FFFFFFFF,,,,,,true\nsnap,2,user,Display,Twitch,FFFFFFFF,8,,,,12.5,false\nsnap,1,winner,Winner,Twitch,FFFFFFFF,10,,,,11.0,false\n").unwrap();
        let parsed = parse_file(&file).unwrap();
        assert_eq!(parsed.results[0].player_name, "Winner");
        assert_eq!(parsed.results[0].platform, "Twitch");
        assert_eq!(parsed.results[0].season_points_earned, 10);
        assert_eq!(parsed.results[2].season_points_earned, 0);
        assert_eq!(parsed.results[2].eliminated, Some(true));
        assert_eq!(parsed.source_snapshot_id.as_deref(), Some("snap"));
        let id = parsed.id.clone();
        assert_eq!(parse_file(&file).unwrap().id, id);
        fs::remove_file(file).ok();
    }

    #[test]
    fn parses_confirmed_custom_map_schema() {
        let file = std::env::temp_dir().join(format!(
            "marbles-map-parser-{}.csv",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::write(&file, "MapName,CreatorName,DateCreated,TotalRaces,ElimRate,AverageFinishTime,RecordTime,RecordHolderName,DateSet,StreamerRecordHolder\nthe straight line,rizza_ttv,2026-09-26T17:00:24.133Z,25,0.205128,151.18718,129.964996,PixiePlayz3,2026.09.27-02.38.35,gtwaanlive\n").unwrap();
        let parsed = parse_map_metadata(&file).unwrap();
        assert_eq!(parsed.map_name, "the straight line");
        assert_eq!(parsed.record_time, Some(129.964996));
        assert_eq!(parsed.record_holder_name.as_deref(), Some("PixiePlayz3"));
        fs::remove_file(file).ok();
    }

    #[test]
    fn race_track_comes_from_matching_final_summary() {
        let directory = std::env::temp_dir().join(format!("marbles-race-summary-{}",
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
        fs::create_dir_all(&directory).unwrap();
        let results = directory.join("LastSeasonRace.csv");
        let summary = directory.join("LastSeasonRaceSummary.csv");
        fs::write(&results, include_str!("../tests/fixtures/LastSeasonRace.csv")).unwrap();
        let summary_text = include_str!("../tests/fixtures/LastSeasonRaceSummary.csv");
        fs::write(&summary, summary_text).unwrap();
        let game = parse_file(&results).unwrap();
        assert_eq!(game.game_type, GameType::Race);
        assert_eq!(game.map_name.as_deref(), Some("my masters machine"));
        fs::write(&summary, summary_text.replace(game.source_snapshot_id.as_deref().unwrap(), "wrong-match")).unwrap();
        assert!(parse_file(&results).unwrap_err().contains("snapshot IDs"));
        fs::remove_dir_all(directory).unwrap();
    }
    #[test]
    fn parses_confirmed_royale_pair_and_rejects_mismatched_summary() {
        let directory = std::env::temp_dir().join(format!(
            "marbles-royale-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&directory).unwrap();
        let results = directory.join("LastSeasonRoyale.csv");
        let summary = directory.join("LastSeasonRoyaleSummary.csv");
        fs::write(
            &results,
            include_str!("../tests/fixtures/LastSeasonRoyale.csv"),
        )
        .unwrap();
        let summary_text = include_str!("../tests/fixtures/LastSeasonRoyaleSummary.csv");
        fs::write(&summary, summary_text).unwrap();
        let game = parse_file(&results).unwrap();
        assert_eq!(game.game_type, GameType::BattleRoyale);
        assert_eq!(game.map_name.as_deref(), Some("Grasslands"));
        assert_eq!(game.player_count, 20);
        assert_eq!(game.results[0].username, "Qaixagdi3");
        assert_eq!(game.results[0].finish_time, Some(259.260529));
        assert_eq!(
            game.results[0]
                .raw_data
                .get("MatchKills")
                .map(String::as_str),
            Some("2")
        );
        assert!(!game.has_world_record);
        assert_eq!(parse_file(&results).unwrap().id, game.id);
        assert_ne!(
            fingerprint(
                &game.results,
                game.source_snapshot_id.as_deref(),
                &GameType::Race
            ),
            game.id
        );
        fs::write(
            &summary,
            summary_text.replace("b2f89f91-4509-7870-dbc1-54a1d30c8b50", "different-snapshot"),
        )
        .unwrap();
        assert!(parse_file(&results).unwrap_err().contains("snapshot IDs"));
        fs::write(&summary, summary_text.replace(",Final,", ",Running,")).unwrap();
        assert!(parse_file(&results).unwrap_err().contains("not a final"));
        fs::write(&summary, summary_text.replace(",20,1,19,", ",21,1,19,")).unwrap();
        assert!(parse_file(&results).unwrap_err().contains("player count"));
        fs::remove_dir_all(directory).unwrap();
    }
}
