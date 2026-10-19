use crate::models::TwitchConfig;
use crate::{log, twitch, SharedRuntime};
use std::{thread, time::{Duration, Instant}};

#[derive(Default)]
struct Schedule {
    settings: Option<(u64, u64, String)>,
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
        let delay = config.promotion_start_delay_minutes.clamp(1, 1440);
        let settings = (minutes, delay, login.to_string());
        let interval = Duration::from_secs(minutes * 60);
        if self.settings.as_ref() != Some(&settings) {
            self.settings = Some(settings);
            // Start only once promotion is enabled and Twitch is connected.
            self.next_post = Some(now + Duration::from_secs(delay * 60));
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
            let (config, login) = match runtime.lock() {
                Ok(rt) if rt.connection_checks_stopped => return,
                Ok(rt) => (
                    rt.snapshot.config.twitch.clone(),
                    if rt.snapshot.twitch_status == "Connected" { rt.snapshot.twitch_username.clone() } else { None },
                ),
                Err(_) => return,
            };
            if schedule.due(Instant::now(), &config, login.as_deref()) {
                match twitch::send_promotion(&config) {
                    Ok(()) => log(&runtime, &app, "info", "[Twitch] Mission app promotion posted"),
                    Err(error) => log(&runtime, &app, "warning", format!("[Twitch] Mission app promotion failed: {error}")),
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
    fn first_post_uses_start_delay_then_repeat_interval_without_catchup() {
        let now = Instant::now();
        let config = TwitchConfig { promote_mission_app: true, promotion_interval_minutes: 60,
            promotion_start_delay_minutes: 15, ..TwitchConfig::default() };
        let mut schedule = Schedule::default();
        assert!(!schedule.due(now, &config, Some("korea")));
        assert!(!schedule.due(now + Duration::from_secs(899), &config, Some("korea")));
        assert!(schedule.due(now + Duration::from_secs(900), &config, Some("korea")));
        assert!(!schedule.due(now + Duration::from_secs(4499), &config, Some("korea")));
        assert!(schedule.due(now + Duration::from_secs(4500), &config, Some("korea")));
        assert!(schedule.due(now + Duration::from_secs(20000), &config, Some("korea")));
        assert!(!schedule.due(now + Duration::from_secs(20001), &config, Some("korea")));
    }

    #[test]
    fn enabling_reconnecting_account_and_timing_changes_start_a_fresh_delay() {
        let now = Instant::now();
        let mut config = TwitchConfig { promote_mission_app: true, promotion_interval_minutes: 60,
            promotion_start_delay_minutes: 15, ..TwitchConfig::default() };
        let mut schedule = Schedule::default();
        assert!(!schedule.due(now, &config, Some("korea")));
        assert!(!schedule.due(now + Duration::from_secs(600), &config, None));
        assert!(!schedule.due(now + Duration::from_secs(601), &config, Some("korea")));
        assert!(!schedule.due(now + Duration::from_secs(1500), &config, Some("korea")));
        assert!(schedule.due(now + Duration::from_secs(1501), &config, Some("korea")));
        config.promote_mission_app = false;
        assert!(!schedule.due(now + Duration::from_secs(1600), &config, Some("korea")));
        config.promote_mission_app = true;
        assert!(!schedule.due(now + Duration::from_secs(1700), &config, Some("korea")));
        assert!(schedule.due(now + Duration::from_secs(2600), &config, Some("korea")));
        config.promotion_start_delay_minutes = 30;
        assert!(!schedule.due(now + Duration::from_secs(2700), &config, Some("korea")));
        assert!(!schedule.due(now + Duration::from_secs(4499), &config, Some("korea")));
        assert!(schedule.due(now + Duration::from_secs(4500), &config, Some("korea")));
        assert!(!schedule.due(now + Duration::from_secs(4600), &config, Some("other")));
        assert!(!schedule.due(now + Duration::from_secs(6399), &config, Some("other")));
        assert!(schedule.due(now + Duration::from_secs(6400), &config, Some("other")));
        config.promotion_interval_minutes = 15;
        assert!(!schedule.due(now + Duration::from_secs(6500), &config, Some("other")));
        assert!(schedule.due(now + Duration::from_secs(8300), &config, Some("other")));
    }

    #[test]
    fn old_config_defaults_promotion_off_and_preserves_explicit_choices() {
        let config: TwitchConfig = serde_json::from_str(r#"{"postResults":true}"#).unwrap();
        assert!(!config.promote_mission_app);
        assert!(!TwitchConfig::default().promote_mission_app);
        assert_eq!(config.promotion_interval_minutes, 60);
        assert_eq!(config.promotion_start_delay_minutes, 30);
        let custom: TwitchConfig = serde_json::from_str(r#"{"postResults":true,"promotionStartDelayMinutes":15}"#).unwrap();
        assert_eq!(custom.promotion_start_delay_minutes, 15);
        let roundtrip: TwitchConfig = serde_json::from_str(&serde_json::to_string(&custom).unwrap()).unwrap();
        assert_eq!(roundtrip.promotion_start_delay_minutes, 15);
        assert!(crate::models::default_promotion_message().contains("Korea's MoS Missions App"));
        assert!(crate::models::default_promotion_message().contains("https://www.missions.lol"));
        let disabled: TwitchConfig = serde_json::from_str(r#"{"postResults":true,"promoteMissionApp":false}"#).unwrap();
        assert!(!disabled.promote_mission_app);
        let enabled: TwitchConfig = serde_json::from_str(r#"{"postResults":true,"promoteMissionApp":true}"#).unwrap();
        assert!(enabled.promote_mission_app);
    }

}
