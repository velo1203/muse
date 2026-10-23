use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::OnceLock;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

/// App-local tools folder (`<app data>/bin`), checked before the system PATH.
static BIN_DIR: OnceLock<PathBuf> = OnceLock::new();

pub fn set_bin_dir(dir: PathBuf) {
    let _ = BIN_DIR.set(dir);
}

pub fn bin_dir() -> Option<&'static PathBuf> {
    BIN_DIR.get()
}

/// GUI apps don't inherit the shell PATH (macOS) and winget links live in a per-user
/// folder (Windows), so check the usual install locations as well.
fn extra_dirs() -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"].iter().map(PathBuf::from).collect();
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        dirs.push(Path::new(&local).join("Microsoft").join("WinGet").join("Links"));
    }
    dirs
}

fn find_binary(name: &str) -> Option<PathBuf> {
    let file = format!("{name}{}", std::env::consts::EXE_SUFFIX);
    let path_dirs = std::env::var_os("PATH").map(|p| std::env::split_paths(&p).collect::<Vec<_>>()).unwrap_or_default();
    // Debug builds can pretend nothing is installed system-wide, to exercise the auto-installer
    let system = !(cfg!(debug_assertions) && std::env::var_os("MUSE_IGNORE_SYSTEM_TOOLS").is_some());
    bin_dir()
        .cloned()
        .into_iter()
        .chain(path_dirs.into_iter().chain(extra_dirs()).filter(|_| system))
        .map(|d| d.join(&file))
        .find(|p| p.is_file())
}

/// Where Muse keeps its own yt-dlp on macOS / Windows: the folder build, which starts in a
/// fraction of a second. The single-file build unpacks itself on every launch (~7 s each time).
pub fn own_ytdlp() -> Option<PathBuf> {
    let exe = if cfg!(target_os = "macos") {
        "yt-dlp_macos"
    } else if cfg!(windows) {
        "yt-dlp.exe"
    } else {
        return None;
    };
    Some(bin_dir()?.join("yt-dlp-dist").join(exe))
}

pub fn ytdlp_path() -> Option<PathBuf> {
    own_ytdlp().filter(|p| p.is_file()).or_else(|| find_binary("yt-dlp"))
}

pub fn ffmpeg_dir() -> Option<PathBuf> {
    find_binary("ffmpeg").and_then(|p| p.parent().map(Path::to_path_buf))
}

pub fn ffmpeg_tool(name: &str) -> Option<PathBuf> {
    ffmpeg_dir().map(|d| d.join(format!("{name}{}", std::env::consts::EXE_SUFFIX)))
}

/// A command that never flashes a console window on Windows.
pub fn command(program: impl AsRef<std::ffi::OsStr>) -> Command {
    #[allow(unused_mut)]
    let mut cmd = Command::new(program);
    // A timed-out or abandoned yt-dlp shouldn't keep running in the background
    cmd.kill_on_drop(true);
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}


#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct YtResult {
    pub id: String,
    pub title: String,
    pub channel: String,
    pub duration: Option<f64>,
    pub thumbnail: String,
}

/// How long a search / link lookup may take before it's reported as failed.
const LISTING_TIMEOUT: Duration = Duration::from_secs(60);

/// Runs `yt-dlp --flat-playlist -J` on a search term or URL and parses its JSON.
async fn flat_listing(bin: &Path, target: &str) -> Result<serde_json::Value, String> {
    let run = command(bin)
        .arg(target)
        .args(["--flat-playlist", "-J", "--no-warnings", "--socket-timeout", "15"])
        .output();
    let out = tokio::time::timeout(LISTING_TIMEOUT, run)
        .await
        .map_err(|_| "YouTube 응답이 너무 늦어요. 인터넷 연결을 확인하고 다시 시도해주세요.".to_string())?
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    serde_json::from_slice(&out.stdout).map_err(|e| e.to_string())
}

pub async fn search(query: &str, limit: u32) -> Result<Vec<YtResult>, String> {
    let bin = ytdlp_path().ok_or("yt-dlp를 찾을 수 없습니다. `brew install yt-dlp`로 설치해주세요.")?;
    let json = flat_listing(&bin, &format!("ytsearch{limit}:{query}")).await?;
    let entries = json["entries"].as_array().cloned().unwrap_or_default();
    Ok(entries
        .iter()
        .filter_map(|e| {
            let id = e["id"].as_str()?.to_string();
            Some(YtResult {
                thumbnail: format!("https://i.ytimg.com/vi/{id}/hqdefault.jpg"),
                title: e["title"].as_str().unwrap_or_default().to_string(),
                channel: e["channel"]
                    .as_str()
                    .or(e["uploader"].as_str())
                    .unwrap_or_default()
                    .to_string(),
                duration: e["duration"].as_f64(),
                id,
            })
        })
        .collect())
}

const UNWANTED: &[&str] = &[
    "live", "cover", "remix", "sped up", "slowed", "karaoke", "instrumental", "reaction",
    "8d", "nightcore", "inst.", "lyrics video", "performance", "dance practice", "fancam",
    "1 hour", "loop", "reverb",
];

/// Picks the YouTube upload that most likely contains the clean studio audio of a song.
pub fn best_match<'a>(
    results: &'a [YtResult],
    title: &str,
    artist: &str,
    duration: Option<f64>,
) -> Option<&'a YtResult> {
    let title_l = title.to_lowercase();
    let artist_l = artist.to_lowercase();
    results
        .iter()
        .map(|r| {
            let t = r.title.to_lowercase();
            let c = r.channel.to_lowercase();
            let mut score = 0.0;
            if c.ends_with(" - topic") {
                score += 30.0;
            }
            if t.contains("official audio") {
                score += 15.0;
            } else if t.contains("audio") {
                score += 5.0;
            }
            if t.contains("official video") || t.contains(" mv") || t.contains("music video") {
                // Music videos often carry intros, outros and sound effects.
                score -= 5.0;
            }
            for w in UNWANTED {
                if t.contains(w) && !title_l.contains(w) {
                    score -= 40.0;
                }
            }
            if t.contains(&title_l) {
                score += 10.0;
            }
            if t.contains(&artist_l) || c.contains(&artist_l) {
                score += 5.0;
            }
            if let (Some(want), Some(got)) = (duration, r.duration) {
                let diff = (want - got).abs();
                score -= if diff > 15.0 { 40.0 } else { diff * 1.5 };
            }
            (score, r)
        })
        .max_by(|a, b| a.0.total_cmp(&b.0))
        .map(|(_, r)| r)
}

pub struct Downloaded {
    pub path: PathBuf,
    pub codec: Option<String>,
    pub bitrate: Option<f64>,
    pub duration: Option<f64>,
}

/// Downloads the audio of `video_id` into `dir/<file_stem>.<ext>`, reporting percentage progress.
pub async fn download_audio(
    video_id: &str,
    dir: &Path,
    file_stem: &str,
    quality: &str,
    mut on_progress: impl FnMut(f64),
) -> Result<Downloaded, String> {
    let bin = ytdlp_path().ok_or("yt-dlp를 찾을 수 없습니다. `brew install yt-dlp`로 설치해주세요.")?;
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let mut cmd = command(bin);
    cmd.arg(format!("https://www.youtube.com/watch?v={video_id}"))
        .arg("-o")
        .arg(dir.join(format!("{file_stem}.%(ext)s")))
        .args([
            "--no-playlist",
            "--no-warnings",
            "--newline",
            "--socket-timeout",
            "20",
            "--progress",
            "--no-simulate",
            "--progress-template",
            "download:PROG %(progress._percent_str)s",
            "--print",
            "after_move:DONE\t%(filepath)s\t%(acodec)s\t%(abr)s\t%(duration)s",
        ]);
    match quality {
        // Re-encode for players that can't handle Opus; quality 0 = highest VBR setting.
        "mp3" => cmd.args(["-f", "bestaudio/best", "-x", "--audio-format", "mp3", "--audio-quality", "0"]),
        "m4a" => cmd.args(["-f", "bestaudio[ext=m4a]/bestaudio/best", "-x", "--audio-format", "m4a", "--audio-quality", "0"]),
        // Highest bitrate stream YouTube offers, kept bit-for-bit (no transcoding loss).
        _ => cmd.args(["-f", "bestaudio/best", "-S", "abr,asr"]),
    };
    if let Some(ff) = ffmpeg_dir() {
        cmd.arg("--ffmpeg-location").arg(ff);
    }
    let mut child = cmd
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;

    let stderr = child.stderr.take().unwrap();
    let err_task = tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        let mut buf = String::new();
        while let Ok(Some(l)) = lines.next_line().await {
            buf.push_str(&l);
            buf.push('\n');
        }
        buf
    });

    let mut done = None;
    let mut lines = BufReader::new(child.stdout.take().unwrap()).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        if let Some(rest) = line.strip_prefix("PROG ") {
            if let Ok(p) = rest.trim().trim_end_matches('%').trim().parse::<f64>() {
                on_progress(p);
            }
        } else if let Some(rest) = line.strip_prefix("DONE\t") {
            let parts: Vec<&str> = rest.split('\t').collect();
            let num = |i: usize| parts.get(i).and_then(|s| s.parse::<f64>().ok());
            done = Some(Downloaded {
                path: PathBuf::from(parts[0]),
                codec: parts.get(1).filter(|s| **s != "NA").map(|s| s.to_string()),
                bitrate: num(2),
                duration: num(3),
            });
        }
    }
    let status = child.wait().await.map_err(|e| e.to_string())?;
    let stderr = err_task.await.unwrap_or_default();
    match done {
        Some(d) if status.success() && d.path.is_file() => Ok(d),
        _ => Err(if stderr.trim().is_empty() {
            "다운로드에 실패했습니다".into()
        } else {
            stderr.trim().to_string()
        }),
    }
}

/// Measures integrated loudness (LUFS) and true peak (dBTP) with ffmpeg's EBU R128 meter.
pub async fn measure_loudness(path: &Path) -> Option<(f64, f64)> {
    let ffmpeg = ffmpeg_tool("ffmpeg")?;
    let out = command(ffmpeg)
        .args(["-hide_banner", "-nostats", "-i"])
        .arg(path)
        .args(["-af", "ebur128=peak=true:framelog=quiet", "-f", "null", "-"])
        .output()
        .await
        .ok()?;
    let stderr = String::from_utf8_lossy(&out.stderr);
    // Summary block: "I:  -9.7 LUFS" ... "Peak:  0.9 dBFS"
    let summary = &stderr[stderr.rfind("Summary:")?..];
    let value_after = |label: &str| {
        let rest = &summary[summary.find(label)? + label.len()..];
        rest.split_whitespace().next()?.parse::<f64>().ok().filter(|n| n.is_finite())
    };
    Some((value_after("I:")?, value_after("Peak:")?))
}

/// Lists the video(s) behind a YouTube link: a single video or every entry of a playlist.
pub async fn resolve_url(url: &str) -> Result<Vec<YtResult>, String> {
    let bin = ytdlp_path().ok_or("yt-dlp를 찾을 수 없습니다. `brew install yt-dlp`로 설치해주세요.")?;
    let json = flat_listing(&bin, url).await?;
    let entries = match json["entries"].as_array() {
        Some(e) => e.clone(),
        None => vec![json],
    };
    Ok(entries
        .iter()
        .filter_map(|e| {
            let id = e["id"].as_str()?.to_string();
            Some(YtResult {
                thumbnail: format!("https://i.ytimg.com/vi/{id}/hqdefault.jpg"),
                title: e["title"].as_str().unwrap_or_default().to_string(),
                channel: e["channel"].as_str().or(e["uploader"].as_str()).unwrap_or_default().to_string(),
                duration: e["duration"].as_f64(),
                id,
            })
        })
        .collect())
}
