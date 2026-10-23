import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";

/** Shared page header: big artwork, kind label, title, meta line; collapses into a sticky bar on scroll. */
export function Page({
  art, kind, title, meta, playing, onPlay, actions, children,
}: {
  art: React.ReactNode;
  kind: string;
  title: string;
  meta?: React.ReactNode;
  playing?: boolean;
  onPlay?: () => void;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(0);
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
  }, [title]);
  const PlayIcon = playing ? Pause : Play;

  return (
    <div className="main-scroll" ref={scroller} onScroll={(e) => setScrolled(e.currentTarget.scrollTop)}>
      <div className="sticky-head" style={{ background: scrolled > 260 ? "rgba(22, 20, 30, .9)" : "transparent" }}>
        {scrolled > 300 && (
          <>
            {onPlay && (
              <button className="play-fab small" onClick={onPlay}>
                <PlayIcon size={20} fill="currentColor" />
              </button>
            )}
            <b style={{ fontSize: 20 }}>{title}</b>
          </>
        )}
      </div>
      <div className="hero">
        {art}
        <div style={{ minWidth: 0 }}>
          <div className="kind">{kind}</div>
          <h1 className={title.length > 14 ? "long" : ""}>{title}</h1>
          {meta && <div className="stats">{meta}</div>}
        </div>
      </div>
      {(onPlay || actions) && (
        <div className="action-row">
          {onPlay && (
            <button className="play-fab" onClick={onPlay}>
              <PlayIcon size={24} fill="currentColor" />
            </button>
          )}
          {actions}
        </div>
      )}
      {children}
      <div style={{ height: 48 }} />
    </div>
  );
}
