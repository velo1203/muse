import { useCallback, useEffect, useRef, useState } from "react";
import { isMobile } from "../platform";

/** How long sheets / the player take to slide away (matches mobile.css). */
export const CLOSE_MS = 220;

/**
 * Keeps showing the last non-null `value` for a moment after it becomes null, with
 * `closing` set, so the element can animate out before it unmounts.
 */
export function usePresence<T>(value: T | null, ms = CLOSE_MS): { shown: T | null; closing: boolean } {
  const [shown, setShown] = useState(value);
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    if (value !== null) {
      setShown(value);
      setClosing(false);
      return;
    }
    if (shown === null) return;
    setClosing(true);
    const t = setTimeout(() => {
      setShown(null);
      setClosing(false);
    }, ms);
    return () => clearTimeout(t);
  }, [value]);
  return { shown, closing };
}

/**
 * Wraps a sheet's `onClose` so on phones it first plays the slide-down animation.
 * Returns whether it's closing (for the CSS class) and the delayed close function.
 */
export function useSheetClose(onClose: () => void): [boolean, () => void] {
  const [closing, setClosing] = useState(false);
  const latest = useRef(onClose);
  latest.current = onClose;
  const close = useCallback(() => {
    if (!isMobile) return latest.current();
    setClosing((was) => {
      if (!was) setTimeout(() => latest.current(), CLOSE_MS);
      return true;
    });
  }, []);
  return [closing, close];
}

/** Restarts the "pop" animation on a heart button when it's tapped. */
export function pop(el: HTMLElement) {
  el.classList.remove("pop");
  // Force a reflow so re-adding the class restarts the animation
  void el.offsetWidth;
  el.classList.add("pop");
}

/**
 * Drag-to-dismiss downwards (the full-screen player). Moves `ref` with the finger and calls
 * `onDismiss` when pulled far or flicked; otherwise springs back.
 */
export function usePullDown(onDismiss: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const start = useRef<{ y: number; t: number } | null>(null);
  const dy = useRef(0);

  const set = (y: number, animate: boolean) => {
    const el = ref.current;
    if (!el) return;
    el.style.transition = animate ? `transform ${CLOSE_MS}ms cubic-bezier(.3,0,0,1)` : "none";
    el.style.transform = y ? `translateY(${y}px)` : "";
  };

  return {
    ref,
    handlers: {
      onTouchStart: (e: React.TouchEvent) => {
        start.current = { y: e.touches[0].clientY, t: Date.now() };
        dy.current = 0;
      },
      onTouchMove: (e: React.TouchEvent) => {
        if (!start.current) return;
        dy.current = Math.max(0, e.touches[0].clientY - start.current.y);
        set(dy.current, false);
      },
      onTouchEnd: () => {
        if (!start.current) return;
        const speed = dy.current / Math.max(1, Date.now() - start.current.t);
        start.current = null;
        const el = ref.current;
        if (el && (dy.current > 140 || (dy.current > 50 && speed > 0.6))) {
          // Hand over to the CSS close animation, starting where the finger let go
          el.style.setProperty("--drag", `${dy.current}px`);
          set(0, false);
          onDismiss();
          setTimeout(() => el.style.removeProperty("--drag"), CLOSE_MS + 50);
        } else set(0, true);
      },
    },
  };
}

/**
 * Horizontal swipe on the mini player: left → next, right → previous. The content follows the
 * finger, slides out on success and comes back in. `wasDrag()` lets the tap handler ignore swipes.
 */
export function useSwipeX(onLeft: () => void, onRight: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; y: number; t: number } | null>(null);
  const dx = useRef(0);
  const dragged = useRef(false);
  const horizontal = useRef<boolean | null>(null);

  const set = (x: number, animate: boolean, opacity = 1) => {
    const el = ref.current;
    if (!el) return;
    el.style.transition = animate ? "transform 180ms cubic-bezier(.3,0,0,1), opacity 180ms" : "none";
    el.style.transform = x ? `translateX(${x}px)` : "";
    el.style.opacity = String(opacity);
  };

  return {
    ref,
    wasDrag: () => dragged.current,
    handlers: {
      onTouchStart: (e: React.TouchEvent) => {
        start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() };
        dx.current = 0;
        dragged.current = false;
        horizontal.current = null;
      },
      onTouchMove: (e: React.TouchEvent) => {
        if (!start.current) return;
        const mx = e.touches[0].clientX - start.current.x;
        const my = e.touches[0].clientY - start.current.y;
        // Decide once whether this is a sideways swipe or a vertical scroll
        if (horizontal.current === null && Math.abs(mx) + Math.abs(my) > 8) horizontal.current = Math.abs(mx) > Math.abs(my);
        if (!horizontal.current) return;
        dragged.current = true;
        dx.current = mx;
        set(mx, false, 1 - Math.min(0.6, Math.abs(mx) / 300));
      },
      onTouchEnd: () => {
        if (!start.current) return;
        const speed = Math.abs(dx.current) / Math.max(1, Date.now() - start.current.t);
        start.current = null;
        const go = Math.abs(dx.current) > 80 || (Math.abs(dx.current) > 30 && speed > 0.5);
        if (!dragged.current || !go) return set(0, true);
        const dir = dx.current < 0 ? -1 : 1;
        set(dir * window.innerWidth * 0.6, true, 0);
        setTimeout(() => {
          (dir < 0 ? onLeft : onRight)();
          // Enter the new song from the opposite side
          set(-dir * 60, false, 0);
          requestAnimationFrame(() => set(0, true, 1));
        }, 180);
      },
    },
  };
}
