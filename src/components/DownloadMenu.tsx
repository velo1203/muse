import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Download, Heart, ListEnd, ListPlus, ListStart, Play, Plus } from "lucide-react";
import { useStore } from "../store";
import type { AfterDownload } from "../types";
import { useSheetClose } from "../mobile/motion";

/**
 * Menu for a search result that isn't in the library yet: every action downloads
 * the song first and then applies the chosen follow-up (play, queue, like, playlist).
 */
export function DownloadMenu({
  x, y, title, onPick, onClose: closeNow,
}: {
  x: number;
  y: number;
  title: string;
  onPick: (after?: AfterDownload) => void;
  onClose: () => void;
}) {
  // On phones the sheet slides down before it goes away
  const [closing, onClose] = useSheetClose(closeNow);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const [picking, setPicking] = useState(false);
  const { library, openModal } = useStore();

  useLayoutEffect(() => {
    const r = ref.current!.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(x - r.width, window.innerWidth - r.width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - r.height - 8)),
    });
  }, [x, y, picking]);

  useEffect(() => {
    const close = (e: Event) => !ref.current?.contains(e.target as Node) && onClose();
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

  const pick = (after?: AfterDownload) => () => {
    onPick(after);
    onClose();
  };

  return (
    <div className={`ctx ${closing ? "closing" : ""}`} ref={ref} style={pos} onContextMenu={(e) => e.preventDefault()}>
      <div className="sub-label ellipsis">{title}</div>
      {picking ? (
        <>
          <button onClick={() => setPicking(false)}>
            <ChevronLeft size={16} /> 뒤로
          </button>
          <hr />
          <button
            onClick={() => {
              onClose();
              openModal({ kind: "newPlaylist", onCreated: (playlistId) => onPick({ playlistId }) });
            }}
          >
            <Plus size={16} /> 새 플레이리스트
          </button>
          <div className="ctx-scroll">
            {library.playlists.map((p) => (
              <button key={p.id} onClick={pick({ playlistId: p.id })}>
                {p.name}
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <button onClick={pick()}>
            <Download size={16} /> 받기
          </button>
          <button onClick={pick({ play: true })}>
            <Play size={16} /> 받고 바로 재생
          </button>
          <button onClick={pick({ queue: "next" })}>
            <ListStart size={16} /> 받고 다음에 재생
          </button>
          <button onClick={pick({ queue: "end" })}>
            <ListEnd size={16} /> 받고 대기열에 추가
          </button>
          <hr />
          <button onClick={() => setPicking(true)}>
            <ListPlus size={16} /> 받아서 플레이리스트에 추가 <ChevronRight size={16} style={{ marginLeft: "auto" }} />
          </button>
          <button onClick={pick({ like: true })}>
            <Heart size={16} /> 받아서 좋아요 표시
          </button>
        </>
      )}
    </div>
  );
}
