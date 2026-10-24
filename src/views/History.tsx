import { useState } from "react";
import { History, Play } from "lucide-react";
import { api, formatTime } from "../api";
import { useStore } from "../store";
import type { Track } from "../types";
import { Cover } from "../components/Art";
import { Page } from "../components/Hero";
import { activate } from "../platform";

function dayLabel(ms: number) {
  const d = new Date(ms);
  const today = new Date();
  const diff = Math.round((new Date(today.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86400000);
  if (diff === 0) return "오늘";
  if (diff === 1) return "어제";
  return d.toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short" });
}

export function HistoryView() {
  const { library, playOrToggle, setLibrary } = useStore();
  const [confirm, setConfirm] = useState(false);
  const byId = new Map(library.tracks.map((t) => [t.id, t]));
  const entries = [...library.history].reverse().filter((h) => byId.has(h.trackId));

  const groups: { label: string; items: { t: Track; at: number }[] }[] = [];
  for (const h of entries) {
    const label = dayLabel(h.at);
    const last = groups[groups.length - 1];
    const item = { t: byId.get(h.trackId)!, at: h.at };
    if (last?.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }
  const listened = entries.reduce((a, h) => a + (byId.get(h.trackId)?.duration ?? 0), 0);

  return (
    <Page
      art={<div className="hero-art history-art"><History size={80} /></div>}
      kind="청취 기록"
      title="최근 재생"
      meta={<span>{entries.length.toLocaleString()}회 재생 • 약 {Math.round(listened / 60).toLocaleString()}분</span>}
      actions={
        entries.length > 0 &&
        (confirm ? (
          <button
            className="dl-btn err"
            onClick={async () => {
              setLibrary(await api.clearHistory());
              setConfirm(false);
            }}
          >
            정말 기록을 지울까요?
          </button>
        ) : (
          <button className="dl-btn" onClick={() => setConfirm(true)}>
            기록 지우기
          </button>
        ))
      }
    >
      <div className="page-pad">
        {!entries.length && <div className="empty">아직 들은 곡이 없어요. 30초 이상 들은 곡이 여기에 기록돼요.</div>}
        {groups.map((g) => (
          <div key={g.label}>
            <div className="section-title">
              <h2>{g.label}</h2>
            </div>
            {g.items.map(({ t, at }, i) => (
              <div key={`${t.id}-${at}-${i}`} className="result-row history-row" {...activate(() => playOrToggle([t.id], 0, t.title))}>
                <Cover src={t.cover} className="art" />
                <div style={{ minWidth: 0 }}>
                  <div className="t">{t.title}</div>
                  <div className="s">{t.artist}</div>
                </div>
                <div className="s">{new Date(at).toLocaleTimeString("ko-KR", { hour: "numeric", minute: "2-digit" })}</div>
                <div className="dur">{formatTime(t.duration)}</div>
                <button className="icon-btn" onClick={(e) => (e.stopPropagation(), playOrToggle([t.id], 0, t.title))}>
                  <Play size={16} fill="currentColor" />
                </button>
              </div>
            ))}
          </div>
        ))}
      </div>
    </Page>
  );
}
