//! Lyrics from LRCLIB (free, community-maintained, includes time-synced LRC).

use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Lyrics {
    /// LRC text with [mm:ss.xx] timestamps
    pub synced: Option<String>,
    pub plain: Option<String>,
    pub instrumental: bool,
}

fn from_json(v: &serde_json::Value) -> Lyrics {
    let text = |k: &str| v[k].as_str().filter(|s| !s.trim().is_empty()).map(str::to_string);
    Lyrics {
        synced: text("syncedLyrics"),
        plain: text("plainLyrics"),
        instrumental: v["instrumental"].as_bool().unwrap_or(false),
    }
}

async fn fetch(title: &str, artist: &str, album: &str, duration: f64) -> Option<Lyrics> {
    let client = reqwest::Client::builder()
        .user_agent("Muse/0.1 (personal music player)")
        .build()
        .ok()?;
    // Exact match first (title/artist/album/duration), then a looser search.
    let exact = client
        .get("https://lrclib.net/api/get")
        .query(&[
            ("track_name", title),
            ("artist_name", artist),
            ("album_name", album),
            ("duration", &format!("{}", duration.round() as i64)),
        ])
        .send()
        .await
        .ok()?;
    if exact.status().is_success() {
        if let Ok(v) = exact.json::<serde_json::Value>().await {
            return Some(from_json(&v));
        }
    }
    let search = |params: Vec<(&'static str, String)>| {
        let req = client.get("https://lrclib.net/api/search").query(&params);
        async move { req.send().await.ok()?.json::<Vec<serde_json::Value>>().await.ok() }
    };
    let mut results = search(vec![("track_name", title.to_string()), ("artist_name", artist.to_string())]).await?;
    if results.is_empty() {
        // Artist names often differ (romanization, "feat." credits): fall back to a free-text search
        results = search(vec![("q", format!("{title} {artist}"))]).await.unwrap_or_default();
    }
    // Prefer synced lyrics whose length is close to ours
    results
        .iter()
        .filter(|r| (r["duration"].as_f64().unwrap_or(0.0) - duration).abs() < 8.0 || duration == 0.0)
        .max_by_key(|r| r["syncedLyrics"].is_string() as u8)
        .or(results.first())
        .map(from_json)
        // The search worked but found nothing: remember that as "no lyrics"
        .or(Some(Lyrics::default()))
}

/// Cached per track in `<root>/lyrics/<id>.json`; misses are cached too so we don't re-query.
pub async fn get(cache: &Path, title: &str, artist: &str, album: &str, duration: f64, refresh: bool) -> Lyrics {
    if refresh {
        let _ = tokio::fs::remove_file(cache).await;
    }
    if let Ok(s) = tokio::fs::read_to_string(cache).await {
        if let Ok(l) = serde_json::from_str(&s) {
            return l;
        }
    }
    let lyrics = fetch(title, artist, album, duration).await;
    // Network failures aren't cached so a later attempt can succeed
    if let Some(l) = &lyrics {
        if let Some(dir) = cache.parent() {
            let _ = tokio::fs::create_dir_all(dir).await;
        }
        let _ = tokio::fs::write(cache, serde_json::to_string(l).unwrap_or_default()).await;
    }
    lyrics.unwrap_or_default()
}
