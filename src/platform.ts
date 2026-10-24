/** Running inside the Android app (WebView) rather than on desktop. */
export const isAndroid = navigator.userAgent.includes("Android");
export const isMobile = isAndroid;

/** Native bridge exposed by MainActivity (Android only). */
interface MuseAndroid {
  insets(): string;
  mediaUpdate(json: string): void;
  mediaStop(): void;
  /** Returns a control that arrived before the page was ready ("" if none). */
  ready(): string;
  /** Lets Android Auto refresh its library lists. */
  libraryChanged(): void;
}

export const native: MuseAndroid | undefined = (window as unknown as { MuseAndroid?: MuseAndroid }).MuseAndroid;

/** Applies system bar insets (status bar, gesture bar, cutout) as CSS variables. */
export function applyInsets(i: { top: number; bottom: number; left: number; right: number }) {
  const s = document.documentElement.style;
  s.setProperty("--safe-top", `${i.top}px`);
  s.setProperty("--safe-bottom", `${i.bottom}px`);
  s.setProperty("--safe-left", `${i.left}px`);
  s.setProperty("--safe-right", `${i.right}px`);
}
