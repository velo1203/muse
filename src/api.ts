import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import type { CatalogAlbum, CatalogTrack, Library, Lyrics, ToolStatus, Track, YtResult } from "./types";

export interface DownloadRequest {
  jobId: string;
  youtubeId?: string;
  title: string;
  artist: string;
  album?: string;
  artwork?: string;
  duration?: number | null;
  trackNumber?: number | null;
  discNumber?: number | null;
  year?: string | null;
  genre?: string | null;
}

export interface TrackEdit {
  title: string;
  artist: string;
  album: string;
  year: string | null;
  genre: string | null;
  trackNumber: number | null;
}

export const api = {
  getLibrary: () => invoke<Library>("get_library"),
  repairLibrary: () => invoke<number>("repair_library"),
  catalogSearch: (query: string) => invoke<CatalogTrack[]>("catalog_search", { query }),
  catalogAlbums: (query: string) => invoke<CatalogAlbum[]>("catalog_albums", { query }),
  catalogAlbum: (id: number) => invoke<{ album: CatalogAlbum; tracks: CatalogTrack[] }>("catalog_album", { id }),
  youtubeSearch: (query: string) => invoke<YtResult[]>("youtube_search", { query }),
  resolveUrl: (url: string) => invoke<YtResult[]>("resolve_url", { url }),
  toolStatus: () => invoke<ToolStatus>("tool_status"),
  installTools: () => invoke<void>("install_tools"),
  downloadTrack: (req: DownloadRequest) => invoke<Track>("download_track", { req }),
  replaceSource: (jobId: string, trackId: string, youtubeId?: string) =>
    invoke<Library>("replace_source", { jobId, trackId, youtubeId }),
  importFiles: (paths: string[]) => invoke<number>("import_files", { paths }),
  getLyrics: (trackId: string, refresh = false) => invoke<Lyrics>("get_lyrics", { trackId, refresh }),
  recordPlay: (trackId: string) => invoke<Library>("record_play", { trackId }),
  setLoudness: (trackId: string, loudness: number, peak: number) =>
    invoke<Library>("set_loudness", { trackId, loudness, peak }),
  clearHistory: () => invoke<Library>("clear_history"),
  updateTrack: (trackId: string, edit: TrackEdit) => invoke<Library>("update_track", { trackId, edit }),
  setTrackCover: (trackId: string, source: string) => invoke<Library>("set_track_cover", { trackId, source }),
  createPlaylist: (name: string, trackIds?: string[]) => invoke<Library>("create_playlist", { name, trackIds }),
  updatePlaylist: (id: string, name: string, description: string) =>
    invoke<Library>("update_playlist", { id, name, description }),
  deletePlaylist: (id: string) => invoke<Library>("delete_playlist", { id }),
  addToPlaylist: (playlistId: string, trackIds: string[]) => invoke<Library>("add_to_playlist", { playlistId, trackIds }),
  removeFromPlaylist: (playlistId: string, trackIds: string[]) =>
    invoke<Library>("remove_from_playlist", { playlistId, trackIds }),
  reorderPlaylist: (playlistId: string, trackIds: string[]) =>
    invoke<Library>("reorder_playlist", { playlistId, trackIds }),
  setLiked: (trackIds: string[], liked: boolean) => invoke<Library>("set_liked", { trackIds, liked }),
  deleteTracks: (trackIds: string[]) => invoke<Library>("delete_tracks", { trackIds }),
  setQuality: (quality: string) => invoke<Library>("set_quality", { quality }),
};

export const fileUrl = (path: string | null | undefined) => (path ? convertFileSrc(path) : "");

export function formatTime(sec: number | null | undefined) {
  if (!sec || !isFinite(sec)) return "0:00";
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${r}` : `${m}:${r}`;
}

export function totalDuration(tracks: Track[]) {
  const sec = tracks.reduce((a, t) => a + (t.duration || 0), 0);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h ? `${h}시간 ${m}분` : `${m}분 ${Math.floor(sec % 60)}초`;
}

export function relativeDate(ms: number) {
  const diff = Date.now() - ms;
  const day = 86400000;
  if (diff < 60000) return "방금 전";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}분 전`;
  if (diff < day) return `${Math.floor(diff / 3600000)}시간 전`;
  if (diff < day * 7) return `${Math.floor(diff / day)}일 전`;
  return new Date(ms).toLocaleDateString("ko-KR");
}

export function qualityLabel(t: Track) {
  const codec = t.codec?.split(".")[0];
  if (!codec) return "";
  const name = codec === "mp4a" ? "AAC" : codec.toUpperCase();
  return t.bitrate ? `${name} ${Math.round(t.bitrate)}kbps` : name;
}

export const isYoutubeUrl = (s: string) => /^(https?:\/\/)?(www\.|m\.|music\.)?(youtube\.com|youtu\.be)\//i.test(s.trim());

/** Albums and artists are derived from the tracks themselves. */
export function groupAlbums(tracks: Track[]) {
  const map = new Map<string, { album: string; artist: string; tracks: Track[]; cover: string | null; year: string | null }>();
  for (const t of tracks) {
    if (!t.album) continue;
    const key = `${t.artist}\u0000${t.album}`;
    const g = map.get(key) ?? { album: t.album, artist: t.artist, tracks: [], cover: null, year: t.year };
    g.tracks.push(t);
    g.cover ??= t.cover;
    g.year ??= t.year;
    map.set(key, g);
  }
  for (const g of map.values()) g.tracks.sort(byTrackOrder);
  return [...map.values()];
}

export function groupArtists(tracks: Track[]) {
  const map = new Map<string, { name: string; tracks: Track[]; cover: string | null; plays: number }>();
  for (const t of tracks) {
    const g = map.get(t.artist) ?? { name: t.artist, tracks: [], cover: null, plays: 0 };
    g.tracks.push(t);
    g.cover ??= t.cover;
    g.plays += t.playCount;
    map.set(t.artist, g);
  }
  return [...map.values()];
}

export const byTrackOrder = (a: Track, b: Track) =>
  (a.discNumber ?? 1) - (b.discNumber ?? 1) || (a.trackNumber ?? 999) - (b.trackNumber ?? 999) || a.addedAt - b.addedAt;
