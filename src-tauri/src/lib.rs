mod catalog;
mod library;
mod lyrics;
mod media;
mod net;
mod tools;
mod ytdlp;

use catalog::{CatalogAlbum, CatalogTrack};
use library::{now_ms, HistoryEntry, Library, Playlist, Store, Track, HISTORY_LIMIT};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::{Mutex, Semaphore};

type SharedStore = Arc<Mutex<Store>>;

/// At most this many yt-dlp downloads run at once (album downloads queue up behind it).
static DOWNLOAD_SLOTS: Semaphore = Semaphore::const_new(3);

// ---------- Search ----------

#[tauri::command]
async fn catalog_search(query: String) -> Result<Vec<CatalogTrack>, String> {
    catalog::search_songs(&query).await
}

#[tauri::command]
async fn catalog_albums(query: String) -> Result<Vec<CatalogAlbum>, String> {
    catalog::search_albums(&query).await
}

#[derive(Serialize)]
struct AlbumDetail {
    album: CatalogAlbum,
    tracks: Vec<CatalogTrack>,
}

#[tauri::command]
async fn catalog_album(id: u64) -> Result<AlbumDetail, String> {
    let (album, tracks) = catalog::album(id).await?;
    Ok(AlbumDetail { album, tracks })
}

#[tauri::command]
async fn youtube_search(app: AppHandle, query: String) -> Result<Vec<ytdlp::YtResult>, String> {
    tools::ensure_ytdlp(&app).await?;
    ytdlp::search(&query, 15).await
}

/// Entries behind a pasted YouTube video / playlist link.
#[tauri::command]
async fn resolve_url(app: AppHandle, url: String) -> Result<Vec<ytdlp::YtResult>, String> {
    tools::ensure_ytdlp(&app).await?;
    ytdlp::resolve_url(&url).await
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ToolStatus {
    ytdlp: Option<String>,
    ffmpeg: Option<String>,
    library_dir: String,
    os: &'static str,
}

/// Installs whatever external tools are missing (also runs automatically at startup).
#[tauri::command]
async fn install_tools(app: AppHandle) -> Result<(), String> {
    tools::ensure_ytdlp(&app).await?;
    tools::ensure_ffmpeg(&app).await?;
    Ok(())
}

#[tauri::command]
async fn tool_status(store: State<'_, SharedStore>) -> Result<ToolStatus, String> {
    let root = store.lock().await.root.clone();
    Ok(ToolStatus {
        ytdlp: ytdlp::ytdlp_path().map(|p| p.display().to_string()),
        ffmpeg: ytdlp::ffmpeg_dir().map(|p| p.display().to_string()),
        library_dir: root.display().to_string(),
        os: std::env::consts::OS,
    })
}

// ---------- Downloads ----------

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DownloadRequest {
    /// Client-side id so the UI can follow progress
    job_id: String,
    /// When absent, the best matching upload is searched for using title/artist
    youtube_id: Option<String>,
    title: String,
    artist: String,
    album: Option<String>,
    artwork: Option<String>,
    duration: Option<f64>,
    track_number: Option<u32>,
    disc_number: Option<u32>,
    year: Option<String>,
    genre: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", rename_all_fields = "camelCase", tag = "status")]
enum DownloadEvent {
    Queued { job_id: String },
    Searching { job_id: String },
    Downloading { job_id: String, progress: f64, youtube_id: String },
    Done { job_id: String, track_id: String },
    Error { job_id: String, message: String },
}

fn emit(app: &AppHandle, ev: DownloadEvent) {
    let _ = app.emit("download", ev);
}

#[tauri::command]
async fn download_track(app: AppHandle, store: State<'_, SharedStore>, req: DownloadRequest) -> Result<Track, String> {
    let store = store.inner().clone();
    let job_id = req.job_id.clone();
    let result = run_download(&app, &store, req).await;
    match &result {
        Ok(track) => {
            emit(&app, DownloadEvent::Done { job_id, track_id: track.id.clone() });
            let _ = app.emit("library-changed", ());
        }
        Err(message) => emit(&app, DownloadEvent::Error { job_id, message: message.clone() }),
    }
    result
}

async fn find_source(app: &AppHandle, job_id: &str, title: &str, artist: &str, duration: Option<f64>) -> Result<String, String> {
    emit(app, DownloadEvent::Searching { job_id: job_id.into() });
    tools::ensure_ytdlp(app).await?;
    let results = ytdlp::search(&format!("{artist} {title} audio"), 10).await?;
    ytdlp::best_match(&results, title, artist, duration)
        .map(|r| r.id.clone())
        .ok_or_else(|| "유튜브에서 음원을 찾지 못했습니다".to_string())
}

/// Downloads `youtube_id` into the music folder under `file_stem`, reporting progress for `job_id`.
async fn fetch_audio(app: &AppHandle, music_dir: &Path, file_stem: &str, quality: &str, job_id: &str, youtube_id: &str) -> Result<ytdlp::Downloaded, String> {
    emit(app, DownloadEvent::Queued { job_id: job_id.into() });
    tools::ensure_ytdlp(app).await?;
    if quality != "best" {
        // MP3 / M4A conversion needs ffmpeg
        tools::ensure_ffmpeg(app).await?;
    }
    let _slot = DOWNLOAD_SLOTS.acquire().await.map_err(|e| e.to_string())?;
    emit(app, DownloadEvent::Downloading { job_id: job_id.into(), progress: 0.0, youtube_id: youtube_id.into() });
    let (a, j, y) = (app.clone(), job_id.to_string(), youtube_id.to_string());
    ytdlp::download_audio(youtube_id, music_dir, file_stem, quality, move |p| {
        emit(&a, DownloadEvent::Downloading { job_id: j.clone(), progress: p, youtube_id: y.clone() });
    })
    .await
}

fn codec_for(quality: &str, downloaded: Option<String>) -> Option<String> {
    match quality {
        "mp3" => Some("mp3".into()),
        "m4a" => Some("aac".into()),
        _ => downloaded,
    }
}

async fn run_download(app: &AppHandle, store: &SharedStore, req: DownloadRequest) -> Result<Track, String> {
    let job_id = req.job_id.clone();
    let youtube_id = match req.youtube_id.clone() {
        Some(id) => id,
        None => find_source(app, &job_id, &req.title, &req.artist, req.duration).await?,
    };

    let (music_dir, covers_dir, quality) = {
        let s = store.lock().await;
        if let Some(existing) = s.data.tracks.iter().find(|t| t.youtube_id == youtube_id) {
            return Ok(existing.clone());
        }
        (s.music_dir(), s.covers_dir(), s.data.settings.quality.clone())
    };

    let id = uuid::Uuid::new_v4().to_string();
    let downloaded = fetch_audio(app, &music_dir, &id, &quality, &job_id, &youtube_id).await?;

    // Uploads picked straight from YouTube have no artwork: look the song up in the
    // catalog for real album art, then fall back to the video thumbnail.
    let mut album = req.album.clone().unwrap_or_default();
    let (mut track_number, mut disc_number, mut year, mut genre) = (req.track_number, req.disc_number, req.year.clone(), req.genre.clone());
    let mut cover_urls: Vec<String> = req.artwork.clone().filter(|a| !a.is_empty()).into_iter().collect();
    if cover_urls.is_empty() {
        if let Some(found) = catalog::lookup(&req.title, &req.artist).await {
            if album.is_empty() {
                album = found.album;
                track_number = found.track_number;
                disc_number = found.disc_number;
            }
            year = year.or(found.year);
            genre = genre.or(found.genre);
            cover_urls.push(found.artwork);
        }
    }
    cover_urls.push(format!("https://i.ytimg.com/vi/{youtube_id}/maxresdefault.jpg"));
    cover_urls.push(format!("https://i.ytimg.com/vi/{youtube_id}/hqdefault.jpg"));
    let cover = first_cover(&cover_urls, &covers_dir.join(format!("{id}.jpg"))).await;

    let loud = ytdlp::measure_loudness(&downloaded.path).await;
    let track = Track {
        id,
        title: req.title,
        artist: req.artist,
        album,
        duration: downloaded.duration.or(req.duration).unwrap_or(0.0),
        path: downloaded.path.display().to_string(),
        cover,
        youtube_id,
        codec: codec_for(&quality, downloaded.codec),
        bitrate: downloaded.bitrate,
        added_at: now_ms(),
        loudness: loud.map(|l| l.0),
        peak: loud.map(|l| l.1),
        source: "youtube".into(),
        play_count: 0,
        last_played_at: None,
        track_number,
        disc_number,
        year,
        genre,
    };
    let mut s = store.lock().await;
    s.data.tracks.push(track.clone());
    s.save()?;
    Ok(track)
}

/// Swaps a track's audio for a different YouTube upload, keeping its metadata, likes and playlists.
#[tauri::command]
async fn replace_source(
    app: AppHandle,
    store: State<'_, SharedStore>,
    job_id: String,
    track_id: String,
    youtube_id: Option<String>,
) -> Result<Library, String> {
    let store = store.inner().clone();
    let result: Result<Library, String> = async {
        let (track, music_dir, quality) = {
            let s = store.lock().await;
            let t = s.data.tracks.iter().find(|t| t.id == track_id).cloned().ok_or("곡을 찾을 수 없습니다")?;
            (t, s.music_dir(), s.data.settings.quality.clone())
        };
        let youtube_id = match youtube_id {
            Some(id) => id,
            None => find_source(&app, &job_id, &track.title, &track.artist, Some(track.duration)).await?,
        };
        let stem = format!("{}-{}", track.id, now_ms());
        let downloaded = fetch_audio(&app, &music_dir, &stem, &quality, &job_id, &youtube_id).await?;
        let loud = ytdlp::measure_loudness(&downloaded.path).await;
        let mut s = store.lock().await;
        let root = s.root.clone();
        let t = s.data.tracks.iter_mut().find(|t| t.id == track_id).ok_or("곡을 찾을 수 없습니다")?;
        let old = std::mem::replace(&mut t.path, downloaded.path.display().to_string());
        if Path::new(&old).starts_with(&root) {
            let _ = std::fs::remove_file(old);
        }
        t.youtube_id = youtube_id;
        t.source = "youtube".into();
        t.codec = codec_for(&quality, downloaded.codec);
        t.bitrate = downloaded.bitrate;
        t.duration = downloaded.duration.unwrap_or(t.duration);
        t.loudness = loud.map(|l| l.0);
        t.peak = loud.map(|l| l.1);
        s.save()?;
        Ok(s.data.clone())
    }
    .await;
    match &result {
        Ok(_) => {
            emit(&app, DownloadEvent::Done { job_id, track_id });
            let _ = app.emit("library-changed", ());
        }
        Err(message) => emit(&app, DownloadEvent::Error { job_id, message: message.clone() }),
    }
    result
}

async fn fetch_cover(url: &str, dest: &Path) -> Option<String> {
    let bytes = net::get(url).await.ok()?.bytes().await.ok()?;
    // YouTube serves a tiny placeholder when maxresdefault doesn't exist
    if bytes.len() < 2048 {
        return None;
    }
    if let Some(dir) = dest.parent() {
        tokio::fs::create_dir_all(dir).await.ok()?;
    }
    tokio::fs::write(dest, &bytes).await.ok()?;
    Some(dest.display().to_string())
}

async fn first_cover(urls: &[String], dest: &Path) -> Option<String> {
    for url in urls {
        if let Some(path) = fetch_cover(url, dest).await {
            return Some(path);
        }
    }
    None
}

// ---------- Local files ----------

/// Copies audio files into the library, reading their tags and embedded artwork.
#[tauri::command]
async fn import_files(app: AppHandle, store: State<'_, SharedStore>, paths: Vec<String>) -> Result<usize, String> {
    // Tags, artwork and loudness are read with ffprobe / ffmpeg
    let _ = tools::ensure_ffmpeg(&app).await;
    let (music_dir, covers_dir) = {
        let s = store.lock().await;
        (s.music_dir(), s.covers_dir())
    };
    let mut files: Vec<PathBuf> = vec![];
    for p in paths.iter().map(PathBuf::from) {
        if p.is_dir() {
            // One level of folders is enough for dropping an album folder
            if let Ok(rd) = std::fs::read_dir(&p) {
                let mut inner: Vec<PathBuf> = rd.flatten().map(|e| e.path()).collect();
                inner.sort();
                files.extend(inner);
            }
        } else {
            files.push(p);
        }
    }
    files.retain(|f| {
        f.extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| media::AUDIO_EXTS.contains(&e.to_lowercase().as_str()))
    });

    let mut imported = 0;
    for src in files {
        let id = uuid::Uuid::new_v4().to_string();
        let ext = src.extension().and_then(|e| e.to_str()).unwrap_or("audio").to_lowercase();
        let dest = music_dir.join(format!("{id}.{ext}"));
        if tokio::fs::copy(&src, &dest).await.is_err() {
            continue;
        }
        let info = media::probe(&dest).await;
        let cover = media::extract_cover(&dest, &covers_dir.join(format!("{id}.jpg"))).await;
        let loud = ytdlp::measure_loudness(&dest).await;
        let stem = src.file_stem().and_then(|s| s.to_str()).unwrap_or("제목 없음").to_string();
        // "Artist - Title.mp3" is a common naming scheme when tags are missing
        let (guess_artist, guess_title) = match stem.split_once(" - ") {
            Some((a, t)) => (Some(a.trim().to_string()), t.trim().to_string()),
            None => (None, stem.clone()),
        };
        let track = Track {
            id,
            title: info.title.unwrap_or(guess_title),
            artist: info.artist.or(guess_artist).unwrap_or_else(|| "알 수 없는 아티스트".into()),
            album: info.album.unwrap_or_default(),
            duration: info.duration.unwrap_or(0.0),
            path: dest.display().to_string(),
            cover,
            youtube_id: String::new(),
            codec: info.codec,
            bitrate: info.bitrate,
            added_at: now_ms(),
            loudness: loud.map(|l| l.0),
            peak: loud.map(|l| l.1),
            source: "local".into(),
            play_count: 0,
            last_played_at: None,
            track_number: info.track_number,
            disc_number: None,
            year: info.year,
            genre: info.genre,
        };
        let mut s = store.lock().await;
        s.data.tracks.push(track);
        s.save()?;
        imported += 1;
        let _ = app.emit("library-changed", ());
    }
    Ok(imported)
}

// ---------- Library maintenance ----------

/// Re-fetches missing artwork and measures loudness for tracks that lack it.
#[tauri::command]
async fn repair_library(app: AppHandle, store: State<'_, SharedStore>) -> Result<usize, String> {
    let (missing, covers_dir) = {
        let s = store.lock().await;
        let missing: Vec<Track> = s
            .data
            .tracks
            .iter()
            .filter(|t| t.source == "youtube" && t.cover.as_ref().is_none_or(|c| !Path::new(c).is_file()))
            .cloned()
            .collect();
        (missing, s.covers_dir())
    };
    let mut fixed = 0;
    for t in missing {
        let mut urls = vec![];
        if let Some(found) = catalog::lookup(&t.title, &t.artist).await {
            urls.push(found.artwork);
        }
        urls.push(format!("https://i.ytimg.com/vi/{}/maxresdefault.jpg", t.youtube_id));
        urls.push(format!("https://i.ytimg.com/vi/{}/hqdefault.jpg", t.youtube_id));
        if let Some(path) = first_cover(&urls, &covers_dir.join(format!("{}.jpg", t.id))).await {
            let mut s = store.lock().await;
            if let Some(track) = s.data.tracks.iter_mut().find(|x| x.id == t.id) {
                track.cover = Some(path);
                fixed += 1;
            }
            s.save()?;
        }
    }
    let unmeasured: Vec<(String, String)> = {
        let s = store.lock().await;
        s.data.tracks.iter().filter(|t| t.loudness.is_none()).map(|t| (t.id.clone(), t.path.clone())).collect()
    };
    for (id, path) in unmeasured {
        if let Some((l, p)) = ytdlp::measure_loudness(Path::new(&path)).await {
            let mut s = store.lock().await;
            if let Some(track) = s.data.tracks.iter_mut().find(|x| x.id == id) {
                track.loudness = Some(l);
                track.peak = Some(p);
                fixed += 1;
            }
            s.save()?;
        }
    }
    if fixed > 0 {
        let _ = app.emit("library-changed", ());
    }
    Ok(fixed)
}

#[tauri::command]
async fn get_library(store: State<'_, SharedStore>) -> Result<Library, String> {
    Ok(store.lock().await.data.clone())
}

#[tauri::command]
async fn get_lyrics(store: State<'_, SharedStore>, track_id: String, refresh: Option<bool>) -> Result<lyrics::Lyrics, String> {
    let (t, cache) = {
        let s = store.lock().await;
        let t = s.data.tracks.iter().find(|t| t.id == track_id).cloned().ok_or("곡을 찾을 수 없습니다")?;
        (t, s.lyrics_path(&track_id))
    };
    Ok(lyrics::get(&cache, &t.title, &t.artist, &t.album, t.duration, refresh.unwrap_or(false)).await)
}

/// Applies `f` to the library, persists it and returns the new state.
async fn mutate(app: &AppHandle, store: &SharedStore, f: impl FnOnce(&mut Store) -> Result<(), String>) -> Result<Library, String> {
    let mut s = store.lock().await;
    f(&mut s)?;
    s.save()?;
    let _ = app.emit("library-changed", ());
    Ok(s.data.clone())
}

fn track_mut<'a>(s: &'a mut Store, id: &str) -> Result<&'a mut Track, String> {
    s.data.tracks.iter_mut().find(|t| t.id == id).ok_or_else(|| "곡을 찾을 수 없습니다".into())
}

#[tauri::command]
async fn record_play(app: AppHandle, store: State<'_, SharedStore>, track_id: String) -> Result<Library, String> {
    mutate(&app, &store, |s| {
        let now = now_ms();
        let t = track_mut(s, &track_id)?;
        t.play_count += 1;
        t.last_played_at = Some(now);
        s.data.history.push(HistoryEntry { track_id, at: now });
        let overflow = s.data.history.len().saturating_sub(HISTORY_LIMIT);
        s.data.history.drain(..overflow);
        Ok(())
    })
    .await
}

#[tauri::command]
async fn clear_history(app: AppHandle, store: State<'_, SharedStore>) -> Result<Library, String> {
    mutate(&app, &store, |s| {
        s.data.history.clear();
        Ok(())
    })
    .await
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TrackEdit {
    title: String,
    artist: String,
    album: String,
    year: Option<String>,
    genre: Option<String>,
    track_number: Option<u32>,
}

#[tauri::command]
async fn update_track(app: AppHandle, store: State<'_, SharedStore>, track_id: String, edit: TrackEdit) -> Result<Library, String> {
    mutate(&app, &store, |s| {
        let lyrics = s.lyrics_path(&track_id);
        let t = track_mut(s, &track_id)?;
        if t.title != edit.title || t.artist != edit.artist {
            // Different song identity → cached lyrics may be wrong
            let _ = std::fs::remove_file(lyrics);
        }
        t.title = edit.title;
        t.artist = edit.artist;
        t.album = edit.album;
        t.year = edit.year.filter(|y| !y.is_empty());
        t.genre = edit.genre.filter(|g| !g.is_empty());
        t.track_number = edit.track_number;
        Ok(())
    })
    .await
}

/// Sets a cover from a local image file or an http(s) URL.
#[tauri::command]
async fn set_track_cover(app: AppHandle, store: State<'_, SharedStore>, track_id: String, source: String) -> Result<Library, String> {
    let covers = store.lock().await.covers_dir();
    // New file name each time so the webview doesn't show a cached image
    let dest = covers.join(format!("{track_id}-{}.jpg", now_ms()));
    let saved = if source.starts_with("http") {
        fetch_cover(&source, &dest).await
    } else {
        tokio::fs::copy(&source, &dest).await.ok().map(|_| dest.display().to_string())
    }
    .ok_or("이미지를 가져오지 못했습니다")?;
    mutate(&app, &store, |s| {
        let root = s.root.clone();
        let t = track_mut(s, &track_id)?;
        if let Some(old) = t.cover.replace(saved) {
            if Path::new(&old).starts_with(&root) {
                let _ = std::fs::remove_file(old);
            }
        }
        Ok(())
    })
    .await
}

#[tauri::command]
async fn create_playlist(app: AppHandle, store: State<'_, SharedStore>, name: String, track_ids: Option<Vec<String>>) -> Result<Library, String> {
    mutate(&app, &store, |s| {
        s.data.playlists.push(Playlist {
            id: uuid::Uuid::new_v4().to_string(),
            name,
            description: String::new(),
            track_ids: track_ids.unwrap_or_default(),
            created_at: now_ms(),
        });
        Ok(())
    })
    .await
}

#[tauri::command]
async fn update_playlist(app: AppHandle, store: State<'_, SharedStore>, id: String, name: String, description: String) -> Result<Library, String> {
    mutate(&app, &store, |s| {
        let p = s.data.playlists.iter_mut().find(|p| p.id == id).ok_or("플레이리스트가 없습니다")?;
        p.name = name;
        p.description = description;
        Ok(())
    })
    .await
}

#[tauri::command]
async fn delete_playlist(app: AppHandle, store: State<'_, SharedStore>, id: String) -> Result<Library, String> {
    mutate(&app, &store, |s| {
        s.data.playlists.retain(|p| p.id != id);
        Ok(())
    })
    .await
}

#[tauri::command]
async fn add_to_playlist(app: AppHandle, store: State<'_, SharedStore>, playlist_id: String, track_ids: Vec<String>) -> Result<Library, String> {
    mutate(&app, &store, |s| {
        let p = s.data.playlists.iter_mut().find(|p| p.id == playlist_id).ok_or("플레이리스트가 없습니다")?;
        for id in track_ids {
            if !p.track_ids.contains(&id) {
                p.track_ids.push(id);
            }
        }
        Ok(())
    })
    .await
}

#[tauri::command]
async fn remove_from_playlist(app: AppHandle, store: State<'_, SharedStore>, playlist_id: String, track_ids: Vec<String>) -> Result<Library, String> {
    mutate(&app, &store, |s| {
        let p = s.data.playlists.iter_mut().find(|p| p.id == playlist_id).ok_or("플레이리스트가 없습니다")?;
        p.track_ids.retain(|t| !track_ids.contains(t));
        Ok(())
    })
    .await
}

#[tauri::command]
async fn reorder_playlist(app: AppHandle, store: State<'_, SharedStore>, playlist_id: String, track_ids: Vec<String>) -> Result<Library, String> {
    mutate(&app, &store, |s| {
        let p = s.data.playlists.iter_mut().find(|p| p.id == playlist_id).ok_or("플레이리스트가 없습니다")?;
        // Only accept a permutation of the current contents
        let mut a = p.track_ids.clone();
        let mut b = track_ids.clone();
        a.sort();
        b.sort();
        if a != b {
            return Err("플레이리스트가 변경되었습니다. 다시 시도해주세요".into());
        }
        p.track_ids = track_ids;
        Ok(())
    })
    .await
}

#[tauri::command]
async fn set_liked(app: AppHandle, store: State<'_, SharedStore>, track_ids: Vec<String>, liked: bool) -> Result<Library, String> {
    mutate(&app, &store, |s| {
        for id in track_ids {
            let has = s.data.liked.contains(&id);
            if liked && !has {
                s.data.liked.push(id);
            } else if !liked && has {
                s.data.liked.retain(|t| *t != id);
            }
        }
        Ok(())
    })
    .await
}

#[tauri::command]
async fn delete_tracks(app: AppHandle, store: State<'_, SharedStore>, track_ids: Vec<String>) -> Result<Library, String> {
    mutate(&app, &store, |s| {
        for id in &track_ids {
            s.remove_track(id);
        }
        Ok(())
    })
    .await
}

#[tauri::command]
async fn set_quality(app: AppHandle, store: State<'_, SharedStore>, quality: String) -> Result<Library, String> {
    mutate(&app, &store, |s| {
        s.data.settings.quality = quality;
        Ok(())
    })
    .await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let root = app.path().app_data_dir()?;
            ytdlp::set_bin_dir(root.join("bin"));
            app.manage::<SharedStore>(Arc::new(Mutex::new(Store::load(root))));
            // Install missing yt-dlp / ffmpeg in the background on first run
            tauri::async_runtime::spawn(tools::ensure_all(app.handle().clone()));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            catalog_search,
            catalog_albums,
            catalog_album,
            youtube_search,
            resolve_url,
            tool_status,
            install_tools,
            download_track,
            replace_source,
            import_files,
            get_library,
            get_lyrics,
            repair_library,
            record_play,
            clear_history,
            update_track,
            set_track_cover,
            create_playlist,
            update_playlist,
            delete_playlist,
            add_to_playlist,
            remove_from_playlist,
            reorder_playlist,
            set_liked,
            delete_tracks,
            set_quality,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
