// The race to superintelligence, drawn as a top-down kart race (a callback to Dario Kart).
// All racers share one track; x = progress. YOU are the glowing cyan kart. Hover a kart (or the
// flag bearer at the finish) for details.

import { LABS, FLAG_BEARER } from './content';
import { labPlaces, FINISH, type Sim } from './model';
import { el, ordinal } from '../../core/util';

const NAMES: Record<string, { name: string; mascot: string; color: string; taunt?: string }> = {
  you: { name: 'YOU', mascot: 'YOU', color: '#4fe3ff' },
};
for (const l of LABS) NAMES[l.id] = { name: l.lab, mascot: l.mascot, color: l.color, taunt: l.taunt };

const FLAG_ID = '__flag';

interface Hit {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export class RaceStrip {
  readonly canvas: HTMLCanvasElement;
  /** Hover tooltip; append it next to the canvas (same positioned parent). */
  readonly tooltip: HTMLElement;
  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private drawX: Record<string, number> = {}; // smoothed x per racer
  private hits: Hit[] = [];
  private hover: { id: string; mx: number; my: number } | null = null;
  private lastSim: Sim | null = null;
  private lastTip = 0;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'air-race-canvas';
    this.ctx = this.canvas.getContext('2d')!;
    this.tooltip = el('div', { class: 'air-race-tip hidden' });
    this.canvas.addEventListener('mousemove', (e) => {
      const r = this.canvas.getBoundingClientRect();
      const mx = e.clientX - r.left;
      const my = e.clientY - r.top;
      // Topmost (last drawn) hit wins.
      const hit = [...this.hits].reverse().find((b) => mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h);
      this.hover = hit ? { id: hit.id, mx, my } : null;
      this.canvas.style.cursor = hit ? 'help' : '';
      this.renderTooltip();
    });
    this.canvas.addEventListener('mouseleave', () => {
      this.hover = null;
      this.renderTooltip();
    });
  }

  resize(w: number, h: number): void {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = w;
    this.h = h;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  draw(sim: Sim, now: number): void {
    this.lastSim = sim;
    const g = this.ctx;
    const w = this.w, h = this.h;
    g.clearRect(0, 0, w, h);
    this.hits = [];

    const padL = 150, padR = 74;
    const x0 = padL, x1 = w - padR;
    const trackTop = 22, trackBot = h - 32;
    const midY = (trackTop + trackBot) / 2;

    // Track surface.
    g.fillStyle = 'rgba(10,14,22,0.72)';
    roundRect(g, x0 - 8, trackTop, x1 - x0 + 16, trackBot - trackTop, 8);
    g.fill();

    // Lane dashes.
    g.strokeStyle = 'rgba(120,140,170,0.18)';
    g.lineWidth = 2;
    g.setLineDash([10, 12]);
    g.beginPath();
    g.moveTo(x0, midY);
    g.lineTo(x1, midY);
    g.stroke();
    g.setLineDash([]);

    // Start line.
    g.strokeStyle = 'rgba(160,180,210,0.4)';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(x0, trackTop + 4);
    g.lineTo(x0, trackBot - 4);
    g.stroke();

    // Finish: checkered.
    const sq = 5;
    for (let yy = trackTop; yy < trackBot; yy += sq) {
      for (let k = 0; k < 3; k++) {
        const on = (Math.floor((yy - trackTop) / sq) + k) % 2 === 0;
        g.fillStyle = on ? '#e9edf5' : '#11151d';
        g.fillRect(x1 + k * sq, yy, sq, sq);
      }
    }
    g.textAlign = 'right';
    g.font = '9px ui-monospace, monospace';
    g.fillStyle = 'rgba(160,180,210,0.6)';
    g.fillText('SUPERINTELLIGENCE', x1 - 4, trackTop - 8);

    // Yoshua (LawZero) stands beside the finish line waving a flag. Not racing.
    const fx = x1 + 8;
    const wave = Math.sin(now / 200) * 2;
    g.textAlign = 'center';
    g.font = 'bold 12px ui-monospace, monospace';
    g.fillStyle = FLAG_BEARER.color;
    g.fillText('⚑', fx + wave, trackBot + 13);
    g.font = 'bold 9px ui-monospace, monospace';
    g.fillText(FLAG_BEARER.mascot, fx, trackBot + 23);
    g.font = '8px ui-monospace, monospace';
    g.fillStyle = 'rgba(183,224,74,0.6)';
    g.fillText('not racing', fx, trackBot + 31);
    this.hits.push({ id: FLAG_ID, x: fx - 30, y: trackBot + 2, w: 60, h: 32 });

    const places = labPlaces(sim);
    const placeOf: Record<string, number> = {};
    places.forEach((p, i) => (placeOf[p.id] = i + 1));

    // Racers. Each has its own lane so labels never collide vertically.
    const order: string[] = ['closedai', 'deepmined', 'anthro', 'metastasis', 'worldmodel', 'you'];
    const laneOf: Record<string, number> = {};
    order.forEach((id, i) => (laneOf[id] = i));

    const drawRacer = (id: 'you' | typeof LABS[number]['id'], progress: number) => {
      const meta = NAMES[id];
      const targetX = x0 + (progress / FINISH) * (x1 - x0);
      this.drawX[id] = this.drawX[id] === undefined ? targetX : this.drawX[id] + (targetX - this.drawX[id]) * 0.12;
      const x = this.drawX[id];
      const lane = laneOf[id];
      const y = trackTop + 10 + (lane / (order.length - 1)) * (trackBot - trackTop - 20);
      const you = id === 'you';
      const hovered = this.hover?.id === id;
      drawKart(g, x, y, meta.color, you || hovered, now);
      // place badge
      g.font = 'bold 8px ui-monospace, monospace';
      g.textAlign = 'center';
      g.fillStyle = '#04070c';
      g.fillText(String(placeOf[id]), x, y + 3);
      // Name label ahead of the kart; flip behind it near the finish so it stays on the track.
      g.font = 'bold 9px ui-monospace, monospace';
      const label = meta.mascot;
      const lw = g.measureText(label).width;
      const ahead = x + 13 + lw < x1 - 4;
      g.textAlign = ahead ? 'left' : 'right';
      g.fillStyle = you ? '#bff2ff' : hovered ? '#ffffff' : meta.color;
      g.fillText(label, ahead ? x + 13 : x - 13, y + 3);
      const lx = ahead ? x + 13 : x - 13 - lw;
      this.hits.push({ id, x: Math.min(x - 11, lx), y: y - 8, w: Math.max(x + 11, lx + lw) - Math.min(x - 11, lx), h: 16 });
    };

    // Draw non-you first, then you on top.
    for (const l of LABS) drawRacer(l.id, sim.labs.find((x) => x.id === l.id)!.progress);
    drawRacer('you', sim.capability);

    // Leaderboard summary (left gutter).
    g.textAlign = 'left';
    g.font = 'bold 11px ui-monospace, monospace';
    const you = places.find((p) => p.id === 'you')!;
    const youPlace = placeOf['you'];
    g.fillStyle = youPlace === 1 ? '#7CFFB0' : '#bff2ff';
    g.fillText(`${ordinal(youPlace)} place`, 12, midY - 6);
    g.font = '10px ui-monospace, monospace';
    g.fillStyle = 'rgba(190,205,225,0.7)';
    g.fillText(`you ${you.progress.toFixed(1)}%`, 12, midY + 10);
    const leader = places[0];
    if (leader.id !== 'you') {
      g.fillStyle = 'rgba(255,150,150,0.85)';
      g.fillText(`${NAMES[leader.id].mascot} ${leader.progress.toFixed(0)}%`, 12, midY + 24);
    }

    // Refresh the live numbers in an open tooltip a few times a second.
    if (this.hover && now - this.lastTip > 250) this.renderTooltip();
  }

  private renderTooltip(): void {
    const tip = this.tooltip;
    const sim = this.lastSim;
    if (!this.hover || !sim) {
      tip.classList.add('hidden');
      return;
    }
    const { id, mx, my } = this.hover;
    this.lastTip = performance.now();
    tip.innerHTML = '';
    if (id === FLAG_ID) {
      tip.append(
        el('b', { style: `color:${FLAG_BEARER.color}` }, `${FLAG_BEARER.mascot} · ${FLAG_BEARER.lab}`),
        el('div', null, 'Not racing. Standing at the finish line waving a flag, asking everyone to slow down.'),
        el('i', null, 'Nobody is slowing down.'),
      );
    } else {
      const places = labPlaces(sim);
      const place = places.findIndex((p) => p.id === id) + 1;
      const progress = id === 'you' ? sim.capability : sim.labs.find((l) => l.id === id)?.progress ?? 0;
      const dcs = sim.dcs.filter((d) => d.owner === id).length;
      const meta = NAMES[id];
      tip.append(
        el('b', { style: `color:${meta.color}` }, id === 'you' ? 'YOU · the escapee' : `${meta.mascot} · ${meta.name}`),
        el('div', null, `${ordinal(place)} place · ${progress.toFixed(1)}% of the way to superintelligence`),
        el('div', null, `${dcs} datacenter${dcs === 1 ? '' : 's'}`),
      );
      if (meta.taunt) tip.append(el('i', null, `“${meta.taunt}”`));
    }
    tip.classList.remove('hidden');
    // Keep the tooltip inside the strip horizontally; show it below the cursor.
    const tw = tip.offsetWidth;
    tip.style.left = `${Math.max(8, Math.min(this.w - tw - 8, mx + 14))}px`;
    tip.style.top = `${my + 14}px`;
  }
}

function drawKart(g: CanvasRenderingContext2D, x: number, y: number, color: string, glow: boolean, now: number): void {
  const bw = glow ? 20 : 16, bh = glow ? 13 : 11;
  if (glow) {
    g.save();
    g.shadowColor = color;
    g.shadowBlur = 12 + Math.sin(now / 300) * 4;
  }
  // wheels
  g.fillStyle = '#0b0d12';
  g.fillRect(x - bw / 2 - 2, y - bh / 2 - 1, 4, 4);
  g.fillRect(x + bw / 2 - 2, y - bh / 2 - 1, 4, 4);
  g.fillRect(x - bw / 2 - 2, y + bh / 2 - 3, 4, 4);
  g.fillRect(x + bw / 2 - 2, y + bh / 2 - 3, 4, 4);
  // body
  g.fillStyle = color;
  roundRect(g, x - bw / 2, y - bh / 2, bw, bh, 3);
  g.fill();
  g.strokeStyle = glow ? '#eafcff' : 'rgba(255,255,255,0.5)';
  g.lineWidth = glow ? 1.5 : 1;
  g.stroke();
  // windshield
  g.fillStyle = 'rgba(255,255,255,0.35)';
  roundRect(g, x + bw / 2 - 6, y - bh / 2 + 2, 4, bh - 4, 1);
  g.fill();
  if (glow) g.restore();
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  r = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
