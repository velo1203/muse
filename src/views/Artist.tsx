import { useEffect, useState } from "react";
import { Play, Search, Shuffle, User } from "lucide-react";
import { api, groupAlbums } from "../api";
import { useStore } from "../store";
import type { CatalogAlbum } from "../types";
import { Cover } from "../components/Art";
import { Page } from "../components/Hero";
import { TrackTable } from "../components/TrackTable";

export function ArtistView({ name }: { name: string }) {
  const s = useStore();
  const [showAll, setShowAll] = useState(false);
  const [catalog, setCatalog] = useState<CatalogAlbum[]>([]);
  const tracks = s.library.tracks.filter((t) => t.artist === name);
  const popular = [...tracks].sort((a, b) => b.playCount - a.playCount || b.addedAt - a.addedAt);
  const albums = groupAlbums(tracks);
  const label = name;
  const isThis = s.contextLabel === label && !!s.current;
  const cover = tracks.find((t) => t.cover)?.cover;

  useEffect(() => {
    setShowAll(false);
    let stale = false;
    api
      .catalogAlbums(name)
      .then((r) => !stale && setCatalog(r.filter((a) => a.artist.toLowerCase().includes(name.toLowerCase())).slice(0, 12)))
      .catch(() => {});
    return () => {
      stale = true;
    };
  }, [name]);

  const plays = tracks.reduce((a, t) => a + t.playCount, 0);
  return (
    <Page
      art={cover ? <Cover src={cover} className="hero-art round" /> : <div className="hero-art round"><User size={80} /></div>}
      kind="아티스트"
      title={name}
      meta={<span>내 라이브러리 {tracks.length}곡 • {plays.toLocaleString()}회 재생</span>}
      playing={isThis && s.playing}
      onPlay={tracks.length ? () => (isThis ? s.togglePlay() : s.playTracks(popular.map((t) => t.id), 0, label)) : undefined}
      actions={
        <>
          <button className={`icon-btn ${s.shuffle ? "active" : ""}`} onClick={s.toggleShuffle} title="셔플">
            <Shuffle size={26} />
          </button>
          <div style={{ flex: 1 }} />
          <button className="dl-btn" onClick={() => s.navigate({ kind: "search", query: name })}>
            <Search size={14} /> 더 많은 곡 찾기
          </button>
        </>
      }
    >
      {tracks.length > 0 && (
        <div className="page-pad">
          <div className="section-title">
            <h2>많이 들은 곡</h2>
          </div>
        </div>
      )}
      <TrackTable tracks={showAll ? popular : popular.slice(0, 5)} label={label} extra="plays" />
      {popular.length > 5 && (
        <div className="page-pad">
          <button className="text-btn" onClick={() => setShowAll(!showAll)}>
            {showAll ? "간략히 보기" : `${popular.length}곡 모두 보기`}
          </button>
        </div>
      )}
      <div className="page-pad">
        {albums.length > 0 && (
          <>
            <div className="section-title">
              <h2>내 라이브러리의 앨범</h2>
            </div>
            <div className="card-row">
              {albums.map((a) => (
                <div key={a.album} className="card" onClick={() => s.navigate({ kind: "album", artist: a.artist, album: a.album })}>
                  <div className="art">
                    <Cover src={a.cover} className="cover-fill" size={40} />
                    <button
                      className="play-fab small float-play"
                      onClick={(e) => {
                        e.stopPropagation();
                        s.playTracks(a.tracks.map((t) => t.id), 0, `${a.album} — ${a.artist}`);
                      }}
                    >
                      <Play size={20} fill="currentColor" />
                    </button>
                  </div>
                  <div className="t">{a.album}</div>
                  <div className="s">{a.year ? `${a.year} • ` : ""}{a.tracks.length}곡</div>
                </div>
              ))}
            </div>
          </>
        )}
        {catalog.length > 0 && (
          <>
            <div className="section-title">
              <h2>디스코그래피</h2>
            </div>
            <div className="card-row">
              {catalog.map((a) => (
                <div key={a.id} className="card" onClick={() => s.navigate({ kind: "catalogAlbum", id: a.id })}>
                  <div className="art">
                    <img src={a.artwork} alt="" />
                  </div>
                  <div className="t">{a.title}</div>
                  <div className="s">{a.year} • {a.trackCount}곡</div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </Page>
  );
}
