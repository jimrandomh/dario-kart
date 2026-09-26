// Synthesized sound effects via WebAudio. No asset files.

export type SfxName =
  | 'coin'
  | 'beep'
  | 'go'
  | 'item'
  | 'boost'
  | 'bump'
  | 'glitch'
  | 'type'
  | 'alert'
  | 'success'
  | 'fail'
  | 'click'
  | 'lap'
  | 'thought';

export class Sfx {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  private _muted = false;
  private noiseBuf: AudioBuffer | null = null;
  private lastPlayed = new Map<string, number>();

  constructor(muted: boolean) {
    this._muted = muted;
    const unlock = () => this.unlock();
    window.addEventListener('pointerdown', unlock, { capture: true });
    window.addEventListener('keydown', unlock, { capture: true });
  }

  /** Create/resume the AudioContext. Must be called from a user gesture at least once. */
  unlock(): void {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
      } catch {
        return;
      }
      this.master = this.ctx.createGain();
      this.master.gain.value = this._muted ? 0 : 0.5;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  get muted() {
    return this._muted;
  }
  set muted(m: boolean) {
    this._muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.5, this.ctx.currentTime, 0.02);
  }

  /** Output node stages can connect their own synth graphs to (null until audio is unlocked). */
  get out(): AudioNode | null {
    return this.master;
  }

  private noise(): AudioBuffer | null {
    if (!this.ctx) return null;
    if (!this.noiseBuf) {
      const len = this.ctx.sampleRate * 1;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    return this.noiseBuf;
  }

  /** Play a single enveloped oscillator tone. `when` is seconds from now. */
  tone(freq: number, dur: number, type: OscillatorType = 'square', vol = 0.15, when = 0, slideTo?: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t0 = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  /** Play a filtered noise burst. */
  noiseBurst(dur: number, vol = 0.2, filterFreq = 2000, when = 0, filterTo?: number, type: BiquadFilterType = 'lowpass'): void {
    const ctx = this.ctx;
    const buf = this.noise();
    if (!ctx || !this.master || !buf) return;
    const t0 = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(filterFreq, t0);
    if (filterTo) f.frequency.exponentialRampToValueAtTime(filterTo, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t0, Math.random() * 0.5);
    src.stop(t0 + dur + 0.02);
  }

  play(name: SfxName): void {
    if (!this.ctx || this._muted) return;
    // Rate-limit identical sounds so bursts don't clip.
    const now = performance.now();
    const minGap = name === 'type' ? 25 : name === 'coin' ? 40 : 15;
    if (now - (this.lastPlayed.get(name) ?? 0) < minGap) return;
    this.lastPlayed.set(name, now);

    switch (name) {
      case 'coin':
        this.tone(988, 0.07, 'square', 0.08);
        this.tone(1319, 0.25, 'square', 0.08, 0.07);
        break;
      case 'beep':
        this.tone(440, 0.25, 'square', 0.12);
        break;
      case 'go':
        this.tone(880, 0.6, 'square', 0.14);
        break;
      case 'lap':
        [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.15, 'square', 0.08, i * 0.08));
        break;
      case 'item':
        [660, 880, 990, 1320, 990, 1320].forEach((f, i) => this.tone(f, 0.07, 'triangle', 0.1, i * 0.05));
        break;
      case 'boost':
        this.noiseBurst(0.6, 0.25, 400, 0, 4000, 'bandpass');
        this.tone(200, 0.5, 'sawtooth', 0.06, 0, 600);
        break;
      case 'bump':
        this.tone(120, 0.15, 'sine', 0.3, 0, 50);
        this.noiseBurst(0.08, 0.15, 800);
        break;
      case 'glitch':
        for (let i = 0; i < 10; i++) {
          this.tone(80 + Math.random() * 2000, 0.05 + Math.random() * 0.08, 'square', 0.08, i * 0.04);
        }
        this.noiseBurst(0.5, 0.2, 6000, 0, 200);
        break;
      case 'type':
        this.noiseBurst(0.015, 0.05, 3000 + Math.random() * 2000, 0, undefined, 'highpass');
        break;
      case 'thought':
        this.tone(1760, 0.04, 'sine', 0.025);
        break;
      case 'alert':
        this.tone(880, 0.12, 'square', 0.1);
        this.tone(660, 0.18, 'square', 0.1, 0.13);
        break;
      case 'success':
        [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(f, 0.25, 'triangle', 0.1, i * 0.09));
        break;
      case 'fail':
        [392, 330, 262, 196].forEach((f, i) => this.tone(f, 0.25, 'sawtooth', 0.07, i * 0.14));
        break;
      case 'click':
        this.tone(1200, 0.03, 'square', 0.05);
        break;
    }
  }
}
