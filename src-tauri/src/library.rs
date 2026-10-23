use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    pub id: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    /// Seconds
    pub duration: f64,
    /// Absolute path of the audio file on disk
    pub path: String,
    /// Absolute path of the cover image on disk, if any
    pub cover: Option<String>,
    pub youtube_id: String,
    pub codec: Option<String>,
    pub bitrate: Option<f64>,
    pub added_at: u64,
    /// Integrated loudness (LUFS), used for volume normalization
    #[serde(default)]
    pub loudness: Option<f64>,
    /// True peak (dBTP)
    #[serde(default)]
    pub peak: Option<f64>,
    /// "youtube" or "local" (imported file; youtube_id is empty)
    #[serde(default = "default_source")]
    pub source: String,
    #[serde(default)]
    pub play_count: u32,
    #[serde(default)]
    pub last_played_at: Option<u64>,
    #[serde(default)]
    pub track_number: Option<u32>,
    #[serde(default)]
    pub disc_number: Option<u32>,
    #[serde(default)]
    pub year: Option<String>,
    #[serde(default)]
    pub genre: Option<String>,
}

fn default_source() -> String {
    "youtube".into()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub track_id: String,
    pub at: u64,
}

/// Keep the listening history bounded
pub const HISTORY_LIMIT: usize = 1000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Playlist {
    pub id: String,
    pub name: String,
    pub description: String,
    pub track_ids: Vec<String>,
    pub created_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    /// "best" keeps the original stream untouched, "m4a" / "mp3" re-encode for compatibility
    pub quality: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self { quality: "best".into() }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Library {
    pub tracks: Vec<Track>,
    pub playlists: Vec<Playlist>,
    pub liked: Vec<String>,
    #[serde(default)]
    pub settings: Settings,
    #[serde(default)]
    pub history: Vec<HistoryEntry>,
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub struct Store {
    pub root: PathBuf,
    pub data: Library,
}

impl Store {
    pub fn load(root: PathBuf) -> Self {
        let _ = std::fs::create_dir_all(root.join("music"));
        let _ = std::fs::create_dir_all(root.join("covers"));
        let _ = std::fs::create_dir_all(root.join("lyrics"));
        let data = std::fs::read_to_string(root.join("library.json"))
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        Self { root, data }
    }

    pub fn music_dir(&self) -> PathBuf {
        self.root.join("music")
    }

    pub fn covers_dir(&self) -> PathBuf {
        self.root.join("covers")
    }

    pub fn lyrics_path(&self, track_id: &str) -> PathBuf {
        self.root.join("lyrics").join(format!("{track_id}.json"))
    }

    pub fn save(&self) -> Result<(), String> {
        let json = serde_json::to_string_pretty(&self.data).map_err(|e| e.to_string())?;
        let tmp = self.root.join("library.json.tmp");
        std::fs::write(&tmp, json).map_err(|e| e.to_string())?;
        std::fs::rename(&tmp, self.root.join("library.json")).map_err(|e| e.to_string())
    }

    pub fn remove_track(&mut self, id: &str) {
        if let Some(pos) = self.data.tracks.iter().position(|t| t.id == id) {
            let track = self.data.tracks.remove(pos);
            remove_if_inside(&self.root, Path::new(&track.path));
            if let Some(cover) = &track.cover {
                remove_if_inside(&self.root, Path::new(cover));
            }
        }
        self.data.liked.retain(|t| t != id);
        self.data.history.retain(|h| h.track_id != id);
        let _ = std::fs::remove_file(self.lyrics_path(id));
        for p in &mut self.data.playlists {
            p.track_ids.retain(|t| t != id);
        }
    }
}

/// Only delete files that live inside the app's own data directory.
fn remove_if_inside(root: &Path, file: &Path) {
    if file.starts_with(root) {
        let _ = std::fs::remove_file(file);
    }
}
