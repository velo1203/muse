//! Bridge to the Kotlin side of the Android app (`MusePlugin`): runs the bundled
//! yt-dlp (youtubedl-android) and copies files picked from the system file picker.

use serde::Deserialize;
use serde_json::json;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::Duration;
use tauri::plugin::{Builder, PluginHandle, TauriPlugin};
use tauri::Wry;

static HANDLE: OnceLock<PluginHandle<Wry>> = OnceLock::new();

pub fn plugin() -> TauriPlugin<Wry> {
    Builder::new("muse")
        .setup(|_app, api| {
            let handle = api.register_android_plugin("com.hosung.muse", "MusePlugin")?;
            let _ = HANDLE.set(handle);
            Ok(())
        })
        .build()
}

/// Calls a `MusePlugin` command off the async runtime (the call blocks until Kotlin resolves).
async fn call<T: serde::de::DeserializeOwned + Send + 'static>(command: &'static str, payload: serde_json::Value) -> Result<T, String> {
    let handle = HANDLE.get().ok_or("앱이 아직 준비되지 않았어요")?;
    tokio::task::spawn_blocking(move || handle.run_mobile_plugin::<T>(command, payload).map_err(|e| e.to_string()))
        .await
        .map_err(|e| e.to_string())?
}

#[derive(Deserialize)]
pub struct RunResult {
    pub out: String,
    pub err: String,
    #[serde(rename = "exitCode")]
    pub exit_code: i32,
}

#[derive(Deserialize)]
struct Progress {
    progress: f64,
}

#[derive(Deserialize)]
struct Empty {}

pub async fn ytdl_init() -> Result<(), String> {
    call::<Empty>("ytdlInit", json!({})).await.map(|_| ())
}

pub async fn ytdl_update() -> Result<(), String> {
    call::<Empty>("ytdlUpdate", json!({})).await.map(|_| ())
}

/// Runs yt-dlp with `args`, polling download progress (0–100) while it works.
pub async fn ytdl_run(args: Vec<String>, mut on_progress: impl FnMut(f64)) -> Result<RunResult, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let run = call::<RunResult>("ytdlRun", json!({ "id": id, "args": args }));
    tokio::pin!(run);
    let mut last = -1.0;
    loop {
        tokio::select! {
            result = &mut run => return result,
            _ = tokio::time::sleep(Duration::from_millis(400)) => {
                if let Ok(p) = call::<Progress>("ytdlProgress", json!({ "id": id })).await {
                    if p.progress >= 0.0 && p.progress != last {
                        last = p.progress;
                        on_progress(p.progress);
                    }
                }
            }
        }
    }
}

#[derive(Deserialize)]
struct Copied {
    path: String,
    name: String,
}

/// Copies a `content://` URI from the file picker into `dir`; returns the new path and the original file name.
pub async fn copy_uri(uri: &str, dir: &Path, stem: &str) -> Result<(PathBuf, String), String> {
    let c = call::<Copied>("copyUri", json!({ "uri": uri, "dir": dir.display().to_string(), "stem": stem })).await?;
    Ok((PathBuf::from(c.path), c.name))
}
