import { useEffect, useState } from "react";
import {
  Heart, ListMusic, Mic2, Moon, PanelRight, Pause, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward,
  Volume, Volume1, Volume2, VolumeX,
} from "lucide-react";
import { api, formatTime } from "../api";
import { useCurrentTrack, useStore } from "../store";
import { Cover } from "./Art";
import { Slider } from "./Slider";

function SleepMenu({ onClose }: { onClose: () => void }) {
  const { sleep, setSleep } = useStore();
  const left = typeof sleep === "number" ? Math.max(0, Math.ceil((sleep - Date.now()) / 60000)) : null;
  const pick = (v: "track" | number | null) => () => {
    setSleep(v);
    onClose();
  };
  return (
    <div className="ctx popup" onMouseLeave={onClose}>
      <div className="sub-label">수면 타이머 {left !== null ? `· ${left}분 남음` : sleep === "track" ? "· 곡 끝날 때" : ""}</div>
      {[5, 15, 30, 45, 60, 90].map((m) => (
        <button key={m} onClick={pick(m)}>
          {m}분
        </button>
      ))}
      <button onClick={pick("track")}>이 곡이 끝날 때</button>
      {sleep !== null && (
        <>
          <hr />
          <button className="danger" onClick={pick(null)}>
            타이머 끄기
          </button>
        </>
      )}
    </div>
  );
}

export function PlayerBar() {
  const s = useStore();
  const track = useCurrentTrack();
  const [sleepOpen, setSleepOpen] = useState(false);
  const liked = track && s.library.liked.includes(track.id);
  const vol = s.muted ? 0 : s.volume;
  const VolIcon = vol === 0 ? VolumeX : vol < 0.33 ? Volume : vol < 0.66 ? Volume1 : Volume2;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const st = useStore.getState();
      if (e.code === "Space") {
        e.preventDefault();
        st.togglePlay();
      } else if (e.metaKey && e.key === "ArrowRight") st.next();
      else if (e.metaKey && e.key === "ArrowLeft") st.prev();
      else if (e.metaKey && e.key === "ArrowUp") st.setVolume(Math.min(1, st.volume + 0.1));
      else if (e.metaKey && e.key === "ArrowDown") st.setVolume(Math.max(0, st.volume - 0.1));
      else if (!e.metaKey && e.key === "ArrowRight") st.seek(Math.min(st.duration, st.time + 5));
      else if (!e.metaKey && e.key === "ArrowLeft") st.seek(Math.max(0, st.time - 5));
      else if (e.key.toLowerCase() === "l" && !e.metaKey) st.navigate(st.view.kind === "lyrics" ? { kind: "home" } : { kind: "lyrics" });
      else if (e.key.toLowerCase() === "s" && !e.metaKey) st.toggleShuffle();
      else if (e.key.toLowerCase() === "r" && !e.metaKey) st.cycleRepeat();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <footer className="player">
      <div className="pl-left">
        {track && (
          <>
            <div onClick={() => s.setRightPanel("now")} style={{ cursor: "pointer" }}>
              <Cover src={track.cover} className={`vinyl ${s.playing ? "spinning" : ""}`} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div
                className="t link"
                onClick={() => track.album && s.navigate({ kind: "album", artist: track.artist, album: track.album })}
              >
                {track.title}
              </div>
              <div className="s link" onClick={() => s.navigate({ kind: "artist", name: track.artist })}>
                {track.artist}
              </div>
            </div>
            <button
              className={`icon-btn ${liked ? "liked-on" : ""}`}
              onClick={async () => s.setLibrary(await api.setLiked([track.id], !liked))}
              title={liked ? "좋아요 취소" : "좋아요"}
            >
              <Heart size={16} fill={liked ? "currentColor" : "none"} />
            </button>
          </>
        )}
      </div>
      <div className="pl-center">
        <div className="pl-controls">
          <button className={`icon-btn ${s.shuffle ? "active" : ""}`} onClick={s.toggleShuffle} title="셔플 (S)">
            <Shuffle size={16} />
          </button>
          <button className="icon-btn" onClick={s.prev} title="이전 (⌘←)">
            <SkipBack size={18} fill="currentColor" />
          </button>
          <button className="pl-play" onClick={s.togglePlay} title={s.playing ? "일시정지 (Space)" : "재생 (Space)"}>
            {s.playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" style={{ marginLeft: 2 }} />}
          </button>
          <button className="icon-btn" onClick={s.next} title="다음 (⌘→)">
            <SkipForward size={18} fill="currentColor" />
          </button>
          <button className={`icon-btn ${s.repeat !== "off" ? "active" : ""}`} onClick={s.cycleRepeat} title="반복 (R)">
            {s.repeat === "one" ? <Repeat1 size={16} /> : <Repeat size={16} />}
          </button>
        </div>
        <div className="pl-progress">
          <span>{formatTime(s.time)}</span>
          <Slider value={s.time} max={s.duration} onChange={() => {}} onCommit={s.seek} />
          <span>{formatTime(s.duration)}</span>
        </div>
      </div>
      <div className="pl-right">
        <button
          className={`icon-btn ${s.view.kind === "lyrics" ? "active" : ""}`}
          title="가사 (L)"
          onClick={() => (s.view.kind === "lyrics" ? s.goBack() : s.navigate({ kind: "lyrics" }))}
        >
          <Mic2 size={16} />
        </button>
        <button
          className={`icon-btn ${s.rightPanel === "now" ? "active" : ""}`}
          title="지금 재생 중"
          onClick={() => s.setRightPanel(s.rightPanel === "now" ? null : "now")}
        >
          <PanelRight size={16} />
        </button>
        <button
          className={`icon-btn ${s.rightPanel === "queue" ? "active" : ""}`}
          title="재생목록"
          onClick={() => s.setRightPanel(s.rightPanel === "queue" ? null : "queue")}
        >
          <ListMusic size={16} />
        </button>
        <div style={{ position: "relative" }}>
          <button className={`icon-btn ${s.sleep !== null ? "active" : ""}`} title="수면 타이머" onClick={() => setSleepOpen((o) => !o)}>
            <Moon size={16} />
          </button>
          {sleepOpen && <SleepMenu onClose={() => setSleepOpen(false)} />}
        </div>
        <button className="icon-btn" onClick={s.toggleMute} title="음소거">
          <VolIcon size={16} />
        </button>
        <Slider className="vol" value={vol} max={1} onChange={s.setVolume} />
      </div>
    </footer>
  );
}
