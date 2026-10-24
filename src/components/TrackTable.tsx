import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Clock3, Heart, MoreHorizontal, MoreVertical, Pause, Play } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { api, formatTime, qualityLabel, relativeDate } from "../api";
import { useStore } from "../store";
import type { Track } from "../types";
import { Cover, Equalizer } from "./Art";
import { TrackMenu, type MenuState } from "./ContextMenu";
import { isMobile } from "../platform";

/** MIME type used when dragging tracks (onto playlists, or to reorder) */
export const TRACKS_MIME = "application/x-muse-tracks";

interface Props {
  tracks: Track[];
  label: string;
  playlistId?: string;
  /** "added" shows the date column, "plays" shows play counts, null hides it */
  extra?: "added" | "plays" | null;
  showAlbum?: boolean;
  /** Use the track number instead of the row index (album pages) */
  trackNumbers?: boolean;
  hideCover?: boolean;
  /** Called with the new order when rows are dragged within the table */
  onReorder?: (ids: string[]) => void;
  /** Phone: show ↑/↓ buttons instead of drag & drop for reordering */
  reorderMode?: boolean;
}

export function TrackTable({
  tracks, label, playlistId, extra: extraProp = "added", showAlbum: showAlbumProp = true, trackNumbers, hideCover, onReorder,
  reorderMode,
}: Props) {
  // Phones get a compact list: cover, title / artist and a menu button
  const extra = isMobile ? null : extraProp;
  const showAlbum = isMobile ? false : showAlbumProp;
  const { current, playing, liked, playOrToggle, setLibrary, navigate } = useStore(
    useShallow((s) => ({
      current: s.current,
      playing: s.playing,
      liked: s.library.liked,
      playOrToggle: s.playOrToggle,
      setLibrary: s.setLibrary,
      navigate: s.navigate,
    })),
  );
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [anchor, setAnchor] = useState<number | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const ids = tracks.map((t) => t.id);
  const cols = isMobile
    ? "minmax(0, 1fr) auto"
    : ["24px", "minmax(160px, 4fr)", showAlbum && "minmax(100px, 2fr)", extra && "minmax(80px, 1fr)", "auto"]
        .filter(Boolean)
        .join(" ");

  const move = (i: number, by: number) => {
    const j = i + by;
    if (!onReorder || j < 0 || j >= ids.length) return;
    const next = [...ids];
    [next[i], next[j]] = [next[j], next[i]];
    onReorder(next);
  };

  // Drop selections that vanished (deleted / filtered out)
  useEffect(() => {
    setSelected((sel) => sel.filter((id) => ids.includes(id)));
  }, [ids.join()]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "Escape") setSelected([]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const select = (i: number, e: React.MouseEvent) => {
    const id = tracks[i].id;
    if (e.shiftKey && anchor !== null) {
      const [a, b] = [Math.min(anchor, i), Math.max(anchor, i)];
      setSelected(ids.slice(a, b + 1));
    } else if (e.metaKey || e.ctrlKey) {
      setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
      setAnchor(i);
    } else {
      setSelected([id]);
      setAnchor(i);
    }
  };

  const menuTracks = (t: Track) => (selected.includes(t.id) ? tracks.filter((x) => selected.includes(x.id)) : [t]);

  const drop = (e: React.DragEvent, at: number) => {
    setDropAt(null);
    if (!onReorder) return;
    const raw = e.dataTransfer.getData(TRACKS_MIME);
    if (!raw) return;
    e.preventDefault();
    const moving: string[] = JSON.parse(raw);
    const rest = ids.filter((id) => !moving.includes(id));
    // Index in `rest` where the dragged rows go
    const before = ids.slice(0, at).filter((id) => !moving.includes(id)).length;
    rest.splice(before, 0, ...moving.filter((id) => ids.includes(id)));
    onReorder(rest);
  };

  return (
    <div className="tt">
      <div className="tt-row tt-head" style={{ gridTemplateColumns: cols }}>
        <div className="num">#</div>
        <div>제목</div>
        {showAlbum && <div>앨범</div>}
        {extra === "added" && <div>추가한 날짜</div>}
        {extra === "plays" && <div>재생 횟수</div>}
        <div className="tt-end">
          <Clock3 size={15} />
        </div>
      </div>
      <div className="tt-body" onDragLeave={() => setDropAt(null)}>
        {tracks.map((t, i) => {
          const isCur = t.id === current;
          const isLiked = liked.includes(t.id);
          const isSel = selected.includes(t.id);
          return (
            <div
              key={t.id}
              className={`tt-row ${isCur ? "current" : ""} ${isSel ? "selected" : ""} ${dropAt === i ? "drop-before" : ""} ${
                dropAt === tracks.length && i === tracks.length - 1 ? "drop-after" : ""
              }`}
              style={{ gridTemplateColumns: cols }}
              draggable={!isMobile}
              onDragStart={(e) => {
                const moving = isSel ? selected : [t.id];
                e.dataTransfer.setData(TRACKS_MIME, JSON.stringify(moving));
                e.dataTransfer.effectAllowed = "copyMove";
                const ghost = document.createElement("div");
                ghost.className = "drag-ghost";
                ghost.textContent = moving.length > 1 ? `${moving.length}곡` : t.title;
                document.body.appendChild(ghost);
                e.dataTransfer.setDragImage(ghost, 12, 12);
                setTimeout(() => ghost.remove());
              }}
              onDragOver={(e) => {
                if (!onReorder || !e.dataTransfer.types.includes(TRACKS_MIME)) return;
                e.preventDefault();
                const r = e.currentTarget.getBoundingClientRect();
                setDropAt(e.clientY > r.top + r.height / 2 ? i + 1 : i);
              }}
              onDrop={(e) => drop(e, dropAt ?? i)}
              onClick={(e) => (isMobile ? !reorderMode && playOrToggle(ids, i, label) : select(i, e))}
              onDoubleClick={() => playOrToggle(ids, i, label)}
              onContextMenu={(e) => {
                e.preventDefault();
                if (!isSel) {
                  setSelected([t.id]);
                  setAnchor(i);
                }
                setMenu({ x: e.clientX, y: e.clientY, tracks: menuTracks(t) });
              }}
            >
              {!isMobile && <div className="num">
                <span className="n">{isCur && playing ? <Equalizer /> : trackNumbers ? t.trackNumber ?? "–" : i + 1}</span>
                <button className="hover-play" onClick={(e) => (e.stopPropagation(), playOrToggle(ids, i, label))}>
                  {isCur && playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}
                </button>
              </div>}
              <div className="tt-title">
                {!hideCover && <Cover src={t.cover} />}
                <div style={{ minWidth: 0 }}>
                  <div className="title-text">
                    {isMobile && isCur && playing && <Equalizer />} {t.title}
                  </div>
                  <div className="artist">
                    <span className="link" onClick={(e) => (e.stopPropagation(), navigate({ kind: "artist", name: t.artist }))}>
                      {t.artist}
                    </span>
                  </div>
                </div>
              </div>
              {showAlbum && (
                <div className="ellipsis">
                  {t.album && (
                    <span
                      className="link"
                      onClick={(e) => (e.stopPropagation(), navigate({ kind: "album", artist: t.artist, album: t.album }))}
                    >
                      {t.album}
                    </span>
                  )}
                </div>
              )}
              {extra === "added" && <div className="ellipsis">{relativeDate(t.addedAt)}</div>}
              {extra === "plays" && <div className="ellipsis">{t.playCount.toLocaleString()}회</div>}
              <div className="tt-end">
                {qualityLabel(t) && <span className="q-badge hover-only">{qualityLabel(t)}</span>}
                <button
                  className={`icon-btn hover-only ${isLiked ? "on liked-on" : ""}`}
                  onClick={async (e) => {
                    e.stopPropagation();
                    setLibrary(await api.setLiked([t.id], !isLiked));
                  }}
                >
                  <Heart size={16} fill={isLiked ? "currentColor" : "none"} />
                </button>
                <span className="dur">{formatTime(t.duration)}</span>
                {reorderMode ? (
                  <>
                    <button className="icon-btn" disabled={i === 0} onClick={(e) => (e.stopPropagation(), move(i, -1))}>
                      <ArrowUp size={20} />
                    </button>
                    <button className="icon-btn" disabled={i === tracks.length - 1} onClick={(e) => (e.stopPropagation(), move(i, 1))}>
                      <ArrowDown size={20} />
                    </button>
                  </>
                ) : (
                  <button
                    className="icon-btn hover-only more-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenu({ x: e.clientX, y: e.clientY, tracks: menuTracks(t) });
                    }}
                  >
                    {isMobile ? <MoreVertical size={20} /> : <MoreHorizontal size={18} />}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {menu && <TrackMenu menu={menu} playlistId={playlistId} onClose={() => setMenu(null)} />}
    </div>
  );
}
