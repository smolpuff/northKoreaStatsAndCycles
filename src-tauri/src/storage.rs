use serde::{de::DeserializeOwned, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
};

#[derive(Clone)]
pub struct Storage {
    pub data_dir: PathBuf,
}

impl Storage {
    pub fn new(data_dir: PathBuf) -> Result<Self, String> {
        fs::create_dir_all(&data_dir)
            .map_err(|e| format!("Unable to create data directory: {e}"))?;
        Ok(Self { data_dir })
    }
    pub fn path(&self, name: &str) -> PathBuf {
        self.data_dir.join(name)
    }
    pub fn read<T: DeserializeOwned>(&self, name: &str) -> Result<T, String> {
        let path = self.path(name);
        let text = fs::read_to_string(&path)
            .map_err(|e| format!("Unable to read {}: {e}", path.display()))?;
        serde_json::from_str(&text).map_err(|e| format!("Invalid {}: {e}", path.display()))
    }
    pub fn write<T: Serialize>(&self, name: &str, value: &T) -> Result<(), String> {
        let path = self.path(name);
        let temp = path.with_extension("json.tmp");
        let bytes = serde_json::to_vec_pretty(value)
            .map_err(|e| format!("Unable to serialize {name}: {e}"))?;
        fs::write(&temp, bytes).map_err(|e| format!("Unable to write {}: {e}", temp.display()))?;
        replace_file(&temp, &path).map_err(|e| format!("Unable to replace {}: {e}", path.display()))
    }

    pub fn remove(&self, name: &str) -> Result<(), String> {
        let path = self.path(name);
        match fs::remove_file(&path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(format!("Unable to remove {}: {error}", path.display())),
        }
    }
}

pub(crate) fn replace_file(temp: &Path, destination: &Path) -> std::io::Result<()> {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Storage::FileSystem::{
            MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
        };
        let source: Vec<u16> = temp.as_os_str().encode_wide().chain(Some(0)).collect();
        let target: Vec<u16> = destination
            .as_os_str()
            .encode_wide()
            .chain(Some(0))
            .collect();
        let result = unsafe {
            MoveFileExW(
                source.as_ptr(),
                target.as_ptr(),
                MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
            )
        };
        if result == 0 {
            Err(std::io::Error::last_os_error())
        } else {
            Ok(())
        }
    }
    #[cfg(not(windows))]
    {
        fs::rename(temp, destination)
    }
}
