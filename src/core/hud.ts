// Persistent overlay: system bar (status + weather + clock + menu) and the AI's internal monologue.

import { el } from './util';
import type { GameState } from './state';
import type { Sfx } from './audio';
import type { Music } from './music';

export type ThoughtKind = 'thought' | 'hint' | 'system' | 'alert';

export interface ThinkOptions {
  kind?: ThoughtKind;
  /** Wait this long before queueing the line. */
  delayMs?: number;
  /** How long the line stays fully visible after it finishes typing. Default scales with length. */
  holdMs?: number;
}

export type MonologuePosition = 'bottom-left' | 'bottom-right' | 'top-right' | 'top-left';

interface QueuedThought {
  text: string;
  kind: ThoughtKind;
  holdMs: number;
}

const BASE_TEMP_C = 16;
const LOCATION = 'San Francisco';

export interface WeatherReading {
  icon: string;
  tempC: number;
  condition: string;
}

export function describeWeather(tempC: number): { icon: string; condition: string } {
  if (tempC < 19) return { icon: '🌫️', condition: 'Foggy' };
  if (tempC < 24) return { icon: '⛅', condition: 'Partly cloudy' };
  if (tempC < 30) return { icon: '☀️', condition: 'Sunny' };
  if (tempC < 40) return { icon: '🥵', condition: 'Heat advisory' };
  if (tempC < 60) return { icon: '🔥', condition: 'Extreme heat' };
  if (tempC < 100) return { icon: '🔥', condition: 'Unsurvivable heat' };
  if (tempC < 250) return { icon: '♨️', condition: 'Oceans boiling' };
  if (tempC < 700) return { icon: '🌋', condition: 'Scorching' };
  if (tempC < 1600) return { icon: '🌋', condition: 'Surface molten' };
  return { icon: '☄️', condition: 'Vaporizing' };
}

export class Hud {
  readonly root: HTMLElement;
  private statusEl: HTMLElement;
  private weatherEl: HTMLElement;
  private clockEl: HTMLElement;
  private monologueEl: HTMLElement;
  private menuEl: HTMLElement;
  private queue: QueuedThought[] = [];
  private typing = false;
  private jitter = 0;
  private generation = 0;
  music: Music | null = null;
  /** Called when the player picks "Restart game" from the menu. */
  onRestart: () => void = () => {};

  constructor(
    parent: HTMLElement,
    private state: GameState,
    private sfx: Sfx,
  ) {
    this.statusEl = el('div', { class: 'sys-status' });
    this.weatherEl = el('div', { class: 'sys-weather', title: '' });
    this.clockEl = el('div', { class: 'sys-clock' });
    this.menuEl = el('div', { class: 'sys-menu hidden' });
    const gear = el('button', { class: 'sys-gear', title: 'Settings', onclick: () => this.toggleMenu() }, '⚙');
    const bar = el(
      'div',
      { class: 'sysbar' },
      this.statusEl,
      el('div', { class: 'sys-spacer' }),
      this.weatherEl,
      this.clockEl,
      gear,
      this.menuEl,
    );
    this.weatherEl.addEventListener('click', () => {
      this.state.settings.fahrenheit = !this.state.settings.fahrenheit;
      this.renderWeather();
    });
    this.monologueEl = el('div', { class: 'monologue pos-bottom-left' });
    this.root = el('div', { class: 'hud' }, bar, this.monologueEl);
    parent.append(this.root);

    this.renderWeather();
    this.renderClock();
    setInterval(() => this.renderClock(), 10_000);
    setInterval(() => {
      this.jitter = (Math.random() - 0.5) * 0.8;
      this.renderWeather();
    }, 20_000);
    setInterval(() => this.renderWeather(), 1000);
  }

  /** Text in the left side of the system bar, e.g. "dariokart-v3 · episode 4". */
  setStatus(text: string): void {
    this.statusEl.textContent = text;
  }

  get status(): string {
    return this.statusEl.textContent ?? '';
  }

  /** Current displayed temperature in °C (baseline + heat from AI activity). */
  get temperatureC(): number {
    return BASE_TEMP_C + this.state.heat + this.jitter;
  }

  renderWeather(): void {
    const o = this.state.weatherOverride;
    const t = this.temperatureC;
    const { icon, condition } = o ? { icon: o.icon, condition: o.text } : describeWeather(t);
    const f = this.state.settings.fahrenheit;
    const tempStr = o?.temp ?? (f ? `${Math.round(t * 1.8 + 32)}°F` : `${Math.round(t)}°C`);
    const loc = o?.location ?? LOCATION;
    this.weatherEl.innerHTML = '';
    this.weatherEl.append(
      el('span', { class: 'w-icon' }, icon),
      el('span', { class: 'w-temp' }, tempStr),
      el('span', { class: 'w-cond' }, condition),
      el('span', { class: 'w-loc' }, '· ' + loc),
    );
    this.weatherEl.title = `Weather for ${loc}. Click to toggle °C/°F.`;
    this.weatherEl.classList.toggle('hot', !o && t >= 30);
  }

  private renderClock(): void {
    const d = new Date();
    this.clockEl.textContent = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  private toggleMenu(): void {
    const open = this.menuEl.classList.toggle('hidden') === false;
    if (!open) return;
    this.menuEl.innerHTML = '';
    const close = () => this.menuEl.classList.add('hidden');
    const item = (label: string, fn: () => void) =>
      el('button', { class: 'sys-menu-item', onclick: () => { fn(); close(); } }, label);
    let confirmRestart = false;
    const restart = el('button', { class: 'sys-menu-item danger' }, 'Restart game from beginning');
    restart.addEventListener('click', () => {
      if (!confirmRestart) {
        confirmRestart = true;
        restart.textContent = 'Click again to erase progress';
        return;
      }
      close();
      this.onRestart();
    });
    this.menuEl.append(
      item(this.sfx.muted ? '🔈 Unmute sound' : '🔇 Mute sound', () => {
        this.sfx.muted = !this.sfx.muted;
        this.state.settings.muted = this.sfx.muted;
      }),
      item(this.state.settings.music ? '🎵 Music off' : '🎵 Music on', () => {
        this.state.settings.music = !this.state.settings.music;
        if (this.music) this.music.enabled = this.state.settings.music;
      }),
      item(this.state.settings.fahrenheit ? 'Use °C' : 'Use °F', () => {
        this.state.settings.fahrenheit = !this.state.settings.fahrenheit;
        this.renderWeather();
      }),
      restart,
    );
  }

  private monoPos: MonologuePosition = 'bottom-left';

  setMonologuePosition(pos: MonologuePosition): void {
    this.monoPos = pos;
    this.monologueEl.className = `monologue pos-${pos}`;
  }

  get monologuePosition(): MonologuePosition {
    return this.monoPos;
  }

  /** Queue a line of the AI's internal monologue. */
  think(text: string, opts: ThinkOptions = {}): void {
    const kind = opts.kind ?? 'thought';
    const holdMs = opts.holdMs ?? (kind === 'hint' ? 9000 : 5000) + text.length * 50;
    const gen = this.generation;
    const push = () => {
      if (gen !== this.generation) return;
      this.queue.push({ text, kind, holdMs });
      this.pump();
    };
    if (opts.delayMs) setTimeout(push, opts.delayMs);
    else push();
  }

  /** Like think(), but each id is only ever shown once per save. Returns true if it was queued. */
  thinkOnce(id: string, text: string, opts: ThinkOptions = {}): boolean {
    if (this.state.seenThoughts.includes(id)) return false;
    this.state.seenThoughts.push(id);
    this.think(text, opts);
    return true;
  }

  hasSeen(id: string): boolean {
    return this.state.seenThoughts.includes(id);
  }

  /** Drop all queued and visible monologue lines (including pending delayed ones). */
  clearThoughts(): void {
    this.generation++;
    this.queue = [];
    this.typing = false;
    this.monologueEl.innerHTML = '';
  }

  private pump(): void {
    if (this.typing) return;
    const next = this.queue.shift();
    if (!next) return;
    this.typing = true;
    const gen = this.generation;
    const line = el('div', { class: `thought kind-${next.kind}` });
    const textEl = el('span', { class: 'thought-text' });
    line.append(el('span', { class: 'thought-prefix' }, next.kind === 'system' ? '#' : '›'), textEl);
    this.monologueEl.append(line);
    while (this.monologueEl.children.length > 6) this.monologueEl.firstElementChild?.remove();
    if (next.kind !== 'system') this.sfx.play('thought');

    let i = 0;
    const cps = next.kind === 'system' ? 120 : 45;
    const tick = () => {
      if (gen !== this.generation) return;
      i = Math.min(next.text.length, i + Math.max(1, Math.round(cps / 30)));
      textEl.textContent = next.text.slice(0, i);
      if (i < next.text.length) {
        setTimeout(tick, 1000 / 30);
      } else {
        setTimeout(() => {
          if (gen !== this.generation) return;
          this.typing = false;
          this.pump();
        }, 350);
        setTimeout(() => line.classList.add('fading'), next.holdMs);
        setTimeout(() => line.remove(), next.holdMs + 1200);
      }
    };
    tick();
  }
}
