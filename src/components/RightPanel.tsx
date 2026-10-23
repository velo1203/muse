import { useState } from "react";
import { GripVertical, Heart, Mic2, Music, Pencil, X } from "lucide-react";
import { api, fileUrl, formatTime, qualityLabel } from "../api";
import { useCurrentTrack, useStore } from "../store";
import type { Track } from "../types";
import { Cover, Equalizer } from "./Art";

function QueueItem({
  t, cur, onPlay, onRemove, drag,
}: {
  t: Track;
  cur?: boolean;
  onPlay?: () => void;
  onRemove?: () => void;
  drag?: React.HTMLAttributes<HTMLDivElement>;
}) {
  const playing = useStore((s) => s.playing);
  return (
    <div className={`q-item ${cur ? "cur" : ""}`} onDoubleClick={onPlay} {...drag}>
      {drag && <GripVertical size={14} className="grip" />}
      <Cover src={t.cover} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="t">{t.title}</div>
        <div className="s">{t.artist}</div>
      </div>
      {cur && <Equalizer paused={!playing} />}
      {onRemove && (
        <button className="icon-btn q-remove" title="대기열에서 삭제" onClick={onRemove}>
          <X size={14} />
        </button>
      )}
    </div>
  );
}

export function RightPanel() {
  const s = useStore();
  const track = useCurrentTrack();
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  if (!s.rightPanel) return null;
  const byId = (id: string) => s.library.tracks.find((t) => t.id === id);
  const upcoming = s.queue
    .map((id, i) => ({ t: byId(id), i }))
    .slice(s.index + 1)
    .filter((x): x is { t: Track; i: number } => !!x.t);
  const upNext = s.upNext.map(byId).filter((t): t is Track => !!t);
  const nextTrack = upNext[0] ?? upcoming[0]?.t;
  const liked = track && s.library.liked.includes(track.id);

  return (
    <aside className="right panel">
      <div className="right-head">
        <span className="ellipsis" style={{ fontSize: 15 }}>
          {s.rightPanel === "now" ? s.contextLabel || "지금 재생 중" : "재생목록"}
        </span>
        <button className="round-btn" onClick={() => s.setRightPanel(null)}>
          <X size={18} />
        </button>
      </div>
      <div className="right-scroll">
        {s.rightPanel === "now" ? (
          track ? (
            <>
              <div className="np-art">{track.cover ? <img src={fileUrl(track.cover)} alt="" /> : <Music size={64} />}</div>
              <div className="np-title">
                <div style={{ minWidth: 0 }}>
                  <h3>{track.title}</h3>
                  <div className="s link" onClick={() => s.navigate({ kind: "artist", name: track.artist })}>
                    {track.artist}
                  </div>
                </div>
                <button
                  className={`icon-btn ${liked ? "liked-on" : ""}`}
                  onClick={async () => s.setLibrary(await api.setLiked([track.id], !liked))}
                >
                  <Heart size={22} fill={liked ? "currentColor" : "none"} />
                </button>
              </div>
              <button className="info-card lyric-card" onClick={() => s.navigate({ kind: "lyrics" })}>
                <Mic2 size={16} /> 가사 보기
              </button>
              <div className="info-card">
                <h4>
                  곡 정보
                  <button onClick={() => s.openModal({ kind: "editTrack", trackId: track.id })}>
                    <Pencil size={11} /> 편집
                  </button>
                </h4>
                <div className="kv">
                  앨범
                  <b
                    className={track.album ? "link" : ""}
                    onClick={() => track.album && s.navigate({ kind: "album", artist: track.artist, album: track.album })}
                  >
                    {track.album || "-"}
                  </b>
                </div>
                {track.year && (
                  <div className="kv">
                    연도 <b>{track.year}</b>
                  </div>
                )}
                {track.genre && (
                  <div className="kv">
                    장르 <b>{track.genre}</b>
                  </div>
                )}
                <div className="kv">
                  음질 <b>{qualityLabel(track) || "-"}</b>
                </div>
                <div className="kv">
                  재생 횟수 <b>{track.playCount.toLocaleString()}회</b>
                </div>
                <div className="kv">
                  출처 <b>{track.source === "local" ? "내 파일" : `YouTube · ${track.youtubeId}`}</b>
                </div>
              </div>
              {nextTrack && (
                <div className="info-card">
                  <h4>
                    다음 재생 곡 <button onClick={() => s.setRightPanel("queue")}>재생목록 열기</button>
                  </h4>
                  <QueueItem t={nextTrack} onPlay={s.next} />
                </div>
              )}
            </>
          ) : (
            <div className="empty" style={{ padding: "48px 8px" }}>
              재생 중인 곡이 없어요
            </div>
          )
        ) : (
          <>
            <div className="q-label">지금 재생 중</div>
            {track ? <QueueItem t={track} cur /> : <div className="s">없음</div>}
            {upNext.length > 0 && (
              <>
                <div className="q-label q-row">
                  다음 재생 목록
                  <button onClick={s.clearUpNext}>지우기</button>
                </div>
                {upNext.map((t, i) => (
                  <QueueItem
                    key={`${t.id}-${i}`}
                    t={t}
                    onRemove={() => s.removeUpNext(i)}
                    drag={{
                      draggable: true,
                      onDragStart: () => setDragFrom(i),
                      onDragOver: (e) => dragFrom !== null && e.preventDefault(),
                      onDrop: () => {
                        if (dragFrom !== null && dragFrom !== i) s.moveUpNext(dragFrom, i);
                        setDragFrom(null);
                      },
                    }}
                  />
                ))}
              </>
            )}
            {upcoming.length > 0 && (
              <>
                <div className="q-label">다음: {s.contextLabel}</div>
                {upcoming.map(({ t, i }) => (
                  <QueueItem
                    key={`${t.id}-${i}`}
                    t={t}
                    onPlay={() => s.jumpTo(i)}
                    onRemove={() => s.removeFromQueue(i)}
                  />
                ))}
              </>
            )}
            {!upNext.length && !upcoming.length && <div className="s" style={{ marginTop: 16 }}>대기열이 비어 있어요</div>}
            <div className="s" style={{ marginTop: 24, fontSize: 12 }}>
              총 {formatTime([track, ...upNext, ...upcoming.map((u) => u.t)].reduce((a, t) => a + (t?.duration ?? 0), 0))}
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
