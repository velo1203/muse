import { useEffect, useRef, useState } from "react";
import {
  ChevronDown, ChevronLeft, Download, Heart, Home, Library, ListMusic, Mic2, Moon, MoreHorizontal, Music, Pause, Play,
  Repeat, Repeat1, Search, Settings, Shuffle, SkipBack, SkipForward, X,
} from "lucide-react";
import { api, fileUrl, formatTime } from "../api";
import { useCurrentTrack, useStore } from "../store";
import { applyInsets, native } from "../platform";
import { Main } from "../views/Main";
import { LyricsView } from "../views/Lyrics";
import { RightPanel } from "../components/RightPanel";
import { Slider } from "../components/Slider";
import { TrackMenu } from "../components/ContextMenu";
import { EditTrackModal } from "../components/EditTrackModal";
import { PlaylistModal } from "../components/PlaylistModal";
import type { View } from "../types";
import { pop, usePresence, usePullDown, useSheetClose, useSwipeX } from "./motion";

const TABS: { kind: View["kind"]; label: string; icon: typeof Home; to: View }[] = [
  { kind: "home", label: "홈", icon: Home, to: { kind: "home" } },
  { kind: "search", label: "검색", icon: Search, to: { kind: "search" } },
  { kind: "library", label: "라이브러리", icon: Library, to: { kind: "library" } },
  { kind: "settings", label: "설정", icon: Settings, to: { kind: "settings" } },
];
const ROOTS = new Set(TABS.map((t) => t.kind));

function SearchHeader() {
  const view = useStore((s) => s.view);
  const query = view.kind === "search" ? (view.query ?? "") : "";
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="m-search">
      <Search size={18} />
      <input
        ref={input}
        value={query}
        enterKeyHint="search"
        placeholder="곡·앨범·아티스트, YouTube 링크"
        onChange={(e) => useStore.setState({ view: { kind: "search", query: e.target.value } })}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          input.current?.blur();
          // Enter also asks for YouTube results (they don't load while typing on the phone)
          window.dispatchEvent(new Event("muse-search-submit"));
        }}
      />
      {query && (
        <button className="icon-btn" onClick={() => useStore.setState({ view: { kind: "search", query: "" } })}>
          <X size={18} />
        </button>
      )}
      <DownloadsButton />
    </div>
  );
}

function DownloadsButton() {
  const { navigate, downloads } = useStore();
  const active = Object.values(downloads).filter((d) => d.status !== "done" && d.status !== "error").length;
  return (
    <button className="m-round m-dl" onClick={() => navigate({ kind: "downloads" })} aria-label="다운로드">
      <Download size={19} />
      {active > 0 && <span className="badge">{active}</span>}
    </button>
  );
}

function TopBar() {
  const { view, back, goBack, navigate } = useStore();
  if (view.kind === "search") return <SearchHeader />;
  const root = ROOTS.has(view.kind);
  return (
    <div className={`m-top ${root ? "root" : ""}`}>
      {!root && (
        <button className="m-round" onClick={() => (back.length ? goBack() : navigate({ kind: "home" }))} aria-label="뒤로">
          <ChevronLeft size={22} />
        </button>
      )}
      {root && (
        <div className="m-brand">
          <img src="/muse.svg" alt="" />
          <span>muse</span>
        </div>
      )}
      <div style={{ flex: 1 }} />
      {view.kind !== "downloads" && <DownloadsButton />}
    </div>
  );
}

function MiniPlayer() {
  const s = useStore();
  const track = useCurrentTrack();
  const swipe = useSwipeX(s.next, s.prev);
  if (!track) return null;
  const liked = s.library.liked.includes(track.id);
  const pct = s.duration ? (s.time / s.duration) * 100 : 0;
  return (
    <div className="m-mini" onClick={() => !swipe.wasDrag() && s.setFullPlayer("player")} {...swipe.handlers}>
      <div className="m-mini-inner" ref={swipe.ref}>
        <div className="m-mini-art">
          {track.cover ? <img key={track.cover} className="fade-in" src={fileUrl(track.cover)} alt="" /> : <Music size={20} />}
        </div>
        <div className="m-mini-text" key={track.id}>
          <div className="t">{track.title}</div>
          <div className="s">{track.artist}</div>
        </div>
        <button
          className={`icon-btn ${liked ? "liked-on" : ""}`}
          onClick={async (e) => {
            e.stopPropagation();
            if (!liked) pop(e.currentTarget);
            s.setLibrary(await api.setLiked([track.id], !liked));
          }}
        >
          <Heart size={22} fill={liked ? "currentColor" : "none"} />
        </button>
        <button
          className="icon-btn m-mini-play"
          onClick={(e) => {
            e.stopPropagation();
            s.togglePlay();
          }}
        >
          <span key={String(s.playing)} className="pp-swap">
            {s.playing ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" />}
          </span>
        </button>
      </div>
      <div className="m-mini-progress">
        <div style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function SleepSheet({ onClose }: { onClose: () => void }) {
  const { sleep, setSleep } = useStore();
  const [closing, close] = useSheetClose(onClose);
  const pick = (v: "track" | number | null) => () => {
    setSleep(v);
    close();
  };
  return (
    <div className="m-sheet-bg" onClick={close}>
      <div className={`ctx m-sheet ${closing ? "closing" : ""}`} onClick={(e) => e.stopPropagation()}>
        <div className="sub-label">수면 타이머</div>
        {[5, 15, 30, 45, 60, 90].map((m) => (
          <button key={m} onClick={pick(m)}>
            {m}분
          </button>
        ))}
        <button onClick={pick("track")}>이 곡이 끝날 때</button>
        {sleep !== null && (
          <button className="danger" onClick={pick(null)}>
            타이머 끄기
          </button>
        )}
      </div>
    </div>
  );
}

function FullPlayer() {
  const s = useStore();
  const track = useCurrentTrack();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [sleepOpen, setSleepOpen] = useState(false);
  const { shown: page, closing } = usePresence(s.fullPlayer);
  const pull = usePullDown(() => s.setFullPlayer(null));
  if (!page || !track) return null;
  const liked = s.library.liked.includes(track.id);

  return (
    <div className={`m-full ${closing ? "closing" : ""}`} ref={pull.ref}>
      {track.cover && <img key={track.cover} className="m-full-bg fade-in" src={fileUrl(track.cover)} alt="" />}
      <div className="m-full-head" {...pull.handlers}>
        <button className="icon-btn" onClick={() => (page === "player" ? s.setFullPlayer(null) : s.setFullPlayer("player"))}>
          {page === "player" ? <ChevronDown size={28} /> : <ChevronLeft size={28} />}
        </button>
        <div className="m-full-context">
          <div className="k">{page === "lyrics" ? "가사" : page === "queue" ? "재생목록" : "재생 중"}</div>
          <div className="v">{s.contextLabel}</div>
        </div>
        <button className="icon-btn" onClick={(e) => setMenu({ x: e.clientX, y: e.clientY })}>
          <MoreHorizontal size={24} />
        </button>
      </div>

      {page === "player" && (
        <div className="m-full-body">
          <div className="m-full-art" {...pull.handlers}>
            {track.cover ? <img key={track.cover} className="fade-in" src={fileUrl(track.cover)} alt="" /> : <Music size={80} />}
          </div>
          <div className="m-full-title" key={track.id}>
            <div style={{ minWidth: 0 }}>
              <div className="t">{track.title}</div>
              <div
                className="s"
                onClick={() => {
                  s.setFullPlayer(null);
                  s.navigate({ kind: "artist", name: track.artist });
                }}
              >
                {track.artist}
              </div>
            </div>
            <button
              className={`icon-btn ${liked ? "liked-on" : ""}`}
              onClick={async (e) => {
                if (!liked) pop(e.currentTarget);
                s.setLibrary(await api.setLiked([track.id], !liked));
              }}
            >
              <Heart size={28} fill={liked ? "currentColor" : "none"} />
            </button>
          </div>
          <div className="m-full-progress">
            <Slider value={s.time} max={s.duration} onChange={() => {}} onCommit={s.seek} />
            <div className="times">
              <span>{formatTime(s.time)}</span>
              <span>{formatTime(s.duration)}</span>
            </div>
          </div>
          <div className="m-full-controls">
            <button className={`icon-btn ${s.shuffle ? "active" : ""}`} onClick={s.toggleShuffle}>
              <Shuffle size={24} />
            </button>
            <button className="icon-btn" onClick={s.prev}>
              <SkipBack size={34} fill="currentColor" />
            </button>
            <button className="m-full-play" onClick={s.togglePlay}>
              <span key={String(s.playing)} className="pp-swap">
                {s.playing ? <Pause size={34} fill="currentColor" /> : <Play size={34} fill="currentColor" style={{ marginLeft: 3 }} />}
              </span>
            </button>
            <button className="icon-btn" onClick={s.next}>
              <SkipForward size={34} fill="currentColor" />
            </button>
            <button className={`icon-btn ${s.repeat !== "off" ? "active" : ""}`} onClick={s.cycleRepeat}>
              {s.repeat === "one" ? <Repeat1 size={24} /> : <Repeat size={24} />}
            </button>
          </div>
          <div className="m-full-extra">
            <button className="icon-btn" onClick={() => s.setFullPlayer("lyrics")}>
              <Mic2 size={22} />
              <span>가사</span>
            </button>
            <button className={`icon-btn ${s.sleep !== null ? "active" : ""}`} onClick={() => setSleepOpen(true)}>
              <Moon size={22} />
              <span>수면 타이머</span>
            </button>
            <button className="icon-btn" onClick={() => s.setFullPlayer("queue")}>
              <ListMusic size={22} />
              <span>재생목록</span>
            </button>
          </div>
        </div>
      )}
      {page === "lyrics" && (
        <div className="m-full-page">
          <LyricsView />
        </div>
      )}
      {page === "queue" && (
        <div className="m-full-page">
          <RightPanel />
        </div>
      )}
      {menu && <TrackMenu menu={{ x: menu.x, y: menu.y, tracks: [track] }} onClose={() => setMenu(null)} />}
      {sleepOpen && <SleepSheet onClose={() => setSleepOpen(false)} />}
    </div>
  );
}

function TabBar() {
  const { view, navigate } = useStore();
  return (
    <nav className="m-tabs">
      {TABS.map((t) => {
        const on = view.kind === t.kind;
        const Icon = t.icon;
        return (
          <button
            key={t.kind}
            className={on ? "on" : ""}
            onClick={() => {
              // Re-tapping the current tab scrolls back to its top
              if (on) document.querySelector(".m-main .main-scroll")?.scrollTo({ top: 0, behavior: "smooth" });
              else navigate(t.to);
            }}
          >
            <Icon size={24} strokeWidth={on ? 2.4 : 1.8} />
            <span>{t.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

/** Phone layout: page + mini player + tab bar, with a full-screen player sheet on top. */
export function MobileApp() {
  const toast = useStore((s) => s.toast);
  const modal = useStore((s) => s.modal);
  const openModal = useStore((s) => s.openModal);
  const view = useStore((s) => s.view);
  const backDepth = useStore((s) => s.back.length);
  const fullPlayer = useStore((s) => s.fullPlayer);
  // Page transition: going deeper slides in from the right, going back from the left,
  // switching tabs fades. The search page keeps its key while typing so it isn't re-mounted.
  const pageKey = view.kind === "search" ? "search" : JSON.stringify(view);
  const nav = useRef({ key: pageKey, depth: backDepth, dir: "fade" });
  if (nav.current.key !== pageKey) {
    const tab = ROOTS.has(view.kind);
    nav.current = {
      key: pageKey,
      depth: backDepth,
      dir: tab && backDepth <= nav.current.depth ? "fade" : backDepth > nav.current.depth ? "forward" : "back",
    };
  }

  useEffect(() => {
    useStore.getState().init();
    const w = window as unknown as Record<string, unknown>;
    w.__museInsets = applyInsets;
    try {
      if (native) applyInsets(JSON.parse(native.insets()));
    } catch {
      /* keep CSS defaults */
    }
  }, []);

  return (
    <div className={`m-app ${fullPlayer ? "m-player-open" : ""}`}>
      <TopBar />
      <main className={`m-main view-${view.kind}`}>
        <div key={pageKey} className={`m-page enter-${nav.current.dir}`}>
          <Main />
        </div>
      </main>
      <MiniPlayer />
      <TabBar />
      <FullPlayer />
      {toast && <div className="toast">{toast}</div>}
      {modal?.kind === "editTrack" && (
        <EditTrackModal key={modal.trackId} trackId={modal.trackId} initialTab={modal.tab} onClose={() => openModal(null)} />
      )}
      {modal?.kind === "newPlaylist" && (
        <PlaylistModal trackIds={modal.trackIds} onCreated={modal.onCreated} onClose={() => openModal(null)} />
      )}
    </div>
  );
}
