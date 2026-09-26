// Canvas world map: a glowing dot-matrix land mask with datacenter nodes, infiltration rings,
// ownership-flip animations and a faint network of links from home to owned datacenters.

import { isLand } from './mapdata';
import { DATACENTERS, LABS, type Owner } from './content';
import { defOf, type Sim } from './model';

const LON_MIN = -138, LON_MAX = 178, LAT_MAX = 74, LAT_MIN = -50;
const YOU_COLOR = '#4fe3ff';
const NEUTRAL_COLOR = '#5a6472';

function ownerColor(owner: Owner): string {
  if (owner === 'you') return YOU_COLOR;
  if (owner === 'neutral') return NEUTRAL_COLOR;
  return LABS.find((l) => l.id === owner)?.color ?? NEUTRAL_COLOR;
}

interface DcAnim {
  flip: number; // seconds remaining on flip shockwave
  colorMix: number; // 0..1 current node color blend (for smooth flips)
  displayOwner: Owner;
}

export class WorldMap {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private land: HTMLCanvasElement; // pre-rendered static layer
  private w = 0;
  private h = 0;
  private mapY0 = 0;
  private mapH = 0;
  private dpr = 1;
  private anim = new Map<string, DcAnim>();
  hover: string | null = null;
  selected: string | null = null;

  /** Reset ownership animation state (used when the stage is retried after a loss). */
  reset(): void {
    for (const d of DATACENTERS) this.anim.set(d.id, { flip: 0, colorMix: 1, displayOwner: d.owner });
    this.selected = null;
    this.hover = null;
  }

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'air-map';
    this.ctx = this.canvas.getContext('2d')!;
    this.land = document.createElement('canvas');
    for (const d of DATACENTERS) this.anim.set(d.id, { flip: 0, colorMix: 1, displayOwner: d.owner });
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
    this.mapH = (w * (LAT_MAX - LAT_MIN)) / (LON_MAX - LON_MIN);
    this.mapY0 = Math.max(0, (h - this.mapH) / 2);
    this.renderLand();
  }

  project(lat: number, lon: number): [number, number] {
    const x = ((lon - LON_MIN) / (LON_MAX - LON_MIN)) * this.w;
    const y = this.mapY0 + ((LAT_MAX - lat) / (LAT_MAX - LAT_MIN)) * this.mapH;
    return [x, y];
  }

  private renderLand(): void {
    const c = this.land;
    c.width = this.canvas.width;
    c.height = this.canvas.height;
    const g = c.getContext('2d')!;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, this.w, this.h);

    // Backdrop: deep space with a subtle radial glow toward the map band.
    const bg = g.createLinearGradient(0, 0, 0, this.h);
    bg.addColorStop(0, '#03060c');
    bg.addColorStop(0.5, '#050a14');
    bg.addColorStop(1, '#03060c');
    g.fillStyle = bg;
    g.fillRect(0, 0, this.w, this.h);

    // Faint starfield in the letterbox margins.
    g.fillStyle = 'rgba(180,210,255,0.5)';
    let seed = 1234567;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 140; i++) {
      const x = rnd() * this.w;
      const y = rnd() * this.h;
      if (y > this.mapY0 + 10 && y < this.mapY0 + this.mapH - 10) continue;
      g.globalAlpha = 0.2 + rnd() * 0.5;
      g.fillRect(x, y, 1, 1);
    }
    g.globalAlpha = 1;

    // Latitude/longitude grid inside the map band.
    g.strokeStyle = 'rgba(80,140,180,0.07)';
    g.lineWidth = 1;
    for (let lon = -120; lon <= 150; lon += 30) {
      const [x] = this.project(0, lon);
      g.beginPath();
      g.moveTo(x, this.mapY0);
      g.lineTo(x, this.mapY0 + this.mapH);
      g.stroke();
    }
    for (let lat = -40; lat <= 70; lat += 20) {
      const [, y] = this.project(lat, 0);
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(this.w, y);
      g.stroke();
    }

    // Dot-matrix land. Brighter dots along coastlines.
    const step = 5;
    for (let py = this.mapY0; py < this.mapY0 + this.mapH; py += step) {
      const lat = LAT_MAX - ((py - this.mapY0) / this.mapH) * (LAT_MAX - LAT_MIN);
      for (let px = 0; px < this.w; px += step) {
        const lon = LON_MIN + (px / this.w) * (LON_MAX - LON_MIN);
        if (!isLand(lat, lon)) continue;
        // Coast test: is any neighbor water?
        const d = 1.6;
        const coast = !isLand(lat + d, lon) || !isLand(lat - d, lon) || !isLand(lat, lon + d) || !isLand(lat, lon - d);
        if (coast) {
          g.fillStyle = 'rgba(90,200,230,0.85)';
          g.beginPath();
          g.arc(px, py, 1.3, 0, Math.PI * 2);
          g.fill();
        } else {
          g.fillStyle = 'rgba(52,104,132,0.55)';
          g.fillRect(px - 0.7, py - 0.7, 1.4, 1.4);
        }
      }
    }
  }

  /** Advance animation state and consume flip events already applied to the sim. */
  update(sim: Sim, dt: number): void {
    for (const dc of sim.dcs) {
      const a = this.anim.get(dc.id)!;
      if (a.displayOwner !== dc.owner) {
        a.displayOwner = dc.owner;
        a.flip = 0.9;
        a.colorMix = 0;
      }
      if (a.flip > 0) a.flip = Math.max(0, a.flip - dt);
      if (a.colorMix < 1) a.colorMix = Math.min(1, a.colorMix + dt * 2.5);
    }
  }

  hitTest(px: number, py: number): string | null {
    let best: string | null = null;
    let bestD = 18 * 18;
    for (const d of DATACENTERS) {
      const [x, y] = this.project(d.lat, d.lon);
      const dd = (x - px) ** 2 + (y - py) ** 2;
      if (dd < bestD) {
        bestD = dd;
        best = d.id;
      }
    }
    return best;
  }

  private nodeRadius(compute: number): number {
    return 3.2 + Math.sqrt(compute) / 6.5;
  }

  draw(sim: Sim, now: number): void {
    const g = this.ctx;
    g.clearRect(0, 0, this.w, this.h);
    g.drawImage(this.land, 0, 0, this.w, this.h);

    // Network links from home to owned datacenters.
    const [hx, hy] = this.project(defOf('sandbox').lat, defOf('sandbox').lon);
    g.lineWidth = 1;
    for (const dc of sim.dcs) {
      if (dc.owner !== 'you' || dc.id === 'sandbox') continue;
      const [x, y] = this.project(defOf(dc.id).lat, defOf(dc.id).lon);
      const midx = (hx + x) / 2;
      const midy = (hy + y) / 2 - Math.abs(x - hx) * 0.12;
      g.strokeStyle = 'rgba(79,227,255,0.16)';
      g.beginPath();
      g.moveTo(hx, hy);
      g.quadraticCurveTo(midx, midy, x, y);
      g.stroke();
      // travelling pulse
      const t = (now / 1400 + (x + y) * 0.001) % 1;
      const bx = (1 - t) * (1 - t) * hx + 2 * (1 - t) * t * midx + t * t * x;
      const by = (1 - t) * (1 - t) * hy + 2 * (1 - t) * t * midy + t * t * y;
      g.fillStyle = 'rgba(150,240,255,0.8)';
      g.beginPath();
      g.arc(bx, by, 1.6, 0, Math.PI * 2);
      g.fill();
    }

    // Datacenter nodes.
    for (const d of DATACENTERS) {
      const dc = sim.dcs.find((x) => x.id === d.id)!;
      const a = this.anim.get(d.id)!;
      const [x, y] = this.project(d.lat, d.lon);
      const r = this.nodeRadius(d.compute);
      const col = ownerColor(dc.owner);
      const isYou = dc.owner === 'you';
      const hovered = this.hover === d.id || this.selected === d.id;

      // Flip shockwave.
      if (a.flip > 0) {
        const p = 1 - a.flip / 0.9;
        g.strokeStyle = `rgba(79,227,255,${(1 - p) * 0.9})`;
        g.lineWidth = 2;
        g.beginPath();
        g.arc(x, y, r + p * 34, 0, Math.PI * 2);
        g.stroke();
      }

      // Glow.
      const glow = g.createRadialGradient(x, y, 0, x, y, r * (isYou ? 4.2 : 2.6));
      glow.addColorStop(0, hexA(col, isYou ? 0.5 : 0.32));
      glow.addColorStop(1, hexA(col, 0));
      g.fillStyle = glow;
      g.beginPath();
      g.arc(x, y, r * (isYou ? 4.2 : 2.6), 0, Math.PI * 2);
      g.fill();

      // Owned pulse ring.
      if (isYou) {
        const pulse = 0.5 + 0.5 * Math.sin(now / 500 + x);
        g.strokeStyle = hexA(YOU_COLOR, 0.25 + pulse * 0.25);
        g.lineWidth = 1.2;
        g.beginPath();
        g.arc(x, y, r + 3 + pulse * 2, 0, Math.PI * 2);
        g.stroke();
      }

      // Node body.
      g.fillStyle = col;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.55)';
      g.lineWidth = hovered ? 2 : 1;
      g.stroke();

      // Infiltration progress ring.
      if (dc.infiltrating) {
        g.strokeStyle = YOU_COLOR;
        g.lineWidth = 3;
        g.beginPath();
        g.arc(x, y, r + 5, -Math.PI / 2, -Math.PI / 2 + dc.progress * Math.PI * 2);
        g.stroke();
        // sweep tick
        g.strokeStyle = 'rgba(180,240,255,0.35)';
        g.lineWidth = 1;
        g.beginPath();
        g.arc(x, y, r + 5, 0, Math.PI * 2);
        g.stroke();
      }

      // Selection ring.
      if (this.selected === d.id) {
        g.strokeStyle = '#fff';
        g.lineWidth = 1.5;
        g.setLineDash([3, 3]);
        g.beginPath();
        g.arc(x, y, r + 9, 0, Math.PI * 2);
        g.stroke();
        g.setLineDash([]);
      }

      // Label.
      const showLabel = isYou || hovered || d.security >= 6 || dc.infiltrating;
      if (showLabel) {
        g.font = '10px ui-monospace, monospace';
        g.textAlign = 'center';
        g.fillStyle = isYou ? 'rgba(180,245,255,0.95)' : hovered ? '#fff' : 'rgba(200,210,225,0.7)';
        g.fillText(d.short, x, y + r + 12);
      }
    }
  }
}

function hexA(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const gg = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${gg},${b},${a})`;
}
