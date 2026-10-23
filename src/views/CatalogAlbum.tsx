import { useEffect, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { api, formatTime } from "../api";
import { useStore } from "../store";
import type { CatalogAlbum, CatalogTrack } from "../types";
import { Page } from "../components/Hero";
import { DlButton, catalogKey } from "./Search";

/** An album from the online catalog; songs can be downloaded one by one or all at once. */
export function CatalogAlbumView({ id }: { id: number }) {
  const s = useStore();
  const [data, setData] = useState<{ album: CatalogAlbum; tracks: CatalogTrack[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    api.catalogAlbum(id).then(setData).catch((e) => setError(String(e)));
  }, [id]);

  if (error) return <div className="empty">{error}</div>;
  if (!data) return <div className="empty"><Loader2 className="spin" /></div>;
  const { album, tracks } = data;

  const owned = (c: CatalogTrack) =>
    s.library.tracks.find((t) => catalogKey(t) === catalogKey(c)) ??
    s.library.tracks.find((t) => t.id === Object.values(s.downloads).find((d) => d.key === catalogKey(c))?.trackId);
  const jobFor = (c: CatalogTrack) => Object.values(s.downloads).filter((d) => d.key === catalogKey(c)).pop();
  const download = (c: CatalogTrack) =>
    s.startDownload({
      key: catalogKey(c),
      title: c.title,
      artist: c.artist,
      album: c.album,
      artwork: c.artwork,
      duration: c.duration,
      trackNumber: c.trackNumber,
      discNumber: c.discNumber,
      year: c.year,
      genre: c.genre,
    });
  const missing = tracks.filter((c) => !owned(c) && !jobFor(c));
  const ownedIds = tracks.map(owned).filter(Boolean).map((t) => t!.id);

  return (
    <Page
      art={<div className="hero-art"><img src={album.artwork} alt="" /></div>}
      kind="앨범"
      title={album.title}
      meta={
        <>
          <b className="link" onClick={() => s.navigate({ kind: "artist", name: album.artist })}>{album.artist}</b>
          <span> • {album.year} • {tracks.length}곡 {album.genre ? `• ${album.genre}` : ""}</span>
        </>
      }
      onPlay={ownedIds.length ? () => s.playTracks(ownedIds, 0, `${album.title} — ${album.artist}`) : undefined}
      actions={
        <>
          <button className="pill-btn" style={{ marginTop: 0 }} disabled={!missing.length} onClick={() => missing.forEach(download)}>
            <Download size={16} style={{ verticalAlign: -3, marginRight: 6 }} />
            {missing.length ? `${missing.length}곡 모두 받기` : "모두 보관됨"}
          </button>
          <span className="s">{ownedIds.length}/{tracks.length}곡 보관됨</span>
        </>
      }
    >
      <div className="tt">
        {tracks.map((c, i) => {
          const t = owned(c);
          return (
            <div
              key={i}
              className="result-row catalog-track"
              onDoubleClick={() => (t ? s.playOrToggle([t.id], 0, t.title) : download(c))}
            >
              <div className="num">{c.trackNumber}</div>
              <div style={{ minWidth: 0 }}>
                <div className="t">{c.title}</div>
                <div className="s">{c.artist}</div>
              </div>
              <div className="dur">{formatTime(c.duration)}</div>
              <DlButton job={jobFor(c)} inLibrary={t} onStart={() => download(c)} onPlay={() => t && s.playOrToggle([t.id], 0, t.title)} />
            </div>
          );
        })}
      </div>
    </Page>
  );
}
