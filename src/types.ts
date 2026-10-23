export interface Track {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  path: string;
  cover: string | null;
  youtubeId: string;
  codec: string | null;
  bitrate: number | null;
  addedAt: number;
  loudness: number | null;
  peak: number | null;
  source: "youtube" | "local";
  playCount: number;
  lastPlayedAt: number | null;
  trackNumber: number | null;
  discNumber: number | null;
  year: string | null;
  genre: string | null;
}

export interface HistoryEntry {
  trackId: string;
  at: number;
}

export interface Playlist {
  id: string;
  name: string;
  description: string;
  trackIds: string[];
  createdAt: number;
}

export type Quality = "best" | "m4a" | "mp3";

export interface Library {
  tracks: Track[];
  playlists: Playlist[];
  liked: string[];
  settings: { quality: Quality };
  history: HistoryEntry[];
}

export interface CatalogTrack {
  title: string;
  artist: string;
  album: string;
  artwork: string;
  duration: number | null;
  albumId: number | null;
  trackNumber: number | null;
  discNumber: number | null;
  year: string | null;
  genre: string | null;
}

export interface CatalogAlbum {
  id: number;
  title: string;
  artist: string;
  artwork: string;
  year: string | null;
  trackCount: number | null;
  genre: string | null;
}

export interface Lyrics {
  synced: string | null;
  plain: string | null;
  instrumental: boolean;
}

export interface YtResult {
  id: string;
  title: string;
  channel: string;
  duration: number | null;
  thumbnail: string;
}

export interface ToolStatus {
  ytdlp: string | null;
  ffmpeg: string | null;
  libraryDir: string;
}

export type DownloadStatus = "pending" | "queued" | "searching" | "downloading" | "done" | "error";

export interface DownloadJob {
  jobId: string;
  /** Stable key for matching a search result to its job: youtube id or "artist|title" */
  key: string;
  title: string;
  artist: string;
  artwork: string;
  status: DownloadStatus;
  progress: number;
  message?: string;
  trackId?: string;
}

export type View =
  | { kind: "home" }
  | { kind: "search"; query?: string }
  | { kind: "songs" }
  | { kind: "liked" }
  | { kind: "playlist"; id: string }
  | { kind: "artist"; name: string }
  | { kind: "album"; artist: string; album: string }
  | { kind: "catalogAlbum"; id: number }
  | { kind: "lyrics" }
  | { kind: "history" }
  | { kind: "downloads" }
  | { kind: "settings" };
