# Muse

A Tauri + React desktop music player. It finds songs in the iTunes catalog (title, artist, album art), then downloads the matching audio from YouTube with `yt-dlp`.

## Requirements

```bash
brew install yt-dlp ffmpeg
```

## Run

```bash
npm install
npm run tauri dev
```

Build the app: `npm run tauri build`. The output is `src-tauri/target/release/bundle/macos/Muse.app`.

## How it works

- **Search**: songs come from the iTunes Search API. The YouTube tab searches YouTube directly.
- **Download**: picks the best YouTube upload (Topic channels and official audio first, matched on song length).
  - Default quality is "best": the highest-bitrate audio stream (usually Opus ~130–160 kbps), saved as-is with no re-encoding.
  - M4A and MP3 can be chosen in Settings.
- **Playback**: Web Audio engine with a 6-band EQ (60Hz–15kHz, ±12dB, 22 presets plus your own), crossfade (0–12s), mono audio, and volume normalization.
  - Normalization targets -19 / -14 / -11 LUFS, based on each track's EBU R128 loudness measured with ffmpeg after download.
- **Browse**: artist and album pages are built from your library. Search results also have an albums tab, and a catalog album page can download the whole album at once (3 downloads at a time).
- **YouTube links**: paste a video or playlist link into the search box to download it directly.
- **Lyrics**: time-synced lyrics from LRCLIB. Click a line to jump to that point in the song.
- **Personal library**:
  - Edit track info (fill it in from the catalog automatically, or change the cover).
  - Replace a track's audio with a different YouTube upload.
  - Import your own audio files (pick them, or drag files or folders onto the window).
- **Listening history**: play counts and history (a play counts after 30s), shown on home as 최근 재생 / 많이 들은 곡 / 자주 듣는 아티스트.
- **Playback**: the queue can be edited (다음에 재생, reorder, remove). There is a sleep timer. The last session (queue and position) is restored on launch.
- **Shortcuts**:
  - Space: play / pause
  - ⌘← / ⌘→: previous / next track
  - ← / →: seek 5 seconds
  - ⌘↑ / ⌘↓: volume
  - L: lyrics
  - S: shuffle
  - R: repeat
  - ⌘K: search
- **Library**: `~/Library/Application Support/com.hosung.muse/` (`library.json`, `music/`, `covers/`, `lyrics/`).

The icon source is `design/muse-icon.svg`. Regenerate the icons with `npx tauri icon design/muse-icon.svg`.
