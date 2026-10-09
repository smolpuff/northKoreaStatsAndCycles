use crate::{models::{GameResult, GameType}, parser::MapMetadata};
use std::time::{Duration, SystemTime};

// Baseline existing metadata without announcing an old record on startup.
pub struct Tracker {
    observed: Option<String>,
    pending: Option<(MapMetadata, SystemTime)>,
}

pub fn identity(metadata: &MapMetadata) -> Option<String> {
    let time = metadata.record_time.filter(|time| time.is_finite() && *time > 0.0)?;
    let holder = metadata.record_holder_name.as_deref()?.trim();
    let date = metadata.date_set.as_deref()?.trim();
    if holder.is_empty() || date.is_empty() || date.starts_with("0001.") { return None; }
    Some(serde_json::json!([
        metadata.map_name.trim().to_lowercase(), holder.to_lowercase(), time, date,
    ]).to_string())
}

impl Tracker {
    pub fn new(metadata: Option<&MapMetadata>) -> Self {
        Self { observed: metadata.and_then(identity), pending: None }
    }

    pub fn observe(&mut self, metadata: MapMetadata, modified: SystemTime) -> bool {
        let key = identity(&metadata);
        if key == self.observed { return false; }
        self.observed = key.clone();
        self.pending = key.map(|_| (metadata, modified));
        true
    }

    pub fn matching_record(&self, game: &GameResult) -> Option<(String, MapMetadata)> {
        let (metadata, modified) = self.pending.as_ref()?;
        let timestamp = chrono::DateTime::parse_from_rfc3339(&game.timestamp).ok()?;
        let game_time: SystemTime = timestamp.with_timezone(&chrono::Utc).into();
        // CSVs may arrive in either order, but an old result must not claim a later record.
        let distance = modified.duration_since(game_time)
            .or_else(|_| game_time.duration_since(*modified)).ok()?;
        if distance > Duration::from_secs(120) { return None; }
        if !game.map_name.as_deref()?.trim().eq_ignore_ascii_case(metadata.map_name.trim()) { return None; }
        let winner = game.results.iter().find(|player| player.placement == 1)?;
        let holder = metadata.record_holder_name.as_deref()?.trim();
        if ![winner.username.as_str(), winner.player_name.as_str(), winner.display_name.as_str()]
            .iter().any(|name| !name.trim().is_empty() && name.trim().eq_ignore_ascii_case(holder)) {
            return None;
        }
        if game.game_type == GameType::Race {
            let finish = winner.finish_time.filter(|time| time.is_finite() && *time > 0.0)?;
            if winner.eliminated == Some(true) || (finish - metadata.record_time?).abs() > 0.001 { return None; }
        }
        Some((identity(metadata)?, metadata.clone()))
    }

    pub fn consume(&mut self) { self.pending = None; }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn metadata() -> MapMetadata {
        MapMetadata { map_name: "Test Map".into(), record_time: Some(42.123),
            record_holder_name: Some("Test Winner".into()), date_set: Some("2026.10.08-12.00.00".into()) }
    }

    fn game() -> GameResult {
        // Existing integration sample uses confirmed normalized result fields.
        let mut game = crate::streamer_bot::sample_game();
        game.timestamp = chrono::Utc::now().to_rfc3339();
        game
    }

    #[test]
    fn existing_and_unchanged_records_do_not_become_pending() {
        let metadata = metadata();
        let mut tracker = Tracker::new(Some(&metadata));
        assert!(!tracker.observe(metadata, SystemTime::now()));
        assert!(tracker.pending.is_none());
    }

    #[test]
    fn rejects_local_empty_or_invalid_records() {
        let mut metadata = metadata();
        metadata.record_holder_name = None;
        assert!(identity(&metadata).is_none());
        metadata.record_holder_name = Some("Winner".into());
        metadata.record_time = Some(f64::NAN);
        assert!(identity(&metadata).is_none());
    }

    #[test]
    fn changed_record_waits_for_matching_winner_map_and_time() {
        let mut tracker = Tracker::new(None);
        tracker.observe(metadata(), SystemTime::now());
        let mut game = game();
        assert!(tracker.matching_record(&game).is_some());
        game.results[0].username = "wrong".into();
        game.results[0].player_name = "Wrong".into();
        game.results[0].display_name = "Wrong".into();
        assert!(tracker.matching_record(&game).is_none());
        game = self::game();
        game.results[0].finish_time = Some(44.0);
        assert!(tracker.matching_record(&game).is_none());
        game = self::game();
        game.map_name = Some("Another map".into());
        assert!(tracker.matching_record(&game).is_none());
        game = self::game();
        game.timestamp = "2020-01-01T00:00:00Z".into();
        assert!(tracker.matching_record(&game).is_none());
        tracker.consume();
        assert!(tracker.matching_record(&self::game()).is_none());
    }

    #[test]
    fn unchanged_touches_keep_pending_record_and_username_can_match() {
        let mut tracker = Tracker::new(None);
        let mut metadata = metadata();
        metadata.record_holder_name = Some("TEST_PLAYER_1".into());
        assert!(tracker.observe(metadata.clone(), SystemTime::now()));
        assert!(!tracker.observe(metadata, SystemTime::now()));
        assert!(tracker.matching_record(&game()).is_some());
        tracker.consume();
        assert!(tracker.matching_record(&game()).is_none());
    }

    #[test]
    fn metadata_can_arrive_before_or_after_the_result() {
        for offset in [-2, 2] {
            let mut tracker = Tracker::new(None);
            let now = SystemTime::now();
            let modified = if offset < 0 { now - Duration::from_secs(2) } else { now + Duration::from_secs(2) };
            tracker.observe(metadata(), modified);
            assert!(tracker.matching_record(&game()).is_some());
        }
    }
}
