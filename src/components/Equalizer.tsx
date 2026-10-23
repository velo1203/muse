import { useRef, useState } from "react";
import { RotateCcw, Save, Trash2 } from "lucide-react";
import { EQ_BANDS, EQ_PRESETS } from "../engine";
import { useStore } from "../store";
import { Toggle } from "./Toggle";
import { Select } from "./Select";

const W = 640;
const H = 220;
const PAD_X = 40;
const PAD_Y = 22;
const MAX_DB = 12;
const VIEW_H = H + 26;

const xOf = (i: number) => PAD_X + (i * (W - PAD_X * 2)) / (EQ_BANDS.length - 1);
const yOf = (db: number) => PAD_Y + ((MAX_DB - db) / (MAX_DB * 2)) * (H - PAD_Y * 2);
const dbOf = (y: number) => {
  const db = MAX_DB - ((y - PAD_Y) / (H - PAD_Y * 2)) * MAX_DB * 2;
  return Math.round(Math.max(-MAX_DB, Math.min(MAX_DB, db)) * 10) / 10;
};
const freqLabel = (f: number) => (f >= 1000 ? `${f / 1000}kHz` : `${f}Hz`);

/** Smooth path through the band points (Catmull-Rom → cubic Bézier). */
function curvePath(pts: [number, number][]) {
  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C ${c1[0]} ${c1[1]}, ${c2[0]} ${c2[1]}, ${p2[0]} ${p2[1]}`;
  }
  return d;
}

export function Equalizer() {
  const { playback, setPlayback, applyEqPreset, showToast } = useStore();
  const svg = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const gains = playback.eqGains;
  const on = playback.eqEnabled;

  const setGainAt = (i: number, clientY: number) => {
    const r = svg.current!.getBoundingClientRect();
    // The viewBox is VIEW_H tall (graph + frequency labels), not just the graph
    const y = ((clientY - r.top) / r.height) * VIEW_H;
    const next = [...gains];
    next[i] = dbOf(y);
    setPlayback({ eqGains: next, eqPreset: "custom", eqEnabled: true, eqEditedFrom: editedFrom });
  };

  const pts = gains.map((g, i) => [xOf(i), yOf(g)] as [number, number]);
  const line = curvePath(pts);
  const area = `${line} L ${xOf(EQ_BANDS.length - 1)} ${yOf(-MAX_DB)} L ${xOf(0)} ${yOf(-MAX_DB)} Z`;
  const isCustomSaved = playback.customPresets.some((c) => c.name === playback.eqPreset);
  // Which of the user's presets this curve belongs to (selected, or the one it was edited from)
  const editedFrom = isCustomSaved ? playback.eqPreset : playback.eqEditedFrom;
  const builtinNames = new Set(Object.entries(EQ_PRESETS).flatMap(([k, p]) => [k, p.label]));

  const save = () => {
    const n = name.trim();
    if (!n) return showToast("사전 설정 이름은 필수 입력 항목입니다");
    if (builtinNames.has(n)) return showToast("기본 사전 설정과 같은 이름은 쓸 수 없어요");
    const exists = playback.customPresets.some((c) => c.name === n);
    const customPresets = exists
      ? playback.customPresets.map((c) => (c.name === n ? { name: n, gains: [...gains] } : c))
      : [...playback.customPresets, { name: n, gains: [...gains] }];
    setPlayback({ customPresets, eqPreset: n, eqEditedFrom: null });
    showToast(exists ? `'${n}' 사전 설정을 수정했어요` : `'${n}' 사전 설정을 저장했어요`);
    setSaving(false);
    setName("");
  };

  const willOverwrite = playback.customPresets.some((c) => c.name === name.trim());

  return (
    <div className={`eq-card ${on ? "" : "off"}`}>
      <div className="eq-top">
        <div>
          <div className="t">이퀄라이저</div>
          <div className="s">곡이 재생되는 방식을 조정하세요. 6개 대역 · ±12dB</div>
        </div>
        <Toggle value={on} onChange={(v) => setPlayback({ eqEnabled: v })} />
      </div>
      <div className="eq-controls">
        <label className="s">사전 설정</label>
        <Select
          value={playback.eqPreset}
          onChange={applyEqPreset}
          placeholder="수동"
          groups={[
            ...(playback.eqPreset === "custom" ? [{ options: [{ value: "custom", label: "수동" }] }] : []),
            ...(playback.customPresets.length
              ? [{ label: "맞춤 사전 설정", options: playback.customPresets.map((c) => ({ value: c.name, label: c.name })) }]
              : []),
            { label: "사전 설정", options: Object.entries(EQ_PRESETS).map(([k, p]) => ({ value: k, label: p.label })) },
          ]}
        />
        <div style={{ flex: 1 }} />
        {playback.eqPreset === "custom" && (
          <button
            className="dl-btn"
            onClick={() => {
              setName(editedFrom ?? "");
              setSaving(true);
            }}
          >
            <Save size={14} /> {editedFrom ? `'${editedFrom}' 수정 저장` : "사전 설정 저장"}
          </button>
        )}
        {isCustomSaved && (
          <button
            className="dl-btn"
            onClick={() =>
              setPlayback({
                customPresets: playback.customPresets.filter((c) => c.name !== playback.eqPreset),
                eqPreset: "custom",
              })
            }
          >
            <Trash2 size={14} /> 사전 설정 삭제
          </button>
        )}
        <button className="dl-btn" onClick={() => applyEqPreset("flat")}>
          <RotateCcw size={14} /> 재설정
        </button>
      </div>
      {saving && (
        <div className="eq-save">
          <input
            autoFocus
            placeholder="사전 설정 이름을 입력하세요"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
              if (e.key === "Escape") setSaving(false);
            }}
          />
          <button className="btn btn-primary btn-sm" onClick={save}>
            {willOverwrite ? "덮어쓰기" : "저장하기"}
          </button>
          <button className="btn btn-tertiary btn-sm" onClick={() => setSaving(false)}>
            취소
          </button>
        </div>
      )}
      <svg
        ref={svg}
        viewBox={`0 0 ${W} ${VIEW_H}`}
        className="eq-graph"
        onPointerMove={(e) => drag !== null && setGainAt(drag, e.clientY)}
        onPointerUp={() => setDrag(null)}
        onPointerLeave={() => setDrag(null)}
      >
        {[-12, -6, 0, 6, 12].map((db) => (
          <g key={db}>
            <line x1={PAD_X} x2={W - PAD_X} y1={yOf(db)} y2={yOf(db)} className={db === 0 ? "eq-zero" : "eq-grid"} />
            <text x={PAD_X - 10} y={yOf(db) + 4} className="eq-db" textAnchor="end">
              {db > 0 ? `+${db}` : db}
            </text>
          </g>
        ))}
        <path d={area} className="eq-area" />
        <path d={line} fill="none" className="eq-line" strokeWidth="3" strokeLinecap="round" />
        {pts.map(([x, y], i) => (
          <g key={i}>
            <line x1={x} x2={x} y1={PAD_Y} y2={H - PAD_Y} className="eq-grid" />
            {/* larger invisible hit area */}
            <circle
              cx={x} cy={y} r={18} fill="transparent" style={{ cursor: "ns-resize" }}
              onPointerDown={(e) => {
                (e.target as Element).setPointerCapture(e.pointerId);
                setDrag(i);
                setGainAt(i, e.clientY);
              }}
              onDoubleClick={() => {
                const next = [...gains];
                next[i] = 0;
                setPlayback({ eqGains: next, eqPreset: "custom" });
              }}
            />
            <circle cx={x} cy={y} r={drag === i ? 9 : 7} className="eq-knob" pointerEvents="none" />
            {drag === i && (
              <text x={x} y={y - 16} textAnchor="middle" className="eq-val">
                {gains[i] > 0 ? "+" : ""}
                {gains[i].toFixed(1)}dB
              </text>
            )}
            <text x={x} y={H + 16} textAnchor="middle" className="eq-freq">
              {freqLabel(EQ_BANDS[i])}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
