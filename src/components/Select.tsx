import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

export interface SelectOption {
  value: string;
  label: string;
  hint?: string;
}

export interface SelectGroup {
  label?: string;
  options: SelectOption[];
}

interface Props {
  value: string;
  groups: SelectGroup[];
  onChange: (value: string) => void;
  disabled?: boolean;
  /** Shown when `value` matches no option */
  placeholder?: string;
  width?: number;
}

/** App-styled dropdown replacing the native <select>, with groups and keyboard support. */
export function Select({ value, groups, onChange, disabled, placeholder = "선택", width = 200 }: Props) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [up, setUp] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const flat = groups.flatMap((g) => g.options);
  const selected = flat.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    setActive(flat.findIndex((o) => o.value === value));
    const close = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const blur = () => setOpen(false);
    window.addEventListener("mousedown", close);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("blur", blur);
    };
  }, [open]);

  // Open upward when there isn't room below
  useLayoutEffect(() => {
    if (!open || !root.current) return;
    const r = root.current.getBoundingClientRect();
    setUp(window.innerHeight - r.bottom < 300 && r.top > window.innerHeight - r.bottom);
  }, [open]);

  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (!open && ["Enter", " ", "ArrowDown", "ArrowUp"].includes(e.key)) {
      e.preventDefault();
      setOpen(true);
      return;
    }
    if (!open) return;
    if (e.key === "Escape") setOpen(false);
    else if (e.key === "ArrowDown") setActive((i) => Math.min(flat.length - 1, i + 1));
    else if (e.key === "ArrowUp") setActive((i) => Math.max(0, i - 1));
    else if (e.key === "Enter" && flat[active]) pick(flat[active].value);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  let i = -1;
  return (
    <div className={`sel ${open ? "open" : ""} ${disabled ? "disabled" : ""}`} ref={root} style={{ width }}>
      <button
        type="button"
        className="sel-btn"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onKey}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="sel-value">{selected?.label ?? placeholder}</span>
        <ChevronDown size={15} className="sel-chev" />
      </button>
      {open && (
        <div className={`sel-menu ${up ? "up" : ""}`} ref={list} role="listbox">
          {groups.map((g, gi) => (
            <div key={gi} className="sel-group">
              {g.label && <div className="sel-label">{g.label}</div>}
              {g.options.map((o) => {
                i++;
                const idx = i;
                const on = o.value === value;
                return (
                  <button
                    key={o.value}
                    type="button"
                    role="option"
                    aria-selected={on}
                    data-i={idx}
                    className={`sel-opt ${on ? "on" : ""} ${idx === active ? "active" : ""}`}
                    onMouseEnter={() => setActive(idx)}
                    onClick={() => pick(o.value)}
                  >
                    <span className="sel-opt-label">{o.label}</span>
                    {o.hint && <span className="sel-hint">{o.hint}</span>}
                    {on && <Check size={14} className="sel-check" />}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
