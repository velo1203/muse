import { useRef, useState } from "react";

interface Props {
  value: number;
  max: number;
  onChange: (v: number) => void;
  /** Called only on release; when given, onChange just previews while dragging */
  onCommit?: (v: number) => void;
  className?: string;
}

export function Slider({ value, max, onChange, onCommit, className = "" }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const shown = drag ?? value;
  const pct = max > 0 ? Math.min(100, (shown / max) * 100) : 0;

  const valueAt = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * max;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!max) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    const v = valueAt(e.clientX);
    setDrag(v);
    if (!onCommit) onChange(v);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (drag === null) return;
    const v = valueAt(e.clientX);
    setDrag(v);
    if (!onCommit) onChange(v);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (drag === null) return;
    const v = valueAt(e.clientX);
    setDrag(null);
    (onCommit ?? onChange)(v);
  };

  return (
    <div
      ref={ref}
      className={`slider ${drag !== null ? "drag" : ""} ${className}`}
      style={{ "--pct": `${pct}%` } as React.CSSProperties}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <div className="track">
        <div className="fill" />
      </div>
      <div className="knob" />
    </div>
  );
}
