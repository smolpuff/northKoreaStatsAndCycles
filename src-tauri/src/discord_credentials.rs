//! Windows-backed storage for secret webhook URLs, never included in snapshots.
#[cfg(windows)]
pub fn save_credential(target: &str, value: &String) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Security::Credentials::{
        CredWriteW, CREDENTIALW, CRED_PERSIST_LOCAL_MACHINE, CRED_TYPE_GENERIC,
    };

    let mut blob = serde_json::to_vec(value)
        .map_err(|error| format!("Unable to protect Discord webhook: {error}"))?;
    let mut target: Vec<u16> = std::ffi::OsStr::new(target)
        .encode_wide()
        .chain(Some(0))
        .collect();
    let mut username: Vec<u16> = std::ffi::OsStr::new("Discord")
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
            "Windows Credential Manager could not save the Discord webhook: {}",
            std::io::Error::last_os_error()
        ))
    } else {
        Ok(())
    }
}

#[cfg(windows)]
pub fn load_credential(target: &str) -> Result<Option<String>, String> {
    use std::{os::windows::ffi::OsStrExt, ptr};
    use windows_sys::Win32::Security::Credentials::{
        CredFree, CredReadW, CREDENTIALW, CRED_TYPE_GENERIC,
    };

    let target: Vec<u16> = std::ffi::OsStr::new(target)
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
            Err(format!("Unable to read the saved Discord webhook: {error}"))
        };
    }

    let parsed = unsafe {
        let credential = &*raw;
        if credential.CredentialBlob.is_null() || credential.CredentialBlobSize == 0 {
            CredFree(raw.cast());
            return Err("The saved Discord webhook is empty or invalid; reconnect or save it again".into());
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
        .map_err(|_| "The saved Discord webhook is invalid; save it again".into())
}

#[cfg(windows)]
pub fn delete_credential(target: &str) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Security::Credentials::{CredDeleteW, CRED_TYPE_GENERIC};

    let target: Vec<u16> = std::ffi::OsStr::new(target)
        .encode_wide()
        .chain(Some(0))
        .collect();
    let result = unsafe { CredDeleteW(target.as_ptr(), CRED_TYPE_GENERIC, 0) };
    if result == 0 {
        let error = std::io::Error::last_os_error();
        if error.raw_os_error() != Some(1168) {
            return Err(format!("Unable to remove the Discord webhook: {error}"));
        }
    }
    Ok(())
}

#[cfg(not(windows))]
pub fn save_credential(_target: &str, _value: &String) -> Result<(), String> {
    Err("Secure Discord webhook storage is supported on Windows only".into())
}

#[cfg(not(windows))]
pub fn load_credential(target: &str) -> Result<Option<String>, String> {
    Ok(None)
}

#[cfg(not(windows))]
pub fn delete_credential(target: &str) -> Result<(), String> {
    Ok(())
}
