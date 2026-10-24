//! Reading tags / embedded artwork from local audio files with ffprobe + ffmpeg.

use crate::ytdlp::{command, ffmpeg_tool};
use std::path::Path;

pub const AUDIO_EXTS: &[&str] = &["mp3", "m4a", "aac", "flac", "wav", "ogg", "opus", "webm", "aiff", "aif", "alac"];

#[derive(Default)]
pub struct Probe {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub duration: Option<f64>,
    pub codec: Option<String>,
    pub bitrate: Option<f64>,
    pub track_number: Option<u32>,
    pub year: Option<String>,
    pub genre: Option<String>,
}

pub async fn probe(path: &Path) -> Probe {
    let Some(ffprobe) = ffmpeg_tool("ffprobe").filter(|p| p.is_file()) else {
        // No ffprobe (Android, or before ffmpeg is installed): read the tags in-process
        let p = path.to_path_buf();
        return tokio::task::spawn_blocking(move || probe_with_lofty(&p)).await.unwrap_or_default();
    };
    let Ok(out) = command(ffprobe)
        .args(["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams"])
        .arg(path)
        .output()
        .await
    else {
        return Probe::default();
    };
    let v: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap_or_default();
    let fmt = &v["format"];
    let audio = v["streams"]
        .as_array()
        .and_then(|s| s.iter().find(|s| s["codec_type"] == "audio"))
        .cloned()
        .unwrap_or_default();
    // Tag keys vary in case between containers (TITLE / title)
    let tag = |k: &str| {
        [&fmt["tags"], &audio["tags"]].iter().find_map(|tags| {
            tags.as_object()?
                .iter()
                .find(|(key, _)| key.eq_ignore_ascii_case(k))
                .and_then(|(_, v)| v.as_str())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
        })
    };
    let num = |s: Option<&str>| s.and_then(|s| s.parse::<f64>().ok());
    Probe {
        title: tag("title"),
        artist: tag("artist").or_else(|| tag("album_artist")),
        album: tag("album"),
        duration: num(fmt["duration"].as_str()),
        codec: audio["codec_name"].as_str().map(str::to_string),
        bitrate: num(audio["bit_rate"].as_str()).or(num(fmt["bit_rate"].as_str())).map(|b| b / 1000.0),
        track_number: tag("track").and_then(|t| t.split('/').next()?.parse().ok()),
        year: tag("date").map(|d| d.chars().take(4).collect()),
        genre: tag("genre"),
    }
}

/// Tags and stream info read in-process with lofty (no external tools).
fn probe_with_lofty(path: &Path) -> Probe {
    use lofty::prelude::*;
    let Ok(file) = lofty::read_from_path(path) else {
        return Probe::default();
    };
    let props = file.properties();
    let tag = file.primary_tag().or(file.first_tag());
    let text = |v: Option<std::borrow::Cow<'_, str>>| v.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    Probe {
        title: tag.and_then(|t| text(t.title())),
        artist: tag.and_then(|t| text(t.artist())),
        album: tag.and_then(|t| text(t.album())),
        duration: Some(props.duration().as_secs_f64()).filter(|d| *d > 0.0),
        codec: Some(format!("{:?}", file.file_type()).to_lowercase()),
        bitrate: props.audio_bitrate().map(f64::from),
        track_number: tag.and_then(|t| t.track()),
        year: tag.and_then(|t| t.date()).map(|d| d.year.to_string()),
        genre: tag.and_then(|t| text(t.genre())),
    }
}

/// Embedded cover art read in-process with lofty.
fn cover_with_lofty(path: &Path, dest: &Path) -> Option<String> {
    use lofty::prelude::*;
    let file = lofty::read_from_path(path).ok()?;
    let tag = file.primary_tag().or(file.first_tag())?;
    let picture = tag.pictures().first()?;
    std::fs::write(dest, picture.data()).ok()?;
    Some(dest.display().to_string())
}

/// Extracts embedded cover art (if any) to `dest`.
pub async fn extract_cover(path: &Path, dest: &Path) -> Option<String> {
    let Some(ffmpeg) = ffmpeg_tool("ffmpeg").filter(|p| p.is_file()) else {
        let (p, d) = (path.to_path_buf(), dest.to_path_buf());
        return tokio::task::spawn_blocking(move || cover_with_lofty(&p, &d)).await.ok().flatten();
    };
    let ok = command(ffmpeg)
        .args(["-v", "quiet", "-y", "-i"])
        .arg(path)
        .args(["-an", "-frames:v", "1"])
        .arg(dest)
        .status()
        .await
        .ok()?
        .success();
    (ok && dest.is_file()).then(|| dest.display().to_string())
}
