import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Download, Home, Search, Settings } from "lucide-react";
import { useStore } from "../store";

export function TopBar() {
  const { view, back, forward, goBack, goForward, navigate, downloads } = useStore();
  const [q, setQ] = useState(view.kind === "search" ? view.query ?? "" : "");
  const input = useRef<HTMLInputElement>(null);
  const active = Object.values(downloads).filter((d) => d.status !== "done" && d.status !== "error").length;

  useEffect(() => {
    if (view.kind === "search") setQ(view.query ?? "");
  }, [view]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        input.current?.focus();
        input.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <header className="topbar" data-tauri-drag-region>
      <div className="side" data-tauri-drag-region>
        <button className="nav-btn" disabled={!back.length} onClick={goBack} title="뒤로">
          <ChevronLeft size={20} />
        </button>
        <button className="nav-btn" disabled={!forward.length} onClick={goForward} title="앞으로">
          <ChevronRight size={20} />
        </button>
      </div>
      <button className={`home-btn ${view.kind === "home" ? "active" : ""}`} onClick={() => navigate({ kind: "home" })} title="홈">
        <Home size={22} fill={view.kind === "home" ? "currentColor" : "none"} />
      </button>
      <form
        className="search-box"
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim()) navigate({ kind: "search", query: q.trim() });
        }}
      >
        <Search size={20} />
        <input
          ref={input}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            // Live search: replace the current search view instead of pushing history
            if (useStore.getState().view.kind === "search") useStore.setState({ view: { kind: "search", query: e.target.value } });
          }}
          onFocus={() => view.kind !== "search" && navigate({ kind: "search", query: q })}
          placeholder="곡·앨범·아티스트 검색, YouTube 링크 붙여넣기  (⌘K)"
        />
      </form>
      <div className="side end" data-tauri-drag-region>
        <button
          className={`icon-btn ${view.kind === "downloads" ? "active" : ""}`}
          title="다운로드"
          onClick={() => navigate({ kind: "downloads" })}
        >
          <Download size={20} />
          {active > 0 && <span className="badge">{active}</span>}
        </button>
        <button
          className={`icon-btn ${view.kind === "settings" ? "active" : ""}`}
          title="설정"
          onClick={() => navigate({ kind: "settings" })}
          style={{ marginRight: 8 }}
        >
          <Settings size={20} />
        </button>
      </div>
    </header>
  );
}
