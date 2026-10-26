use serde::{de::DeserializeOwned, Serialize};
use std::{
    fs,
    io::{BufWriter, Write},
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
        self.write_with(name, |writer| serde_json::to_writer(writer, value)
            .map_err(|e| format!("Unable to serialize {name}: {e}")))
    }

    pub fn write_with(&self, name: &str, write: impl FnOnce(&mut dyn Write) -> Result<(), String>) -> Result<(), String> {
        let path = self.path(name);
        let temp = temporary_path(&path);
        let result = (|| {
            let file = fs::File::create(&temp).map_err(|e| format!("Unable to write {}: {e}", temp.display()))?;
            // Share bounded buffering and atomic replacement for every saved output.
            let mut writer = BufWriter::with_capacity(64 * 1024, file);
            write(&mut writer)?;
            writer.flush().map_err(|e| format!("Unable to flush {name}: {e}"))?;
            drop(writer);
            if name == "race-state.json" { self.backup_before_history_compaction()?; }
            replace_file(&temp, &path).map_err(|e| format!("Unable to replace {}: {e}", path.display()))
        })();
        if result.is_err() { let _ = fs::remove_file(&temp); }
        result
    }

    fn backup_before_history_compaction(&self) -> Result<(), String> {
        let original = self.path("race-state.json");
        let backup = self.path("race-state-before-history-compaction.json");
        if !original.exists() || backup.exists() { return Ok(()); }
        let temp = temporary_path(&backup);
        let result = fs::copy(&original, &temp)
            .and_then(|_| replace_file(&temp, &backup))
            .map_err(|e| format!("Unable to back up race state before compacting history: {e}"));
        if result.is_err() { let _ = fs::remove_file(temp); }
        result
    }

    pub fn write_bytes(&self, name: &str, bytes: &[u8]) -> Result<(), String> {
        self.write_with(name, |writer| writer.write_all(bytes).map_err(|e| format!("Unable to write {name}: {e}")))
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

fn temporary_path(path: &Path) -> PathBuf {
    let mut name = path.as_os_str().to_os_string();
    name.push(".tmp");
    PathBuf::from(name)
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temporary_storage() -> Storage {
        let path = std::env::temp_dir().join(format!("marbles-storage-{}-{}",
            std::process::id(), SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
        Storage::new(path).unwrap()
    }

    #[test]
    fn streamed_json_roundtrips_and_preserves_original_backup_once() {
        let storage = temporary_storage();
        let original = br#"{ "legacy": true, "standings": [1, 2, 3] }"#;
        fs::write(storage.path("race-state.json"), original).unwrap();
        let value = serde_json::json!({"payload": "x".repeat(150_000), "count": 42});
        storage.write("race-state.json", &value).unwrap();
        assert_eq!(storage.read::<serde_json::Value>("race-state.json").unwrap(), value);
        assert_eq!(fs::read(storage.path("race-state.json")).unwrap(), serde_json::to_vec(&value).unwrap());
        assert_eq!(fs::read(storage.path("race-state-before-history-compaction.json")).unwrap(), original);
        storage.write("race-state.json", &serde_json::json!({"count": 43})).unwrap();
        assert_eq!(fs::read(storage.path("race-state-before-history-compaction.json")).unwrap(), original);
        fs::create_dir_all(storage.path("backups")).unwrap();
        for name in ["config.json", "history.json", "world-records.json", "overlay-durations.json",
            "overlay-customizations.json", "streamdeck-connection.json", "template-defaults.json", "backups/results.json", "export.json"] {
            storage.write(name, &value).unwrap();
            assert_eq!(fs::read(storage.path(name)).unwrap(), serde_json::to_vec(&value).unwrap(), "{name}");
            assert_eq!(storage.read::<serde_json::Value>(name).unwrap(), value, "{name}");
        }
        assert!(!storage.path("race-state.json.tmp").exists());
        fs::remove_dir_all(storage.data_dir).unwrap();
    }

    #[test]
    fn serialization_failure_preserves_original_and_removes_partial_file() {
        struct Broken;
        impl Serialize for Broken {
            fn serialize<S: serde::Serializer>(&self, _serializer: S) -> Result<S::Ok, S::Error> {
                Err(serde::ser::Error::custom("intentional serialization failure"))
            }
        }
        #[derive(Serialize)]
        struct Partial { prefix: String, broken: Broken }
        let storage = temporary_storage();
        let original = br#"{"count":7}"#;
        fs::write(storage.path("race-state.json"), original).unwrap();
        assert!(storage.write("race-state.json", &Partial { prefix: "x".repeat(150_000), broken: Broken }).is_err());
        assert_eq!(fs::read(storage.path("race-state.json")).unwrap(), original);
        assert!(!storage.path("race-state.json.tmp").exists());
        assert!(!storage.path("race-state-before-history-compaction.json").exists());
        fs::remove_dir_all(storage.data_dir).unwrap();
    }
}
