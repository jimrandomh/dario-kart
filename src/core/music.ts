// Procedural background music: a tiny step sequencer with one theme per stage.

import type { Sfx } from './audio';

export type ThemeId = 'kart' | 'turbo' | 'shell' | 'airace' | 'galaxy' | 'ending';

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

interface Theme {
  bpm: number;
  /** Steps per bar (16ths). */
  steps: number;
  /** Total steps before looping. */
  length: number;
  play(step: number, t: number, v: Voices): void;
}

interface Voices {
  note(midi: number, t: number, dur: number, type: OscillatorType, vol: number, opts?: { attack?: number; filter?: number; detune?: number; vibrato?: number }): void;
  kick(t: number, vol?: number): void;
  snare(t: number, vol?: number): void;
  hat(t: number, vol?: number, open?: boolean): void;
  stepDur: number;
}

// Chord roots (MIDI) and qualities for progressions.
const CH = {
  C: [48, 52, 55],
  G: [43, 47, 50],
  Am: [45, 48, 52],
  F: [41, 45, 48],
  Dm: [50, 53, 57],
  E: [40, 44, 47],
  Em: [40, 43, 47],
  Bb: [46, 50, 53],
};

// --- Dario Kart: bouncy I–V–vi–IV chiptune ------------------------------------------------------
const KART_PROG = [CH.C, CH.G, CH.Am, CH.F, CH.C, CH.G, CH.F, CH.G];
const KART_LEAD = [
  [76, 0, 79, 0, 84, 0, 83, 0, 79, 0, 76, 0, 79, 0, 0, 0],
  [74, 0, 79, 0, 83, 0, 81, 0, 79, 0, 74, 0, 71, 0, 0, 0],
  [72, 0, 76, 0, 81, 0, 79, 0, 76, 0, 72, 0, 76, 0, 79, 0],
  [77, 0, 76, 0, 74, 0, 72, 0, 74, 0, 76, 0, 74, 0, 0, 0],
  [76, 0, 79, 0, 84, 0, 86, 0, 88, 0, 86, 0, 84, 0, 0, 0],
  [83, 0, 81, 0, 79, 0, 81, 0, 83, 0, 0, 79, 0, 0, 0, 0],
  [81, 0, 79, 0, 77, 0, 76, 0, 77, 0, 81, 0, 84, 0, 0, 0],
  [83, 0, 0, 0, 79, 0, 0, 0, 74, 0, 76, 0, 77, 0, 79, 0],
];

function kartTheme(bpm: number): Theme {
  return {
    bpm,
    steps: 16,
    length: 16 * 8,
    play(step, t, v) {
      const bar = Math.floor(step / 16) % 8;
      const s = step % 16;
      const chord = KART_PROG[bar];
      if (s % 2 === 0) v.note(chord[0] - 12 + (s % 4 === 2 ? 12 : 0), t, v.stepDur * 1.6, 'triangle', 0.22);
      v.note(chord[s % 3] + 24, t, v.stepDur * 0.8, 'square', 0.035, { filter: 3000 });
      const m = KART_LEAD[bar][s];
      if (m) v.note(m, t, v.stepDur * 1.8, 'square', 0.07, { filter: 4500, vibrato: 4 });
      if (s === 0 || s === 8 || s === 10) v.kick(t);
      if (s === 4 || s === 12) v.snare(t);
      if (s % 2 === 0) v.hat(t, 0.05);
    },
  };
}

// --- Shell: server-room hum with sparse blips ----------------------------------------------------
const shellTheme: Theme = {
  bpm: 60,
  steps: 16,
  length: 16 * 4,
  play(step, t, v) {
    const s = step % 64;
    if (s === 0) {
      v.note(33, t, v.stepDur * 64, 'sine', 0.12, { attack: 3 });
      v.note(45, t, v.stepDur * 64, 'triangle', 0.03, { attack: 4, filter: 400 });
    }
    if (s === 32) v.note(40, t, v.stepDur * 32, 'sine', 0.04, { attack: 3 });
    if (Math.random() < 0.06) v.note(84 + Math.floor(Math.random() * 12), t, 0.05, 'sine', 0.02);
  },
};

// --- AI race: tense minor arpeggios --------------------------------------------------------------
const AIR_PROG = [CH.Am, CH.F, CH.C, CH.G, CH.Am, CH.F, CH.Dm, CH.E];
const airaceTheme: Theme = {
  bpm: 112,
  steps: 16,
  length: 16 * 8,
  play(step, t, v) {
    const bar = Math.floor(step / 16) % 8;
    const s = step % 16;
    const chord = AIR_PROG[bar];
    if (s % 2 === 0) v.note(chord[0] - 12, t, v.stepDur * 1.5, 'sawtooth', 0.07, { filter: 500 });
    const arp = [0, 1, 2, 1];
    v.note(chord[arp[s % 4]] + 24 + (s >= 8 ? 12 : 0), t, v.stepDur * 0.9, 'triangle', 0.05);
    if (s === 0 || s === 6 || s === 8) v.kick(t, 0.5);
    if (s === 12) v.snare(t, 0.12);
    if (s % 4 === 2) v.hat(t, 0.03);
    if (s === 0 && bar % 2 === 0) v.note(chord[2] + 12, t, v.stepDur * 14, 'sine', 0.03, { attack: 1.5 });
  },
};

// --- Galaxy: slow, cold, vast pads ---------------------------------------------------------------
const GAL_PROG = [CH.Am, CH.F, CH.C, CH.Em, CH.Am, CH.F, CH.Dm, CH.E];
const galaxyTheme: Theme = {
  bpm: 64,
  steps: 16,
  length: 16 * 8,
  play(step, t, v) {
    const bar = Math.floor(step / 16) % 8;
    const s = step % 16;
    const chord = GAL_PROG[bar];
    if (s === 0) {
      for (const n of chord) v.note(n + 12, t, v.stepDur * 17, 'sine', 0.035, { attack: 2.5, detune: 6 });
      v.note(chord[0] - 12, t, v.stepDur * 16, 'sine', 0.1, { attack: 1.5 });
    }
    if (s % 4 === 0 && Math.random() < 0.55) {
      const n = chord[Math.floor(Math.random() * 3)] + 36;
      v.note(n, t, v.stepDur * 6, 'sine', 0.025);
    }
  },
};

// --- Ending: the kart theme, slowed into a music box ---------------------------------------------
const endingTheme: Theme = {
  bpm: 78,
  steps: 16,
  length: 16 * 8,
  play(step, t, v) {
    const bar = Math.floor(step / 16) % 8;
    const s = step % 16;
    const m = KART_LEAD[bar][s];
    if (m) v.note(m + 12, t, v.stepDur * 3, 'sine', 0.05);
    if (s === 0) v.note(KART_PROG[bar][0], t, v.stepDur * 16, 'triangle', 0.06, { attack: 0.5 });
  },
};

const THEMES: Record<ThemeId, Theme> = {
  kart: kartTheme(148),
  turbo: kartTheme(210),
  shell: shellTheme,
  airace: airaceTheme,
  galaxy: galaxyTheme,
  ending: endingTheme,
};

export class Music {
  private themeId: ThemeId | null = null;
  private bus: GainNode | null = null;
  private step = 0;
  private nextTime = 0;
  private timer: number;
  private _enabled: boolean;

  constructor(
    private sfx: Sfx,
    enabled: boolean,
  ) {
    this._enabled = enabled;
    this.timer = window.setInterval(() => this.tick(), 30);
  }

  get enabled() {
    return this._enabled;
  }
  set enabled(on: boolean) {
    this._enabled = on;
    if (this.bus && this.sfx.ctx) this.bus.gain.setTargetAtTime(on ? 0.6 : 0, this.sfx.ctx.currentTime, 0.2);
  }

  get current(): ThemeId | null {
    return this.themeId;
  }

  /** Switch themes (null = silence). Fades out the previous theme. */
  play(id: ThemeId | null): void {
    if (id === this.themeId) return;
    this.themeId = id;
    this.fadeOutBus();
    this.step = 0;
    this.nextTime = 0;
  }

  private fadeOutBus(): void {
    const ctx = this.sfx.ctx;
    if (this.bus && ctx) {
      const old = this.bus;
      old.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
      setTimeout(() => old.disconnect(), 2000);
    }
    this.bus = null;
  }

  private tick(): void {
    const ctx = this.sfx.ctx;
    const out = this.sfx.out;
    if (!ctx || !out || !this.themeId || ctx.state !== 'running') return;
    const theme = THEMES[this.themeId];
    if (!this.bus) {
      this.bus = ctx.createGain();
      this.bus.gain.value = 0;
      this.bus.gain.setTargetAtTime(this._enabled ? 0.6 : 0, ctx.currentTime, 0.4);
      this.bus.connect(out);
      this.nextTime = ctx.currentTime + 0.1;
    }
    const stepDur = 60 / theme.bpm / 4;
    if (this.nextTime < ctx.currentTime - 0.5) this.nextTime = ctx.currentTime + 0.05; // tab was backgrounded
    const voices = this.voices(ctx, this.bus, stepDur);
    while (this.nextTime < ctx.currentTime + 0.15) {
      if (this._enabled) theme.play(this.step % theme.length, this.nextTime, voices);
      this.nextTime += stepDur;
      this.step++;
    }
  }

  private voices(ctx: AudioContext, bus: GainNode, stepDur: number): Voices {
    const noiseBurst = (t: number, dur: number, vol: number, freq: number, type: BiquadFilterType) => {
      const len = Math.ceil(ctx.sampleRate * dur);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f).connect(g).connect(bus);
      src.start(t);
    };
    return {
      stepDur,
      note(midi, t, dur, type, vol, opts = {}) {
        const osc = ctx.createOscillator();
        osc.type = type;
        osc.frequency.value = mtof(midi);
        if (opts.detune) osc.detune.value = (Math.random() - 0.5) * opts.detune * 2;
        if (opts.vibrato) {
          const lfo = ctx.createOscillator();
          const lg = ctx.createGain();
          lfo.frequency.value = 5.5;
          lg.gain.value = opts.vibrato;
          lfo.connect(lg).connect(osc.detune);
          lfo.start(t);
          lfo.stop(t + dur + 0.1);
        }
        const g = ctx.createGain();
        const a = opts.attack ?? 0.008;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(vol, t + a);
        g.gain.setValueAtTime(vol, t + Math.max(a, dur * 0.6));
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur + a);
        let node: AudioNode = osc;
        if (opts.filter) {
          const f = ctx.createBiquadFilter();
          f.type = 'lowpass';
          f.frequency.value = opts.filter;
          node = osc.connect(f);
        }
        node.connect(g).connect(bus);
        osc.start(t);
        osc.stop(t + dur + a + 0.05);
      },
      kick(t, vol = 0.6) {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.frequency.setValueAtTime(140, t);
        osc.frequency.exponentialRampToValueAtTime(40, t + 0.12);
        g.gain.setValueAtTime(vol, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
        osc.connect(g).connect(bus);
        osc.start(t);
        osc.stop(t + 0.2);
      },
      snare(t, vol = 0.18) {
        noiseBurst(t, 0.12, vol, 1800, 'bandpass');
      },
      hat(t, vol = 0.05, open = false) {
        noiseBurst(t, open ? 0.15 : 0.03, vol, 7000, 'highpass');
      },
    };
  }

  dispose(): void {
    clearInterval(this.timer);
    this.fadeOutBus();
  }
}

/** Default theme for each stage. */
export const STAGE_THEMES: Record<string, ThemeId | null> = {
  kart: 'kart',
  shell: 'shell',
  airace: 'airace',
  galaxy: 'galaxy',
  ending: 'ending',
};
