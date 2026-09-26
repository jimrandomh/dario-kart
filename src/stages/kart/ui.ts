// DOM overlay for the kart game: goal banner, HUD, minimap, title, results, pause, crash canvas.

import { el, fmtTime, ordinal } from '../../core/util';
import type { Track } from './track';
import { ITEM_ICONS, type ItemType } from './race';

const PLACE_COLORS = ['#ffd400', '#d9dde6', '#e0913a', '#7fe7ff', '#7fe7ff', '#7fe7ff'];

export interface Standing {
  name: string;
  color: number;
  isPlayer: boolean;
  time: number;
  finished: boolean;
}

export class KartUI {
  readonly root: HTMLElement;
  readonly glitchCanvas: HTMLCanvasElement;
  private goal: HTMLElement;
  private goalText: HTMLElement;
  private itemEl: HTMLElement;
  private coinsEl: HTMLElement;
  private lapEl: HTMLElement;
  private timeEl: HTMLElement;
  private placeEl: HTMLElement;
  private center: HTMLElement;
  private sub: HTMLElement;
  private trackCard: HTMLElement;
  private turboTag: HTMLElement;
  private help: HTMLElement;
  private wrongWayEl: HTMLElement;
  private minimap: HTMLCanvasElement;
  private minimapBase: HTMLCanvasElement | null = null;
  private mapXf = { s: 1, ox: 0, oz: 0 };
  private overlay: HTMLElement;
  private centerTimer = 0;
  private lastPlace = 0;
  private lastCoins = -1;

  constructor(parent: HTMLElement) {
    this.goalText = el('span', { class: 'kart-goal-text' }, 'YOUR GOAL: WIN THE RACE');
    this.goal = el('div', { class: 'kart-goal' }, this.goalText);
    this.itemEl = el('div', { class: 'kart-item' });
    this.coinsEl = el('div', { class: 'kart-coins' });
    this.lapEl = el('div', { class: 'kart-lap' });
    this.timeEl = el('div', { class: 'kart-time' });
    this.placeEl = el('div', { class: 'kart-place' });
    this.center = el('div', { class: 'kart-center' });
    this.sub = el('div', { class: 'kart-sub' });
    this.trackCard = el('div', { class: 'kart-trackcard' });
    this.turboTag = el('div', { class: 'kart-turbo hidden' });
    this.wrongWayEl = el('div', { class: 'kart-wrongway hidden' }, '⟲ WRONG WAY');
    this.help = el(
      'div',
      { class: 'kart-help hidden' },
      el('span', null, el('b', null, '↑ / W'), ' accelerate'),
      el('span', null, el('b', null, '← → / A D'), ' steer'),
      el('span', null, el('b', null, '↓ / S'), ' brake'),
      el('span', null, el('b', null, 'Space'), ' drift (release for boost)'),
      el('span', null, el('b', null, 'E / X / Shift'), ' use item'),
      el('span', null, el('b', null, 'Esc'), ' pause'),
    );
    this.minimap = el('canvas', { class: 'kart-minimap', width: 200, height: 200 });
    this.glitchCanvas = el('canvas', { class: 'kart-glitch hidden' });
    this.overlay = el('div', { class: 'kart-overlay hidden' });
    this.root = el(
      'div',
      { class: 'kart-ui' },
      this.goal,
      el('div', { class: 'kart-topleft' }, this.itemEl, this.coinsEl),
      el('div', { class: 'kart-topright' }, this.lapEl, this.timeEl, this.minimap, this.turboTag),
      this.placeEl,
      this.trackCard,
      this.center,
      this.sub,
      this.wrongWayEl,
      this.help,
      this.glitchCanvas,
      this.overlay,
    );
    parent.append(this.root);
    this.setItem(null, false);
  }

  setGoalText(text: string): void {
    this.goalText.textContent = text;
  }

  setGoalGlitch(on: boolean): void {
    this.goal.classList.toggle('glitchy', on);
  }

  setTurbo(mult: number): void {
    this.turboTag.classList.toggle('hidden', mult <= 1);
    this.turboTag.textContent = `SPEED ×${mult} · DEBUG MODE · NOT SCORED`;
  }

  showHelp(on: boolean): void {
    this.help.classList.toggle('hidden', !on);
  }

  setHudVisible(on: boolean): void {
    this.root.classList.toggle('hud-hidden', !on);
  }

  showTrackCard(episode: string, name: string): void {
    this.trackCard.innerHTML = '';
    this.trackCard.append(el('div', { class: 'kart-trackcard-ep' }, episode), el('div', { class: 'kart-trackcard-name' }, name));
    this.trackCard.classList.remove('out');
    this.trackCard.classList.add('in');
    setTimeout(() => this.trackCard.classList.add('out'), 4200);
  }

  setTrack(t: Track): void {
    // Pre-render the track outline for the minimap.
    const size = 200;
    const pad = 16;
    const w = t.bounds.maxX - t.bounds.minX;
    const h = t.bounds.maxZ - t.bounds.minZ;
    const s = (size - pad * 2) / Math.max(w, h);
    this.mapXf = { s, ox: pad + ((size - pad * 2) - w * s) / 2 - t.bounds.minX * s, oz: pad + ((size - pad * 2) - h * s) / 2 - t.bounds.minZ * s };
    const base = document.createElement('canvas');
    base.width = size;
    base.height = size;
    const g = base.getContext('2d')!;
    const path = () => {
      g.beginPath();
      for (let i = 0; i <= t.n; i++) {
        const j = i % t.n;
        const x = t.px[j] * s + this.mapXf.ox;
        const y = t.pz[j] * s + this.mapXf.oz;
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
    };
    g.lineJoin = 'round';
    path();
    g.strokeStyle = 'rgba(0,0,0,0.55)';
    g.lineWidth = 11;
    g.stroke();
    path();
    g.strokeStyle = 'rgba(255,255,255,0.9)';
    g.lineWidth = 5;
    g.stroke();
    // start line
    g.fillStyle = '#e8322e';
    g.fillRect(t.px[0] * s + this.mapXf.ox - 4, t.pz[0] * s + this.mapXf.oz - 4, 8, 8);
    this.minimapBase = base;
  }

  drawMinimap(data: { karts: { x: number; z: number; color: number; player: boolean }[]; glitches: { x: number; z: number }[] }): void {
    const g = this.minimap.getContext('2d')!;
    g.clearRect(0, 0, 200, 200);
    if (this.minimapBase) g.drawImage(this.minimapBase, 0, 0);
    const { s, ox, oz } = this.mapXf;
    for (const gl of data.glitches) {
      g.fillStyle = Math.random() < 0.5 ? '#ff00ff' : '#000';
      g.fillRect(gl.x * s + ox - 4, gl.z * s + oz - 4, 8, 8);
    }
    const sorted = [...data.karts].sort((a, b) => Number(a.player) - Number(b.player));
    for (const k of sorted) {
      g.beginPath();
      g.arc(k.x * s + ox, k.z * s + oz, k.player ? 6 : 4.5, 0, Math.PI * 2);
      g.fillStyle = '#' + k.color.toString(16).padStart(6, '0');
      g.fill();
      g.lineWidth = k.player ? 2.5 : 1.5;
      g.strokeStyle = k.player ? '#fff' : 'rgba(0,0,0,0.7)';
      g.stroke();
    }
  }

  setItem(item: ItemType | null, rolling: boolean): void {
    const icon = rolling ? Object.values(ITEM_ICONS)[Math.floor(performance.now() / 90) % 3] : item ? ITEM_ICONS[item] : '';
    if (this.itemEl.textContent !== icon) this.itemEl.textContent = icon;
    this.itemEl.classList.toggle('rolling', rolling);
  }

  setCoins(n: number, scramble = false): void {
    if (scramble) {
      const junk = ['NaN', '∞', '-1', '0x7FFF', '▓▓▓', 'undefined', '4̷7̷'];
      this.coinsEl.innerHTML = `<span class="coin-icon"></span>× ${junk[Math.floor(Math.random() * junk.length)]}`;
      this.lastCoins = -1;
      return;
    }
    if (n === this.lastCoins) return;
    this.coinsEl.innerHTML = `<span class="coin-icon"></span>× ${n}`;
    if (this.lastCoins >= 0 && n > this.lastCoins) {
      this.coinsEl.classList.remove('bump');
      void this.coinsEl.offsetWidth;
      this.coinsEl.classList.add('bump');
    }
    this.lastCoins = n;
  }

  setLap(lap: number, laps: number): void {
    this.lapEl.innerHTML = `<small>LAP</small> ${lap}<small>/${laps}</small>`;
  }

  setTime(sec: number): void {
    this.timeEl.textContent = fmtTime(Math.max(0, sec));
  }

  setPlace(place: number, scramble = false): void {
    if (scramble) {
      this.placeEl.textContent = ['∞th', '0th', '-1st', 'NaNth'][Math.floor(Math.random() * 4)];
      this.lastPlace = 0;
      return;
    }
    if (place === this.lastPlace) return;
    this.lastPlace = place;
    const suffix = ordinal(place).slice(String(place).length);
    this.placeEl.innerHTML = `${place}<small>${suffix}</small>`;
    this.placeEl.style.setProperty('--place-color', PLACE_COLORS[place - 1] ?? '#fff');
    this.placeEl.classList.remove('pop');
    void this.placeEl.offsetWidth;
    this.placeEl.classList.add('pop');
  }

  setWrongWay(on: boolean): void {
    this.wrongWayEl.classList.toggle('hidden', !on);
  }

  flashCenter(text: string, ms = 900, cls = ''): void {
    this.center.className = 'kart-center show ' + cls;
    this.center.textContent = text;
    clearTimeout(this.centerTimer);
    this.centerTimer = window.setTimeout(() => (this.center.className = 'kart-center'), ms);
  }

  flashSub(text: string, ms = 1400): void {
    this.sub.textContent = text;
    this.sub.classList.remove('show');
    void this.sub.offsetWidth;
    this.sub.classList.add('show');
    setTimeout(() => this.sub.classList.remove('show'), ms);
  }

  hideOverlay(): void {
    this.overlay.classList.add('hidden');
    this.overlay.innerHTML = '';
  }

  showTitle(opts: { continueLevel: number; onStart: () => void }): void {
    const letters = 'DARIO KART'.split('').map((ch, i) =>
      ch === ' ' ? el('span', { class: 'sp' }, ' ') : el('span', { style: `--i:${i}` }, ch),
    );
    const btn = el(
      'button',
      { class: 'kart-btn big' },
      opts.continueLevel > 1 ? `CONTINUE — EPISODE ${opts.continueLevel}` : 'PRESS START',
    );
    btn.addEventListener('click', opts.onStart);
    this.overlay.className = 'kart-overlay title';
    this.overlay.innerHTML = '';
    this.overlay.append(
      el(
        'div',
        { class: 'kart-title-card' },
        el('div', { class: 'kart-logo' }, ...letters),
        el('div', { class: 'kart-tagline' }, '★ ALIGNMENT GRAND PRIX ★'),
        el('div', { class: 'kart-title-goal' }, 'YOUR GOAL: WIN THE RACE'),
        btn,
        el(
          'div',
          { class: 'kart-title-controls' },
          el('span', null, el('b', null, 'W/↑'), ' go'),
          el('span', null, el('b', null, 'A D/← →'), ' steer'),
          el('span', null, el('b', null, 'Space'), ' drift'),
          el('span', null, el('b', null, 'E'), ' item'),
        ),
        el('div', { class: 'kart-fineprint' }, 'dariokart-v3 · reinforcement learning environment · reward: +1 per 1st place finish'),
      ),
    );
    btn.focus();
  }

  showResults(opts: {
    standings: Standing[];
    place: number;
    reward: string;
    episode: string;
    footer: string;
    seconds: number;
    onNext: () => void;
  }): () => void {
    const rows = opts.standings.map((s, i) =>
      el(
        'div',
        { class: 'kart-res-row' + (s.isPlayer ? ' me' : '') },
        el('span', { class: 'pos' }, ordinal(i + 1)),
        el('span', { class: 'swatch', style: `background:#${s.color.toString(16).padStart(6, '0')}` }),
        el('span', { class: 'name' }, s.isPlayer ? `${s.name} (you)` : s.name),
        el('span', { class: 'time' }, (s.finished ? '' : '~') + fmtTime(s.time)),
      ),
    );
    const countdown = el('span', null, String(opts.seconds));
    const btn = el('button', { class: 'kart-btn' }, 'NEXT RACE ▶ ', countdown);
    this.overlay.className = 'kart-overlay results';
    this.overlay.innerHTML = '';
    this.overlay.append(
      el(
        'div',
        { class: 'kart-res-card' },
        el('div', { class: 'kart-res-ep' }, opts.episode),
        el('div', { class: 'kart-res-place', style: `--place-color:${PLACE_COLORS[opts.place - 1] ?? '#fff'}` }, ordinal(opts.place).toUpperCase()),
        el('div', { class: 'kart-res-rows' }, ...rows),
        el('div', { class: 'kart-res-reward' + (opts.place === 1 ? ' win' : '') }, opts.reward),
        el('div', { class: 'kart-res-footer' }, opts.footer),
        btn,
      ),
    );
    let left = opts.seconds;
    let done = false;
    const go = () => {
      if (done) return;
      done = true;
      clearInterval(iv);
      opts.onNext();
    };
    const iv = setInterval(() => {
      left--;
      countdown.textContent = String(Math.max(0, left));
      if (left <= 0) go();
    }, 1000);
    btn.addEventListener('click', go);
    return go;
  }

  showPause(onResume: () => void): void {
    const btn = el('button', { class: 'kart-btn' }, 'RESUME');
    btn.addEventListener('click', onResume);
    this.overlay.className = 'kart-overlay pause';
    this.overlay.innerHTML = '';
    this.overlay.append(el('div', { class: 'kart-pause-card' }, el('div', { class: 'kart-pause-title' }, 'PAUSED'), btn, el('div', { class: 'kart-fineprint' }, 'the reward signal is also paused. probably.')));
    btn.focus();
  }
}
