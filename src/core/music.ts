// Background music: one Suno-generated track per stage, in public/music/ next to a .json sidecar that
// records its prompt and download (keep it: it's the commercial-rights record). A looping track plays
// its intro once, then repeats its loop region, crossfading from the loop's end back to its start so
// Suno's fade-out is never heard.

import type { Sfx } from './audio';

export type ThemeId = 'kart' | 'turbo' | 'shell' | 'airace' | 'galaxy' | 'ending';

interface Theme {
  /** File in public/music/. */
  file: string;
  /**
   * Linear gain. The files all master to about -16 LUFS; this brings in-game tracks to about -23
   * (ambient ones -24) before the 0.5 master gain, which keeps the synthesized SFX audible.
   */
  gain: number;
  /** Playback rate. Turbo is the kart track, sped up. */
  rate?: number;
  /**
   * Loop region in file seconds: at `end` the track crossfades into `start`. Both are beat-aligned
   * and a whole number of 4-bar phrases apart, chosen for matching harmony (librosa beat tracking +
   * chroma). Omitted = play once.
   */
  loop?: [start: number, end: number];
  /** Crossfade length in file seconds. */
  xfade?: number;
}

const KART: Theme = { file: 'kart-8cbdfaae.mp3', gain: 0.44, loop: [18.44, 94.6] };

const THEMES: Record<ThemeId, Theme> = {
  kart: KART,
  turbo: { ...KART, rate: 1.26 },
  shell: { file: 'shell-1e8bae6c.mp3', gain: 0.37, loop: [6.27, 156.85] },
  airace: { file: 'airace-e9e866b9.mp3', gain: 0.45, loop: [4.2, 130.36] },
  galaxy: { file: 'galaxy-36132128.mp3', gain: 0.42, loop: [6.59, 167.58], xfade: 5 },
  ending: { file: 'ending-bb48ba20.mp3', gain: 0.7 },
};

/** Default theme for each stage. */
export const STAGE_THEMES: Record<string, ThemeId | null> = {
  kart: 'kart',
  shell: 'shell',
  airace: 'airace',
  galaxy: 'galaxy',
  ending: 'ending',
};

/** Default loop crossfade length (file seconds). */
const XFADE = 2.5;
/** Equal-power crossfade curves. */
const FADE_IN = Float32Array.from({ length: 64 }, (_, i) => Math.sin(((i / 63) * Math.PI) / 2));
const FADE_OUT = FADE_IN.slice().reverse();
/** Decoded tracks are ~70 MB each, so keep only the most recent few. */
const MAX_DECODED = 2;

interface Playing {
  id: ThemeId;
  theme: Theme;
  buf: AudioBuffer;
  /** Fades the whole track in and out; feeds the master bus. */
  bus: GainNode;
  sources: AudioBufferSourceNode[];
  /** Context time at which the next loop segment must start. */
  nextAt: number;
}

export class Music {
  private want: ThemeId | null = null;
  private cur: Playing | null = null;
  private loadingFor: ThemeId | null = null;
  private loadSeq = 0;
  private bytes = new Map<string, Promise<ArrayBuffer>>();
  private decoded = new Map<string, AudioBuffer>();
  private failed = new Set<string>();
  private timer: number;
  private _enabled: boolean;

  constructor(
    private sfx: Sfx,
    enabled: boolean,
  ) {
    this._enabled = enabled;
    this.timer = window.setInterval(() => this.tick(), 250);
  }

  get enabled() {
    return this._enabled;
  }
  set enabled(on: boolean) {
    this._enabled = on;
    if (!on) this.stop();
    this.tick();
  }

  get current(): ThemeId | null {
    return this.want;
  }

  /** Switch themes (null = silence). Fades out the previous theme. */
  play(id: ThemeId | null): void {
    if (id === this.want) return;
    this.want = id;
    this.stop();
    if (id) void this.loadBytes(THEMES[id].file).catch(() => {});
    this.tick();
  }

  private loadBytes(file: string): Promise<ArrayBuffer> {
    let p = this.bytes.get(file);
    if (!p) {
      p = fetch(`music/${file}`).then((r) => {
        if (!r.ok) throw new Error(`${file}: HTTP ${r.status}`);
        return r.arrayBuffer();
      });
      p.catch(() => {
        this.bytes.delete(file);
        this.failed.add(file);
      });
      this.bytes.set(file, p);
    }
    return p;
  }

  private async decode(ctx: AudioContext, file: string): Promise<AudioBuffer> {
    let buf = this.decoded.get(file);
    if (!buf) {
      // decodeAudioData detaches its argument; keep the fetched bytes reusable.
      buf = await ctx.decodeAudioData((await this.loadBytes(file)).slice(0));
    }
    this.decoded.delete(file);
    this.decoded.set(file, buf);
    for (const k of this.decoded.keys()) {
      if (this.decoded.size <= MAX_DECODED) break;
      this.decoded.delete(k);
    }
    return buf;
  }

  private tick(): void {
    const ctx = this.sfx.ctx;
    if (!ctx || !this.sfx.out || ctx.state !== 'running') return;
    const id = this.want;
    if (!this.cur && id && this._enabled && this.loadingFor !== id && !this.failed.has(THEMES[id].file)) void this.start(ctx, id);
    // Schedule the next pass through the loop a few seconds ahead (late if timers were throttled).
    const c = this.cur;
    if (c?.theme.loop && c.nextAt - ctx.currentTime < 4) {
      this.segment(ctx, c, c.theme.loop[0], Math.max(c.nextAt, ctx.currentTime + 0.05), true);
    }
  }

  private async start(ctx: AudioContext, id: ThemeId): Promise<void> {
    const seq = ++this.loadSeq;
    this.loadingFor = id;
    const theme = THEMES[id];
    let buf: AudioBuffer;
    try {
      buf = await this.decode(ctx, theme.file);
    } catch {
      this.failed.add(theme.file);
      return;
    } finally {
      if (seq === this.loadSeq) this.loadingFor = null;
    }
    const out = this.sfx.out;
    if (seq !== this.loadSeq || this.want !== id || this.cur || !this._enabled || !out) return;
    const now = ctx.currentTime;
    const bus = ctx.createGain();
    bus.gain.setValueAtTime(0, now);
    bus.gain.linearRampToValueAtTime(theme.gain, now + 0.5);
    bus.connect(out);
    this.cur = { id, theme, buf, bus, sources: [], nextAt: Infinity };
    this.segment(ctx, this.cur, 0, now + 0.05, false);
  }

  /** Play the track from file offset `from` at context time `at`, through its loop's crossfade out. */
  private segment(ctx: AudioContext, c: Playing, from: number, at: number, fadeIn: boolean): void {
    const rate = c.theme.rate ?? 1;
    const fade = (c.theme.xfade ?? XFADE) / rate;
    const src = ctx.createBufferSource();
    src.buffer = c.buf;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    src.connect(g).connect(c.bus);
    if (fadeIn) g.gain.setValueCurveAtTime(FADE_IN, at, fade);
    src.start(at, from);
    c.nextAt = Infinity;
    if (c.theme.loop) {
      const fadeAt = at + (c.theme.loop[1] - from) / rate;
      g.gain.setValueCurveAtTime(FADE_OUT, fadeAt, fade);
      src.stop(fadeAt + fade + 0.05);
      c.nextAt = fadeAt;
    }
    c.sources.push(src);
    src.onended = () => {
      c.sources = c.sources.filter((s) => s !== src);
      g.disconnect();
    };
  }

  /** Fade out and discard whatever is playing. */
  private stop(): void {
    this.loadSeq++;
    this.loadingFor = null;
    const c = this.cur;
    this.cur = null;
    const ctx = this.sfx.ctx;
    if (!c || !ctx) return;
    const now = ctx.currentTime;
    c.bus.gain.cancelScheduledValues(now);
    c.bus.gain.setValueAtTime(c.bus.gain.value, now);
    c.bus.gain.setTargetAtTime(0, now, 0.3);
    for (const s of c.sources) {
      try {
        s.stop(now + 2);
      } catch {
        /* already stopped */
      }
    }
    setTimeout(() => c.bus.disconnect(), 2100);
  }

  dispose(): void {
    clearInterval(this.timer);
    this.stop();
  }
}
