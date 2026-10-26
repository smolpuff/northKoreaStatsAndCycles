//! Lumia commands consume the same normalized event arguments as Streamer.bot.
use crate::models::LumiaConfig;
use serde_json::{json, Value};
use std::time::Duration;
const CREDENTIAL_TARGET: &str = "MarblesStats/LumiaStream";

fn client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder().no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_millis(1500)).timeout(Duration::from_secs(3))
        .build().map_err(|_| "Unable to create Lumia client".into())
}
pub fn is_configured() -> bool {
    load_credential().ok().flatten().is_some_and(|value| !value.trim().is_empty())
}

fn token() -> Result<String, String> {
    load_credential()?.filter(|value| !value.is_empty()).ok_or("Save a Lumia API token first".into())
}
fn response_value(response: reqwest::blocking::Response) -> Result<Value, String> {
    let status = response.status().as_u16();
    if !(200..300).contains(&status) { return Err(status_error(status)); }
    let value: Value = response.json().map_err(|_| "Lumia returned an invalid JSON response")?;
    if !value.is_object() { return Err("Lumia returned an invalid API response".into()); }
    if let Some(status) = value["status"].as_u64() {
        if !(200..300).contains(&status) { return Err(status_error(status as u16)); }
    }
    if value["message"] == false { return Err("Lumia did not accept the request".into()); }
    Ok(value)
}
fn status_error(status: u16) -> String {
    match status {
        401 | 403 => "Lumia rejected the API token. Check Settings > API in Lumia.".into(),
        404 => "Lumia command or API endpoint was not found. Check the command name and update Lumia.".into(),
        409 => "The Lumia command or its folder is disabled. Enable it in Lumia.".into(),
        _ => format!("Lumia returned HTTP {status}"),
    }
}
// Build encoded query parameters without reqwest's optional `query` feature.
fn endpoint(config: &LumiaConfig, path: &str, token: &str) -> Result<reqwest::Url, String> {
    if config.port == 0 { return Err("Choose a Lumia port from 1 to 65535".into()); }
    let mut url = reqwest::Url::parse(&format!("http://127.0.0.1:{}{path}", config.port))
        .map_err(|_| "Invalid Lumia API endpoint")?;
    url.query_pairs_mut().append_pair("token", token);
    Ok(url)
}
fn settings(config: &LumiaConfig, token: &str) -> Result<Value, String> {
    if config.port == 0 { return Err("Choose a Lumia port from 1 to 65535".into()); }
    let mut url = endpoint(config, "/api/retrieve", token)?;
    url.query_pairs_mut().append_pair("slim", "true");
    let response = client()?.get(url).send()
        // Do not format reqwest errors: their URL contains the secret token.
        .map_err(|_| "Unable to connect to Lumia Stream. Enable its developer API and check the port." )?;
    let value = response_value(response)?;
    if !value["data"].is_object() { return Err("Lumia did not return its settings".into()); }
    Ok(value)
}
fn verify_capabilities(meta: &Value) -> Result<(), String> {
    let validates_names = meta["features"].as_array().is_some_and(|features| {
        features.iter().any(|feature| feature.as_str() == Some("name-validation"))
    });
    if meta["name"].as_str() != Some("lumia-stream") || !validates_names {
        return Err("Update Lumia Stream: its API must support command and disabled-folder validation before this app can run automations.".into());
    }
    Ok(())
}
fn supported_settings(config: &LumiaConfig, secret: &str) -> Result<Value, String> {
    let response = client()?.get(endpoint(config, "/api/meta", secret)?).send()
        .map_err(|_| "Unable to connect to Lumia Stream. Enable its developer API and check the port.")?;
    if response.status().as_u16() == 404 {
        return Err("Update Lumia Stream: this version cannot report whether API commands and folders are enabled.".into());
    }
    verify_capabilities(&response_value(response)?)?;
    settings(config, secret)
}
pub fn test_connection(config: &LumiaConfig) -> Result<(), String> { supported_settings(config, &token()?).map(|_| ()) }
pub fn validate_token(config: &LumiaConfig, value: &str) -> Result<(), String> {
    if value.trim().is_empty() || value.len() > 2048 { return Err("Enter a valid Lumia API token".into()); }
    supported_settings(config, value.trim()).map(|_| ())
}

fn command_body(name: &str, args: Value) -> Value {
    json!({"type":"chat-command", "params":{"value":name, "extraSettings":args}})
}
fn verify_command(settings: &Value, name: &str) -> Result<(), String> {
    let names = settings["data"]["options"]["chat-command"]["values"].as_array()
        .ok_or("Lumia did not return its chat-command list")?;
    if !names.iter().any(|value| value.as_str() == Some(name)) {
        return Err("Lumia chat command was not found. Create it in Lumia and copy its exact name here.".into());
    }
    Ok(())
}
pub fn trigger_command(config: &LumiaConfig, name: &str, args: Value) -> Result<(), String> {
    trigger_with_token(config, name, args, &token()?)
}
fn trigger_with_token(config: &LumiaConfig, name: &str, args: Value, secret: &str) -> Result<(), String> {
    let name = name.trim();
    if name.is_empty() { return Err("Lumia command name is empty".into()); }
    verify_command(&supported_settings(config, secret)?, name)?;
    let response = client()?.post(endpoint(config, "/api/send", secret)?)
        .json(&command_body(name, args)).send()
        .map_err(|_| "Lumia command request failed or timed out; it was not retried to avoid duplicate effects")?;
    response_value(response).map(|_| ())
}

#[cfg(windows)]
pub fn save_credential(value: &String) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Security::Credentials::{
        CredWriteW, CREDENTIALW, CRED_PERSIST_LOCAL_MACHINE, CRED_TYPE_GENERIC,
    };

    let mut blob = serde_json::to_vec(value)
        .map_err(|error| format!("Unable to protect Lumia API token: {error}"))?;
    let mut target: Vec<u16> = std::ffi::OsStr::new(CREDENTIAL_TARGET)
        .encode_wide()
        .chain(Some(0))
        .collect();
    let mut username: Vec<u16> = std::ffi::OsStr::new("Lumia Stream")
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
            "Windows Credential Manager could not save the Lumia API token: {}",
            std::io::Error::last_os_error()
        ))
    } else {
        Ok(())
    }
}

#[cfg(windows)]
fn load_credential() -> Result<Option<String>, String> {
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
            Err(format!("Unable to read the saved Lumia API token: {error}"))
        };
    }

    let parsed = unsafe {
        let credential = &*raw;
        if credential.CredentialBlob.is_null() || credential.CredentialBlobSize == 0 {
            CredFree(raw.cast());
            return Err("The saved Lumia API token is empty or invalid; reconnect or save it again".into());
        }
        let bytes = std::slice::from_raw_parts(
            credential.CredentialBlob,
            credential.CredentialBlobSize as usize,
        );
        serde_json::from_slice::<String>(bytes)
    };
    unsafe { CredFree(raw.cast()) };
    parsed
        .map(Some)
        .map_err(|_| "The saved Lumia API token is invalid; save it again".into())
}

#[cfg(windows)]
pub fn delete_credential() -> Result<(), String> {
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
            return Err(format!("Unable to remove the Lumia API token: {error}"));
        }
    }
    Ok(())
}

#[cfg(not(windows))]
pub fn save_credential(_value: &String) -> Result<(), String> {
    Err("Secure Lumia API token storage is supported on Windows only".into())
}

#[cfg(not(windows))]
fn load_credential() -> Result<Option<String>, String> {
    Ok(None)
}

#[cfg(not(windows))]
pub fn delete_credential() -> Result<(), String> {
    Ok(())
}


#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn command_keeps_full_results_and_scalar_fields() {
        let args = crate::streamer_bot::test_args("gameComplete");
        let body = command_body("marbles-game-complete", args.clone());
        assert_eq!(body["type"], "chat-command");
        assert_eq!(body["params"]["extraSettings"], args);
        assert!(body["params"]["extraSettings"]["placements"].is_array());
        assert!(body["params"]["extraSettings"]["firstplace"].is_string());
        assert!(body["params"]["extraSettings"].get("token").is_none());
    }
    #[test]
    fn missing_commands_fail_before_send() {
        let settings = json!({"data":{"options":{"chat-command":{"values":["marbles-game-complete"]}}}});
        assert!(verify_command(&settings, "marbles-game-complete").is_ok());
        assert!(verify_command(&settings, "missing").is_err());
        assert!(verify_command(&json!({}), "missing").is_err());
        let config: LumiaConfig = serde_json::from_str("{}").unwrap();
        assert!(!config.enabled);
        assert!(!config.events.world_record);
        assert_eq!(config.port, 39231);
        assert!(!serde_json::to_string(&config).unwrap().contains("token"));
    }
    // A loopback fixture checks the real HTTP adapter without touching saved credentials.
    fn mock_server(replies: Vec<(u16, Value)>) -> (u16, std::thread::JoinHandle<Vec<(String, Value)>>) {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = std::thread::spawn(move || {
            let mut requests = vec![];
            for (status, body) in replies {
                let (mut stream, _) = listener.accept().unwrap();
                stream.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
                let mut bytes = vec![];
                let mut byte = [0];
                while !bytes.ends_with(b"\r\n\r\n") { stream.read_exact(&mut byte).unwrap(); bytes.push(byte[0]); }
                let headers = String::from_utf8(bytes).unwrap();
                let length = headers.lines().find_map(|line| line.split_once(':').filter(|(key, _)| key.eq_ignore_ascii_case("content-length"))
                    .map(|(_, value)| value.trim().parse::<usize>().unwrap())).unwrap_or(0);
                let mut bytes = vec![0; length]; stream.read_exact(&mut bytes).unwrap();
                requests.push((headers.lines().next().unwrap().to_string(), if bytes.is_empty() { Value::Null } else { serde_json::from_slice(&bytes).unwrap() }));
                let body = body.to_string();
                write!(stream, "HTTP/1.1 {status} Test\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body).unwrap();
            }
            requests
        });
        (port, server)
    }
    fn api_meta() -> Value { json!({"status":200,"name":"lumia-stream","features":["name-validation"]}) }
    fn command_settings() -> Value { json!({"status":200,"data":{"options":{"chat-command":{"values":["marbles-game-complete"]}}}}) }
    #[test]
    fn http_adapter_verifies_name_then_posts_event_with_extra_settings() {
        let (port, server) = mock_server(vec![(200, api_meta()), (200, command_settings()), (200, json!({"status":200,"message":true}))]);
        let config = LumiaConfig { port, ..LumiaConfig::default() };
        let args = crate::streamer_bot::test_args("gameComplete");
        trigger_with_token(&config, "marbles-game-complete", args.clone(), "fixture-token").unwrap();
        let requests = server.join().unwrap();
        assert!(requests[0].0.starts_with("GET /api/meta?"));
        assert!(requests[1].0.starts_with("GET /api/retrieve?") && requests[1].0.contains("slim=true"));
        assert!(requests[2].0.starts_with("POST /api/send?"));
        assert_eq!(requests[2].1, command_body("marbles-game-complete", args));
    }
    #[test]
    fn http_adapter_does_not_post_unknown_names_or_retry_rejected_commands() {
        let (port, server) = mock_server(vec![(200, api_meta()), (200, command_settings())]);
        let config = LumiaConfig { port, ..LumiaConfig::default() };
        assert!(trigger_with_token(&config, "missing", json!({}), "fixture-token").is_err());
        assert_eq!(server.join().unwrap().len(), 2);
        let (port, server) = mock_server(vec![(200, api_meta()), (200, command_settings()), (409, json!({"status":409,"message":"fixture-token"}))]);
        let config = LumiaConfig { port, ..LumiaConfig::default() };
        let error = trigger_with_token(&config, "marbles-game-complete", json!({}), "fixture-token").unwrap_err();
        assert!(error.contains("disabled")); assert!(!error.contains("fixture-token"));
        assert_eq!(server.join().unwrap().len(), 3);
    }

    #[test]
    fn endpoint_encodes_tokens_without_the_optional_reqwest_query_feature() {
        let config = LumiaConfig::default();
        let secret = "fixture&value=+ /?#%";
        let url = endpoint(&config, "/api/send", secret).unwrap();
        assert_eq!(url.host_str(), Some("127.0.0.1"));
        assert_eq!(url.path(), "/api/send");
        assert!(url.fragment().is_none());
        let pairs: Vec<_> = url.query_pairs().collect();
        assert_eq!(pairs.len(), 1); assert_eq!(pairs[0].0, "token"); assert_eq!(pairs[0].1, secret);
    }
    #[test]
    fn unverifiable_legacy_api_fails_before_any_automation_is_sent() {
        assert!(verify_capabilities(&api_meta()).is_ok());
        assert!(verify_capabilities(&json!({"name":"lumia-stream", "features":[]})).is_err());
        let (port, server) = mock_server(vec![(404, json!({"status":404}))]);
        let config = LumiaConfig { port, ..LumiaConfig::default() };
        let error = trigger_with_token(&config, "marbles-game-complete", json!({}), "fixture-token").unwrap_err();
        assert!(error.contains("Update Lumia")); assert_eq!(server.join().unwrap().len(), 1);
    }

}
