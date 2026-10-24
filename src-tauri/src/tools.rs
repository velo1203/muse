//! Installs the external tools (yt-dlp, ffmpeg/ffprobe) into the app's own `bin` folder
//! when they aren't already on the system, and keeps the app-managed yt-dlp up to date.

#[cfg(not(target_os = "android"))]
use crate::ytdlp::{command, ffmpeg_dir, own_ytdlp, ytdlp_path};
use crate::ytdlp::bin_dir;
use serde::Serialize;
#[cfg(not(target_os = "android"))]
use std::io::Read;
#[cfg(not(target_os = "android"))]
use std::path::Path;
use std::path::PathBuf;
use std::time::{Duration, SystemTime};
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;

/// Serializes installs so concurrent callers wait for one download instead of racing.
static YTDLP_LOCK: Mutex<()> = Mutex::const_new(());
#[cfg(not(target_os = "android"))]
static FFMPEG_LOCK: Mutex<()> = Mutex::const_new(());

#[cfg(not(target_os = "android"))]
const EXE: &str = std::env::consts::EXE_SUFFIX;
const UPDATE_EVERY: Duration = Duration::from_secs(7 * 24 * 3600);
#[cfg(not(target_os = "android"))]
const YTDLP_RELEASES: &str = "https://github.com/yt-dlp/yt-dlp/releases";

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

#[cfg_attr(target_os = "android", allow(dead_code))]
fn own_bin() -> Result<&'static PathBuf, String> {
    bin_dir().ok_or_else(|| "도구 폴더를 찾을 수 없습니다".to_string())
}

#[cfg(not(target_os = "android"))]
/// Downloads `url` into memory, reporting 0–100 progress.
async fn download(app: &AppHandle, tool: &'static str, url: &str) -> Result<Vec<u8>, String> {
    let mut resp = crate::net::client()
        .get(url)
        .send()
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

#[cfg(not(target_os = "android"))]
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

#[cfg(not(target_os = "android"))]
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

#[cfg(not(target_os = "android"))]
/// Extracts all of `zip` into `dest`, keeping its folder layout and file modes.
fn unzip_tree(zip: &[u8], dest: &Path) -> Result<(), String> {
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(zip)).map_err(|e| e.to_string())?;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let Some(rel) = entry.enclosed_name() else { continue };
        let out = dest.join(rel);
        if entry.is_dir() {
            std::fs::create_dir_all(&out).map_err(|e| e.to_string())?;
            continue;
        }
        if let Some(parent) = out.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut file = std::fs::File::create(&out).map_err(|e| e.to_string())?;
        std::io::copy(&mut entry, &mut file).map_err(|e| e.to_string())?;
        #[cfg(unix)]
        if let Some(mode) = entry.unix_mode() {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&out, std::fs::Permissions::from_mode(mode & 0o777)).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[cfg(not(target_os = "android"))]
/// Downloads the latest yt-dlp into the app's `bin` folder (replacing any older copy there).
async fn install_ytdlp(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = own_bin()?;
    tokio::fs::create_dir_all(dir).await.map_err(|e| e.to_string())?;
    let asset = if cfg!(windows) {
        "yt-dlp_win.zip"
    } else if cfg!(target_os = "macos") {
        "yt-dlp_macos.zip"
    } else {
        "yt-dlp_linux"
    };
    let bytes = download(app, "yt-dlp", &format!("{YTDLP_RELEASES}/latest/download/{asset}")).await?;
    emit(app, "yt-dlp", "installing", 100.0, None);
    let single_file = dir.join(format!("yt-dlp{EXE}"));
    let path = match own_ytdlp() {
        Some(exe) => {
            // Unpack next to the old copy, then swap, so a half-extracted folder is never used
            let dist = exe.parent().ok_or("도구 폴더를 찾을 수 없습니다")?.to_path_buf();
            let tmp = dist.with_extension("part");
            let _ = tokio::fs::remove_dir_all(&tmp).await;
            let t = tmp.clone();
            tokio::task::spawn_blocking(move || unzip_tree(&bytes, &t))
                .await
                .map_err(|e| e.to_string())??;
            let _ = tokio::fs::remove_dir_all(&dist).await;
            tokio::fs::rename(&tmp, &dist).await.map_err(|e| e.to_string())?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = std::fs::set_permissions(&exe, std::fs::Permissions::from_mode(0o755));
            }
            // Earlier versions installed the slow single-file build here
            let _ = tokio::fs::remove_file(&single_file).await;
            exe
        }
        None => {
            write_executable(&single_file, &bytes).await?;
            single_file
        }
    };
    // macOS checks a new binary on its first launch (several seconds): get that out of the way
    // now instead of during the first search
    let _ = tokio::time::timeout(Duration::from_secs(60), command(&path).arg("--version").output()).await;
    let _ = tokio::fs::write(dir.join(".yt-dlp-checked"), b"").await;
    Ok(path)
}

#[cfg(not(target_os = "android"))]
async fn install_ytdlp_reporting(app: &AppHandle) -> Result<PathBuf, String> {
    let result = install_ytdlp(app).await;
    match &result {
        Ok(_) => emit(app, "yt-dlp", "done", 100.0, None),
        Err(e) => emit(app, "yt-dlp", "error", 0.0, Some(e.clone())),
    }
    result
}

#[cfg(not(target_os = "android"))]
/// Makes sure yt-dlp is available, downloading it if needed.
pub async fn ensure_ytdlp(app: &AppHandle) -> Result<PathBuf, String> {
    // Usual case: already there, no need to wait behind an install or update
    if let Some(p) = ytdlp_path() {
        return Ok(p);
    }
    let _guard = YTDLP_LOCK.lock().await;
    if let Some(p) = ytdlp_path() {
        return Ok(p);
    }
    install_ytdlp_reporting(app).await
}

#[cfg(not(target_os = "android"))]
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

#[cfg(not(target_os = "android"))]
/// Version tag of the newest yt-dlp release (the `latest` link redirects to its tag page).
async fn latest_ytdlp_version() -> Option<String> {
    let resp = crate::net::client().get(format!("{YTDLP_RELEASES}/latest")).timeout(crate::net::API_TIMEOUT).send().await.ok()?;
    resp.url().path_segments()?.next_back().map(str::to_string)
}

#[cfg(not(target_os = "android"))]
/// The yt-dlp that Muse installed itself is kept current (YouTube changes often break old versions),
/// and the slow single-file build from earlier versions is swapped for the folder build.
/// Copies managed by Homebrew / winget are left to their package manager.
pub async fn update_ytdlp_if_stale(app: &AppHandle) {
    let Some(dir) = bin_dir() else { return };
    let Some(current) = ytdlp_path() else { return };
    let single_file = dir.join(format!("yt-dlp{EXE}"));
    let outdated_build = own_ytdlp().is_some() && current == single_file;
    if !outdated_build {
        let managed = own_ytdlp().as_ref() == Some(&current) || current == single_file;
        if !managed {
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
        let Some(latest) = latest_ytdlp_version().await else { return };
        let installed = command(&current).arg("--version").output().await.ok();
        if installed.is_some_and(|o| String::from_utf8_lossy(&o.stdout).trim() == latest) {
            let _ = tokio::fs::write(&stamp, b"").await;
            return;
        }
    }
    let _guard = YTDLP_LOCK.lock().await;
    let _ = install_ytdlp_reporting(app).await;
}

// ---------- Android: yt-dlp and ffmpeg ship inside the app (youtubedl-android) ----------

/// The bundled yt-dlp unpacks its Python runtime on first use; later calls return immediately.
#[cfg(target_os = "android")]
pub async fn ensure_ytdlp(app: &AppHandle) -> Result<PathBuf, String> {
    static READY: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
    if READY.load(std::sync::atomic::Ordering::Acquire) {
        return Ok(PathBuf::from("yt-dlp"));
    }
    let _guard = YTDLP_LOCK.lock().await;
    if READY.load(std::sync::atomic::Ordering::Acquire) {
        return Ok(PathBuf::from("yt-dlp"));
    }
    emit(app, "yt-dlp", "installing", 100.0, None);
    let ready = async {
        crate::android::ytdl_init().await?;
        // The yt-dlp shipped inside the APK is months old and YouTube rejects it (HTTP 403):
        // the very first time, update before anything is searched or downloaded
        let stamp = bin_dir().map(|d| d.join(".yt-dlp-checked"));
        if stamp.as_ref().is_some_and(|s| !s.is_file()) {
            crate::android::ytdl_update().await?;
            if let Some(s) = &stamp {
                let _ = tokio::fs::create_dir_all(s.parent().unwrap()).await;
                let _ = tokio::fs::write(s, b"").await;
            }
        }
        Ok::<(), String>(())
    };
    match ready.await {
        Ok(()) => {
            READY.store(true, std::sync::atomic::Ordering::Release);
            emit(app, "yt-dlp", "done", 100.0, None);
            Ok(PathBuf::from("yt-dlp"))
        }
        Err(e) => {
            emit(app, "yt-dlp", "error", 0.0, Some(e.clone()));
            Err(e)
        }
    }
}

/// ffmpeg is bundled with youtubedl-android; nothing to install.
#[cfg(target_os = "android")]
pub async fn ensure_ffmpeg(app: &AppHandle) -> Result<PathBuf, String> {
    ensure_ytdlp(app).await
}

/// Updates the bundled yt-dlp weekly (YouTube changes often break old versions).
#[cfg(target_os = "android")]
pub async fn update_ytdlp_if_stale(_app: &AppHandle) {
    let Some(dir) = bin_dir() else { return };
    let _ = tokio::fs::create_dir_all(dir).await;
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
    if crate::android::ytdl_update().await.is_ok() {
        let _ = tokio::fs::write(&stamp, b"").await;
    }
}

/// Startup task: install whatever is missing, then refresh yt-dlp if it's old.
pub async fn ensure_all(app: AppHandle) {
    let _ = ensure_ytdlp(&app).await;
    let _ = ensure_ffmpeg(&app).await;
    update_ytdlp_if_stale(&app).await;
}
