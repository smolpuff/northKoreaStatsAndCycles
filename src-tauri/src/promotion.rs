use crate::models::TwitchConfig;
use crate::{log, streamer_bot, twitch, SharedRuntime};
use std::{thread, time::{Duration, Instant}};

#[derive(Default)]
struct Schedule {
    settings: Option<(u64, String)>,
    next_post: Option<Instant>,
}

impl Schedule {
    fn due(&mut self, now: Instant, config: &TwitchConfig, login: Option<&str>) -> bool {
        let Some(login) = login.filter(|_| config.promote_mission_app) else {
            self.settings = None;
            self.next_post = None;
            return false;
        };
        let minutes = config.promotion_interval_minutes.clamp(1, 1440);
        let settings = (minutes, login.to_string());
        let interval = Duration::from_secs(minutes * 60);
        if self.settings.as_ref() != Some(&settings) {
            self.settings = Some(settings);
            self.next_post = Some(now + interval);
            return false;
        }
        if self.next_post.is_some_and(|deadline| now >= deadline) {
            // Missed intervals never produce a burst; failures wait a full interval too.
            self.next_post = Some(now + interval);
            return true;
        }
        false
    }
}

pub fn start(runtime: &SharedRuntime, app: &tauri::AppHandle) {
    let runtime = runtime.clone();
    let app = app.clone();
    thread::spawn(move || {
        let mut schedule = Schedule::default();
        loop {
            let (config, streamer, login) = match runtime.lock() {
                Ok(rt) if rt.connection_checks_stopped => return,
                Ok(rt) => (
                    rt.snapshot.config.twitch.clone(),
                    rt.snapshot.config.streamer_bot.clone(),
                    if rt.snapshot.twitch_status == "Connected" { rt.snapshot.twitch_username.clone() } else { None },
                ),
                Err(_) => return,
            };
            let mut timer_config = config.clone();
            timer_config.promote_mission_app = config.promote_mission_app || streamer.events.mission_promotion;
            let identity = if streamer.events.mission_promotion {
                Some(format!("{}:{}:{}:{}", streamer.host, streamer.port, streamer.actions.mission_promotion, login.as_deref().unwrap_or("")))
            } else { login.clone() };
            if schedule.due(Instant::now(), &timer_config, identity.as_deref()) {
                if config.promote_mission_app && login.is_some() {
                    match twitch::send_promotion(&config) {
                        Ok(()) => log(&runtime, &app, "info", "[Twitch] Mission app promotion posted"),
                        Err(error) => log(&runtime, &app, "warning", format!("[Twitch] Mission app promotion failed: {error}")),
                    }
                }
                if streamer.events.mission_promotion {
                    let args = streamer_bot::promotion_args(config.promotion_interval_minutes, false);
                    match streamer_bot::trigger_action(&streamer, &streamer.actions.mission_promotion, args) {
                        Ok(()) => log(&runtime, &app, "info", "[Streamer.bot] Mission promotion action triggered"),
                        Err(error) => log(&runtime, &app, "warning", format!("[Streamer.bot] Mission promotion action failed: {error}")),
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

    #[test]
    fn promotion_waits_an_interval_and_never_catches_up_in_a_burst() {
        let now = Instant::now();
        let config = TwitchConfig { promote_mission_app: true, promotion_interval_minutes: 1, ..TwitchConfig::default() };
        let mut schedule = Schedule::default();
        assert!(!schedule.due(now, &config, Some("korea")));
        assert!(!schedule.due(now + Duration::from_secs(59), &config, Some("korea")));
        assert!(schedule.due(now + Duration::from_secs(60), &config, Some("korea")));
        assert!(schedule.due(now + Duration::from_secs(600), &config, Some("korea")));
        assert!(!schedule.due(now + Duration::from_secs(601), &config, Some("korea")));
    }

    #[test]
    fn disabling_disconnects_and_setting_changes_reset_the_timer() {
        let now = Instant::now();
        let mut config = TwitchConfig { promote_mission_app: true, promotion_interval_minutes: 1, ..TwitchConfig::default() };
        let mut schedule = Schedule::default();
        assert!(!schedule.due(now, &config, Some("korea")));
        assert!(!schedule.due(now + Duration::from_secs(60), &config, None));
        assert!(!schedule.due(now + Duration::from_secs(61), &config, Some("korea")));
        config.promotion_interval_minutes = 2;
        assert!(!schedule.due(now + Duration::from_secs(121), &config, Some("korea")));
        assert!(schedule.due(now + Duration::from_secs(241), &config, Some("korea")));
        config.promote_mission_app = false;
        assert!(!schedule.due(now + Duration::from_secs(400), &config, Some("korea")));
    }

    #[test]
    fn old_config_defaults_promotion_on_and_preserves_explicit_off() {
        let config: TwitchConfig = serde_json::from_str(r#"{"postResults":true}"#).unwrap();
        assert!(config.promote_mission_app);
        assert_eq!(config.promotion_interval_minutes, 60);
        assert!(crate::models::default_promotion_message().contains("Doing missions?"));
        let disabled: TwitchConfig = serde_json::from_str(r#"{"postResults":true,"promoteMissionApp":false}"#).unwrap();
        assert!(!disabled.promote_mission_app);
    }

    #[test]
    fn promotion_hook_receives_fixed_copy_and_test_marker() {
        let args = streamer_bot::promotion_args(60, true);
        assert_eq!(args["eventType"], "missionPromotion");
        assert_eq!(args["promotionMessage"], crate::models::default_promotion_message());
        assert_eq!(args["downloadUrl"], "https://www.missions.lol");
        assert_eq!(args["intervalMinutes"], 60);
        assert_eq!(args["isTest"], true);
        let config = crate::models::StreamerBotConfig::default();
        assert!(!config.events.mission_promotion);
        assert_eq!(config.actions.mission_promotion, "Marbles - Mission Promotion");
    }
}
