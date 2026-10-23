import { useMemo } from "react";
import { FolderInput, History, Pause, Play, Search, User } from "lucide-react";
import { groupArtists } from "../api";
import { useStore } from "../store";
import type { Track } from "../types";
import { Cover, LikedArt, PlaylistArt, SongsArt } from "../components/Art";

function greeting() {
  const h = new Date().getHours();
  if (h < 6) return "편안한 밤 되세요";
  if (h < 12) return "좋은 아침입니다";
  if (h < 18) return "좋은 오후입니다";
  return "좋은 저녁입니다";
}

function TrackCards({ tracks, label }: { tracks: Track[]; label: string }) {
  const { current, playing, playOrToggle } = useStore();
  const ids = tracks.map((t) => t.id);
  return (
    <div className="card-row">
      {tracks.map((t, i) => (
        <div key={t.id} className="card" onClick={() => playOrToggle(ids, i, label)}>
          <div className="art">
            <Cover src={t.cover} className="cover-fill" size={40} />
            <button className={`play-fab small float-play ${current === t.id ? "shown" : ""}`}>
              {current === t.id && playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
            </button>
          </div>
          <div className="t">{t.title}</div>
          <div className="s">{t.artist}</div>
        </div>
      ))}
    </div>
  );
}

export function Home() {
  const { library, navigate, playTracks, current, playing, contextLabel, togglePlay } = useStore();
  const byId = useMemo(() => new Map(library.tracks.map((t) => [t.id, t])), [library.tracks]);

  const recentlyPlayed = useMemo(() => {
    const seen = new Set<string>();
    const out: Track[] = [];
    for (const h of [...library.history].reverse()) {
      const t = byId.get(h.trackId);
      if (t && !seen.has(t.id)) {
        seen.add(t.id);
        out.push(t);
      }
      if (out.length >= 12) break;
    }
    return out;
  }, [library.history, byId]);
  const mostPlayed = useMemo(
    () => library.tracks.filter((t) => t.playCount > 0).sort((a, b) => b.playCount - a.playCount).slice(0, 12),
    [library.tracks],
  );
  const topArtists = useMemo(
    () => groupArtists(library.tracks).filter((a) => a.plays > 0).sort((a, b) => b.plays - a.plays).slice(0, 8),
    [library.tracks],
  );
  const recentlyAdded = useMemo(() => [...library.tracks].sort((a, b) => b.addedAt - a.addedAt).slice(0, 12), [library.tracks]);
  const weekAgo = Date.now() - 7 * 86400000;
  const weekPlays = library.history.filter((h) => h.at >= weekAgo);
  const weekMinutes = Math.round(weekPlays.reduce((a, h) => a + (byId.get(h.trackId)?.duration ?? 0), 0) / 60);

  const quick = [
    { key: "liked", name: "좋아요 표시한 곡", art: <LikedArt />, ids: library.liked.filter((id) => byId.has(id)), go: () => navigate({ kind: "liked" }) },
    { key: "songs", name: "모든 곡", art: <SongsArt />, ids: [...library.tracks].reverse().map((t) => t.id), go: () => navigate({ kind: "songs" }) },
    ...library.playlists.map((p) => ({
      key: p.id,
      name: p.name,
      art: <PlaylistArt playlist={p} tracks={library.tracks} />,
      ids: p.trackIds.filter((id) => byId.has(id)),
      go: () => navigate({ kind: "playlist", id: p.id }),
    })),
  ].slice(0, 8);

  return (
    <div className="main-scroll">
      <div className="page-pad">
        <div className="greeting">{greeting()}</div>
        <div className="greeting-sub">
          {weekPlays.length > 0 ? `이번 주 ${weekPlays.length}곡, 약 ${weekMinutes}분을 들었어요` : "오늘의 뮤즈를 찾아볼까요?"}
        </div>
        <div className="quick-grid">
          {quick.map((q) => {
            const isThis = contextLabel === q.name && !!current;
            return (
              <div key={q.key} className="quick" onClick={q.go}>
                {q.art}
                <div className="name">{q.name}</div>
                <button
                  className={`mini-play ${isThis ? "shown" : ""}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (isThis) togglePlay();
                    else if (q.ids.length) playTracks(q.ids, 0, q.name);
                  }}
                >
                  {isThis && playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
                </button>
              </div>
            );
          })}
        </div>

        {library.tracks.length === 0 ? (
          <div className="empty">
            <Search size={48} />
            <h2>첫 곡을 찾아보세요</h2>
            <div>곡을 검색하면 YouTube에서 최상의 음질로 음원을 찾아 라이브러리에 저장해요.</div>
            <div className="row" style={{ justifyContent: "center" }}>
              <button className="pill-btn" onClick={() => navigate({ kind: "search" })}>
                검색하기
              </button>
              <button className="pill-btn ghost" onClick={() => navigate({ kind: "settings" })}>
                <FolderInput size={16} style={{ verticalAlign: -3, marginRight: 6 }} />
                내 음악 파일 가져오기
              </button>
            </div>
          </div>
        ) : (
          <>
            {recentlyPlayed.length > 0 && (
              <>
                <div className="section-title">
                  <h2>최근 재생</h2>
                  <button onClick={() => navigate({ kind: "history" })}>
                    <History size={13} style={{ verticalAlign: -2 }} /> 청취 기록
                  </button>
                </div>
                <TrackCards tracks={recentlyPlayed} label="최근 재생" />
              </>
            )}
            {mostPlayed.length > 0 && (
              <>
                <div className="section-title">
                  <h2>많이 들은 곡</h2>
                </div>
                <TrackCards tracks={mostPlayed} label="많이 들은 곡" />
              </>
            )}
            {topArtists.length > 0 && (
              <>
                <div className="section-title">
                  <h2>자주 듣는 아티스트</h2>
                </div>
                <div className="card-row">
                  {topArtists.map((a) => (
                    <div key={a.name} className="card" onClick={() => navigate({ kind: "artist", name: a.name })}>
                      <div className="art round">
                        {a.cover ? <Cover src={a.cover} className="cover-fill" /> : <User size={40} />}
                      </div>
                      <div className="t">{a.name}</div>
                      <div className="s">{a.plays.toLocaleString()}회 재생</div>
                    </div>
                  ))}
                </div>
              </>
            )}
            <div className="section-title">
              <h2>최근 추가한 곡</h2>
              <button onClick={() => navigate({ kind: "songs" })}>모두 표시</button>
            </div>
            <TrackCards tracks={recentlyAdded} label="최근 추가한 곡" />
          </>
        )}
      </div>
    </div>
  );
}
