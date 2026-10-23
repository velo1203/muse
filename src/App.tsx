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
import { Home } from "./views/Home";
import { SearchView } from "./views/Search";
import { Collection } from "./views/Collection";
import { Downloads } from "./views/Downloads";
import { Settings } from "./views/Settings";
import { AlbumView } from "./views/Album";
import { ArtistView } from "./views/Artist";
import { CatalogAlbumView } from "./views/CatalogAlbum";
import { LyricsView } from "./views/Lyrics";
import { HistoryView } from "./views/History";

function Main() {
  const view = useStore((s) => s.view);
  switch (view.kind) {
    case "home":
      return <Home />;
    case "search":
      return <SearchView query={view.query} />;
    case "songs":
    case "liked":
    case "playlist":
      return <Collection view={view} />;
    case "artist":
      return <ArtistView name={view.name} />;
    case "album":
      return <AlbumView artist={view.artist} album={view.album} />;
    case "catalogAlbum":
      return <CatalogAlbumView id={view.id} />;
    case "lyrics":
      return <LyricsView />;
    case "history":
      return <HistoryView />;
    case "downloads":
      return <Downloads />;
    case "settings":
      return <Settings />;
  }
}

export default function App() {
  const toast = useStore((s) => s.toast);
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
          <Main />
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
