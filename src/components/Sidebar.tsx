import { useMemo, useState } from "react";
import { History, Library, Plus, Search, User } from "lucide-react";
import { api, groupAlbums, groupArtists } from "../api";
import { useStore } from "../store";
import { Cover, LikedArt, PlaylistArt, SongsArt } from "./Art";
import { TRACKS_MIME } from "./TrackTable";
import { ToolInstallStatus } from "./ToolSetup";

type Tab = "playlists" | "artists" | "albums";

/** Makes a sidebar row accept dragged tracks. */
function useDropTarget(onTracks: (ids: string[]) => void) {
  const [over, setOver] = useState(false);
  return {
    over,
    props: {
      onDragOver: (e: React.DragEvent) => {
        if (!e.dataTransfer.types.includes(TRACKS_MIME)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setOver(true);
      },
      onDragLeave: () => setOver(false),
      onDrop: (e: React.DragEvent) => {
        setOver(false);
        const raw = e.dataTransfer.getData(TRACKS_MIME);
        if (raw) onTracks(JSON.parse(raw));
      },
    },
  };
}

function PlaylistRow({ id }: { id: string }) {
  const { library, view, navigate, contextLabel, playing, setLibrary, showToast } = useStore();
  const p = library.playlists.find((x) => x.id === id)!;
  const drop = useDropTarget(async (ids) => {
    setLibrary(await api.addToPlaylist(p.id, ids));
    showToast(`'${p.name}'에 추가했어요`);
  });
  const active = view.kind === "playlist" && view.id === p.id;
  return (
    <div
      className={`lib-item ${active ? "active" : ""} ${playing && contextLabel === p.name ? "playing" : ""} ${drop.over ? "drop" : ""}`}
      onClick={() => navigate({ kind: "playlist", id: p.id })}
      {...drop.props}
    >
      <PlaylistArt playlist={p} tracks={library.tracks} />
      <div className="meta">
        <div className="name">{p.name}</div>
        <div className="sub">플레이리스트 • {p.trackIds.length}곡</div>
      </div>
    </div>
  );
}

export function Sidebar() {
  const { library, view, navigate, contextLabel, playing, setLibrary, showToast, openModal } = useStore();
  const [tab, setTab] = useState<Tab>("playlists");
  const [filter, setFilter] = useState("");
  const [showFilter, setShowFilter] = useState(false);
  const q = filter.toLowerCase();

  const playlists = useMemo(
    () => library.playlists.filter((p) => p.name.toLowerCase().includes(q)),
    [library.playlists, q],
  );
  const artists = useMemo(
    () =>
      groupArtists(library.tracks)
        .filter((a) => a.name.toLowerCase().includes(q))
        .sort((a, b) => a.name.localeCompare(b.name, "ko")),
    [library.tracks, q],
  );
  const albums = useMemo(
    () =>
      groupAlbums(library.tracks)
        .filter((a) => `${a.album} ${a.artist}`.toLowerCase().includes(q))
        .sort((a, b) => a.album.localeCompare(b.album, "ko")),
    [library.tracks, q],
  );

  const likedDrop = useDropTarget(async (ids) => {
    setLibrary(await api.setLiked(ids, true));
    showToast("좋아요 표시한 곡에 저장했어요");
  });

  return (
    <nav className="sidebar panel">
      <div className="brand">
        <img src="/muse.svg" alt="" />
        <span>muse</span>
      </div>
      <div className="sidebar-head">
        <h2>
          <Library size={16} /> 내 라이브러리
        </h2>
        <div style={{ display: "flex", gap: 2 }}>
          <button className="round-btn" title="검색" onClick={() => setShowFilter((v) => !v)}>
            <Search size={16} />
          </button>
          <button className="round-btn" title="플레이리스트 만들기" onClick={() => openModal({ kind: "newPlaylist" })}>
            <Plus size={18} />
          </button>
        </div>
      </div>
      <div className="chips">
        {(
          [
            ["playlists", "플레이리스트"],
            ["artists", "아티스트"],
            ["albums", "앨범"],
          ] as [Tab, string][]
        ).map(([k, l]) => (
          <button key={k} className={`chip ${tab === k ? "on" : ""}`} onClick={() => setTab(k)}>
            {l}
          </button>
        ))}
      </div>
      {showFilter && (
        <div style={{ padding: "0 16px 8px" }}>
          <div className="search-box small" style={{ width: "100%" }}>
            <Search size={14} />
            <input autoFocus placeholder="내 라이브러리에서 검색" value={filter} onChange={(e) => setFilter(e.target.value)} />
          </div>
        </div>
      )}
      <div className="lib-list">
        {tab === "playlists" && (
          <>
            <div
              className={`lib-item ${view.kind === "liked" ? "active" : ""} ${playing && contextLabel === "좋아요 표시한 곡" ? "playing" : ""} ${likedDrop.over ? "drop" : ""}`}
              onClick={() => navigate({ kind: "liked" })}
              {...likedDrop.props}
            >
              <LikedArt />
              <div className="meta">
                <div className="name">좋아요 표시한 곡</div>
                <div className="sub">플레이리스트 • {library.liked.length}곡</div>
              </div>
            </div>
            <div
              className={`lib-item ${view.kind === "songs" ? "active" : ""} ${playing && contextLabel === "모든 곡" ? "playing" : ""}`}
              onClick={() => navigate({ kind: "songs" })}
            >
              <SongsArt />
              <div className="meta">
                <div className="name">모든 곡</div>
                <div className="sub">라이브러리 • {library.tracks.length}곡</div>
              </div>
            </div>
            <div className={`lib-item ${view.kind === "history" ? "active" : ""}`} onClick={() => navigate({ kind: "history" })}>
              <div className="thumb history-art">
                <History size={20} />
              </div>
              <div className="meta">
                <div className="name">최근 재생</div>
                <div className="sub">청취 기록 • {library.history.length}회</div>
              </div>
            </div>
            {playlists.map((p) => (
              <PlaylistRow key={p.id} id={p.id} />
            ))}
          </>
        )}
        {tab === "artists" &&
          artists.map((a) => (
            <div
              key={a.name}
              className={`lib-item ${view.kind === "artist" && view.name === a.name ? "active" : ""}`}
              onClick={() => navigate({ kind: "artist", name: a.name })}
            >
              {a.cover ? <Cover src={a.cover} className="thumb round" /> : <div className="thumb round"><User size={20} /></div>}
              <div className="meta">
                <div className="name">{a.name}</div>
                <div className="sub">아티스트 • {a.tracks.length}곡</div>
              </div>
            </div>
          ))}
        {tab === "albums" &&
          albums.map((a) => (
            <div
              key={`${a.artist}-${a.album}`}
              className={`lib-item ${view.kind === "album" && view.album === a.album && view.artist === a.artist ? "active" : ""}`}
              onClick={() => navigate({ kind: "album", artist: a.artist, album: a.album })}
            >
              <Cover src={a.cover} />
              <div className="meta">
                <div className="name">{a.album}</div>
                <div className="sub">앨범 • {a.artist}</div>
              </div>
            </div>
          ))}
        {tab !== "playlists" && (tab === "artists" ? artists : albums).length === 0 && (
          <div className="side-empty">아직 없어요. 곡을 받으면 여기에 정리돼요.</div>
        )}
      </div>
      <ToolInstallStatus />
    </nav>
  );
}
