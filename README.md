# Muse

A Tauri + React desktop music player. It finds songs in the iTunes catalog (title, artist, album art), then downloads the matching audio from YouTube with `yt-dlp`.

## Install

Download the installer from [Releases](../../releases):

- **Windows**: `Muse_*_x64-setup.exe` (or the `.msi`)
- **macOS**: `Muse_*_universal.dmg`, then drag Muse into Applications.
  The app isn't signed with an Apple Developer certificate, so the first launch shows an
  "unidentified developer" warning. Open it via System Settings → Privacy & Security → "Open Anyway".

Muse needs **yt-dlp** to download songs. Use the "yt-dlp 자동 설치" button inside the app, or install it yourself.
**ffmpeg** is needed for MP3/M4A conversion, loudness measurement and importing your own files.

| | yt-dlp | ffmpeg |
|---|---|---|
| macOS | `brew install yt-dlp` | `brew install ffmpeg` |
| Windows | `winget install yt-dlp.yt-dlp` | `winget install Gyan.FFmpeg` |

## Android (APK)

Muse also runs on Android phones (Android 7.0+, 64-bit ARM). Install the APK directly; it's not on the Play Store.

1. Send `Muse_*_android.apk` to the phone and open it. Allow "install unknown apps" for the app you opened it from (Files, KakaoTalk, Chrome…).
2. Open Muse. The first launch takes a few seconds while the built-in yt-dlp unpacks and updates itself.
3. Search, download and play as on the desktop.
   - Playback keeps going with the screen off.
   - The notification, lock screen and headphone buttons control it.

The phone app works on its own; its library is separate from the desktop one.

### Android Auto

Muse shows up as a media app in Android Auto. In the car you can browse 좋아요 표시한 곡, 모든 곡, 최근 재생 and your playlists, play a song, and control playback.

- **Sideloaded apps are hidden by default.** Android Auto only lists them once its developer settings allow it:
  1. Android Auto settings → tap "버전" 10 times to unlock developer settings.
  2. ⋮ → 개발자 설정 → enable "알 수 없는 소스" (Unknown sources).
- **Open Muse on the phone once before driving.** It can stay in the background. The player lives in the app, so if it was never opened, the car asks you to open it on the phone first.

### Building the APK

The Android build needs rustup (not Homebrew Rust) with the Android targets, plus the Android SDK/NDK.

```bash
npx tauri android build --apk --target aarch64
```

- **Release signing:** reads `src-tauri/gen/android/keystore.properties`, which is not committed and points at a local keystore. Keep that keystore safe: updates only install over the old version if they're signed with the same key.
- **Build steps and progress:** see [docs/ANDROID_PLAN.md](docs/ANDROID_PLAN.md).

## Disclaimer

Muse is a personal, non-commercial project for learning and private listening.

- It is not affiliated with YouTube, Apple or any music streaming service.
- Downloading from YouTube may be against YouTube's Terms of Service. You are responsible for how you use this software.
- All songs, lyrics and artwork belong to their respective rights holders. Please support artists through official channels.

이 프로젝트는 개인 학습·감상용 비상업 프로젝트입니다. 유튜브 다운로드는 유튜브 약관에 어긋날 수 있으며, 사용에 따른 책임은 사용자에게 있습니다. 모든 음원·가사·앨범 아트의 저작권은 각 권리자에게 있습니다.

## Develop

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
