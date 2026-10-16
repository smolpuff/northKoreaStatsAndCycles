//! Discord incoming webhooks: one channel target per credential, no bot or shared app secret.
use crate::models::{DiscordConfig, DiscordEvent};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};

pub const KINDS: [&str; 4] = ["race", "battleRoyale", "cycleComplete", "worldRecord"];
#[derive(Clone)]
pub struct Delivery {
    pub revision: u64,
    pub kind: String,
    pub event: DiscordEvent,
    pub content: String,
}

// Replace only the initial, uncustomized Discord wording from this development pass.
pub fn upgrade_defaults(config: &mut DiscordConfig) {
    let defaults = DiscordConfig::default();
    for (kind, event) in &mut config.events {
        let Some(default) = defaults.events.get(kind) else {
            continue;
        };
        if matches!(event.message_template.as_str(),
            "**{race} results — {mapName}**\n{placements}" |
            "Congratulations **{cycleplayer}**! Cycle **#{cyclenumber}** completed in {cycleraces} races!" |
            "**World record!** {wrplayer} finished {mapName} in **{wrrecordtime}s** (+{wrplayerpoints} pts)." |
            "?? Congrats {player} on a cycle! You are great! That's cycle #{cycle}! ??") {
            event.message_template = default.message_template.clone();
        }
        if event.placement_template == "{placement}. {player} — +{points} pts" {
            event.placement_template = default.placement_template.clone();
            if event.placement_separator == "\n" {
                event.placement_separator = default.placement_separator.clone();
            }
        }
    }
}
fn credential_target(target: &str) -> Result<String, String> {
    if target.is_empty()
        || target.len() > 60
        || !target
            .bytes()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-' || c == b'_')
    {
        return Err(
            "Channel label must use 1–60 lowercase letters, numbers, hyphens or underscores".into(),
        );
    }
    Ok(format!("MarblesStats/Discord/{target}"))
}
pub fn validate_config(config: &DiscordConfig) -> Result<(), String> {
    if config.targets.is_empty() || config.targets.len() > 20 {
        return Err("Choose 1–20 Discord channel targets".into());
    }
    let mut names = std::collections::HashSet::new();
    for target in &config.targets {
        credential_target(target)?;
        if !names.insert(target) {
            return Err("Discord channel labels must be unique".into());
        }
    }
    if config.events.len() != KINDS.len() {
        return Err("Discord event settings are incomplete".into());
    }
    for kind in KINDS {
        let event = config
            .events
            .get(kind)
            .ok_or("Discord event settings are incomplete")?;
        if !config.targets.contains(&event.target) {
            return Err("Choose a saved channel target for every Discord event".into());
        }
        if event.message_template.trim().is_empty()
            || event.message_template.encode_utf16().count() > 2000
            || event.placement_template.encode_utf16().count() > 500
            || event.placement_separator.encode_utf16().count() > 40
        {
            return Err("Discord messages need text (up to 2000 characters); placement text is limited to 500 and separators to 40".into());
        }
    }
    Ok(())
}
fn webhook_url(value: &str) -> Result<reqwest::Url, String> {
    let error = "Paste an incoming Discord webhook URL copied from a text channel's Integrations > Webhooks";
    let url = reqwest::Url::parse(value.trim()).map_err(|_| error)?;
    if url.scheme() != "https"
        || url.host_str() != Some("discord.com")
        || url.port().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(error.into());
    }
    let parts: Vec<_> = url.path().split('/').filter(|p| !p.is_empty()).collect();
    let pair = match parts.as_slice() {
        ["api", "webhooks", id, token] | ["api", "v10", "webhooks", id, token] => (*id, *token),
        _ => return Err(error.into()),
    };
    if pair.0.is_empty()
        || !pair.0.bytes().all(|c| c.is_ascii_digit())
        || pair.1.len() < 20
        || !pair
            .1
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
    {
        return Err(error.into());
    }
    reqwest::Url::parse(&format!(
        "https://discord.com/api/v10/webhooks/{}/{}",
        pair.0, pair.1
    ))
    .map_err(|_| error.into())
}
fn client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(4))
        .timeout(Duration::from_secs(10))
        .user_agent("MarblesStats/Discord")
        .build()
        .map_err(|_| "Unable to create Discord client".into())
}
fn status_error(code: u16) -> String {
    match code {
        401 | 403 | 404 => "Discord rejected this webhook. It may have been removed or lost channel access; save a new webhook URL.".into(),
        400 => "Discord rejected the message. Use a normal text channel webhook and check the message settings.".into(),
        429 => "Discord is rate limiting this webhook. Try again later.".into(),
        _ => format!("Discord returned HTTP {code}. The message was not retried."),
    }
}
fn check_url(url: reqwest::Url) -> Result<(), String> {
    let response = client()?
        .get(url)
        .send()
        .map_err(|_| "Unable to reach Discord. Check your internet connection.")?;
    if !response.status().is_success() {
        return Err(status_error(response.status().as_u16()));
    }
    let data: Value = response
        .json()
        .map_err(|_| "Discord returned an invalid webhook response")?;
    if data["type"] != 1 || data["channel_id"].as_str().is_none() {
        return Err("Use an incoming webhook for a Discord text channel".into());
    }
    Ok(())
}
fn saved_url(target: &str) -> Result<reqwest::Url, String> {
    let value = crate::discord_credentials::load_credential(&credential_target(target)?)?
        .ok_or("Set a webhook URL for this channel target first")?;
    webhook_url(&value)
}
pub fn save_webhook(target: &str, secret: &str) -> Result<(), String> {
    let target = credential_target(target)?;
    let url = webhook_url(secret)?;
    check_url(url.clone())?;
    crate::discord_credentials::save_credential(&target, &url.to_string())
}
pub fn remove_webhook(target: &str) -> Result<(), String> {
    crate::discord_credentials::delete_credential(&credential_target(target)?)
}
pub fn test_webhook(target: &str) -> Result<(), String> {
    check_url(saved_url(target)?)
}
pub fn test_connection() -> Result<(), String> {
    // Reachability only: no credentials, channel lookup, webhook validation or post.
    let response = client()?
        .get("https://discord.com/api/v10/gateway")
        .send()
        .map_err(|_| "Unable to reach Discord. Check your internet connection.")?;
    if !response.status().is_success() {
        return Err(format!(
            "Discord connection check returned HTTP {}",
            response.status().as_u16()
        ));
    }
    let data: Value = response
        .json()
        .map_err(|_| "Discord returned an invalid connection response")?;
    if data["url"].as_str().is_none() {
        return Err("Discord returned an invalid connection response".into());
    }
    Ok(())
}

// Shared pacing also covers manual tests; queued events are checked again after waiting.
fn cooldowns() -> &'static Mutex<HashMap<String, Instant>> {
    static VALUE: OnceLock<Mutex<HashMap<String, Instant>>> = OnceLock::new();
    VALUE.get_or_init(|| Mutex::new(HashMap::new()))
}
pub fn message_body(kind: &str, content: &str) -> Result<Value, String> {
    let (title, color) = match kind {
        "race" => ("🏁 Race finished", 0x00efaa_u32),
        "battleRoyale" => ("⚔️ Battle Royale finished", 0x00efaa_u32),
        "worldRecord" => ("🏆 World record", 0xffe024_u32),
        "cycleComplete" => ("🎉 Cycle complete", 0xffe024_u32),
        _ => return Err("Unknown Discord event".into()),
    };
    Ok(json!({
        "embeds": [{"title": title, "description": content, "color": color,
            "footer": {"text": "Marbles Stats"}}],
        "allowed_mentions": {"parse": []},
    }))
}
pub fn post(
    target: &str,
    kind: &str,
    content: &str,
    still_enabled: impl Fn() -> bool,
) -> Result<bool, String> {
    let body = message_body(kind, content)?;
    let mut url = saved_url(target)?;
    url.query_pairs_mut().append_pair("wait", "true");
    let mut pacing = cooldowns()
        .lock()
        .map_err(|_| "Discord delivery unavailable")?;
    for attempt in 0..2 {
        while let Some(until) = pacing.get(target) {
            if !still_enabled() {
                return Ok(false);
            }
            let delay = until.saturating_duration_since(Instant::now());
            if delay.is_zero() {
                break;
            }
            std::thread::sleep(delay.min(Duration::from_millis(250)));
        }
        if !still_enabled() {
            return Ok(false);
        }
        let response = client()?
            .post(url.clone())
            .json(&body)
            .send()
            .map_err(|_| {
                "Discord request failed or timed out. It was not retried to avoid duplicate posts."
            })?;
        let code = response.status().as_u16();
        let remaining = response
            .headers()
            .get("x-ratelimit-remaining")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse::<u32>().ok());
        let reset = response
            .headers()
            .get("x-ratelimit-reset-after")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse::<f64>().ok());
        if remaining == Some(0) {
            if let Some(delay) = reset.filter(|v| v.is_finite() && *v >= 0.0) {
                pacing.insert(
                    target.into(),
                    Instant::now() + Duration::from_secs_f64(delay.min(60.0) + 0.1),
                );
            }
        }
        if code == 429 {
            let data: Value = response
                .json()
                .map_err(|_| "Discord is rate limiting this webhook. Try again later.")?;
            let delay = data["retry_after"]
                .as_f64()
                .filter(|v| v.is_finite() && *v >= 0.0 && *v <= 60.0)
                .ok_or("Discord rate limit is too long; this post was skipped")?;
            pacing.insert(
                target.into(),
                Instant::now() + Duration::from_secs_f64(delay + 0.1),
            );
            // A 429 explicitly rejects the message, so one delayed retry cannot duplicate it.
            if attempt == 0 {
                continue;
            }
            return Err(status_error(429));
        }
        if !(200..300).contains(&code) {
            return Err(status_error(code));
        }
        let data: Value = response
            .json()
            .map_err(|_| "Discord did not confirm the message. It was not retried.")?;
        if data["id"].as_str().is_none() {
            return Err("Discord did not confirm the message. It was not retried.".into());
        }
        return Ok(true);
    }
    Err(status_error(429))
}

fn scalar(value: &Value) -> Option<String> {
    match value {
        Value::String(s) => Some(s.clone()),
        Value::Number(_) | Value::Bool(_) => Some(value.to_string()),
        Value::Null => Some(String::new()),
        _ => None,
    }
}
// Substitute only the original template; braces in player names never become new variables.
pub fn render(template: &str, args: &Value) -> String {
    let mut result = String::new();
    let mut rest = template;
    while let Some(start) = rest.find('{') {
        result.push_str(&rest[..start]);
        let Some(end) = rest[start..].find('}').map(|end| start + end) else {
            result.push_str(&rest[start..]);
            return result;
        };
        let key = &rest[start + 1..end];
        result.push_str(
            &args
                .get(key)
                .and_then(scalar)
                .unwrap_or_else(|| rest[start..=end].into()),
        );
        rest = &rest[end + 1..];
    }
    result.push_str(rest);
    result
}
pub fn messages(event: &DiscordEvent, args: &Value) -> Result<Vec<String>, String> {
    let mut args = args.clone();
    if args["eventType"] == "cycleComplete" {
        args["player"] = args["cycleplayer"].clone();
        args["cycle"] = args["cyclenumber"].clone();
        args["races"] = args["cycleraces"].clone();
    }
    if let Some(placements) = args["placements"].as_array() {
        let lines: Vec<_> = placements
            .iter()
            .map(|player| {
                let mut row = args.clone();
                for (key, source) in [
                    ("player", "name"),
                    ("placement", "place"),
                    ("place", "place"),
                    ("points", "points"),
                    ("time", "time"),
                    ("username", "username"),
                ] {
                    row[key] = player[source].clone();
                }
                row["place"] = json!(match player["place"].as_u64() {
                    Some(1) => "🥇".into(),
                    Some(2) => "🥈".into(),
                    Some(3) => "🥉".into(),
                    Some(place) => format!("#{place}"),
                    None => String::new(),
                });
                render(&event.placement_template, &row)
            })
            .collect();
        args["placements"] = json!(lines.join(&event.placement_separator));
    }
    let text = render(&event.message_template, &args);
    if text.trim().is_empty() {
        return Err("Discord message is empty after substituting variables".into());
    }
    if text.len() > 200_000 {
        return Err("Discord message is too long; shorten the template or placement text".into());
    }
    // Discord's content limit uses UTF-16 units, so emoji must count as two.
    let mut parts = vec![];
    let mut part = String::new();
    let mut units = 0;
    for ch in text.chars() {
        if units + ch.len_utf16() > 2000 {
            if !part.trim().is_empty() {
                parts.push(std::mem::take(&mut part));
            } else {
                part.clear();
            }
            units = 0;
        }
        part.push(ch);
        units += ch.len_utf16();
    }
    if !part.trim().is_empty() {
        parts.push(part);
    }
    Ok(parts)
}
pub fn deliveries(
    config: &DiscordConfig,
    kind: &str,
    args: &Value,
) -> Result<Vec<Delivery>, String> {
    if !config.enabled {
        return Ok(vec![]);
    }
    let event = config.events.get(kind).ok_or("Unknown Discord event")?;
    if !event.enabled {
        return Ok(vec![]);
    }
    Ok(messages(event, args)?
        .into_iter()
        .map(|content| Delivery {
            revision: 0,
            kind: kind.into(),
            event: event.clone(),
            content,
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn messages_are_colored_embeds_with_no_plain_message_or_mentions() {
        for (kind, color) in [
            ("race", 0x00efaa),
            ("battleRoyale", 0x00efaa),
            ("worldRecord", 0xffe024),
            ("cycleComplete", 0xffe024),
        ] {
            let body = message_body(kind, "Custom message @everyone").unwrap();
            assert!(body.get("content").is_none());
            assert_eq!(body["embeds"].as_array().unwrap().len(), 1);
            assert_eq!(body["embeds"][0]["color"], color);
            assert_eq!(body["embeds"][0]["description"], "Custom message @everyone");
            assert!(body["embeds"][0]["title"].as_str().unwrap().chars().count() < 256);
            assert_eq!(body["allowed_mentions"]["parse"], json!([]));
        }
        assert!(message_body("unknown", "hello").is_err());
    }
    #[test]
    fn defaults_are_optional_and_share_one_channel() {
        let config = DiscordConfig::default();
        validate_config(&config).unwrap();
        assert!(!config.enabled);
        assert_eq!(config.events.len(), 4);
        assert!(config
            .events
            .values()
            .all(|event| !event.enabled && event.target == "marbles-results"));
        let roundtrip: DiscordConfig =
            serde_json::from_str(&serde_json::to_string(&config).unwrap()).unwrap();
        assert_eq!(config, roundtrip);
    }
    #[test]
    fn event_switches_route_independently_without_changing_payloads() {
        let mut config = DiscordConfig::default();
        let args = crate::streamer_bot::test_args("gameComplete");
        for mask in 0..16 {
            config.enabled = true;
            for (index, kind) in KINDS.iter().enumerate() {
                let event = config.events.get_mut(*kind).unwrap();
                event.enabled = mask & (1 << index) != 0;
                event.target = format!("channel-{index}");
            }
            for (index, kind) in KINDS.iter().enumerate() {
                let posts = deliveries(&config, kind, &args).unwrap();
                assert_eq!(!posts.is_empty(), mask & (1 << index) != 0);
                assert!(posts
                    .iter()
                    .all(|post| post.kind == *kind
                        && post.event.target == format!("channel-{index}")));
            }
            config.enabled = false;
            for kind in KINDS {
                assert!(deliveries(&config, kind, &args).unwrap().is_empty());
            }
        }
    }
    #[test]
    fn every_placement_survives_chunking_and_invalid_targets_are_rejected() {
        let event = DiscordConfig::default().events["race"].clone();
        let players: Vec<_> = (1..=300)
            .map(|place| json!({"place":place,"name":format!("Player{place}"),"points":place}))
            .collect();
        let parts = messages(
            &event,
            &json!({"race":"Battle Royale","mapName":"Test Map","placements":players}),
        )
        .unwrap();
        assert!(parts.len() > 1);
        assert!(parts.iter().all(|part| part.encode_utf16().count() <= 2000));
        let text = parts.concat();
        for place in 1..=300 {
            assert!(text.contains(&format!("Player{place} +{place}pts")));
        }
        let mut config = DiscordConfig::default();
        config.events.get_mut("race").unwrap().target = "missing-channel".into();
        assert!(validate_config(&config).is_err());
        assert!(credential_target("../secret").is_err());
        assert!(credential_target("marbles-results").is_ok());
    }
    #[test]
    fn rejects_untrusted_urls_without_network_requests() {
        for url in [
            "http://discord.com/api/webhooks/1/abcdefghijklmnopqrst",
            "https://discord.com.evil.test/api/webhooks/1/abcdefghijklmnopqrst",
            "https://localhost/api/webhooks/1/abcdefghijklmnopqrst",
            "https://discord.com/api/webhooks/1/abcdefghijklmnopqrst?wait=true",
        ] {
            assert!(webhook_url(url).is_err());
        }
        assert!(webhook_url("https://discord.com/api/webhooks/123/abcdefghijklmnopqrst").is_ok());
    }
    #[test]
    fn renders_once_and_splits_unicode_without_losing_players() {
        assert_eq!(
            render(
                "Winner {player} {points}",
                &json!({"player":"{points}","points":9})
            ),
            "Winner {points} 9"
        );
        let mut event = DiscordConfig::default().events["race"].clone();
        event.message_template = "{player}".into();
        let text = "🎉".repeat(2001);
        let chunks = messages(&event, &json!({"player":text})).unwrap();
        assert_eq!(chunks.concat(), text);
        assert_eq!(chunks.len(), 3);
        assert!(chunks
            .iter()
            .all(|message| message.encode_utf16().count() <= 2000));
        let event = DiscordConfig::default().events["race"].clone();
        let result = messages(&event, &crate::streamer_bot::test_args("gameComplete"))
            .unwrap()
            .join("");
        assert!(result.contains("Test Winner"));
        assert!(result.contains("🥇 Test Winner +10pts"));
    }
}
