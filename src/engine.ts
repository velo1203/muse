/**
 * Web Audio playback engine.
 *
 * Two decks (one <audio> each) feed a shared chain so tracks can crossfade:
 *   deck A ─┐
 *           ├─ mix ─ mono? ─ 6-band EQ ─ normalize gain ─ limiter ─ master volume ─ out
 *   deck B ─┘
 */

export const EQ_BANDS = [60, 150, 400, 1000, 2400, 15000] as const;

export const EQ_PRESETS: Record<string, { label: string; gains: number[] }> = {
  flat: { label: "플랫", gains: [0, 0, 0, 0, 0, 0] },
  acoustic: { label: "어쿠스틱", gains: [4, 3, 1, 1.5, 3, 2.5] },
  bassBooster: { label: "베이스 부스터", gains: [6, 4.5, 2, 0, 0, 0] },
  bassReducer: { label: "베이스 리듀서", gains: [-6, -4.5, -2, 0, 0, 0] },
  classical: { label: "클래식", gains: [4, 3, -1, -1, 2, 4] },
  dance: { label: "댄스", gains: [4.5, 5.5, 1, 0, 3, 3.5] },
  deep: { label: "딥", gains: [5, 3, 1.5, 0.5, -2, -4.5] },
  electronic: { label: "일렉트로닉", gains: [4.5, 3.5, -1, 1.5, 2, 4.5] },
  hiphop: { label: "힙합", gains: [5, 4, 1, -1, 1, 2.5] },
  jazz: { label: "재즈", gains: [4, 2.5, 1.5, -1.5, 1.5, 3.5] },
  latin: { label: "라틴", gains: [4.5, 2.5, 0, -1, 2, 4] },
  loudness: { label: "라우드니스", gains: [6, 3.5, 0, -1.5, 1, 5] },
  lounge: { label: "라운지", gains: [-3, -1, 0.5, 1.5, 1, -1] },
  piano: { label: "피아노", gains: [3, 2, 0, 2.5, 3, 3.5] },
  pop: { label: "팝", gains: [-1.5, -0.5, 1.5, 3.5, 1.5, -1] },
  rnb: { label: "R&B", gains: [3, 6.5, 1.5, -1.5, 2.5, 3] },
  rock: { label: "록", gains: [5, 3.5, -0.5, -1, 2.5, 4.5] },
  smallSpeakers: { label: "스몰 스피커", gains: [5.5, 4, 3, 1.5, -1, -3] },
  spokenWord: { label: "스포큰 워드", gains: [-3.5, -0.5, 1.5, 4, 3.5, 0] },
  trebleBooster: { label: "트레블 부스터", gains: [0, 0, 0, 2, 4, 6] },
  trebleReducer: { label: "트레블 리듀서", gains: [0, 0, 0, -2, -4, -6] },
  vocalBooster: { label: "보컬 부스터", gains: [-2, -3, 2, 4.5, 3, 0] },
};

/** Target integrated loudness (LUFS) per volume level */
export const LOUDNESS_TARGETS = { quiet: -19, normal: -14, loud: -11 } as const;
export type VolumeLevel = keyof typeof LOUDNESS_TARGETS;

interface Deck {
  el: HTMLAudioElement;
  gain: GainNode;
}

type Listener = (deck: HTMLAudioElement) => void;

export class Engine {
  private ctx: AudioContext;
  private decks: [Deck, Deck];
  private active = 0;
  private monoNode: GainNode;
  private stereoIn: GainNode;
  private filters: BiquadFilterNode[];
  private normGain: GainNode;
  private limiter: DynamicsCompressorNode;
  private master: GainNode;
  private fadeTimer: number | undefined;
  private listeners: Record<string, Listener[]> = {};
  private volume = 1;
  private muted = false;
  private mono = false;

  constructor() {
    this.ctx = new AudioContext();
    this.stereoIn = this.ctx.createGain();
    // A 1-channel node with "speakers" interpretation downmixes L+R; later nodes upmix back.
    this.monoNode = this.ctx.createGain();
    this.monoNode.channelCount = 1;
    this.monoNode.channelCountMode = "explicit";
    this.monoNode.channelInterpretation = "speakers";

    this.filters = EQ_BANDS.map((f, i) => {
      const b = this.ctx.createBiquadFilter();
      b.type = i === 0 ? "lowshelf" : i === EQ_BANDS.length - 1 ? "highshelf" : "peaking";
      b.frequency.value = f;
      b.Q.value = 1.1;
      b.gain.value = 0;
      return b;
    });
    this.normGain = this.ctx.createGain();
    this.limiter = this.ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -1;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.15;
    this.master = this.ctx.createGain();

    this.filters.reduce<AudioNode>((prev, f) => (prev.connect(f), f), this.stereoIn);
    this.filters[this.filters.length - 1].connect(this.normGain);
    this.normGain.connect(this.limiter).connect(this.master).connect(this.ctx.destination);

    this.decks = [this.makeDeck(), this.makeDeck()];
  }

  private makeDeck(): Deck {
    const el = new Audio();
    el.preload = "auto";
    // Needed for Web Audio to read asset:// media (served with CORS headers)
    el.crossOrigin = "anonymous";
    const src = this.ctx.createMediaElementSource(el);
    const gain = this.ctx.createGain();
    src.connect(gain).connect(this.stereoIn);
    for (const ev of ["timeupdate", "durationchange", "play", "pause", "ended", "error"]) {
      el.addEventListener(ev, () => {
        if (el === this.el) this.listeners[ev]?.forEach((l) => l(el));
      });
    }
    return { el, gain };
  }

  on(ev: string, l: Listener) {
    (this.listeners[ev] ??= []).push(l);
  }

  get el() {
    return this.decks[this.active].el;
  }

  private resume() {
    if (this.ctx.state === "suspended") this.ctx.resume();
  }

  /** Hard switch to a new source on the active deck, optionally resuming at `startAt` seconds. */
  load(src: string, autoplay: boolean, startAt = 0) {
    this.cancelFade();
    const other = this.decks[1 - this.active];
    other.el.pause();
    other.gain.gain.value = 0;
    const deck = this.decks[this.active];
    deck.gain.gain.cancelScheduledValues(0);
    deck.gain.gain.value = 1;
    deck.el.src = src;
    if (startAt > 0) {
      deck.el.addEventListener("loadedmetadata", () => (deck.el.currentTime = startAt), { once: true });
    }
    if (autoplay) return this.play();
    return Promise.resolve();
  }

  /** Starts `src` on the idle deck and fades between the two over `secs`. */
  crossfadeTo(src: string, secs: number) {
    this.resume();
    this.cancelFade();
    const from = this.decks[this.active];
    this.active = 1 - this.active;
    const to = this.decks[this.active];
    const now = this.ctx.currentTime;
    to.el.src = src;
    to.gain.gain.cancelScheduledValues(now);
    to.gain.gain.setValueAtTime(0, now);
    to.gain.gain.linearRampToValueAtTime(1, now + secs);
    from.gain.gain.cancelScheduledValues(now);
    from.gain.gain.setValueAtTime(from.gain.gain.value, now);
    from.gain.gain.linearRampToValueAtTime(0, now + secs);
    this.fadeTimer = window.setTimeout(() => from.el.pause(), secs * 1000 + 50);
    return to.el.play();
  }

  private cancelFade() {
    clearTimeout(this.fadeTimer);
  }

  play() {
    this.resume();
    return this.el.play();
  }

  pause() {
    // Pausing mid-crossfade should silence both decks
    this.decks.forEach((d) => d.el.pause());
  }

  /** Gently lowers the volume to silence over `secs`, then pauses (sleep timer). */
  fadeOutAndPause(secs: number) {
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.linearRampToValueAtTime(0, now + secs);
    window.setTimeout(() => {
      this.pause();
      this.applyMaster();
    }, secs * 1000);
  }

  seek(t: number) {
    this.el.currentTime = t;
  }

  setVolume(v: number) {
    this.volume = v;
    this.applyMaster();
  }

  setMuted(m: boolean) {
    this.muted = m;
    this.applyMaster();
  }

  private applyMaster() {
    // Perceptual curve so the slider feels linear
    const v = this.muted ? 0 : this.volume ** 2;
    this.glide(this.master.gain, v, 0.02);
  }

  /**
   * Glides `param` to `value` starting now. Earlier automation is dropped first: dragging an EQ
   * knob fires dozens of updates a second, and letting them pile up on the timeline makes
   * WebKit's audio thread lag behind (or skip) the latest value.
   */
  private glide(param: AudioParam, value: number, timeConstant: number) {
    const now = this.ctx.currentTime;
    const from = param.value;
    param.cancelScheduledValues(0);
    param.setValueAtTime(from, now);
    param.setTargetAtTime(value, now, timeConstant);
  }

  setEq(enabled: boolean, gains: number[]) {
    this.filters.forEach((f, i) => this.glide(f.gain, enabled ? gains[i] ?? 0 : 0, 0.03));
  }

  setMono(mono: boolean) {
    // Rewiring the graph mid-playback glitches, so only do it when the setting actually changes
    if (mono === this.mono) return;
    this.mono = mono;
    for (const d of this.decks) {
      d.gain.disconnect();
      if (mono) d.gain.connect(this.monoNode);
      else d.gain.connect(this.stereoIn);
    }
    this.monoNode.disconnect();
    if (mono) this.monoNode.connect(this.stereoIn);
  }

  /** Gain (dB) applied to reach the target loudness; null disables normalization. */
  setNormalization(gainDb: number | null) {
    const lin = gainDb === null ? 1 : 10 ** (gainDb / 20);
    this.glide(this.normGain.gain, lin, 0.05);
  }
}
