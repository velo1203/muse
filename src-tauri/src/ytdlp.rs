use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::OnceLock;
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
    bin_dir()
        .cloned()
        .into_iter()
        .chain(path_dirs)
        .chain(extra_dirs())
        .map(|d| d.join(&file))
        .find(|p| p.is_file())
}

pub fn ytdlp_path() -> Option<PathBuf> {
    find_binary("yt-dlp")
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
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

/// Downloads the standalone yt-dlp build for this OS into the app's tools folder.
pub async fn install_ytdlp() -> Result<PathBuf, String> {
    let asset = if cfg!(windows) {
        "yt-dlp.exe"
    } else if cfg!(target_os = "macos") {
        "yt-dlp_macos"
    } else {
        "yt-dlp_linux"
    };
    let dir = bin_dir().ok_or("도구 폴더를 찾을 수 없습니다")?;
    tokio::fs::create_dir_all(dir).await.map_err(|e| e.to_string())?;
    let url = format!("https://github.com/yt-dlp/yt-dlp/releases/latest/download/{asset}");
    let bytes = reqwest::get(&url)
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("yt-dlp 다운로드 실패: {e}"))?
        .bytes()
        .await
        .map_err(|e| e.to_string())?;
    let dest = dir.join(format!("yt-dlp{}", std::env::consts::EXE_SUFFIX));
    tokio::fs::write(&dest, &bytes).await.map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        tokio::fs::set_permissions(&dest, std::fs::Permissions::from_mode(0o755)).await.map_err(|e| e.to_string())?;
    }
    Ok(dest)
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

pub async fn search(query: &str, limit: u32) -> Result<Vec<YtResult>, String> {
    let bin = ytdlp_path().ok_or("yt-dlp를 찾을 수 없습니다. `brew install yt-dlp`로 설치해주세요.")?;
    let out = command(bin)
        .arg(format!("ytsearch{limit}:{query}"))
        .args(["--flat-playlist", "-J", "--no-warnings"])
        .output()
        .await
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    let json: serde_json::Value =
        serde_json::from_slice(&out.stdout).map_err(|e| e.to_string())?;
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
    let out = command(bin)
        .arg(url)
        .args(["--flat-playlist", "-J", "--no-warnings"])
        .output()
        .await
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    let json: serde_json::Value = serde_json::from_slice(&out.stdout).map_err(|e| e.to_string())?;
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
