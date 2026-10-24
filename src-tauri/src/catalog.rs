//! Song / album metadata from the public iTunes Search API (no key required).

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogTrack {
    pub title: String,
    pub artist: String,
    pub album: String,
    pub artwork: String,
    /// Seconds
    pub duration: Option<f64>,
    pub album_id: Option<u64>,
    pub track_number: Option<u32>,
    pub disc_number: Option<u32>,
    pub year: Option<String>,
    pub genre: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogAlbum {
    pub id: u64,
    pub title: String,
    pub artist: String,
    pub artwork: String,
    pub year: Option<String>,
    pub track_count: Option<u32>,
    pub genre: Option<String>,
}

fn artwork(r: &serde_json::Value) -> String {
    r["artworkUrl100"].as_str().unwrap_or_default().replace("100x100bb", "600x600bb")
}

fn year(r: &serde_json::Value) -> Option<String> {
    r["releaseDate"].as_str().map(|d| d.chars().take(4).collect())
}

fn track_of(r: &serde_json::Value) -> Option<CatalogTrack> {
    Some(CatalogTrack {
        title: r["trackName"].as_str()?.to_string(),
        artist: r["artistName"].as_str().unwrap_or_default().to_string(),
        album: r["collectionName"].as_str().unwrap_or_default().to_string(),
        artwork: artwork(r),
        duration: r["trackTimeMillis"].as_f64().map(|ms| ms / 1000.0),
        album_id: r["collectionId"].as_u64(),
        track_number: r["trackNumber"].as_u64().map(|n| n as u32),
        disc_number: r["discNumber"].as_u64().map(|n| n as u32),
        year: year(r),
        genre: r["primaryGenreName"].as_str().map(str::to_string),
    })
}

async fn get(url: String) -> Result<Vec<serde_json::Value>, String> {
    let json: serde_json::Value = crate::net::get(&url)
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    Ok(json["results"].as_array().cloned().unwrap_or_default())
}

pub async fn search_songs(query: &str) -> Result<Vec<CatalogTrack>, String> {
    let url = format!(
        "https://itunes.apple.com/search?term={}&entity=song&limit=25",
        urlencoding::encode(query)
    );
    Ok(get(url).await?.iter().filter_map(track_of).collect())
}

pub async fn search_albums(query: &str) -> Result<Vec<CatalogAlbum>, String> {
    let url = format!(
        "https://itunes.apple.com/search?term={}&entity=album&limit=20",
        urlencoding::encode(query)
    );
    Ok(get(url)
        .await?
        .iter()
        .filter_map(|r| {
            Some(CatalogAlbum {
                id: r["collectionId"].as_u64()?,
                title: r["collectionName"].as_str()?.to_string(),
                artist: r["artistName"].as_str().unwrap_or_default().to_string(),
                artwork: artwork(r),
                year: year(r),
                track_count: r["trackCount"].as_u64().map(|n| n as u32),
                genre: r["primaryGenreName"].as_str().map(str::to_string),
            })
        })
        .collect())
}

/// Album info plus its tracks in disc/track order.
pub async fn album(id: u64) -> Result<(CatalogAlbum, Vec<CatalogTrack>), String> {
    let results = get(format!("https://itunes.apple.com/lookup?id={id}&entity=song&limit=200")).await?;
    let info = results
        .iter()
        .find(|r| r["wrapperType"] == "collection")
        .ok_or("앨범을 찾을 수 없습니다")?;
    let album = CatalogAlbum {
        id,
        title: info["collectionName"].as_str().unwrap_or_default().to_string(),
        artist: info["artistName"].as_str().unwrap_or_default().to_string(),
        artwork: artwork(info),
        year: year(info),
        track_count: info["trackCount"].as_u64().map(|n| n as u32),
        genre: info["primaryGenreName"].as_str().map(str::to_string),
    };
    let mut tracks: Vec<CatalogTrack> = results
        .iter()
        .filter(|r| r["wrapperType"] == "track")
        .filter_map(track_of)
        .collect();
    tracks.sort_by_key(|t| (t.disc_number.unwrap_or(1), t.track_number.unwrap_or(0)));
    Ok((album, tracks))
}

/// Best catalog match for a song whose metadata came from a YouTube title.
pub async fn lookup(title: &str, artist: &str, duration: Option<f64>) -> Option<CatalogTrack> {
    let results = search_songs(&format!("{artist} {title}")).await.ok()?;
    let t = title.to_lowercase();
    let same_title = |r: &CatalogTrack| {
        let rt = r.title.to_lowercase();
        rt.contains(&t) || t.contains(&rt)
    };
    // Korean titles often come back translated ("밤편지" → "Through the Night"), so a near-identical
    // length among the top hits counts as the same song too
    let same_length = |r: &CatalogTrack| matches!((duration, r.duration), (Some(d), Some(rd)) if (rd - d).abs() <= 3.0);
    let found = results.iter().find(|r| same_title(r)).or_else(|| results.iter().take(3).find(|r| same_length(r)));
    found.filter(|r| !r.artwork.is_empty()).cloned()
}
