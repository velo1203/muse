import { openPath } from "@tauri-apps/plugin-opener";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderInput } from "lucide-react";
import { importPaths } from "../importFiles";
import { InstallYtdlpButton, installHint, useToolStatus } from "../components/ToolSetup";
import { api } from "../api";
import { useStore } from "../store";
import type { Quality } from "../types";
import { Equalizer } from "../components/Equalizer";
import { Toggle } from "../components/Toggle";
import { Select } from "../components/Select";
import { Slider } from "../components/Slider";
import type { VolumeLevel } from "../engine";

const OPTIONS: { value: Quality; title: string; desc: string; rec?: boolean }[] = [
  {
    value: "best",
    title: "최상 · 원본 그대로",
    desc: "YouTube가 제공하는 가장 높은 비트레이트의 오디오 스트림(보통 Opus ~160kbps)을 재인코딩 없이 그대로 저장합니다. 변환 손실이 없어 가장 음질이 좋습니다.",
    rec: true,
  },
  {
    value: "m4a",
    title: "높음 · AAC",
    desc: "AAC 스트림이 있으면 그대로 받고, 없으면 최고 품질로 AAC 변환합니다. 다른 기기/플레이어와의 호환성이 좋습니다.",
  },
  {
    value: "mp3",
    title: "호환 · MP3",
    desc: "최고 품질 원본을 MP3 최고 VBR 설정으로 변환합니다. 어디서나 재생되지만 재인코딩으로 약간의 손실이 생깁니다.",
  },
];

export function Settings() {
  const { library, setLibrary, playback, setPlayback } = useStore();
  const { tools, refresh } = useToolStatus();

  return (
    <div className="main-scroll">
      <div className="page-pad settings" style={{ maxWidth: 820 }}>
        <div className="greeting" style={{ marginBottom: 8 }}>설정</div>
        <h3>오디오 품질</h3>
        <div className="setting-row">
          <div>
            <div className="t">음질</div>
            <div className="s">{OPTIONS.find((o) => o.value === library.settings.quality)?.desc}</div>
          </div>
          <Select
            width={200}
            value={library.settings.quality}
            onChange={async (v) => setLibrary(await api.setQuality(v))}
            groups={[{ options: OPTIONS.map((o) => ({ value: o.value, label: o.title, hint: o.rec ? "추천" : undefined })) }]}
          />
        </div>
        <h3>재생</h3>
        <div className="setting-row">
          <div>
            <div className="t">곡 크로스페이드</div>
            <div className="s">곡과 곡 사이가 서로 겹치며 자연스럽게 넘어가요.</div>
          </div>
          <div className="row-ctrl">
            <Slider
              className="cf"
              value={playback.crossfade}
              max={12}
              onChange={(v) => setPlayback({ crossfade: Math.round(v) })}
            />
            <span className="val">{playback.crossfade ? `${playback.crossfade}초` : "끔"}</span>
          </div>
        </div>
        <div className="setting-row">
          <div>
            <div className="t">모노 오디오</div>
            <div className="s">좌우 스피커에서 동일한 오디오를 재생합니다.</div>
          </div>
          <Toggle value={playback.mono} onChange={(mono) => setPlayback({ mono })} />
        </div>

        <h3>볼륨</h3>
        <div className="setting-row">
          <div>
            <div className="t">볼륨 표준화</div>
            <div className="s">모든 곡을 같은 크기로 들려줘요. 다운로드할 때 측정한 EBU R128 라우드니스를 기준으로 합니다.</div>
          </div>
          <Toggle value={playback.normalize} onChange={(normalize) => setPlayback({ normalize })} />
        </div>
        <div className={`setting-row ${playback.normalize ? "" : "disabled"}`}>
          <div>
            <div className="t">음량 크기</div>
            <div className="s">크게는 리미터를 사용하므로 음질이 약간 저하될 수 있어요. 작게·보통은 음질에 영향이 없습니다.</div>
          </div>
          <Select
            width={180}
            disabled={!playback.normalize}
            value={playback.volumeLevel}
            onChange={(v) => setPlayback({ volumeLevel: v as VolumeLevel })}
            groups={[
              {
                options: [
                  { value: "quiet", label: "작게", hint: "-19 LUFS" },
                  { value: "normal", label: "보통", hint: "-14 LUFS" },
                  { value: "loud", label: "크게", hint: "-11 LUFS" },
                ],
              },
            ]}
          />
        </div>

        <h3>이퀄라이저</h3>
        <Equalizer />

        <h3>내 음악 파일</h3>
        <div className="setting-row">
          <div>
            <div className="t">음악 파일 가져오기</div>
            <div className="s">
              MP3, M4A, FLAC, WAV 등 갖고 있는 파일을 라이브러리로 복사해요. 태그와 앨범 커버도 함께 읽어요. 파일이나 폴더를 창에
              끌어다 놓아도 돼요.
            </div>
          </div>
          <div className="row-ctrl">
            <button
              className="dl-btn"
              onClick={async () => {
                const picked = await open({
                  multiple: true,
                  filters: [{ name: "오디오", extensions: ["mp3", "m4a", "aac", "flac", "wav", "ogg", "opus", "aiff", "aif"] }],
                });
                if (picked) importPaths(Array.isArray(picked) ? picked : [picked]);
              }}
            >
              <FolderInput size={14} /> 파일 선택
            </button>
            <button
              className="dl-btn"
              onClick={async () => {
                const dir = await open({ directory: true });
                if (typeof dir === "string") importPaths([dir]);
              }}
            >
              폴더 선택
            </button>
          </div>
        </div>

        <h3>도구</h3>
        <div className="setting-row">
          <div>
            <div className="t">yt-dlp</div>
            <div className="s mono">{tools ? tools.ytdlp ?? `설치되지 않음 — ${installHint("yt-dlp")}` : "…"}</div>
          </div>
          {tools && !tools.ytdlp && <InstallYtdlpButton onDone={refresh} />}
        </div>
        <div className="setting-row">
          <div>
            <div className="t">ffmpeg</div>
            <div className="s mono">
              {tools ? tools.ffmpeg ?? `설치되지 않음 — ${installHint("ffmpeg")} (MP3/M4A 변환·볼륨 측정·파일 가져오기에 필요)` : "…"}
            </div>
          </div>
        </div>

        <h3>저장 위치</h3>
        <div className="setting-row">
          <div style={{ minWidth: 0 }}>
            <div className="t">라이브러리 폴더</div>
            <div className="s mono ellipsis">{tools?.libraryDir}</div>
          </div>
          <button className="dl-btn" onClick={() => tools && openPath(tools.libraryDir)}>
            {navigator.userAgent.includes("Windows") ? "탐색기에서 열기" : "Finder에서 열기"}
          </button>
        </div>
      </div>
    </div>
  );
}
