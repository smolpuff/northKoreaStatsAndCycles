//! Twitch Public-client device authorization. No client secret or callback server.
use crate::twitch::{self, StoredTwitchCredential};
use reqwest::blocking::Client;
use serde::Deserialize;
use std::{
    thread,
    time::{Duration, Instant},
};

pub(crate) const CLIENT_ID: &str = "06di08aqgp56hw5nnnzpaki0025rpa";
const SCOPE: &str = "user:write:chat";

#[derive(Deserialize)]
struct DeviceAuthorization {
    device_code: String,
    user_code: String,
    expires_in: u64,
    interval: u64,
    verification_uri: String,
}

#[derive(Deserialize)]
pub(crate) struct OAuthTokens {
    pub access_token: String,
    pub refresh_token: String,
}

#[derive(Deserialize)]
struct OAuthError {
    message: String,
}

fn verification_url(address: &str) -> Result<reqwest::Url, String> {
    let url =
        reqwest::Url::parse(address).map_err(|_| "Twitch returned an invalid sign-in page")?;
    if url.scheme() != "https"
        || url.host_str() != Some("www.twitch.tv")
        || url.path() != "/activate"
        || url.port().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
    {
        return Err("Twitch returned an unexpected sign-in page".into());
    }
    Ok(url)
}

pub fn authorize(on_ready: impl FnOnce(&str)) -> Result<StoredTwitchCredential, String> {
    let client = twitch::http_client()?;
    let device = client
        .post("https://id.twitch.tv/oauth2/device")
        .form(&[("client_id", CLIENT_ID), ("scopes", SCOPE)])
        .send()
        .map_err(|_| "Unable to reach Twitch for sign-in")?
        .error_for_status()
        .map_err(|_| "Twitch could not start sign-in. Try again.")?
        .json::<DeviceAuthorization>()
        .map_err(|_| "Twitch returned an invalid sign-in request")?;
    if device.device_code.is_empty()
        || device.expires_in == 0
        || device.interval == 0
        || device.user_code.is_empty()
        || device.user_code.len() > 64
        || !device
            .user_code
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
    {
        return Err("Twitch returned an incomplete sign-in request".into());
    }
    let address = verification_url(&device.verification_uri)?;
    if !address
        .query_pairs()
        .any(|(key, value)| key == "device-code" && value == device.user_code)
    {
        return Err("Twitch returned a sign-in page without the expected code".into());
    }
    on_ready(&format!("Your sign-in code: {}. This code comes from Marbles Stats and is already filled in on the Twitch page. Confirm it, click Authorize, then return here. The app connects automatically.", device.user_code));
    twitch::open_browser(address.as_str())?;
    let deadline = Instant::now() + Duration::from_secs(device.expires_in.min(1800));
    let mut interval = Duration::from_secs(device.interval.clamp(1, 60));
    while Instant::now() < deadline {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining <= interval {
            break;
        }
        thread::sleep(interval);
        let response = client
            .post("https://id.twitch.tv/oauth2/token")
            .form(&[
                ("client_id", CLIENT_ID),
                ("scopes", SCOPE),
                ("device_code", device.device_code.as_str()),
                ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
            ])
            .send()
            .map_err(|_| "Twitch sign-in connection failed. Try Connect Twitch again.")?;
        if response.status().is_success() {
            let tokens = response
                .json::<OAuthTokens>()
                .map_err(|_| "Twitch returned invalid sign-in credentials")?;
            return twitch::complete_authorization(tokens.access_token, tokens.refresh_token);
        }
        if response.status().as_u16() != 400 {
            return Err("Twitch could not complete sign-in. Try Connect Twitch again.".into());
        }
        let error = response
            .json::<OAuthError>()
            .map_err(|_| "Twitch returned an invalid sign-in response")?;
        match error.message.as_str() {
            "authorization_pending" => {}
            "slow_down" => {
                interval = (interval + Duration::from_secs(5)).min(Duration::from_secs(120))
            }
            "access_denied" => {
                return Err("Twitch authorization was cancelled. Try Connect Twitch again.".into())
            }
            "expired_token" | "invalid device code" => break,
            _ => return Err("Twitch sign-in was not completed. Try Connect Twitch again.".into()),
        }
    }
    Err("Twitch sign-in timed out. Try Connect Twitch again.".into())
}

pub(crate) fn refresh(client: &Client, refresh_token: &str) -> Result<OAuthTokens, String> {
    client
        .post("https://id.twitch.tv/oauth2/token")
        .form(&[
            ("client_id", CLIENT_ID),
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_token),
        ])
        .send()
        .map_err(|_| "Unable to refresh Twitch login; try again")?
        .error_for_status()
        .map_err(|_| "Twitch login expired; click Connect Twitch again")?
        .json::<OAuthTokens>()
        .map_err(|_| "Twitch returned an invalid login refresh".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_opens_twitch_device_approval_page() {
        assert!(
            verification_url("https://www.twitch.tv/activate?public=true&device-code=TEST").is_ok()
        );
        for address in [
            "http://www.twitch.tv/activate",
            "https://other.example/activate",
            "https://www.twitch.tv.evil.example/activate",
            "https://user@www.twitch.tv/activate",
            "https://www.twitch.tv/other",
            "https://www.twitch.tv:444/activate",
        ] {
            assert!(verification_url(address).is_err());
        }
    }
}
