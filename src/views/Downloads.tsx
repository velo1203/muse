import { Check, Loader2, Play, RotateCcw, X } from "lucide-react";
import { useStore } from "../store";
import type { DownloadStatus } from "../types";

const LABEL: Record<DownloadStatus, string> = {
  pending: "준비 중",
  queued: "대기 중 (동시에 3곡까지 받아요)",
  searching: "YouTube에서 가장 알맞은 음원 찾는 중…",
  downloading: "다운로드 중",
  done: "완료",
  error: "실패",
};

export function Downloads() {
  const { downloads, library, playTracks, navigate, retryDownload, clearFinishedDownloads } = useStore();
  const jobs = Object.values(downloads).reverse();
  const active = jobs.filter((j) => j.status !== "done" && j.status !== "error").length;
  const failed = jobs.filter((j) => j.status === "error");

  return (
    <div className="main-scroll">
      <div className="page-pad">
        <div className="section-title" style={{ marginTop: 24 }}>
          <h2>다운로드 {active > 0 && <span className="dim">· {active}곡 진행 중</span>}</h2>
          <div style={{ display: "flex", gap: 8 }}>
            {failed.length > 0 && (
              <button className="dl-btn" onClick={() => failed.forEach((j) => retryDownload(j.jobId))}>
                <RotateCcw size={14} /> 실패한 {failed.length}곡 재시도
              </button>
            )}
            {jobs.some((j) => j.status === "done") && (
              <button className="dl-btn" onClick={clearFinishedDownloads}>
                완료 항목 지우기
              </button>
            )}
          </div>
        </div>
        {!jobs.length && (
          <div className="empty">
            <h2>다운로드 기록이 없어요</h2>
            검색에서 곡의 '받기' 버튼을 누르면 여기에서 진행 상황을 볼 수 있어요.
            <div>
              <button className="pill-btn" onClick={() => navigate({ kind: "search" })}>
                검색하기
              </button>
            </div>
          </div>
        )}
        {jobs.map((j) => {
          const track = j.trackId ? library.tracks.find((t) => t.id === j.trackId) : undefined;
          return (
            <div key={j.jobId} className="dl-item">
              <div className="thumb">{j.artwork ? <img src={j.artwork} alt="" /> : null}</div>
              <div style={{ minWidth: 0 }}>
                <div className="ellipsis" style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>
                  {j.title}
                </div>
                <div className="ellipsis" style={{ color: "var(--text-subdued)" }}>
                  {j.artist}
                </div>
                <div className={`dl-state ${j.status === "error" ? "err" : ""}`}>
                  {j.status === "error" ? j.message : LABEL[j.status]}
                </div>
              </div>
              <div className="bar">
                <div style={{ width: `${j.status === "done" ? 100 : j.progress}%` }} />
              </div>
              <div style={{ display: "grid", placeItems: "center" }}>
                {j.status === "done" && track ? (
                  <button className="icon-btn" onClick={() => playTracks([track.id], 0, track.title)}>
                    <Play size={18} fill="currentColor" />
                  </button>
                ) : j.status === "done" ? (
                  <Check size={18} color="var(--accent)" />
                ) : j.status === "error" ? (
                  <button className="icon-btn" title="재시도" onClick={() => retryDownload(j.jobId)}>
                    <RotateCcw size={18} />
                  </button>
                ) : j.status === "pending" || j.status === "queued" ? (
                  <X size={16} color="var(--text-dim)" style={{ opacity: 0 }} />
                ) : (
                  <Loader2 size={18} className="spin" />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
