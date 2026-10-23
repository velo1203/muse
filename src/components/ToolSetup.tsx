import { useEffect, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { api } from "../api";
import { useStore } from "../store";
import type { ToolStatus } from "../types";

export const isWindows = navigator.userAgent.includes("Windows");

/** Shell command that installs the external tools on this OS. */
export const installHint = (tool: "yt-dlp" | "ffmpeg") =>
  isWindows ? `winget install ${tool === "yt-dlp" ? "yt-dlp.yt-dlp" : "Gyan.FFmpeg"}` : `brew install ${tool}`;

export function useToolStatus() {
  const [tools, setTools] = useState<ToolStatus | null>(null);
  const refresh = () => api.toolStatus().then(setTools);
  useEffect(() => {
    refresh();
  }, []);
  return { tools, refresh };
}

/** One-click yt-dlp download into the app's own tools folder. */
export function InstallYtdlpButton({ onDone }: { onDone: () => void }) {
  const showToast = useStore((s) => s.showToast);
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="btn btn-primary btn-sm"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await api.installYtdlp();
          showToast("yt-dlp를 설치했어요");
          onDone();
        } catch (e) {
          showToast(String(e));
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? <Loader2 size={14} className="spin" /> : <Download size={14} />} {busy ? "설치 중…" : "yt-dlp 자동 설치"}
    </button>
  );
}
