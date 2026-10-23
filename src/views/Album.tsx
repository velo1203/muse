import { Disc3, Search, Shuffle } from "lucide-react";
import { byTrackOrder, totalDuration } from "../api";
import { useStore } from "../store";
import { Cover } from "../components/Art";
import { Page } from "../components/Hero";
import { TrackTable } from "../components/TrackTable";

/** An album as it exists in the local library. */
export function AlbumView({ artist, album }: { artist: string; album: string }) {
  const s = useStore();
  const tracks = s.library.tracks.filter((t) => t.artist === artist && t.album === album).sort(byTrackOrder);
  const label = `${album} — ${artist}`;
  const isThis = s.contextLabel === label && !!s.current;
  const year = tracks.find((t) => t.year)?.year;
  const cover = tracks.find((t) => t.cover)?.cover;

  return (
    <Page
      art={cover ? <Cover src={cover} className="hero-art" /> : <div className="hero-art"><Disc3 size={80} /></div>}
      kind="앨범"
      title={album}
      meta={
        <>
          <b className="link" onClick={() => s.navigate({ kind: "artist", name: artist })}>{artist}</b>
          <span> • {year ? `${year} • ` : ""}{tracks.length}곡, {totalDuration(tracks)}</span>
        </>
      }
      playing={isThis && s.playing}
      onPlay={() => (isThis ? s.togglePlay() : s.playTracks(tracks.map((t) => t.id), 0, label))}
      actions={
        <>
          <button className={`icon-btn ${s.shuffle ? "active" : ""}`} onClick={s.toggleShuffle} title="셔플">
            <Shuffle size={26} />
          </button>
          <div style={{ flex: 1 }} />
          <button className="dl-btn" onClick={() => s.navigate({ kind: "search", query: `${artist} ${album}` })}>
            <Search size={14} /> 앨범 전체 찾기
          </button>
        </>
      }
    >
      <TrackTable tracks={tracks} label={label} showAlbum={false} trackNumbers hideCover extra="plays" />
    </Page>
  );
}
