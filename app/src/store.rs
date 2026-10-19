//! Persistent data model + atomic JSON file storage + shared app state.
use crate::core::{Doc, Link};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Smtp {
    pub host: String,
    pub port: u16,
    /// "tls" | "starttls" | "none"
    pub security: String,
    pub username: String,
    pub password: String,
    pub from: String,
}
impl Default for Smtp {
    fn default() -> Self {
        Smtp { host: String::new(), port: 465, security: "tls".into(), username: String::new(), password: String::new(), from: String::new() }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    pub notify_email: String,
    pub smtp: Smtp,
    pub interval_minutes: u32,
}
impl Default for Settings {
    fn default() -> Self {
        Settings { notify_email: String::new(), smtp: Smtp::default(), interval_minutes: 30 }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Watch {
    pub id: String,
    pub url: String,
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub selector: String,
    #[serde(default)]
    pub documents_only: bool,
    pub created_at: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct WatchState {
    pub last_checked: Option<String>,
    pub last_changed: Option<String>,
    pub last_hash: Option<String>,
    pub last_status: Option<String>,
    pub last_error: Option<String>,
    pub lines: Vec<String>,
    pub links: Vec<Link>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    pub watch_id: String,
    pub url: String,
    pub label: String,
    pub at: String,
    pub summary: String,
    pub new_documents: Vec<Doc>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Data {
    pub settings: Settings,
    pub watches: Vec<Watch>,
    pub state: HashMap<String, WatchState>,
    pub events: Vec<Event>,
}

impl Data {
    pub fn load(path: &Path) -> Data {
        match std::fs::read_to_string(path) {
            Ok(s) => serde_json::from_str(&s).unwrap_or_else(|e| {
                eprintln!("Data file is unreadable ({e}); keeping a backup and starting fresh.");
                let _ = std::fs::rename(path, path.with_extension("json.bak"));
                Data::default()
            }),
            Err(_) => Data::default(),
        }
    }

    /// Atomic write: temp file in the same directory, then rename over the target.
    pub fn save(&self, path: &Path) -> anyhow::Result<()> {
        let tmp = path.with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_vec_pretty(self)?)?;
        std::fs::rename(&tmp, path)?;
        Ok(())
    }
}

pub fn data_file() -> anyhow::Result<PathBuf> {
    let dir = match std::env::var("NEWS_SCANNER_DATA_DIR") {
        Ok(d) if !d.trim().is_empty() => PathBuf::from(d),
        _ => dirs::data_dir().unwrap_or_else(|| PathBuf::from(".")).join("NewsScanner"),
    };
    std::fs::create_dir_all(&dir)?;
    Ok(dir.join("news-scanner-data.json"))
}

#[derive(Clone)]
pub struct App {
    pub data: Arc<Mutex<Data>>,
    pub path: Arc<PathBuf>,
    /// Held while checks run so runs never overlap.
    pub run_lock: Arc<tokio::sync::Mutex<()>>,
    pub client: reqwest::Client,
    pub app_password: Option<Arc<String>>,
    pub loopback_only: bool,
}

impl App {
    /// Mutate data under the lock and persist it.
    pub fn with_data<R>(&self, f: impl FnOnce(&mut Data) -> R) -> R {
        let mut d = self.data.lock().unwrap_or_else(|e| e.into_inner());
        let r = f(&mut d);
        if let Err(e) = d.save(&self.path) {
            eprintln!("Could not save data: {e}");
        }
        r
    }
    pub fn read<R>(&self, f: impl FnOnce(&Data) -> R) -> R {
        let d = self.data.lock().unwrap_or_else(|e| e.into_inner());
        f(&d)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn roundtrip_atomic() {
        let dir = std::env::temp_dir().join(format!("ns-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("d.json");
        let mut d = Data::default();
        d.settings.notify_email = "a@b.c".into();
        d.save(&p).unwrap();
        d.save(&p).unwrap();
        assert_eq!(Data::load(&p).settings.notify_email, "a@b.c");
        assert!(!p.with_extension("json.tmp").exists());
        std::fs::remove_dir_all(&dir).ok();
    }
}
