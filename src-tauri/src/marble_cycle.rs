use std::{io::Read, time::Duration};
use crate::models::*;

fn same_race(left: &GameResult, right: &GameResult) -> bool {
    // Different source race IDs remain different events, even when all results match.
    crate::game_keys(left).iter().any(|key| crate::game_keys(right).contains(key))
}

fn source_order(left: &GameResult, right: &GameResult) -> std::cmp::Ordering {
    let raw = |game: &GameResult, key: &str| game.results.first().and_then(|p| p.raw_data.get(key)).cloned().unwrap_or_default();
    if left.timestamp.is_empty() && right.timestamp.is_empty() {
        return raw(left, "MarbleCycleSessionUrl").cmp(&raw(right, "MarbleCycleSessionUrl"))
            .then_with(|| raw(left, "MarbleCycleRaceNumber").parse::<u64>().unwrap_or(0)
                .cmp(&raw(right, "MarbleCycleRaceNumber").parse::<u64>().unwrap_or(0)))
            .then_with(|| left.id.cmp(&right.id));
    }
    left.timestamp.cmp(&right.timestamp).then_with(|| left.id.cmp(&right.id))
}

pub struct PreparedImport {
    pub state: RaceState,
    pub history: Vec<GameResult>,
    pub added: usize,
    pub cycle_races: usize,
    pub skipped: usize,
}

pub fn prepare(current: &RaceState, saved: &[GameResult], games: &[GameResult]) -> PreparedImport {
    prepare_with_progress(current, saved, games, |_, _, _, _| {})
}

pub fn prepare_with_progress(current: &RaceState, saved: &[GameResult], games: &[GameResult],
    mut progress: impl FnMut(&str, usize, usize, u8)) -> PreparedImport {
    let mut history = saved.to_vec();
    let mut next = current.clone();
    // Historical standings are large. Keep them outside per-game state clones
    // while using the same commit/scoring function as live recording.
    let retained_cycle_history = std::mem::take(&mut next.cycle_history);
    let mut added = 0;
    let mut skipped = 0;
    let mut cycle_additions: Vec<GameResult> = Vec::new();
    let mut corrected = false;
    for (index, game) in games.iter().enumerate() {
        let found = history.iter().position(|previous| same_race(previous, game));
        let canonical = if let Some(index) = found {
            skipped += 1;
            // Re-import also corrects the old importer's missing DNF flags.
            for result in &mut history[index].results {
                if let Some(source) = game.results.iter().find(|source| crate::race_cycle_player_key(source) == crate::race_cycle_player_key(result)) {
                    if result.eliminated != source.eliminated && result.raw_data.contains_key("MarbleCycleSessionUrl") {
                        result.eliminated = source.eliminated;
                        corrected = true;
                    }
                }
            }
            if game.game_type == GameType::BattleRoyale && crate::earns_cycle_placements(game) {
                for result in &mut history[index].results { result.raw_data.insert("MarbleCycleBrWinsAsFirst".into(), "true".into()); }
            }
            // Preserve source metadata for the same stable race ID.
            for result in &mut history[index].results {
                if let Some(source) = game.results.iter().find(|source| crate::race_cycle_player_key(source) == crate::race_cycle_player_key(result)) {
                    for (key, value) in &source.raw_data {
                        if key.starts_with("MarbleCycle") { result.raw_data.entry(key.clone()).or_insert_with(|| value.clone()); }
                    }
                }
                let aliases = result.raw_data.entry("MarbleCycleRaceIds".into()).or_default();
                if !aliases.split(',').any(|id| id == game.id) {
                    if !aliases.is_empty() { aliases.push(','); }
                    aliases.push_str(&game.id);
                }
            }
            history[index].clone()
        } else {
            if let Some((updated, _, _)) = crate::prepare_race_commit(&next, game, true, false, &game.timestamp, crate::ReadReason::Manual) {
                next = updated;
            }
            history.push(game.clone());
            added += 1;
            game.clone()
        };
        let previously_earned = current.cycle_history.iter().any(|entry| entry.game_id == canonical.id
            || entry.game.as_ref().is_some_and(|saved| same_race(saved, &canonical)));
        if crate::earns_cycle_placements(&canonical) && !previously_earned
            && !crate::game_keys(&canonical).iter().any(|key| current.cycle_processed_ids.contains(key))
            && !cycle_additions.iter().any(|saved| same_race(saved, &canonical)) {
            cycle_additions.push(canonical);
        }
        if index % 10 == 0 || index + 1 == games.len() {
            progress("Reading standings", index + 1, games.len(), ((index + 1) * 40 / games.len()) as u8);
        }
    }
    let cycle_races = cycle_additions.iter().filter(|game| game.game_type == GameType::Race).count();
    next.cycle_history = retained_cycle_history;
    if !cycle_additions.is_empty() || corrected {
        // Replay known current-cycle games around the new past placements. Keep
        // any unrepresented accumulated placements as a baseline; never reset them.
        let mut replay: Vec<GameResult> = saved.iter().chain(current.cycle_history.iter().filter_map(|entry| entry.game.as_ref()))
            .filter(|game| crate::earns_cycle_placements(game) && crate::game_keys(game).iter().any(|key| current.cycle_processed_ids.contains(key)))
            .cloned().collect();
        let mut seen = std::collections::HashSet::new();
        replay.retain(|game| seen.insert(crate::game_points_key(game)));
        for game in &replay {
            let mut seen_players = std::collections::HashSet::new();
            for result in &game.results {
                let key = crate::race_cycle_player_key(result);
                if !seen_players.insert(key.clone()) { continue; }
                if let Some(player) = next.race_cycles.iter_mut().find(|p| crate::same_cycle_player(p, &key, &result.player_name)) {
                    if game.game_type == GameType::Race { player.total_races = player.total_races.saturating_sub(1); }
                    let Some(placement) = crate::cycle_placement(game, result) else { continue; };
                    player.placement_counts.resize(10, 0);
                    player.placement_counts[placement as usize - 1] = player.placement_counts[placement as usize - 1].saturating_sub(1);
                }
            }
        }
        let replay_keys: std::collections::HashSet<String> = replay.iter().flat_map(crate::game_keys).collect();
        next.cycle_processed_ids.retain(|key| !replay_keys.contains(key));
        next.cycle_history.retain(|entry| !replay.iter().any(|game| entry.game_id == game.id));
        next.total_cycle_race_count = next.total_cycle_race_count.saturating_sub(replay.iter().filter(|game| game.game_type == GameType::Race).count() as u64);
        for player in &mut next.race_cycles {
            player.cycles = player.completed_cycles();
            player.current_cycle_positions = Some(player.current_positions());
            player.cycle_race_counts = if player.placement_counts.iter().all(|count| *count == 0) { vec![Some(0)] } else { vec![None] };
        }
        // Subtract the previously recorded values above, then replay corrected rosters.
        for game in &mut replay {
            if let Some(corrected) = history.iter().find(|saved| same_race(saved, game)) { *game = corrected.clone(); }
        }
        replay.extend(cycle_additions);
        replay.sort_by(source_order);
        let mut point_history = std::mem::take(&mut next.cycle_history);
        let replay_total = replay.len();
        for (index, game) in replay.into_iter().enumerate() {
            if let Some((updated, _, _)) = crate::prepare_race_commit(&next, &game, false, true, &game.timestamp, crate::ReadReason::Manual) {
                next = updated;
                point_history.append(&mut next.cycle_history);
            }
            if index % 10 == 0 || index + 1 == replay_total {
                progress("Calculating Cycles", index + 1, replay_total, (40 + (index + 1) * 55 / replay_total) as u8);
            }
        }
        next.cycle_history = point_history;
        next.cycle_history.sort_by_cached_key(|entry| {
            let raw = entry.game.as_ref().and_then(|game| game.results.first()).map(|player| &player.raw_data);
            (entry.timestamp.clone(), raw.and_then(|data| data.get("MarbleCycleSessionUrl")).cloned().unwrap_or_default(),
                raw.and_then(|data| data.get("MarbleCycleRaceNumber")).and_then(|value| value.parse::<u64>().ok()).unwrap_or(0), entry.game_id.clone())
        });
    }
    // An import changes standings/history, never replaces the displayed live game.
    next.current_result = current.current_result.clone().or_else(|| if added > 0 { games.last().cloned() } else { None });
    next.stats_results_cleared = current.stats_results_cleared && added == 0;
    next.cycle_last_update = current.cycle_last_update.clone();
    history.sort_by(source_order);
    PreparedImport { state: next, history, added, cycle_races, skipped }
}

pub fn session_url(value: &str) -> Result<String, String> {
    let url = reqwest::Url::parse(value.trim()).map_err(|_| "Paste a complete Marble Cycle session URL")?;
    if url.scheme() != "https" || !matches!(url.host_str(), Some("marblecycle.com" | "www.marblecycle.com"))
        || !url.username().is_empty() || url.password().is_some() || url.port().is_some()
        || url.query().is_some() || url.fragment().is_some() {
        return Err("Use https://marblecycle.com/session/<session ID>".into());
    }
    let id = url.path().strip_prefix("/session/").unwrap_or("").trim_end_matches('/');
    if id.len() != 36 || !id.chars().enumerate().all(|(index, c)|
        if [8, 13, 18, 23].contains(&index) { c == '-' } else { c.is_ascii_hexdigit() }) {
        return Err("The session URL must contain a valid session ID".into());
    }
    Ok(format!("https://marblecycle.com/session/{}", id.to_lowercase()))
}

pub fn fetch(value: &str) -> Result<String, String> {
    let url = session_url(value)?;
    let client = reqwest::blocking::Client::builder().timeout(Duration::from_secs(45))
        .redirect(reqwest::redirect::Policy::none()).build().map_err(|e| e.to_string())?;
    let response = client.get(url).send().map_err(|e| format!("Unable to retrieve session: {e}"))?
        .error_for_status().map_err(|e| format!("Session request failed: {e}"))?;
    if response.status().is_redirection() { return Err("The session redirected instead of returning race data".into()); }
    let mut bytes = Vec::new();
    response.take(25 * 1024 * 1024 + 1).read_to_end(&mut bytes).map_err(|e| e.to_string())?;
    if bytes.len() > 25 * 1024 * 1024 { return Err("Session exceeds the 25 MB import limit".into()); }
    String::from_utf8(bytes).map_err(|_| "Session was not valid UTF-8".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn restrict_session_requests() {
        assert!(session_url("https://marblecycle.com/session/13e1c46f-3301-4d50-ba61-4324972c7e08").is_ok());
        for url in ["http://marblecycle.com/session/13e1c46f-3301-4d50-ba61-4324972c7e08", "https://marblecycle.com.evil.test/session/13e1c46f-3301-4d50-ba61-4324972c7e08", "https://marblecycle.com/session/../admin"] {
            assert!(session_url(url).is_err());
        }
    }

    fn race(id: &str, placement: u32) -> GameResult {
        let mut game = crate::streamer_bot::sample_game();
        game.id = id.into();
        game.source_snapshot_id = Some(id.into());
        game.timestamp.clear();
        game.map_name = None;
        game.has_world_record = false;
        game.results.truncate(1);
        game.player_count = 1;
        game.results[0].placement = placement;
        game.results[0].finish_time = None;
        game.results[0].raw_data.insert("MarbleCycleRaceNumber".into(), placement.to_string());
        game
    }

    #[test]
    fn import_stacks_replays_keeps_current_and_is_idempotent_after_reset() {
        let live = race("live", 10);
        let (current, _, _) = crate::prepare_race_commit(&RaceState::default(), &live, true, true, "live", crate::ReadReason::Manual).unwrap();
        let imported: Vec<_> = (1..10).map(|position| race(&format!("historical-{position}"), position)).collect();
        let first = prepare(&current, &[live.clone()], &imported);
        assert_eq!(first.added, 9);
        assert_eq!(first.cycle_races, 9);
        assert_eq!(first.state.race_cycles[0].cycles, 1);
        assert_eq!(first.state.race_cycles[0].placement_counts, vec![1; 10]);
        assert_eq!(first.state.race_cycles[0].total_races, 10);
        assert_eq!(first.state.current_result.as_ref().unwrap().id, "live");
        assert_eq!(first.state.cycle_history.len(), 10);
        let again = prepare(&first.state, &first.history, &imported);
        assert_eq!(again.added, 0);
        assert_eq!(again.cycle_races, 0);
        assert_eq!(again.state.race_cycles[0].total_races, 10);
        let mut reset = first.state.clone();
        crate::reset_stats_totals(&mut reset);
        crate::reset_cycle_totals(&mut reset);
        let after_reset = prepare(&reset, &first.history, &imported);
        assert_eq!(after_reset.added, 0);
        assert_eq!(after_reset.cycle_races, 0);
        assert!(after_reset.state.race_cycles.is_empty());
    }

    #[test]
    fn missing_local_placements_are_preserved_as_baseline() {
        let mut current = RaceState::default();
        let game = race("past-first", 1);
        let (mut current_with_player, _, _) = crate::prepare_race_commit(&current, &game, false, true, "", crate::ReadReason::Manual).unwrap();
        current_with_player.race_cycles[0].placement_counts = vec![100; 10];
        current_with_player.race_cycles[0].total_races = 1000;
        current_with_player.cycle_history.clear();
        current_with_player.cycle_processed_ids.clear();
        current_with_player.total_cycle_race_count = 1000;
        current = current_with_player;
        let imported = prepare(&current, &[], &[game]);
        assert_eq!(imported.state.race_cycles[0].placement_counts[0], 101);
        assert_eq!(imported.state.race_cycles[0].cycles, 100);
    }

    #[test]
    fn count_outside_top_ten_but_never_brs() {
        let outside = race("outside", 11);
        let mut br = race("royale", 1);
        br.game_type = GameType::BattleRoyale;
        let result = prepare(&RaceState::default(), &[], &[outside, br]);
        assert_eq!(result.state.total_cycle_race_count, 1);
        assert_eq!(result.state.race_cycles[0].total_races, 1);
        assert!(result.state.cycle_history.is_empty());
    }

    #[test]
    fn distinct_source_ids_count_even_with_identical_results() {
        let mut first = race("first-upload", 1);
        first.results[0].finish_time = Some(50.123);
        let mut duplicate = first.clone();
        duplicate.id = "second-upload".into();
        duplicate.source_snapshot_id = Some(duplicate.id.clone());
        let result = prepare(&RaceState::default(), &[], &[first, duplicate]);
        assert_eq!(result.added, 2);
        assert_eq!(result.skipped, 0);
        assert_eq!(result.state.race_cycles[0].placement_counts[0], 2);
        let again = prepare(&result.state, &result.history, &result.history);
        assert_eq!(again.added, 0);
        assert_eq!(again.cycle_races, 0);
    }

    #[test]
    fn live_participation_increments_once_per_parsed_event() {
        let mut current = RaceState::default();
        for index in 0..3 {
            let game = race(&format!("live-{index}"), 11);
            let (updated, _, _) = crate::prepare_race_commit(&current, &game, true, true, "", crate::ReadReason::FileChanged).unwrap();
            assert_eq!(updated.total_race_count, index + 1);
            assert_eq!(updated.total_cycle_race_count, index + 1);
            assert_eq!(updated.race_cycles[0].total_races, index + 1);
            assert!(updated.race_cycles[0].total_races_complete);
            assert!(crate::prepare_race_commit(&updated, &game, true, true, "", crate::ReadReason::FileChanged).is_none());
            current = updated;
        }
        let mut br = race("live-br", 1);
        br.game_type = GameType::BattleRoyale;
        let (updated, _, _) = crate::prepare_race_commit(&current, &br, true, true, "", crate::ReadReason::FileChanged).unwrap();
        assert_eq!(updated.total_battle_royale_count, 1);
        assert_eq!(updated.total_race_count, 3);
        assert_eq!(updated.race_cycles[0].total_races, 3);
    }

    #[test]
    fn br_wins_are_optional_firsts_without_race_participation() {
        let mut br = race("br-win", 1);
        br.game_type = GameType::BattleRoyale;
        let initial = prepare(&RaceState::default(), &[], &[br.clone()]);
        assert!(initial.state.race_cycles.is_empty());
        br.results[0].raw_data.insert("MarbleCycleBrWinsAsFirst".into(), "true".into());
        let enabled = prepare(&initial.state, &initial.history, &[br.clone()]);
        assert_eq!(enabled.added, 0);
        assert_eq!(enabled.state.race_cycles[0].placement_counts[0], 1);
        assert_eq!(enabled.state.race_cycles[0].total_races, 0);
        assert_eq!(enabled.state.total_cycle_race_count, 0);
        assert_eq!(enabled.state.total_battle_royale_count, 1);
        let again = prepare(&enabled.state, &enabled.history, &[br]);
        assert_eq!(again.state.race_cycles[0].placement_counts[0], 1);
    }

    #[test]
    fn reimport_repairs_old_dnf_points_without_losing_participation() {
        let mut old = race("old-dnf", 1);
        old.results[0].eliminated = None;
        old.results[0].raw_data.insert("MarbleCycleSessionUrl".into(), "session".into());
        let initial = prepare(&RaceState::default(), &[], &[old.clone()]);
        assert_eq!(initial.state.race_cycles[0].placement_counts[0], 1);
        old.results[0].eliminated = Some(true);
        let fixed = prepare(&initial.state, &initial.history, &[old.clone()]);
        assert_eq!(fixed.state.race_cycles[0].placement_counts[0], 0);
        assert_eq!(fixed.state.race_cycles[0].total_races, 1);
        assert!(fixed.state.cycle_history.is_empty());
        let again = prepare(&fixed.state, &fixed.history, &[old]);
        assert_eq!(again.state.race_cycles[0].total_races, 1);
    }

    #[test]
    fn progress_reports_actual_processed_races_in_order() {
        let games: Vec<_> = (1..10).map(|position| race(&format!("past-{position}"), position)).collect();
        let mut updates = Vec::new();
        let result = prepare_with_progress(&RaceState::default(), &[], &games, |phase, current, total, percent| updates.push((phase.to_owned(), current, total, percent)));
        assert_eq!(result.added, 9);
        assert!(updates.iter().all(|(_, current, total, _)| current <= total));
        assert!(updates.windows(2).all(|pair| pair[0].3 <= pair[1].3));
        assert_eq!(updates.last().unwrap().3, 95);
    }
}
