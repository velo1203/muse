import { useEffect, useState } from "react";
import { Loader2, RotateCcw, Wrench } from "lucide-react";
import { api } from "../api";
import { useStore } from "../store";
import type { ToolStatus } from "../types";

export const isWindows = navigator.userAgent.includes("Windows");

/** Shell command that installs the external tools on this OS (manual fallback). */
export const installHint = (tool: "yt-dlp" | "ffmpeg") =>
  isWindows ? `winget install ${tool === "yt-dlp" ? "yt-dlp.yt-dlp" : "Gyan.FFmpeg"}` : `brew install ${tool}`;

export function useToolStatus() {
  const [tools, setTools] = useState<ToolStatus | null>(null);
  const events = useStore((s) => s.tools);
  const refresh = () => api.toolStatus().then(setTools);
  useEffect(() => {
    refresh();
  }, [events["yt-dlp"]?.stage, events.ffmpeg?.stage]);
  return { tools, refresh };
}

/** Re-runs the automatic install (only needed if it failed, e.g. offline on first launch). */
export function RetryToolsButton() {
  const showToast = useStore((s) => s.showToast);
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="btn btn-secondary btn-sm"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await api.installTools();
          showToast("필요한 도구를 설치했어요");
        } catch (e) {
          showToast(String(e));
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? <Loader2 size={14} className="spin" /> : <RotateCcw size={14} />} {busy ? "설치 중…" : "다시 설치"}
    </button>
  );
}

const LABEL = { "yt-dlp": "음원 다운로더", ffmpeg: "오디오 변환 도구" };

/** Small status card shown while yt-dlp / ffmpeg install in the background. */
export function ToolInstallStatus() {
  const tools = useStore((s) => s.tools);
  const active = Object.values(tools).find((t) => t && (t.stage === "downloading" || t.stage === "installing"));
  const failed = Object.values(tools).find((t) => t?.stage === "error");
  if (!active && !failed) return null;
  if (active)
    return (
      <div className="tool-status">
        <div className="tool-status-row">
          <Loader2 size={14} className="spin" />
          <span>
            {LABEL[active.tool]} 설치 중 {active.stage === "downloading" ? `${Math.round(active.progress)}%` : "…"}
          </span>
        </div>
        <div className="bar">
          <div style={{ width: `${active.stage === "downloading" ? active.progress : 100}%` }} />
        </div>
        <div className="tool-status-sub">처음 한 번만 자동으로 준비돼요</div>
      </div>
    );
  return (
    <div className="tool-status err">
      <div className="tool-status-row">
        <Wrench size={14} />
        <span>{LABEL[failed!.tool]} 설치에 실패했어요</span>
      </div>
      <div className="tool-status-sub">인터넷 연결을 확인한 뒤 다시 시도해주세요.</div>
      <RetryToolsButton />
    </div>
  );
}
