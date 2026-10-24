//! YouTube search through the site's own web API. It answers in about a second, while a yt-dlp
//! search starts a whole process (a Python runtime on phones). If YouTube changes the format,
//! `ytdlp::search` falls back to yt-dlp.

use crate::ytdlp::YtResult;
use serde_json::{json, Value};

const SEARCH_URL: &str = "https://www.youtube.com/youtubei/v1/search?prettyPrint=false";
const CLIENT_VERSION: &str = "2.20241023.01.00";
/// Search filter: videos only (no channels, playlists or Shorts).
const VIDEOS_ONLY: &str = "EgIQAQ==";

pub async fn search(query: &str, limit: usize) -> Result<Vec<YtResult>, String> {
    let body = json!({
        "context": { "client": { "clientName": "WEB", "clientVersion": CLIENT_VERSION, "hl": "ko", "gl": "KR" } },
        "query": query,
        "params": VIDEOS_ONLY,
    });
    let res: Value = crate::net::client()
        .post(SEARCH_URL)
        .header("User-Agent", "Mozilla/5.0")
        .json(&body)
        .timeout(crate::net::API_TIMEOUT)
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    collect(&res, &mut out, limit);
    if out.is_empty() && !has_videos_section(&res) {
        // Nothing we recognise: the response format probably changed
        return Err("YouTube 검색 응답을 읽지 못했어요".into());
    }
    Ok(out)
}

/// Walks the response for `videoRenderer` entries, in page order.
fn collect(v: &Value, out: &mut Vec<YtResult>, limit: usize) {
    if out.len() >= limit {
        return;
    }
    match v {
        Value::Object(map) => {
            if let Some(r) = map.get("videoRenderer").and_then(video) {
                out.push(r);
                return;
            }
            for child in map.values() {
                collect(child, out, limit);
            }
        }
        Value::Array(items) => {
            for child in items {
                collect(child, out, limit);
            }
        }
        _ => {}
    }
}

fn video(r: &Value) -> Option<YtResult> {
    let id = r["videoId"].as_str()?.to_string();
    // Live streams have no length; they can't be downloaded as a song
    let duration = parse_length(r["lengthText"]["simpleText"].as_str()?);
    Some(YtResult {
        thumbnail: format!("https://i.ytimg.com/vi/{id}/hqdefault.jpg"),
        title: text(&r["title"]),
        channel: text(&r["ownerText"]),
        duration,
        id,
    })
}

fn text(v: &Value) -> String {
    if let Some(s) = v["simpleText"].as_str() {
        return s.to_string();
    }
    v["runs"].as_array().map(|runs| runs.iter().filter_map(|r| r["text"].as_str()).collect()).unwrap_or_default()
}

/// "4:14" / "1:02:03" → seconds
fn parse_length(s: &str) -> Option<f64> {
    s.split(':').try_fold(0.0, |acc, part| part.trim().parse::<f64>().ok().map(|n| acc * 60.0 + n))
}

/// An empty result list is fine when YouTube says so (no matches); anything else is a format change.
fn has_videos_section(v: &Value) -> bool {
    match v {
        Value::Object(map) => {
            map.contains_key("itemSectionRenderer") || map.contains_key("backgroundPromoRenderer") || map.values().any(has_videos_section)
        }
        Value::Array(items) => items.iter().any(has_videos_section),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::{parse_length, search};

    #[test]
    fn lengths() {
        assert_eq!(parse_length("4:14"), Some(254.0));
        assert_eq!(parse_length("1:02:03"), Some(3723.0));
        assert_eq!(parse_length("라이브"), None);
    }

    // Hits the network: cargo test --lib youtube -- --ignored
    #[tokio::test]
    #[ignore]
    async fn live_search() {
        let r = search("아이유 밤편지", 10).await.unwrap();
        for v in &r {
            println!("{} | {} | {} | {:?}", v.id, v.title, v.channel, v.duration);
        }
        assert!(r.len() >= 5 && r.iter().all(|v| v.duration.is_some()));
    }
}
