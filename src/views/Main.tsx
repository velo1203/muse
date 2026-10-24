import { useStore } from "../store";
import { Home } from "./Home";
import { SearchView } from "./Search";
import { Collection } from "./Collection";
import { Downloads } from "./Downloads";
import { Settings } from "./Settings";
import { AlbumView } from "./Album";
import { ArtistView } from "./Artist";
import { CatalogAlbumView } from "./CatalogAlbum";
import { LyricsView } from "./Lyrics";
import { HistoryView } from "./History";
import { Sidebar } from "../components/Sidebar";

/** The page for the current view (shared by the desktop and phone layouts). */
export function Main() {
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
    case "library":
      return <Sidebar />;
  }
}
