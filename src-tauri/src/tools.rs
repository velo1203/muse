//! Installs the external tools (yt-dlp, ffmpeg/ffprobe) into the app's own `bin` folder
//! when they aren't already on the system, and keeps the app-managed yt-dlp up to date.

use crate::ytdlp::{bin_dir, command, ffmpeg_dir, ytdlp_path};
use serde::Serialize;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;

/// Serializes installs so concurrent callers wait for one download instead of racing.
static YTDLP_LOCK: Mutex<()> = Mutex::const_new(());
static FFMPEG_LOCK: Mutex<()> = Mutex::const_new(());

const EXE: &str = std::env::consts::EXE_SUFFIX;
const UPDATE_EVERY: Duration = Duration::from_secs(7 * 24 * 3600);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolEvent {
    pub tool: &'static str,
    /// "downloading" | "installing" | "done" | "error"
    pub stage: &'static str,
    pub progress: f64,
    pub message: Option<String>,
}

fn emit(app: &AppHandle, tool: &'static str, stage: &'static str, progress: f64, message: Option<String>) {
    let _ = app.emit("tools", ToolEvent { tool, stage, progress, message });
}

fn own_bin() -> Result<&'static PathBuf, String> {
    bin_dir().ok_or_else(|| "도구 폴더를 찾을 수 없습니다".to_string())
}

/// Downloads `url` into memory, reporting 0–100 progress.
async fn download(app: &AppHandle, tool: &'static str, url: &str) -> Result<Vec<u8>, String> {
    let mut resp = reqwest::get(url)
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("{tool} 다운로드 실패: {e}"))?;
    let total = resp.content_length().unwrap_or(0) as f64;
    let mut buf = Vec::with_capacity(total as usize);
    let mut last = -1.0;
    while let Some(chunk) = resp.chunk().await.map_err(|e| format!("{tool} 다운로드 실패: {e}"))? {
        buf.extend_from_slice(&chunk);
        if total > 0.0 {
            let p = (buf.len() as f64 / total * 100.0).floor();
            if p != last {
                last = p;
                emit(app, tool, "downloading", p, None);
            }
        }
    }
    Ok(buf)
}

async fn write_executable(path: &Path, bytes: &[u8]) -> Result<(), String> {
    // Write to a temp name first so a half-written binary is never picked up
    let tmp = path.with_extension("part");
    tokio::fs::write(&tmp, bytes).await.map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        tokio::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o755)).await.map_err(|e| e.to_string())?;
    }
    tokio::fs::rename(&tmp, path).await.map_err(|e| e.to_string())
}

/// Extracts the entries of `zip` whose file names satisfy `keep` into `dest` (flattened).
fn unzip_into(zip: &[u8], dest: &Path, keep: impl Fn(&str) -> bool) -> Result<usize, String> {
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(zip)).map_err(|e| e.to_string())?;
    let mut n = 0;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        if entry.is_dir() {
            continue;
        }
        let Some(name) = entry.enclosed_name().and_then(|p| p.file_name().map(|f| f.to_string_lossy().to_string())) else {
            continue;
        };
        if !keep(&name) {
            continue;
        }
        let mut bytes = Vec::with_capacity(entry.size() as usize);
        entry.read_to_end(&mut bytes).map_err(|e| e.to_string())?;
        let out = dest.join(&name);
        std::fs::write(&out, &bytes).map_err(|e| e.to_string())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&out, std::fs::Permissions::from_mode(0o755)).map_err(|e| e.to_string())?;
        }
        n += 1;
    }
    Ok(n)
}

/// Makes sure yt-dlp is available, downloading the standalone build if needed.
pub async fn ensure_ytdlp(app: &AppHandle) -> Result<PathBuf, String> {
    let _guard = YTDLP_LOCK.lock().await;
    if let Some(p) = ytdlp_path() {
        return Ok(p);
    }
    let asset = if cfg!(windows) {
        "yt-dlp.exe"
    } else if cfg!(target_os = "macos") {
        "yt-dlp_macos"
    } else {
        "yt-dlp_linux"
    };
    let dir = own_bin()?;
    tokio::fs::create_dir_all(dir).await.map_err(|e| e.to_string())?;
    let result: Result<PathBuf, String> = async {
        let bytes = download(app, "yt-dlp", &format!("https://github.com/yt-dlp/yt-dlp/releases/latest/download/{asset}")).await?;
        emit(app, "yt-dlp", "installing", 100.0, None);
        let dest = dir.join(format!("yt-dlp{EXE}"));
        write_executable(&dest, &bytes).await?;
        let _ = tokio::fs::write(dir.join(".yt-dlp-checked"), b"").await;
        Ok(dest)
    }
    .await;
    match &result {
        Ok(_) => emit(app, "yt-dlp", "done", 100.0, None),
        Err(e) => emit(app, "yt-dlp", "error", 0.0, Some(e.clone())),
    }
    result
}

/// Makes sure ffmpeg + ffprobe are available, downloading static builds if needed.
pub async fn ensure_ffmpeg(app: &AppHandle) -> Result<PathBuf, String> {
    let _guard = FFMPEG_LOCK.lock().await;
    if let Some(d) = ffmpeg_dir() {
        if d.join(format!("ffprobe{EXE}")).is_file() {
            return Ok(d);
        }
    }
    let dir = own_bin()?.clone();
    tokio::fs::create_dir_all(&dir).await.map_err(|e| e.to_string())?;
    let result: Result<PathBuf, String> = async {
        if cfg!(windows) {
            // Shared build from the yt-dlp project: ffmpeg/ffprobe .exe plus their DLLs
            let zip = download(
                app,
                "ffmpeg",
                "https://github.com/yt-dlp/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-win64-gpl-shared.zip",
            )
            .await?;
            emit(app, "ffmpeg", "installing", 100.0, None);
            let d = dir.clone();
            tokio::task::spawn_blocking(move || {
                unzip_into(&zip, &d, |n| n == "ffmpeg.exe" || n == "ffprobe.exe" || n.ends_with(".dll"))
            })
            .await
            .map_err(|e| e.to_string())??;
        } else if cfg!(target_os = "macos") {
            let arch = if cfg!(target_arch = "aarch64") { "arm64" } else { "amd64" };
            for (i, tool) in ["ffmpeg", "ffprobe"].iter().enumerate() {
                let url = format!("https://ffmpeg.martin-riedl.de/redirect/latest/macos/{arch}/release/{tool}.zip");
                let zip = download(app, "ffmpeg", &url).await.map_err(|e| format!("{e} ({}/2)", i + 1))?;
                let d = dir.clone();
                let name = tool.to_string();
                tokio::task::spawn_blocking(move || unzip_into(&zip, &d, |n| n == name))
                    .await
                    .map_err(|e| e.to_string())??;
            }
        } else {
            return Err("이 OS에서는 ffmpeg를 직접 설치해주세요".into());
        }
        if !dir.join(format!("ffmpeg{EXE}")).is_file() {
            return Err("ffmpeg 압축을 풀지 못했습니다".into());
        }
        Ok(dir)
    }
    .await;
    match &result {
        Ok(_) => emit(app, "ffmpeg", "done", 100.0, None),
        Err(e) => emit(app, "ffmpeg", "error", 0.0, Some(e.clone())),
    }
    result
}

/// The yt-dlp that Muse installed itself updates weekly (YouTube changes often break old versions).
/// Copies managed by Homebrew / winget are left to their package manager.
pub async fn update_ytdlp_if_stale() {
    let Some(dir) = bin_dir() else { return };
    let own = dir.join(format!("yt-dlp{EXE}"));
    if !own.is_file() || ytdlp_path().as_deref() != Some(own.as_path()) {
        return;
    }
    let stamp = dir.join(".yt-dlp-checked");
    let fresh = std::fs::metadata(&stamp)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| SystemTime::now().duration_since(t).ok())
        .is_some_and(|age| age < UPDATE_EVERY);
    if fresh {
        return;
    }
    let _guard = YTDLP_LOCK.lock().await;
    let ok = command(&own).arg("-U").output().await.is_ok_and(|o| o.status.success());
    if ok {
        let _ = tokio::fs::write(&stamp, b"").await;
    }
}

/// Startup task: install whatever is missing, then refresh yt-dlp if it's old.
pub async fn ensure_all(app: AppHandle) {
    let _ = ensure_ytdlp(&app).await;
    let _ = ensure_ffmpeg(&app).await;
    update_ytdlp_if_stale().await;
}
