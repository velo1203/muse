import { useState } from "react";
import { api } from "../api";
import { useStore } from "../store";
import type { Playlist } from "../types";
import { useSheetClose } from "../mobile/motion";

/** Create a playlist (optionally pre-filled with tracks), or edit one when `playlist` is given. */
export function PlaylistModal({
  playlist, trackIds, onCreated, onClose: closeNow,
}: {
  playlist?: Playlist;
  trackIds?: string[];
  /** Called with the new playlist's id (e.g. to add a song once it finishes downloading) */
  onCreated?: (id: string) => void;
  onClose: () => void;
}) {
  const [closing, onClose] = useSheetClose(closeNow);
  const { library, setLibrary, navigate, showToast } = useStore();
  const [name, setName] = useState(playlist?.name ?? `내 플레이리스트 #${library.playlists.length + 1}`);
  const [desc, setDesc] = useState(playlist?.description ?? "");

  const save = async () => {
    if (!name.trim()) return;
    if (playlist) {
      setLibrary(await api.updatePlaylist(playlist.id, name.trim(), desc.trim()));
    } else {
      let lib = await api.createPlaylist(name.trim(), trackIds);
      const created = lib.playlists[lib.playlists.length - 1];
      if (desc.trim()) lib = await api.updatePlaylist(created.id, created.name, desc.trim());
      setLibrary(lib);
      if (onCreated) onCreated(created.id);
      else if (trackIds?.length) showToast(`'${created.name}'에 ${trackIds.length}곡을 담았어요`);
      else navigate({ kind: "playlist", id: created.id });
    }
    onClose();
  };

  return (
    <div className={`modal-bg ${closing ? "closing" : ""}`} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h2>{playlist ? "세부 정보 편집" : "새 플레이리스트"}</h2>
        <input
          autoFocus
          value={name}
          placeholder="이름 추가"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && save()}
        />
        <textarea rows={4} value={desc} placeholder="설명 추가(선택 사항)" onChange={(e) => setDesc(e.target.value)} />
        <div className="row">
          <button className="pill-btn ghost" onClick={onClose}>
            취소
          </button>
          <button className="pill-btn" onClick={save}>
            저장하기
          </button>
        </div>
      </div>
    </div>
  );
}
