import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import { api, fileUrl, type DownloadRequest } from "./api";
import type { DownloadJob, Library, Track, View } from "./types";
import { EQ_PRESETS, Engine, LOUDNESS_TARGETS, type VolumeLevel } from "./engine";

type Repeat = "off" | "all" | "one";

export interface PlaybackSettings {
  /** Crossfade length in seconds, 0 = off */
  crossfade: number;
  normalize: boolean;
  volumeLevel: VolumeLevel;
  mono: boolean;
  eqEnabled: boolean;
  /** Preset key, a custom preset name, or "custom" for manual edits */
  eqPreset: string;
  eqGains: number[];
  customPresets: { name: string; gains: number[] }[];
  /** Custom preset the current manual curve was edited from, so it can be saved back over it */
  eqEditedFrom: string | null;
}

const defaultPlayback: PlaybackSettings = {
  crossfade: 0,
  normalize: true,
  volumeLevel: "normal",
  mono: false,
  eqEnabled: false,
  eqPreset: "flat",
  eqGains: [0, 0, 0, 0, 0, 0],
  customPresets: [],
  eqEditedFrom: null,
};

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: settings just won't persist */
  }
}

export type Modal =
  | { kind: "editTrack"; trackId: string; tab?: "info" | "source" }
  | { kind: "newPlaylist"; trackIds?: string[] }
  | null;

/** null = off, a timestamp = pause at that time, "track" = pause when the current song ends */
export type SleepTimer = number | "track" | null;

interface State {
  library: Library;
  view: View;
  back: View[];
  forward: View[];
  rightPanel: "now" | "queue" | null;
  downloads: Record<string, DownloadJob>;
  toast: string | null;
  modal: Modal;

  // player
  queue: string[];
  originalQueue: string[];
  index: number;
  /** Id of the loaded track (may come from upNext rather than queue[index]) */
  current: string | null;
  upNext: string[];
  contextLabel: string;
  playing: boolean;
  shuffle: boolean;
  repeat: Repeat;
  volume: number;
  muted: boolean;
  time: number;
  duration: number;
  playback: PlaybackSettings;
  sleep: SleepTimer;
}

interface Actions {
  init: () => Promise<void>;
  setLibrary: (l: Library) => void;
  navigate: (v: View) => void;
  goBack: () => void;
  goForward: () => void;
  setRightPanel: (p: State["rightPanel"]) => void;
  showToast: (msg: string) => void;
  openModal: (m: Modal) => void;

  playTracks: (ids: string[], start: number, label: string) => void;
  /** Pauses/resumes when ids[start] is already loaded, otherwise starts it */
  playOrToggle: (ids: string[], start: number, label: string) => void;
  togglePlay: () => void;
  next: () => void;
  prev: () => void;
  seek: (t: number) => void;
  setVolume: (v: number) => void;
  toggleMute: () => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  setPlayback: (p: Partial<PlaybackSettings>) => void;
  applyEqPreset: (key: string) => void;
  setSleep: (s: "track" | number | null) => void;

  addToQueue: (ids: string[]) => void;
  playNext: (ids: string[]) => void;
  removeUpNext: (i: number) => void;
  moveUpNext: (from: number, to: number) => void;
  clearUpNext: () => void;
  removeFromQueue: (i: number) => void;
  /** Plays queue[i] directly (skipping anything in upNext) */
  jumpTo: (i: number) => void;

  startDownload: (req: Omit<DownloadRequest, "jobId"> & { key: string }) => string;
  replaceSource: (track: Track, youtubeId?: string) => void;
  retryDownload: (jobId: string) => void;
  clearFinishedDownloads: () => void;
}

const engine = new Engine();

const emptyLibrary: Library = { tracks: [], playlists: [], liked: [], settings: { quality: "best" }, history: [] };

function shuffled<T>(arr: T[]) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

let toastTimer: number | undefined;
/** Requests kept so failed downloads can be retried */
const downloadRequests = new Map<string, Omit<DownloadRequest, "jobId">>();

interface SavedSession {
  queue: string[];
  originalQueue: string[];
  index: number;
  current: string | null;
  upNext: string[];
  contextLabel: string;
  shuffle: boolean;
  repeat: Repeat;
  time: number;
}

export const useStore = create<State & Actions>((set, get) => {
  const trackById = (id: string | null | undefined) => get().library.tracks.find((t) => t.id === id);

  /** dB of gain that brings a track to the target loudness (Spotify-style normalization). */
  const normalizationDb = (t: Track) => {
    const { normalize, volumeLevel } = get().playback;
    if (!normalize || t.loudness == null) return null;
    let gain = LOUDNESS_TARGETS[volumeLevel] - t.loudness;
    // Quiet/normal never push peaks past -1 dBTP; loud relies on the limiter instead
    if (volumeLevel !== "loud" && t.peak != null) gain = Math.min(gain, -1 - t.peak);
    return gain;
  };

  let fadingFrom: string | null = null;
  /** A play is counted once per load after 30s (or half of a short song) */
  let counted = false;
  let lastSessionSave = 0;

  const saveSession = () => {
    const s = get();
    const session: SavedSession = {
      queue: s.queue,
      originalQueue: s.originalQueue,
      index: s.index,
      current: s.current,
      upNext: s.upNext,
      contextLabel: s.contextLabel,
      shuffle: s.shuffle,
      repeat: s.repeat,
      time: s.time,
    };
    writeJson("session", session);
  };

  const load = (id: string | undefined, autoplay = true, fade = false) => {
    const t = trackById(id);
    if (!t) {
      engine.pause();
      set({ playing: false, current: null });
      return;
    }
    const src = fileUrl(t.path);
    const fadeSecs = get().playback.crossfade;
    const started = fade && fadeSecs > 0 ? engine.crossfadeTo(src, fadeSecs) : engine.load(src, autoplay);
    engine.setNormalization(normalizationDb(t));
    counted = false;
    set({ current: t.id, time: 0, duration: t.duration });
    started.catch((e) => {
      if (e?.name !== "AbortError") get().showToast(`재생 실패: ${e.message ?? e}`);
    });
    updateSession(t);
    saveSession();
  };

  engine.on("timeupdate", (el) => {
    const now = el.currentTime;
    set({ time: now });
    const { playback, playing, repeat, current, sleep } = get();

    if (!counted && current && now >= Math.min(30, (el.duration || 60) / 2)) {
      counted = true;
      api.recordPlay(current).then(get().setLibrary).catch(() => {});
    }
    if (typeof sleep === "number" && Date.now() >= sleep) {
      set({ sleep: null });
      engine.fadeOutAndPause(5);
      get().showToast("수면 타이머로 재생을 멈췄어요");
    }
    if (Date.now() - lastSessionSave > 5000) {
      lastSessionSave = Date.now();
      saveSession();
    }
    // Start the next track early so the two overlap
    const left = el.duration - now;
    if (
      playback.crossfade > 0 && playing && repeat !== "one" && sleep !== "track" &&
      isFinite(left) && left <= playback.crossfade && fadingFrom !== current
    ) {
      fadingFrom = current;
      advance(true);
    }
  });
  engine.on("durationchange", (el) => {
    if (isFinite(el.duration)) set({ duration: el.duration });
  });
  engine.on("play", () => set({ playing: true }));
  engine.on("pause", () => {
    set({ playing: false });
    saveSession();
  });
  engine.on("ended", () => {
    if (get().sleep === "track") {
      set({ sleep: null });
      get().showToast("수면 타이머로 재생을 멈췄어요");
      return;
    }
    if (get().repeat === "one") {
      engine.seek(0);
      engine.play();
    } else advance(false);
  });
  engine.on("error", (el) => {
    if (el.src) get().showToast("이 파일을 재생할 수 없습니다");
  });

  /** Moves to the next track; `fade` crossfades instead of cutting. */
  function advance(fade: boolean) {
    const { upNext, queue, index, repeat } = get();
    if (upNext.length) {
      set({ upNext: upNext.slice(1) });
      load(upNext[0], true, fade);
      return;
    }
    let i = index + 1;
    if (i >= queue.length) {
      if (repeat !== "all") {
        if (!fade) {
          engine.pause();
          engine.seek(0);
        }
        return;
      }
      i = 0;
    }
    set({ index: i });
    load(queue[i], true, fade);
  }

  const applyAudioSettings = () => {
    const p = get().playback;
    engine.setEq(p.eqEnabled, p.eqGains);
    engine.setMono(p.mono);
    const t = trackById(get().current);
    engine.setNormalization(t ? normalizationDb(t) : null);
  };

  const updateJob = (jobId: string, patch: Partial<DownloadJob>) => {
    const job = get().downloads[jobId];
    if (job) set({ downloads: { ...get().downloads, [jobId]: { ...job, ...patch } } });
  };

  if ("mediaSession" in navigator) {
    navigator.mediaSession.setActionHandler("play", () => engine.play());
    navigator.mediaSession.setActionHandler("pause", () => engine.pause());
    navigator.mediaSession.setActionHandler("nexttrack", () => get().next());
    navigator.mediaSession.setActionHandler("previoustrack", () => get().prev());
    navigator.mediaSession.setActionHandler("seekto", (d) => d.seekTime != null && get().seek(d.seekTime));
  }

  return {
    library: emptyLibrary,
    view: { kind: "home" },
    back: [],
    forward: [],
    rightPanel: "now",
    downloads: {},
    toast: null,
    modal: null,
    queue: [],
    originalQueue: [],
    index: -1,
    current: null,
    upNext: [],
    contextLabel: "",
    playing: false,
    shuffle: false,
    repeat: "off",
    volume: Number(localStorage.getItem("volume") ?? 0.8),
    muted: false,
    time: 0,
    duration: 0,
    playback: readJson("playback", defaultPlayback),
    sleep: null,

    init: async () => {
      engine.setVolume(get().volume);
      applyAudioSettings();
      get().setLibrary(await api.getLibrary());

      // Pick up where the last session left off (paused)
      const saved = readJson<SavedSession | null>("session", null);
      const t = trackById(saved?.current);
      if (saved && t) {
        const known = (ids: string[]) => ids.filter((id) => trackById(id));
        set({
          queue: known(saved.queue),
          originalQueue: known(saved.originalQueue),
          index: Math.max(0, known(saved.queue).indexOf(t.id)),
          current: t.id,
          upNext: known(saved.upNext),
          contextLabel: saved.contextLabel,
          shuffle: saved.shuffle,
          repeat: saved.repeat,
          time: saved.time,
          duration: t.duration,
        });
        engine.load(fileUrl(t.path), false, saved.time);
        engine.setNormalization(normalizationDb(t));
        counted = true;
        updateSession(t);
      }

      api.repairLibrary().catch(() => {});
      listen("library-changed", async () => get().setLibrary(await api.getLibrary()));
      listen<{ status: string; jobId: string; progress?: number; message?: string; trackId?: string }>("download", ({ payload: p }) =>
        updateJob(p.jobId, {
          status: p.status as DownloadJob["status"],
          progress: p.progress ?? get().downloads[p.jobId]?.progress ?? 0,
          message: p.message,
          trackId: p.trackId,
        }),
      );
      window.addEventListener("beforeunload", saveSession);
    },

    setLibrary: (library) => set({ library }),

    navigate: (v) => {
      const { view, back } = get();
      if (JSON.stringify(v) === JSON.stringify(view)) return;
      set({ view: v, back: [...back, view].slice(-50), forward: [] });
    },
    goBack: () => {
      const { back, view, forward } = get();
      if (!back.length) return;
      set({ view: back[back.length - 1], back: back.slice(0, -1), forward: [view, ...forward] });
    },
    goForward: () => {
      const { back, view, forward } = get();
      if (!forward.length) return;
      set({ view: forward[0], forward: forward.slice(1), back: [...back, view] });
    },
    setRightPanel: (rightPanel) => set({ rightPanel }),
    showToast: (toast) => {
      set({ toast });
      clearTimeout(toastTimer);
      toastTimer = window.setTimeout(() => set({ toast: null }), 2600);
    },
    openModal: (modal) => set({ modal }),

    playTracks: (ids, start, label) => {
      if (!ids.length) return;
      const first = ids[start];
      let queue = ids;
      let index = start;
      if (get().shuffle) {
        queue = [first, ...shuffled(ids.filter((_, i) => i !== start))];
        index = 0;
      }
      set({ queue, originalQueue: ids, index, contextLabel: label });
      load(queue[index]);
    },
    playOrToggle: (ids, start, label) => {
      if (ids[start] && ids[start] === get().current) get().togglePlay();
      else get().playTracks(ids, start, label);
    },
    togglePlay: () => {
      if (!get().current) {
        const all = [...get().library.tracks].reverse().map((t) => t.id);
        if (all.length) get().playTracks(all, 0, "모든 곡");
        return;
      }
      if (engine.el.paused) engine.play();
      else engine.pause();
    },
    next: () => advance(false),
    prev: () => {
      const { queue, index } = get();
      if (engine.el.currentTime > 3 || index <= 0) {
        engine.seek(0);
        return;
      }
      set({ index: index - 1 });
      load(queue[index - 1]);
    },
    seek: (t) => {
      engine.seek(t);
      set({ time: t });
    },
    setVolume: (volume) => {
      engine.setVolume(volume);
      engine.setMuted(false);
      localStorage.setItem("volume", String(volume));
      set({ volume, muted: false });
    },
    toggleMute: () => {
      const muted = !get().muted;
      engine.setMuted(muted);
      set({ muted });
    },
    toggleShuffle: () => {
      const { shuffle, queue, index, originalQueue, current } = get();
      if (!shuffle) {
        const rest = shuffled(queue.filter((_, i) => i !== index));
        set({ shuffle: true, queue: current ? [current, ...rest] : rest, index: current ? 0 : -1 });
      } else {
        set({ shuffle: false, queue: originalQueue, index: current ? originalQueue.indexOf(current) : -1 });
      }
      saveSession();
    },
    cycleRepeat: () => {
      const order: Repeat[] = ["off", "all", "one"];
      set({ repeat: order[(order.indexOf(get().repeat) + 1) % 3] });
      saveSession();
    },
    setPlayback: (p) => {
      const playback = { ...get().playback, ...p };
      writeJson("playback", playback);
      set({ playback });
      applyAudioSettings();
    },
    applyEqPreset: (key) => {
      const custom = get().playback.customPresets.find((c) => c.name === key);
      const gains = custom?.gains ?? EQ_PRESETS[key]?.gains;
      if (gains) get().setPlayback({ eqPreset: key, eqGains: [...gains], eqEnabled: true, eqEditedFrom: null });
    },
    setSleep: (s) => {
      const sleep = typeof s === "number" ? Date.now() + s * 60000 : s;
      set({ sleep });
      get().showToast(
        s === null ? "수면 타이머를 껐어요" : s === "track" ? "이 곡이 끝나면 멈춰요" : `${s}분 뒤에 재생을 멈춰요`,
      );
    },

    addToQueue: (ids) => {
      set({ upNext: [...get().upNext, ...ids] });
      get().showToast(ids.length > 1 ? `${ids.length}곡을 대기열에 추가했어요` : "대기열에 추가했어요");
      saveSession();
    },
    playNext: (ids) => {
      set({ upNext: [...ids, ...get().upNext] });
      get().showToast("다음에 재생돼요");
      saveSession();
    },
    removeUpNext: (i) => {
      set({ upNext: get().upNext.filter((_, j) => j !== i) });
      saveSession();
    },
    moveUpNext: (from, to) => {
      const list = [...get().upNext];
      const [item] = list.splice(from, 1);
      list.splice(to, 0, item);
      set({ upNext: list });
      saveSession();
    },
    clearUpNext: () => {
      set({ upNext: [] });
      saveSession();
    },
    removeFromQueue: (i) => {
      const { queue, index, originalQueue } = get();
      const id = queue[i];
      if (i <= index) return;
      set({ queue: queue.filter((_, j) => j !== i), originalQueue: originalQueue.filter((x) => x !== id) });
      saveSession();
    },

    jumpTo: (i) => {
      const id = get().queue[i];
      if (!id) return;
      set({ index: i });
      load(id);
    },

    startDownload: ({ key, ...req }) => {
      const existing = Object.values(get().downloads).find((d) => d.key === key && d.status !== "error");
      if (existing) return existing.jobId;
      const jobId = crypto.randomUUID();
      downloadRequests.set(jobId, req);
      set({
        downloads: {
          ...get().downloads,
          [jobId]: { jobId, key, title: req.title, artist: req.artist, artwork: req.artwork ?? "", status: "pending", progress: 0 },
        },
      });
      api
        .downloadTrack({ jobId, ...req })
        .catch((e) => get().showToast(`다운로드 실패: ${String(e).slice(0, 80)}`));
      return jobId;
    },
    replaceSource: (track, youtubeId) => {
      const jobId = crypto.randomUUID();
      set({
        downloads: {
          ...get().downloads,
          [jobId]: {
            jobId,
            key: `replace:${track.id}`,
            title: `${track.title} (음원 교체)`,
            artist: track.artist,
            artwork: track.cover ? fileUrl(track.cover) : "",
            status: "pending",
            progress: 0,
          },
        },
      });
      const wasCurrent = get().current === track.id;
      api
        .replaceSource(jobId, track.id, youtubeId)
        .then((lib) => {
          get().setLibrary(lib);
          get().showToast(`'${track.title}' 음원을 교체했어요`);
          // Reload so the new file plays instead of the deleted one
          if (wasCurrent) load(track.id, get().playing);
        })
        .catch((e) => get().showToast(`음원 교체 실패: ${String(e).slice(0, 80)}`));
    },
    retryDownload: (jobId) => {
      const job = get().downloads[jobId];
      const req = downloadRequests.get(jobId);
      if (!job || !req) return;
      const { [jobId]: _, ...rest } = get().downloads;
      set({ downloads: rest });
      get().startDownload({ key: job.key, ...req });
    },
    clearFinishedDownloads: () => {
      set({
        downloads: Object.fromEntries(Object.entries(get().downloads).filter(([, d]) => d.status !== "done")),
      });
    },
  };
});

function updateSession(t: Track) {
  document.title = `${t.title} • ${t.artist}`;
  if (!("mediaSession" in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: t.title,
    artist: t.artist,
    album: t.album,
    artwork: t.cover ? [{ src: fileUrl(t.cover), sizes: "600x600" }] : [],
  });
}

export const useCurrentTrack = () => useStore((s) => s.library.tracks.find((t) => t.id === s.current));
