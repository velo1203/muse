import { useEffect, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { FolderInput } from "lucide-react";
import { useCurrentTrack, useStore } from "./store";
import { fileUrl } from "./api";
import { importPaths } from "./importFiles";
import { TopBar } from "./components/TopBar";
import { Sidebar } from "./components/Sidebar";
import { PlayerBar } from "./components/PlayerBar";
import { RightPanel } from "./components/RightPanel";
import { EditTrackModal } from "./components/EditTrackModal";
import { PlaylistModal } from "./components/PlaylistModal";
import { Main } from "./views/Main";

export default function App() {
  const toast = useStore((s) => s.toast);
  const view = useStore((s) => s.view);
  const modal = useStore((s) => s.modal);
  const openModal = useStore((s) => s.openModal);
  const track = useCurrentTrack();
  const [fileDrag, setFileDrag] = useState(false);

  useEffect(() => {
    useStore.getState().init();
    const block = (e: MouseEvent) => e.preventDefault();
    window.addEventListener("contextmenu", block);
    // Audio files / folders dropped from Finder
    const unlisten = getCurrentWebview().onDragDropEvent((e) => {
      if (e.payload.type === "enter") setFileDrag(e.payload.paths.length > 0);
      else if (e.payload.type === "leave") setFileDrag(false);
      else if (e.payload.type === "drop") {
        setFileDrag(false);
        importPaths(e.payload.paths);
      }
    });
    return () => {
      window.removeEventListener("contextmenu", block);
      unlisten.then((f) => f());
    };
  }, []);

  return (
    <>
      <div className="ambient">{track?.cover && <img key={track.cover} src={fileUrl(track.cover)} alt="" />}</div>
      <div className="app">
        <TopBar />
        <Sidebar />
        <main className="main panel">
          {/* A new key per destination replays the enter animation; search stays mounted while typing */}
          <div className="view" key={view.kind === "search" ? "search" : JSON.stringify(view)}>
            <Main />
          </div>
        </main>
        <RightPanel />
        <PlayerBar />
        {toast && <div className="toast">{toast}</div>}
      </div>
      {modal?.kind === "editTrack" && (
        <EditTrackModal key={modal.trackId} trackId={modal.trackId} initialTab={modal.tab} onClose={() => openModal(null)} />
      )}
      {modal?.kind === "newPlaylist" && (
        <PlaylistModal trackIds={modal.trackIds} onCreated={modal.onCreated} onClose={() => openModal(null)} />
      )}
      {fileDrag && (
        <div className="file-drop">
          <FolderInput size={40} />
          <div>놓으면 라이브러리로 가져와요</div>
        </div>
      )}
    </>
  );
}
