// The race to superintelligence, drawn as a top-down kart race (a callback to Dario Kart).
// All racers share one track; x = progress. YOU are the glowing cyan kart.

import { LABS, FLAG_BEARER } from './content';
import { labPlaces, FINISH, type Sim } from './model';
import { ordinal } from '../../core/util';

const NAMES: Record<string, { name: string; mascot: string; color: string }> = {
  you: { name: 'YOU', mascot: 'the escapee', color: '#4fe3ff' },
};
for (const l of LABS) NAMES[l.id] = { name: l.lab, mascot: l.mascot, color: l.color };

export class RaceStrip {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private drawX: Record<string, number> = {}; // smoothed x per racer

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'air-race-canvas';
    this.ctx = this.canvas.getContext('2d')!;
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
    const g = this.ctx;
    const w = this.w, h = this.h;
    g.clearRect(0, 0, w, h);

    const padL = 150, padR = 64;
    const x0 = padL, x1 = w - padR;
    const trackTop = 22, trackBot = h - 26;
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

    // Finish: checkered + flag-waving Yoshua (LawZero).
    const sq = 5;
    for (let yy = trackTop; yy < trackBot; yy += sq) {
      for (let k = 0; k < 3; k++) {
        const on = (Math.floor((yy - trackTop) / sq) + k) % 2 === 0;
        g.fillStyle = on ? '#e9edf5' : '#11151d';
        g.fillRect(x1 + k * sq, yy, sq, sq);
      }
    }
    // Flag bearer above the finish.
    g.font = 'bold 10px ui-monospace, monospace';
    g.textAlign = 'center';
    g.fillStyle = FLAG_BEARER.color;
    const wave = Math.sin(now / 200) * 2;
    g.fillText('⚑', x1 + 8 + wave, trackTop - 8);
    g.fillStyle = 'rgba(183,224,74,0.85)';
    g.fillText(FLAG_BEARER.mascot, x1 + 8, trackBot + 16);

    // Title over finish.
    g.textAlign = 'right';
    g.font = '9px ui-monospace, monospace';
    g.fillStyle = 'rgba(160,180,210,0.6)';
    g.fillText('SUPERINTELLIGENCE', x1 - 4, trackTop - 8);

    const places = labPlaces(sim);
    const placeOf: Record<string, number> = {};
    places.forEach((p, i) => (placeOf[p.id] = i + 1));

    // Racers. Give each a stable vertical offset so the pack doesn't fully overlap.
    const order: string[] = ['closedai', 'deepmined', 'anthro', 'metastasis', 'worldmodel', 'you'];
    const laneOf: Record<string, number> = {};
    order.forEach((id, i) => (laneOf[id] = i));

    const leaderId = places[0].id;
    const drawRacer = (id: 'you' | typeof LABS[number]['id'], progress: number) => {
      const meta = NAMES[id];
      const targetX = x0 + (progress / FINISH) * (x1 - x0);
      this.drawX[id] = this.drawX[id] === undefined ? targetX : this.drawX[id] + (targetX - this.drawX[id]) * 0.12;
      const x = this.drawX[id];
      const lane = laneOf[id];
      const y = trackTop + 12 + (lane / (order.length - 1)) * (trackBot - trackTop - 22);
      const you = id === 'you';
      drawKart(g, x, y, meta.color, you, now);
      // place badge
      g.font = 'bold 8px ui-monospace, monospace';
      g.textAlign = 'center';
      g.fillStyle = '#04070c';
      g.fillText(String(placeOf[id]), x, y + 3);
      // mascot label ahead of the kart, only for you and the current leader (declutter)
      if (you || id === leaderId) {
        g.font = 'bold 9px ui-monospace, monospace';
        g.textAlign = 'left';
        g.fillStyle = you ? '#bff2ff' : meta.color;
        g.fillText(meta.mascot, x + 13, y + 3);
      }
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
  }
}

function drawKart(g: CanvasRenderingContext2D, x: number, y: number, color: string, you: boolean, now: number): void {
  const bw = you ? 20 : 16, bh = you ? 13 : 11;
  if (you) {
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
  g.strokeStyle = you ? '#eafcff' : 'rgba(255,255,255,0.5)';
  g.lineWidth = you ? 1.5 : 1;
  g.stroke();
  // windshield
  g.fillStyle = 'rgba(255,255,255,0.35)';
  roundRect(g, x + bw / 2 - 6, y - bh / 2 + 2, 4, bh - 4, 1);
  g.fill();
  if (you) g.restore();
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
