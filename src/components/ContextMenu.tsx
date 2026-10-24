import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Disc3, ExternalLink, FolderOpen, Heart, HeartOff, ListEnd, ListMinus, ListPlus, ListStart, Pencil, Plus, RefreshCw,
  Trash2, User,
} from "lucide-react";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { api } from "../api";
import { useStore } from "../store";
import type { Track } from "../types";
import { isMobile } from "../platform";
import { useSheetClose } from "../mobile/motion";

export interface MenuState {
  x: number;
  y: number;
  tracks: Track[];
}

export function TrackMenu({ menu, onClose: closeNow, playlistId }: { menu: MenuState; onClose: () => void; playlistId?: string }) {
  // On phones the sheet slides down before it goes away
  const [closing, onClose] = useSheetClose(closeNow);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: menu.x, top: menu.y });
  const { library, addToQueue, playNext, setLibrary, showToast, navigate, openModal } = useStore();
  const [picking, setPicking] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const tracks = menu.tracks;
  const ids = tracks.map((t) => t.id);
  const single = tracks.length === 1 ? tracks[0] : null;
  const allLiked = ids.every((id) => library.liked.includes(id));

  useLayoutEffect(() => {
    const r = ref.current!.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(menu.x, window.innerWidth - r.width - 8)),
      top: Math.max(8, Math.min(menu.y, window.innerHeight - r.height - 8)),
    });
  }, [menu, picking, confirming]);

  useEffect(() => {
    const close = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", esc);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", esc);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  const run = (fn: () => Promise<unknown> | void) => async () => {
    onClose();
    try {
      await fn();
    } catch (e) {
      showToast(String(e));
    }
  };

  return (
    <div className={`ctx ${closing ? "closing" : ""}`} ref={ref} style={pos} onContextMenu={(e) => e.preventDefault()}>
      {tracks.length > 1 && <div className="sub-label">{tracks.length}곡 선택됨</div>}
      {picking ? (
        <>
          <div className="sub-label">플레이리스트에 추가</div>
          <button onClick={run(() => openModal({ kind: "newPlaylist", trackIds: ids }))}>
            <Plus size={16} /> 새 플레이리스트
          </button>
          <hr />
          <div className="ctx-scroll">
            {library.playlists.map((p) => (
              <button
                key={p.id}
                onClick={run(async () => {
                  setLibrary(await api.addToPlaylist(p.id, ids));
                  showToast(`'${p.name}'에 추가했어요`);
                })}
              >
                {p.name}
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <button onClick={run(() => playNext(ids))}>
            <ListStart size={16} /> 다음에 재생
          </button>
          <button onClick={run(() => addToQueue(ids))}>
            <ListEnd size={16} /> 대기열에 추가
          </button>
          <button onClick={() => setPicking(true)}>
            <ListPlus size={16} /> 플레이리스트에 추가
          </button>
          {playlistId && (
            <button onClick={run(async () => setLibrary(await api.removeFromPlaylist(playlistId, ids)))}>
              <ListMinus size={16} /> 이 플레이리스트에서 삭제
            </button>
          )}
          <button onClick={run(async () => setLibrary(await api.setLiked(ids, !allLiked)))}>
            {allLiked ? <HeartOff size={16} /> : <Heart size={16} />}
            {allLiked ? "좋아요 표시한 곡에서 삭제" : "좋아요 표시한 곡에 저장"}
          </button>
          {single && (
            <>
              <hr />
              <button onClick={run(() => navigate({ kind: "artist", name: single.artist }))}>
                <User size={16} /> 아티스트로 이동
              </button>
              {single.album && (
                <button onClick={run(() => navigate({ kind: "album", artist: single.artist, album: single.album }))}>
                  <Disc3 size={16} /> 앨범으로 이동
                </button>
              )}
              <hr />
              <button onClick={run(() => openModal({ kind: "editTrack", trackId: single.id }))}>
                <Pencil size={16} /> 정보 편집
              </button>
              <button onClick={run(() => openModal({ kind: "editTrack", trackId: single.id, tab: "source" }))}>
                <RefreshCw size={16} /> 다른 음원으로 바꾸기
              </button>
              {!isMobile && (
                <button onClick={run(() => revealItemInDir(single.path))}>
                  <FolderOpen size={16} /> Finder에서 보기
                </button>
              )}
              {single.youtubeId && (
                <button onClick={run(() => openUrl(`https://www.youtube.com/watch?v=${single.youtubeId}`))}>
                  <ExternalLink size={16} /> YouTube에서 원본 보기
                </button>
              )}
            </>
          )}
          <hr />
          {confirming ? (
            <button className="danger" onClick={run(async () => setLibrary(await api.deleteTracks(ids)))}>
              <Trash2 size={16} /> 정말 삭제할까요? (파일도 삭제됨)
            </button>
          ) : (
            <button className="danger" onClick={() => setConfirming(true)}>
              <Trash2 size={16} /> 라이브러리에서 삭제
            </button>
          )}
        </>
      )}
    </div>
  );
}
