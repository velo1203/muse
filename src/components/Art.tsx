import { Heart, ListMusic, Music } from "lucide-react";
import { fileUrl } from "../api";
import type { Playlist, Track } from "../types";

export function Cover({ src, className = "thumb", size = 20 }: { src?: string | null; className?: string; size?: number }) {
  return (
    <div className={className}>
      {src ? <img src={src.startsWith("http") ? src : fileUrl(src)} alt="" draggable={false} /> : <Music size={size} />}
    </div>
  );
}

/** Playlist art: a 2x2 mosaic of its first covers, like most music apps do. */
export function PlaylistArt({
  playlist,
  tracks,
  className = "thumb",
  size = 20,
}: {
  playlist: Playlist;
  tracks: Track[];
  className?: string;
  size?: number;
}) {
  const covers = playlist.trackIds
    .map((id) => tracks.find((t) => t.id === id)?.cover)
    .filter((c): c is string => !!c);
  const unique = [...new Set(covers)];
  if (unique.length >= 4)
    return (
      <div className={`${className} mosaic`}>
        {unique.slice(0, 4).map((c) => (
          <img key={c} src={fileUrl(c)} alt="" draggable={false} />
        ))}
      </div>
    );
  if (unique.length) return <Cover src={unique[0]} className={className} size={size} />;
  return (
    <div className={className}>
      <ListMusic size={size} />
    </div>
  );
}

export function LikedArt({ className = "thumb", size = 20 }: { className?: string; size?: number }) {
  return (
    <div className={`${className} liked-art`}>
      <Heart size={size} fill="currentColor" />
    </div>
  );
}

export function SongsArt({ className = "thumb", size = 20 }: { className?: string; size?: number }) {
  return (
    <div className={`${className} songs-art`}>
      <Music size={size} />
    </div>
  );
}

export function Equalizer({ paused }: { paused?: boolean }) {
  return (
    <span className={`eq ${paused ? "paused" : ""}`}>
      <i />
      <i />
      <i />
    </span>
  );
}
