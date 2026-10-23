import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Mic2, Pencil, RotateCcw } from "lucide-react";
import { api } from "../api";
import { useCurrentTrack, useStore } from "../store";
import type { Lyrics } from "../types";

interface Line {
  time: number;
  text: string;
}

/** Parses LRC ("[01:23.45]text", possibly several stamps per line). */
function parseLrc(lrc: string): Line[] {
  const lines: Line[] = [];
  for (const raw of lrc.split("\n")) {
    const stamps = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    if (!stamps.length) continue;
    const text = raw.replace(/\[[^\]]*\]/g, "").trim();
    for (const m of stamps) lines.push({ time: Number(m[1]) * 60 + Number(m[2]), text });
  }
  return lines.sort((a, b) => a.time - b.time);
}

const cache = new Map<string, Lyrics>();

export function LyricsView() {
  const track = useCurrentTrack();
  const time = useStore((s) => s.time);
  const seek = useStore((s) => s.seek);
  const openModal = useStore((s) => s.openModal);
  const [lyrics, setLyrics] = useState<Lyrics | null>(null);
  const [loading, setLoading] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const userScrolledAt = useRef(0);

  const load = (refresh: boolean) => {
    if (!track) return () => {};
    const hit = !refresh && cache.get(track.id);
    if (hit) {
      setLyrics(hit);
      return () => {};
    }
    setLyrics(null);
    setLoading(true);
    let stale = false;
    api
      .getLyrics(track.id, refresh)
      .then((l) => {
        cache.set(track.id, l);
        if (!stale) setLyrics(l);
      })
      .finally(() => !stale && setLoading(false));
    return () => {
      stale = true;
    };
  };

  useEffect(() => load(false), [track?.id, track?.title, track?.artist]);

  const lines = useMemo(() => (lyrics?.synced ? parseLrc(lyrics.synced) : []), [lyrics]);
  // Slight lead so the highlight lands as the line is sung
  const active = lines.findLastIndex((l) => l.time <= time + 0.3);

  useEffect(() => {
    if (Date.now() - userScrolledAt.current < 3500) return;
    const el = box.current?.querySelector<HTMLElement>(`[data-i="${active}"]`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [active]);

  if (!track)
    return (
      <div className="empty">
        <Mic2 size={40} />
        <h2>재생 중인 곡이 없어요</h2>
      </div>
    );

  return (
    <div
      className="main-scroll lyrics"
      ref={box}
      onWheel={() => (userScrolledAt.current = Date.now())}
    >
      <div className="lyrics-head">
        <div style={{ minWidth: 0 }}>
          <div className="t ellipsis">{track.title}</div>
          <div className="s">{track.artist}</div>
        </div>
        <button className="btn btn-tertiary btn-sm" onClick={() => load(true)} disabled={loading} title="가사 다시 찾기">
          <RotateCcw size={14} /> 다시 찾기
        </button>
      </div>
      {loading && (
        <div className="empty">
          <Loader2 className="spin" />
        </div>
      )}
      {!loading && lines.length > 0 && (
        <div className="lyrics-lines">
          {lines.map((l, i) => (
            <p
              key={i}
              data-i={i}
              className={i === active ? "on" : i < active ? "past" : ""}
              onClick={() => seek(l.time)}
            >
              {l.text || "♪"}
            </p>
          ))}
        </div>
      )}
      {!loading && !lines.length && lyrics?.plain && (
        <div className="lyrics-lines plain">
          {lyrics.plain.split("\n").map((l, i) => (
            <p key={i}>{l || " "}</p>
          ))}
        </div>
      )}
      {!loading && lyrics && !lines.length && !lyrics.plain && (
        <div className="empty">
          <h2>{lyrics.instrumental ? "연주곡이에요" : "가사를 찾지 못했어요"}</h2>
          {!lyrics.instrumental && "가사 데이터베이스(LRCLIB)에 없는 곡이거나, 제목·아티스트 표기가 달라서 못 찾았을 수 있어요."}
          {!lyrics.instrumental && (
            <div className="row">
              <button className="btn btn-secondary btn-sm" onClick={() => openModal({ kind: "editTrack", trackId: track.id })}>
                <Pencil size={14} /> 곡 정보 고치기
              </button>
              <button className="btn btn-primary btn-sm" onClick={() => load(true)}>
                <RotateCcw size={14} /> 다시 찾기
              </button>
            </div>
          )}
        </div>
      )}
      <div className="lyrics-credit">가사 제공: LRCLIB</div>
    </div>
  );
}
