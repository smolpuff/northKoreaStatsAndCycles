// OS-generated random tokens for local authentication and update transactions.
#[cfg(windows)]
pub(crate) fn generate() -> Result<String, String> {
    use windows_sys::Win32::Security::Cryptography::{
        BCryptGenRandom, BCRYPT_USE_SYSTEM_PREFERRED_RNG,
    };
    let mut bytes = [0u8; 32];
    let result = unsafe {
        BCryptGenRandom(
            std::ptr::null_mut(),
            bytes.as_mut_ptr(),
            bytes.len() as u32,
            BCRYPT_USE_SYSTEM_PREFERRED_RNG,
        )
    };
    if result < 0 {
        return Err("Unable to generate a secure local token".into());
    }
    Ok(hex::encode(bytes))
}

#[cfg(not(windows))]
pub(crate) fn generate() -> Result<String, String> {
    Err("Secure local tokens require Windows".into())
}
