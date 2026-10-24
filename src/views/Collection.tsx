import { useEffect, useState } from "react";
import { ArrowDownUp, MoreHorizontal, Pencil, Search, Shuffle, Trash2 } from "lucide-react";
import { api, totalDuration } from "../api";
import { useStore } from "../store";
import type { Track } from "../types";
import { LikedArt, PlaylistArt, SongsArt } from "../components/Art";
import { Page } from "../components/Hero";
import { TrackTable } from "../components/TrackTable";
import { PlaylistModal } from "../components/PlaylistModal";
import { isMobile } from "../platform";

type Kind = { kind: "songs" } | { kind: "liked" } | { kind: "playlist"; id: string };
type Sort = "custom" | "title" | "artist" | "added" | "plays";

const SORTS: Record<Sort, string> = {
  custom: "사용자 지정 순서",
  title: "제목순",
  artist: "아티스트순",
  added: "최근 추가순",
  plays: "많이 들은 순",
};

export function Collection({ view }: { view: Kind }) {
  const s = useStore();
  const [editing, setEditing] = useState(false);
  const [menu, setMenu] = useState(false);
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<Sort>("custom");
  const [reordering, setReordering] = useState(false);

  useEffect(() => {
    setFilter("");
    setSort("custom");
  }, [JSON.stringify(view)]);

  const lib = s.library;
  const byId = (id: string) => lib.tracks.find((t) => t.id === id);
  let title = "";
  let label = "";
  let desc = "";
  let art: React.ReactNode = null;
  let tracks: Track[] = [];
  const playlist = view.kind === "playlist" ? lib.playlists.find((p) => p.id === view.id) : undefined;

  if (view.kind === "liked") {
    title = label = "좋아요 표시한 곡";
    tracks = lib.liked.map(byId).filter((t): t is Track => !!t);
    art = <LikedArt className="hero-art liked-art" size={80} />;
  } else if (view.kind === "songs") {
    title = "모든 곡";
    label = "모든 곡";
    tracks = [...lib.tracks].reverse();
    art = <SongsArt className="hero-art songs-art" size={80} />;
  } else if (playlist) {
    title = label = playlist.name;
    desc = playlist.description;
    tracks = playlist.trackIds.map(byId).filter((t): t is Track => !!t);
    art = <PlaylistArt className="hero-art" playlist={playlist} tracks={lib.tracks} size={80} />;
  } else {
    return <div className="empty">플레이리스트를 찾을 수 없습니다</div>;
  }

  const q = filter.toLowerCase();
  let shown = tracks.filter((t) => !q || `${t.title} ${t.artist} ${t.album}`.toLowerCase().includes(q));
  if (sort === "title") shown = [...shown].sort((a, b) => a.title.localeCompare(b.title, "ko"));
  if (sort === "artist") shown = [...shown].sort((a, b) => a.artist.localeCompare(b.artist, "ko"));
  if (sort === "added") shown = [...shown].sort((a, b) => b.addedAt - a.addedAt);
  if (sort === "plays") shown = [...shown].sort((a, b) => b.playCount - a.playCount);
  // Rows can only be dragged into a new order when the full list is shown in its saved order
  const canReorder = !!playlist && sort === "custom" && !q;

  const isThis = s.contextLabel === label && !!s.current;
  const sorts = Object.keys(SORTS) as Sort[];

  return (
    <Page
      art={art}
      kind={view.kind === "songs" ? "라이브러리" : "플레이리스트"}
      title={title}
      meta={
        <>
          {desc && <div className="desc">{desc}</div>}
          <span>{tracks.length}곡, {totalDuration(tracks)}</span>
        </>
      }
      playing={isThis && s.playing}
      onPlay={tracks.length ? () => (isThis ? s.togglePlay() : s.playTracks(shown.map((t) => t.id), 0, label)) : undefined}
      actions={
        <>
          <button className={`icon-btn ${s.shuffle ? "active" : ""}`} onClick={s.toggleShuffle} title="셔플">
            <Shuffle size={26} />
          </button>
          {playlist && (
            <div style={{ position: "relative" }}>
              <button className="icon-btn" onClick={() => setMenu((m) => !m)}>
                <MoreHorizontal size={26} />
              </button>
              {menu && (
                <div className="ctx" style={{ position: "absolute", top: 36, left: 0 }} onMouseLeave={() => setMenu(false)}>
                  <button onClick={() => (setMenu(false), setEditing(true))}>
                    <Pencil size={16} /> 세부 정보 편집
                  </button>
                  <button
                    className="danger"
                    onClick={async () => {
                      setMenu(false);
                      s.setLibrary(await api.deletePlaylist(playlist.id));
                      s.navigate({ kind: "home" });
                    }}
                  >
                    <Trash2 size={16} /> 플레이리스트 삭제
                  </button>
                </div>
              )}
            </div>
          )}
          <div style={{ flex: 1 }} />
          <div className="search-box small" style={{ width: 220 }}>
            <Search size={14} />
            <input placeholder="이 목록에서 검색" value={filter} onChange={(e) => setFilter(e.target.value)} />
          </div>
          <button
            className="icon-btn sort-btn"
            onClick={() => setSort(sorts[(sorts.indexOf(sort) + 1) % sorts.length])}
            title="정렬 바꾸기"
          >
            <ArrowDownUp size={14} /> {SORTS[sort]}
          </button>
          {isMobile && canReorder && (
            <button className={`btn btn-sm ${reordering ? "btn-primary" : "btn-secondary"}`} onClick={() => setReordering(!reordering)}>
              {reordering ? "완료" : "순서 편집"}
            </button>
          )}
        </>
      }
    >
      {tracks.length ? (
        <TrackTable
          tracks={shown}
          label={label}
          playlistId={playlist?.id}
          extra={sort === "plays" ? "plays" : "added"}
          onReorder={canReorder ? async (ids) => s.setLibrary(await api.reorderPlaylist(playlist!.id, ids)) : undefined}
          reorderMode={isMobile && canReorder && reordering}
        />
      ) : (
        <div className="empty">
          <h2>{view.kind === "liked" ? "좋아하는 곡이 여기에 표시돼요" : "이 플레이리스트에 곡을 추가해보세요"}</h2>
          <div>
            {isMobile
              ? "곡을 검색해서 받은 뒤, 하트를 누르거나 곡의 ⋮ 메뉴에서 담아보세요."
              : "곡을 검색해서 받은 뒤, 하트를 누르거나 곡을 왼쪽 목록으로 끌어다 놓으세요."}
          </div>
          <button className="pill-btn" onClick={() => s.navigate({ kind: "search" })}>
            곡 찾기
          </button>
        </div>
      )}
      {editing && playlist && <PlaylistModal playlist={playlist} onClose={() => setEditing(false)} />}
    </Page>
  );
}
