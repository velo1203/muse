import { useEffect, useMemo, useState } from "react";
import { Check, Download, Link2, Loader2, Pause, Play, RotateCcw } from "lucide-react";
import { api, formatTime, isYoutubeUrl } from "../api";
import { useStore } from "../store";
import type { CatalogAlbum, CatalogTrack, DownloadJob, Track, YtResult } from "../types";
import { TrackTable } from "../components/TrackTable";
import { InstallYtdlpButton, installHint, useToolStatus } from "../components/ToolSetup";

type Tab = "all" | "songs" | "albums" | "youtube" | "library";

const GENRES = [
  { name: "K-POP", q: "K-POP", c: "#d94b6a" },
  { name: "발라드", q: "발라드", c: "#7b62a8" },
  { name: "힙합", q: "Korean hip hop", c: "#b8662a" },
  { name: "인디", q: "Korean indie", c: "#3f8a4a" },
  { name: "J-POP", q: "J-POP", c: "#355a9c" },
  { name: "Pop", q: "pop hits", c: "#3f7f95" },
  { name: "R&B", q: "R&B", c: "#a8467e" },
  { name: "재즈", q: "jazz", c: "#2f6fb8" },
  { name: "Lo-fi", q: "lofi", c: "#5a4a68" },
  { name: "OST", q: "드라마 OST", c: "#93408a" },
];

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
export const catalogKey = (c: { artist: string; title: string }) => `${norm(c.artist)}|${norm(c.title)}`;

/** "Artist - Title (Official Audio)" → { artist, title } */
export function parseYtTitle(r: YtResult) {
  const clean = r.title
    .replace(/\[[^\]]*\]|\((?:official|lyrics?|audio|mv|m\/v|music video|visualizer)[^)]*\)/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  const m = clean.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (m) return { artist: m[1].trim(), title: m[2].replace(/["'“”‘’]/g, "").trim() };
  return { artist: r.channel.replace(/ - Topic$/, ""), title: clean };
}

export function DlButton({
  job, inLibrary, onStart, onPlay,
}: { job?: DownloadJob; inLibrary?: Track; onStart: () => void; onPlay?: () => void }) {
  const { current, playing } = useStore();
  if (inLibrary || job?.status === "done") {
    const isCur = inLibrary && current === inLibrary.id;
    return (
      <button className="dl-btn done" onClick={onPlay}>
        {isCur && playing ? <Pause size={14} /> : isCur ? <Play size={14} /> : <Check size={14} />}
        {isCur ? (playing ? "재생 중" : "일시정지") : "보관됨"}
      </button>
    );
  }
  if (job?.status === "error")
    return (
      <button className="dl-btn err" onClick={onStart} title={job.message}>
        <RotateCcw size={14} /> 재시도
      </button>
    );
  if (job)
    return (
      <span className="dl-btn busy">
        {job.status === "downloading" && job.progress > 0 ? <Ring pct={job.progress} /> : <Loader2 size={14} className="spin" />}
        {job.status === "searching"
          ? "음원 찾는 중"
          : job.status === "queued" || job.status === "pending"
            ? "대기 중"
            : `${Math.round(job.progress)}%`}
      </span>
    );
  return (
    <button className="dl-btn" onClick={onStart}>
      <Download size={14} /> 받기
    </button>
  );
}

function Ring({ pct }: { pct: number }) {
  const r = 8;
  const c = 2 * Math.PI * r;
  return (
    <svg className="ring" viewBox="0 0 22 22" style={{ width: 16, height: 16 }}>
      <circle cx="11" cy="11" r={r} fill="none" stroke="rgba(255,255,255,.15)" strokeWidth="3" />
      <circle
        cx="11" cy="11" r={r} fill="none" stroke="var(--accent)" strokeWidth="3"
        strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)} transform="rotate(-90 11 11)" strokeLinecap="round"
      />
    </svg>
  );
}

export function SearchView({ query = "" }: { query?: string }) {
  const s = useStore();
  const [tab, setTab] = useState<Tab>("all");
  const [catalog, setCatalog] = useState<CatalogTrack[]>([]);
  const [albums, setAlbums] = useState<CatalogAlbum[]>([]);
  const [yt, setYt] = useState<YtResult[]>([]);
  const [linked, setLinked] = useState<YtResult[] | null>(null);
  const [loading, setLoading] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const { tools, refresh: refreshTools } = useToolStatus();
  const ytdlpMissing = tools !== null && !tools.ytdlp;
  const isUrl = isYoutubeUrl(query);

  useEffect(() => {
    const q = query.trim();
    setError(null);
    setLinked(null);
    if (!q) {
      setCatalog([]);
      setAlbums([]);
      setYt([]);
      return;
    }
    let stale = false;
    const track = <T,>(p: Promise<T>, then: (v: T) => void) => {
      setLoading((n) => n + 1);
      p.then((v) => !stale && then(v))
        .catch((e) => !stale && setError(String(e)))
        .finally(() => setLoading((n) => n - 1));
    };
    const timer = setTimeout(() => {
      if (isYoutubeUrl(q)) {
        track(api.resolveUrl(q), setLinked);
        return;
      }
      track(api.catalogSearch(q), setCatalog);
      track(api.catalogAlbums(q), setAlbums);
      track(api.youtubeSearch(q), setYt);
    }, 450);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [query]);

  const jobs = Object.values(s.downloads);
  const jobFor = (key: string) =>
    jobs.filter((j) => j.key === key).sort((a, b) => (a.status === "error" ? 1 : 0) - (b.status === "error" ? 1 : 0))[0];
  const libByKey = useMemo(() => new Map(s.library.tracks.map((t) => [catalogKey(t), t])), [s.library.tracks]);
  const libByYt = useMemo(() => new Map(s.library.tracks.filter((t) => t.youtubeId).map((t) => [t.youtubeId, t])), [s.library.tracks]);
  const trackById = (id?: string) => s.library.tracks.find((t) => t.id === id);

  const q = norm(query);
  const libMatches = q && !isUrl ? s.library.tracks.filter((t) => norm(`${t.title} ${t.artist} ${t.album}`).includes(q)) : [];

  const playOne = (t?: Track) => t && s.playOrToggle([t.id], 0, t.title);
  const downloadCatalog = (c: CatalogTrack) =>
    s.startDownload({
      key: catalogKey(c), title: c.title, artist: c.artist, album: c.album, artwork: c.artwork, duration: c.duration,
      trackNumber: c.trackNumber, discNumber: c.discNumber, year: c.year, genre: c.genre,
    });
  const downloadYt = (r: YtResult) => {
    const p = parseYtTitle(r);
    s.startDownload({ key: r.id, youtubeId: r.id, title: p.title, artist: p.artist, duration: r.duration });
  };

  const catalogRow = (c: CatalogTrack, i: number) => {
    const key = catalogKey(c);
    const owned = libByKey.get(key) ?? trackById(jobFor(key)?.trackId);
    return (
      <div key={`${key}-${i}`} className="result-row" onDoubleClick={() => (owned ? playOne(owned) : downloadCatalog(c))}>
        <div className="art">{c.artwork && <img src={c.artwork} alt="" />}</div>
        <div style={{ minWidth: 0 }}>
          <div className="t">{c.title}</div>
          <div className="s">
            <span className="link" onClick={() => s.navigate({ kind: "search", query: c.artist })}>{c.artist}</span>
          </div>
        </div>
        <div className="s album">
          {c.albumId ? (
            <span className="link" onClick={() => s.navigate({ kind: "catalogAlbum", id: c.albumId! })}>{c.album}</span>
          ) : (
            c.album
          )}
        </div>
        <div className="dur">{formatTime(c.duration)}</div>
        <DlButton job={jobFor(key)} inLibrary={owned} onStart={() => downloadCatalog(c)} onPlay={() => playOne(owned)} />
      </div>
    );
  };

  const ytRow = (r: YtResult) => {
    const owned = libByYt.get(r.id) ?? trackById(jobFor(r.id)?.trackId);
    return (
      <div key={r.id} className="result-row yt" onDoubleClick={() => (owned ? playOne(owned) : downloadYt(r))}>
        <div className="art">
          <img src={r.thumbnail} alt="" />
        </div>
        <div style={{ minWidth: 0 }}>
          <div className="t">{r.title}</div>
          <div className="s">{r.channel}</div>
        </div>
        <div className="s album">{r.channel.endsWith(" - Topic") ? "공식 음원 (Topic)" : ""}</div>
        <div className="dur">{formatTime(r.duration)}</div>
        <DlButton job={jobFor(r.id)} inLibrary={owned} onStart={() => downloadYt(r)} onPlay={() => playOne(owned)} />
      </div>
    );
  };

  const albumCards = (list: CatalogAlbum[]) => (
    <div className="card-row">
      {list.map((a) => (
        <div key={a.id} className="card" onClick={() => s.navigate({ kind: "catalogAlbum", id: a.id })}>
          <div className="art">
            <img src={a.artwork} alt="" />
          </div>
          <div className="t">{a.title}</div>
          <div className="s">
            {a.year} • {a.artist}
          </div>
        </div>
      ))}
    </div>
  );

  const missing = ytdlpMissing && (
    <div className="notice notice-row">
      <span>
        곡을 받으려면 yt-dlp가 필요해요. 버튼으로 바로 설치하거나 터미널에서 <code>{installHint("yt-dlp")}</code> 를 실행하세요.
      </span>
      <InstallYtdlpButton onDone={refreshTools} />
    </div>
  );

  if (!q)
    return (
      <div className="main-scroll">
        {missing}
        <div className="page-pad">
          <div className="section-title">
            <h2>모두 둘러보기</h2>
          </div>
          <div className="genre-grid">
            {GENRES.map((g) => (
              <button key={g.name} className="genre" style={{ background: g.c }} onClick={() => s.navigate({ kind: "search", query: g.q })}>
                {g.name}
              </button>
            ))}
          </div>
          <div className="tip">
            <Link2 size={16} /> YouTube 영상이나 재생목록 링크를 검색창에 붙여넣으면 바로 받을 수 있어요.
          </div>
        </div>
      </div>
    );

  if (isUrl) {
    const notOwned = (linked ?? []).filter((r) => !libByYt.has(r.id) && !jobFor(r.id));
    return (
      <div className="main-scroll">
        {missing}
        {error && <div className="notice">{error}</div>}
        <div className="page-pad">
          <div className="section-title">
            <h2>
              <Link2 size={20} style={{ verticalAlign: -3, marginRight: 8 }} />
              링크에서 가져오기
            </h2>
            {linked && linked.length > 1 && (
              <button className="dl-btn" disabled={!notOwned.length} onClick={() => notOwned.forEach(downloadYt)}>
                <Download size={14} /> {notOwned.length ? `${notOwned.length}곡 모두 받기` : "모두 보관됨"}
              </button>
            )}
          </div>
          {!linked && loading > 0 && (
            <div className="empty">
              <Loader2 className="spin" />
              <div>링크 정보를 불러오는 중…</div>
            </div>
          )}
          {linked?.map(ytRow)}
        </div>
      </div>
    );
  }

  const top = catalog[0];
  const topOwned = top && (libByKey.get(catalogKey(top)) ?? trackById(jobFor(catalogKey(top))?.trackId));

  return (
    <div className="main-scroll">
      {missing}
      <div className="tabs">
        {(
          [
            ["all", "모두"],
            ["songs", "곡"],
            ["albums", "앨범"],
            ["youtube", "YouTube"],
            ["library", `내 라이브러리${libMatches.length ? ` (${libMatches.length})` : ""}`],
          ] as [Tab, string][]
        ).map(([k, l]) => (
          <button key={k} className={`chip ${tab === k ? "on" : ""}`} onClick={() => setTab(k)}>
            {l}
          </button>
        ))}
        {loading > 0 && <Loader2 size={18} className="spin" style={{ alignSelf: "center", color: "var(--text-subdued)" }} />}
      </div>
      {error && <div className="notice">{error}</div>}
      <div className="page-pad">
        {tab === "all" && (
          <>
            {top && (
              <div className="top-result">
                <div>
                  <div className="section-title">
                    <h2>상위 결과</h2>
                  </div>
                  <div className="top-card">
                    <div className="art">
                      <img src={top.artwork} alt="" />
                    </div>
                    <h3>{top.title}</h3>
                    <div className="s">
                      곡 • <b>{top.artist}</b>
                    </div>
                    <div className="corner">
                      {topOwned ? (
                        <button className="play-fab" onClick={() => playOne(topOwned)}>
                          {s.current === topOwned.id && s.playing ? (
                            <Pause size={24} fill="currentColor" />
                          ) : (
                            <Play size={24} fill="currentColor" />
                          )}
                        </button>
                      ) : (
                        <DlButton job={jobFor(catalogKey(top))} onStart={() => downloadCatalog(top)} />
                      )}
                    </div>
                  </div>
                </div>
                <div style={{ minWidth: 0 }}>
                  <div className="section-title">
                    <h2>곡</h2>
                    <button onClick={() => setTab("songs")}>모두 표시</button>
                  </div>
                  {catalog.slice(1, 5).map(catalogRow)}
                </div>
              </div>
            )}
            {albums.length > 0 && (
              <>
                <div className="section-title">
                  <h2>앨범</h2>
                  <button onClick={() => setTab("albums")}>모두 표시</button>
                </div>
                {albumCards(albums.slice(0, 6))}
              </>
            )}
            {libMatches.length > 0 && (
              <>
                <div className="section-title">
                  <h2>내 라이브러리</h2>
                  <button onClick={() => setTab("library")}>모두 표시</button>
                </div>
                <TrackTable tracks={libMatches.slice(0, 5)} label={`'${query}' 검색 결과`} extra={null} />
              </>
            )}
            {yt.length > 0 && (
              <>
                <div className="section-title">
                  <h2>YouTube</h2>
                  <button onClick={() => setTab("youtube")}>모두 표시</button>
                </div>
                {yt.slice(0, 5).map(ytRow)}
              </>
            )}
            {loading === 0 && !catalog.length && !yt.length && !libMatches.length && !albums.length && (
              <div className="empty">
                <h2>'{query}'에 대한 결과가 없습니다</h2>
                철자를 확인하거나 다른 키워드로 검색해보세요.
              </div>
            )}
          </>
        )}
        {tab === "songs" && (
          <>
            <div className="section-title">
              <h2>곡</h2>
            </div>
            {catalog.map(catalogRow)}
          </>
        )}
        {tab === "albums" && (
          <>
            <div className="section-title">
              <h2>앨범</h2>
            </div>
            {albumCards(albums)}
          </>
        )}
        {tab === "youtube" && (
          <>
            <div className="section-title">
              <h2>YouTube 검색 결과</h2>
            </div>
            {yt.map(ytRow)}
          </>
        )}
      </div>
      {tab === "library" && <TrackTable tracks={libMatches} label={`'${query}' 검색 결과`} extra={null} />}
    </div>
  );
}
