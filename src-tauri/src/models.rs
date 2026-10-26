use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum GameType {
    Auto,
    Race,
    BattleRoyale,
    Tilt,
}

impl Default for GameType {
    fn default() -> Self {
        Self::Auto
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CsvConfig {
    pub path: String,
    pub game_type: GameType,
    pub auto_start_watcher: bool,
    #[serde(default)]
    pub auto_start_cycles: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamerBotActions {
    #[serde(default = "default_promotion_action")]
    pub mission_promotion: String,
    #[serde(default = "default_cycle_action")]
    pub cycle_complete: String,
    pub game_complete: String,
    pub world_record: String,
}

fn default_cycle_action() -> String { "Marbles - Cycle Complete".into() }
fn default_promotion_action() -> String { "Marbles - Mission Promotion".into() }

impl Default for StreamerBotActions {
    fn default() -> Self {
        Self {
            mission_promotion: default_promotion_action(),
            game_complete: "Marbles - Game Complete".into(),
            cycle_complete: default_cycle_action(),
            world_record: "Marbles - World Record".into(),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamerBotConfig {
    #[serde(default = "legacy_streamer_enabled")]
    pub enabled: bool,
    pub host: String,
    pub port: u16,
    pub actions: StreamerBotActions,
    #[serde(default)]
    pub events: StreamerBotEvents,
}


// Earlier versions implicitly enabled Streamer.bot. Preserve saved setups on upgrade.
fn legacy_streamer_enabled() -> bool { true }

impl Default for StreamerBotConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            host: "127.0.0.1".into(),
            port: 7474,
            actions: StreamerBotActions::default(),
            events: StreamerBotEvents::default(),
        }
    }
}

impl StreamerBotConfig {
    pub fn has_enabled_events(&self) -> bool {
        self.events.race_complete || self.events.world_record || self.events.cycle_complete
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct StreamerBotEvents {
    pub mission_promotion: bool,
    pub cycle_complete: bool,
    pub race_complete: bool,
    pub world_record: bool,
}

impl Default for StreamerBotEvents {
    fn default() -> Self {
        Self { race_complete: false, world_record: true, cycle_complete: false, mission_promotion: false }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct LumiaConfig {
    pub enabled: bool,
    pub port: u16,
    pub actions: StreamerBotActions,
    pub events: StreamerBotEvents,
}
impl Default for LumiaConfig {
    fn default() -> Self {
        Self {
            enabled: false, port: 39231,
            actions: StreamerBotActions {
                game_complete: "marbles-game-complete".into(), world_record: "marbles-world-record".into(),
                cycle_complete: "marbles-cycle-complete".into(), mission_promotion: "marbles-mission-promotion".into(),
            },
            events: StreamerBotEvents { world_record: false, ..StreamerBotEvents::default() },
        }
    }
}
impl LumiaConfig {
    pub fn event_config(&self) -> StreamerBotConfig {
        StreamerBotConfig { enabled: self.enabled, host: "127.0.0.1".into(), port: self.port, actions: self.actions.clone(), events: self.events.clone() }
    }
}

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscordEvent {
    pub enabled: bool,
    pub target: String,
    pub message_template: String,
    pub placement_template: String,
}

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DiscordConfig {
    pub enabled: bool,
    pub targets: Vec<String>,
    pub events: std::collections::BTreeMap<String, DiscordEvent>,
}

impl Default for DiscordConfig {
    fn default() -> Self {
        let events = ["race", "battleRoyale", "cycleComplete", "worldRecord"].into_iter().map(|kind| {
            let message = match kind {
                "cycleComplete" => "🎉 Congrats {player} on a cycle! You are great! That's cycle #{cycle}! 🎉 Total races: {totalRaces}.",
                "worldRecord" => "🎉 New World Record on {mapName}!\n{wrplayer} +{wrplayerpoints} points in {wrrecordtime}s!",
                _ => "{placements}",
            };
            (kind.into(), DiscordEvent { enabled: false, target: "marbles-results".into(), message_template: message.into(),
                placement_template: "{place} {player} +{points}pts{timeSuffix}".into() })
        }).collect();
        Self { enabled: false, targets: vec!["marbles-results".into()], events }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TwitchConfig {
    #[serde(default)]
    pub my_cycle_command: bool,
    #[serde(default)]
    pub my_stats_command: bool,
    #[serde(default = "default_cycle_command_alias")]
    pub my_cycle_command_alias: String,
    #[serde(default = "default_stats_command_alias")]
    pub my_stats_command_alias: String,
    #[serde(default = "default_promotion_enabled")]
    pub promote_mission_app: bool,
    #[serde(default = "default_promotion_interval")]
    pub promotion_interval_minutes: u64,
    #[serde(default = "default_promotion_start_delay")]
    pub promotion_start_delay_minutes: u64,
    #[serde(default = "default_promotion_message")]
    pub promotion_message_template: String,
    #[serde(default)]
    pub post_world_records: bool,
    #[serde(default = "default_world_record_message")]
    pub world_record_message_template: String,
    #[serde(default)]
    pub post_cycle_results: bool,
    pub post_results: bool,
    #[serde(default)]
    pub message_prefix: String,
    #[serde(default)]
    pub race_message_template: String,
    #[serde(default)]
    pub race_entry_template: String,
    #[serde(default)]
    pub race_podium_templates: Vec<String>,
    #[serde(default = "default_race_separator")]
    pub race_entry_separator: String,
    #[serde(default)]
    pub cycle_message_template: String,
}

pub fn default_cycle_command_alias() -> String { "!mycycle".into() }
pub fn default_stats_command_alias() -> String { "!mystat".into() }

pub fn default_world_record_message() -> String {
    "World Record! {wrplayer} earned +{wrplayerpoints} points on {mapName} in {wrrecordtime}s!".into()
}

pub fn default_race_separator() -> String { " | ".into() }

pub fn default_promotion_interval() -> u64 { 60 }
pub fn default_promotion_start_delay() -> u64 { 30 }
pub fn default_promotion_enabled() -> bool { true }
pub const MISSION_APP_URL: &str = "https://www.missions.lol";

pub fn default_promotion_message() -> String {
    "🚀 Korea's Mission Manager - Automate your entire MoS flow with 1 click. Never pay gross upcharges.  🔐 Full self-custody with built-in burner wallet. You dont need to buy my love.   🔗 {url}".into()
}

impl Default for TwitchConfig {
    fn default() -> Self {
        Self {
            my_cycle_command: false,
            my_stats_command: false,
            my_cycle_command_alias: default_cycle_command_alias(),
            my_stats_command_alias: default_stats_command_alias(),
            promote_mission_app: default_promotion_enabled(),
            promotion_interval_minutes: default_promotion_interval(),
            promotion_start_delay_minutes: default_promotion_start_delay(),
            promotion_message_template: default_promotion_message(),
            post_world_records: false,
            world_record_message_template: default_world_record_message(),
            post_results: true,
            post_cycle_results: false,
            message_prefix: "🏁 {race} results ({mapName}):".into(),
            race_message_template: String::new(),
            race_entry_template: String::new(),
            race_podium_templates: Vec::new(),
            race_entry_separator: default_race_separator(),
            cycle_message_template:
                "🎉 Congrats {player} on a cycle! You are great! That's cycle #{cycle}! 🎉".into(),
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AppearanceTheme {
    #[default]
    Default,
    Dark,
    Minimal,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    #[serde(default)]
    pub theme: AppearanceTheme,
    #[serde(default = "default_update_checks")]
    pub auto_update_check_enabled: bool,
    #[serde(default)]
    pub start_minimized: bool,
    #[serde(default)]
    pub seasons: SeasonConfig,
    pub csv: CsvConfig,
    #[serde(default)]
    pub streamer_bot: StreamerBotConfig,
    #[serde(default)]
    pub lumia: LumiaConfig,
    #[serde(default)]
    pub discord: DiscordConfig,
    #[serde(default)]
    pub twitch: TwitchConfig,
}

impl AppConfig {
    pub fn default_for(path: String) -> Self {
        Self {
            theme: AppearanceTheme::Default,
            auto_update_check_enabled: true,
            seasons: SeasonConfig::default(),
            start_minimized: false,
            csv: CsvConfig {
                path,
                game_type: GameType::Race,
                auto_start_watcher: false,
                auto_start_cycles: false,
            },
            streamer_bot: StreamerBotConfig::default(),
            lumia: LumiaConfig::default(),
            discord: DiscordConfig::default(),
            twitch: TwitchConfig::default(),
        }
    }
}

fn default_update_checks() -> bool { true }

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerResult {
    pub player_name: String,
    pub username: String,
    pub display_name: String,
    pub platform: String,
    pub name_color_hex: Option<String>,
    pub placement: u32,
    pub season_points_earned: i64,
    pub season_points_total: Option<i64>,
    pub season_wins_total: Option<u64>,
    pub season_matches_played_total: Option<u64>,
    pub finish_time: Option<f64>,
    pub eliminated: Option<bool>,
    pub raw_data: HashMap<String, String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameResult {
    pub id: String,
    pub source_snapshot_id: Option<String>,
    pub timestamp: String,
    pub game_type: GameType,
    pub player_count: usize,
    pub results: Vec<PlayerResult>,
    pub has_world_record: bool,
    pub world_record_player: Option<String>,
    pub world_record_time: Option<f64>,
    pub map_name: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RaceCyclePlayer {
    #[serde(default)]
    pub total_races: u64,
    #[serde(default)]
    pub total_races_complete: bool,
    pub player_key: String,
    pub player_name: String,
    pub placement_counts: Vec<u64>,
    pub cycles: u64,
    #[serde(default)]
    pub current_cycle_positions: Option<Vec<u8>>,
    #[serde(default)]
    pub cycle_race_counts: Vec<Option<u64>>,
}

impl RaceCyclePlayer {
    pub fn completed_cycles(&self) -> u64 {
        (0..10).map(|index| self.placement_counts.get(index).copied().unwrap_or(0)).min().unwrap_or(0)
    }

    pub fn current_positions(&self) -> Vec<u8> {
        let completed = self.completed_cycles();
        self.placement_counts.iter().take(10).enumerate()
            .filter(|(_, count)| **count > completed)
            .map(|(index, _)| (index + 1) as u8).collect()
    }

    pub fn cycle_progress(&self) -> usize {
        self.current_positions().len()
    }
}

pub fn compare_cycle_players(left: &RaceCyclePlayer, right: &RaceCyclePlayer) -> std::cmp::Ordering {
    right.completed_cycles().cmp(&left.completed_cycles())
        .then_with(|| right.cycle_progress().cmp(&left.cycle_progress()))
        .then_with(|| left.player_name.to_lowercase().cmp(&right.player_name.to_lowercase()))
        .then_with(|| left.player_key.cmp(&right.player_key))
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    pub games_played: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    pub timestamp: String,
    pub level: String,
    pub message: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSnapshot {
    pub event_result_ids: Vec<String>,
    pub cycle_history: Vec<CycleHistoryEntry>,
    pub total_cycle_race_count: u64,
    pub total_race_count: u64,
    pub total_battle_royale_count: u64,
    pub season_points_earned: i64,
    pub session_results: Vec<GameResult>,
    pub config: AppConfig,
    pub watcher_status: String,
    pub stats_tracking_enabled: bool,
    pub cycles_tracking_enabled: bool,
    pub watcher_message: Option<String>,
    pub detected_game_type: Option<GameType>,
    pub last_update: Option<String>,
    pub cycle_last_update: Option<String>,
    pub latest_result: Option<GameResult>,
    pub streamer_bot_status: String,
    pub streamer_bot_message: Option<String>,
    #[serde(default)]
    pub lumia_configured: bool,
    pub lumia_status: String,
    pub lumia_message: Option<String>,
    pub discord_status: String,
    pub discord_message: Option<String>,
    pub twitch_status: String,
    pub twitch_message: Option<String>,
    pub twitch_username: Option<String>,
    #[serde(default)]
    pub twitch_chat_message: String,
    pub session: SessionSummary,
    pub recent_results: Vec<GameResult>,
    pub race_cycles: Vec<RaceCyclePlayer>,
    pub logs: Vec<LogEntry>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SeasonConfig {
    pub race_name: String,
    pub cycle_name: String,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RaceState {
    #[serde(default)]
    pub stats_results_cleared: bool,
    #[serde(default)]
    pub current_result: Option<GameResult>,
    #[serde(default)]
    pub cycle_history: Vec<CycleHistoryEntry>,
    pub total_race_count: u64,
    #[serde(default)]
    pub total_battle_royale_count: u64,
    #[serde(default)]
    pub season_points_earned: i64,
    pub processed_ids: Vec<String>,
    // None marks matches from before the most recent stats reset.
    #[serde(default)]
    pub game_points: std::collections::BTreeMap<String, Option<i64>>,
    #[serde(default)]
    pub total_cycle_race_count: u64,
    #[serde(default)]
    pub cycle_processed_ids: Vec<String>,
    #[serde(default)]
    pub cycle_last_update: Option<String>,
    pub race_cycles: Vec<RaceCyclePlayer>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CycleHistoryEntry {
    // Legacy saves repeated the entire leaderboard for every event. Per-player
    // earnings retain the historical counts; never allocate those unused copies.
    #[serde(skip)]
    pub standings: Vec<RaceCyclePlayer>,
    #[serde(default)]
    pub game: Option<GameResult>,
    #[serde(default)]
    pub earnings: Vec<CycleHistoryEarning>,
    pub timestamp: String,
    #[serde(default)]
    pub player_name: String,
    #[serde(default)]
    pub cycle_number: u64,
    pub map_name: Option<String>,
    pub game_id: String,
    #[serde(default)]
    pub winner_name: Option<String>,
    #[serde(default)]
    pub winning_time: Option<f64>,
    #[serde(default)]
    pub player_count: Option<usize>,
    #[serde(default)]
    pub completions: Vec<CycleHistoryCompletion>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CycleHistoryCompletion {
    pub player_name: String,
    pub cycle_number: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CycleHistoryEarning {
    pub player_key: String,
    pub player_name: String,
    pub placement: u32,
    pub points_earned: u64,
    pub cycles_earned: u64,
    pub cycle_number: u64,
    pub placement_counts: Vec<u64>,
}
