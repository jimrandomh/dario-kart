// Track features: layout planning (item boxes, coins, ramps, boost pads, slop) and the
// per-kart queries the race simulation uses (ramp height, pads, slop puddles).

import * as THREE from 'three';
import { randRange, type Rng } from '../../core/util';
import { pointAt, headingAt, type Track } from './track';
import { boostPadMesh, boostPadTexture, rampMesh, slopMesh } from './models';

export const RAMP_LEN = 7;
export const RAMP_H = 1.8;
const PAD_LEN = 4.5;
const PAD_W = 5;
const SLOP_R = 2.3;
/** Launch gravity; also used to lay coin arcs along a full-speed jump. */
export const GRAVITY = 36;

export interface Layout {
  boxRows: number[];
  coinClusters: { s: number; lat: number; drift: number }[];
  /** Coins floating along the flight path of a full-speed jump (s, lateral, height). */
  coinArcs: { s: number; lat: number; y: number }[];
  ramps: { s: number; lat: number; width: number }[];
  pads: { s: number; lat: number }[];
  slop: { s: number; lat: number }[];
}

/** Worst curvature over [s + from, s + to]. */
function bend(t: Track, s: number, from: number, to: number): number {
  let m = 0;
  for (let d = from; d <= to; d += 2) {
    const p = pointAt(t, s + d, 0);
    m = Math.max(m, Math.abs(t.k[p.i]));
  }
  return m;
}

export function planLayout(t: Track, level: number, mode: 'campaign' | 'turbo', rng: Rng): Layout {
  const L = t.length;
  const hw = t.halfWidth;
  const reserved: [number, number][] = [
    [0, 55],
    [L - 50, L],
  ];
  const free = (s: number, pad = 0) => s > 0 && s < L && reserved.every(([a, b]) => s < a - pad || s > b + pad);
  const reserve = (a: number, b: number) => reserved.push([a, b]);

  // Item box rows at fixed fractions of the lap.
  const boxRows = [0.22, 0.52, 0.8].map((f) => f * L + randRange(rng, -15, 15));
  for (const s of boxRows) reserve(s - 18, s + 18);

  // Ramps go on the straightest stretches, with room to land.
  const rampCount = mode === 'turbo' ? 2 : level <= 1 ? 1 : level <= 3 ? 1 + (rng() < 0.5 ? 1 : 0) : 2;
  const ramps: Layout['ramps'] = [];
  const candidates: { s: number; score: number }[] = [];
  for (let s = 70; s < L - 90; s += 5) candidates.push({ s, score: bend(t, s, -25, 55) + rng() * 0.002 });
  candidates.sort((a, b) => a.score - b.score);
  for (const c of candidates) {
    if (ramps.length >= rampCount) break;
    if (!free(c.s, 0) || !free(c.s - 30, 0) || !free(c.s + 55, 0)) continue;
    if (c.score > 1 / 45) break; // nothing straight enough left
    const full = rng() < 0.45;
    const width = full ? hw * 2 - 1 : 8;
    const lat = full ? 0 : (rng() < 0.5 ? -1 : 1) * (hw - 4.5);
    ramps.push({ s: c.s, lat, width });
    reserve(c.s - 35, c.s + 60);
  }

  // Coins arc over each ramp along a full-speed jump.
  const coinArcs: Layout['coinArcs'] = [];
  const vy = Math.min(16, 36 * 0.3);
  for (const r of ramps) {
    for (let i = 1; i <= 5; i++) {
      const d = i * 4.5;
      const tt = d / 36;
      coinArcs.push({ s: r.s + RAMP_LEN + d, lat: r.lat, y: RAMP_H + vy * tt - 0.5 * GRAVITY * tt * tt + 1.1 });
    }
  }

  // Boost pads: one leading into each narrow ramp, plus a few on open stretches.
  const pads: Layout['pads'] = [];
  for (const r of ramps) if (r.width < hw) pads.push({ s: r.s - 14, lat: r.lat });
  const extraPads = (mode === 'turbo' ? 3 : 2) + (level >= 2 ? 1 : 0) + (rng() < 0.5 ? 1 : 0);
  for (let tries = 0; tries < 200 && pads.length < ramps.filter((r) => r.width < hw).length + extraPads; tries++) {
    const s = randRange(rng, 60, L - 60);
    if (!free(s, 12) || bend(t, s, -5, 20) > 1 / 35) continue;
    pads.push({ s, lat: randRange(rng, -hw + 3.5, hw - 3.5) });
    reserve(s - 10, s + 15);
  }

  // Slop puddles: none on the first episode, more later.
  const slopCount = mode === 'turbo' ? 2 : [0, 0, 1, 2, 3][Math.min(level, 4)];
  const slop: Layout['slop'] = [];
  for (let tries = 0; tries < 200 && slop.length < slopCount; tries++) {
    const s = randRange(rng, 60, L - 60);
    if (!free(s, 10)) continue;
    slop.push({ s, lat: randRange(rng, -hw + 3, hw - 3) });
    reserve(s - 8, s + 8);
  }

  // Coin lines fill in wherever is left.
  const coinClusters: Layout['coinClusters'] = [];
  for (let c = 0; c < 8; c++) {
    const s0 = ((c + randRange(rng, 0.2, 0.8)) / 8) * L;
    if (!free(s0, 2) || !free(s0 + 16, 2)) continue;
    coinClusters.push({ s: s0, lat: randRange(rng, -hw * 0.65, hw * 0.65), drift: randRange(rng, -0.3, 0.3) });
  }

  return { boxRows, coinClusters, coinArcs, ramps, pads, slop };
}

interface Ramp {
  s0: number;
  s1: number;
  lat0: number;
  lat1: number;
}

interface Pad {
  s0: number;
  s1: number;
  lat0: number;
  lat1: number;
}

interface Slop {
  x: number;
  z: number;
  s: number;
  lat: number;
  mesh: THREE.Group;
}

export class TrackFeatures {
  readonly ramps: Ramp[];
  readonly pads: Pad[];
  readonly slop: Slop[];

  constructor(
    scene: THREE.Scene,
    private track: Track,
    layout: Layout,
  ) {
    const t = track;
    this.ramps = layout.ramps.map((r) => {
      const p = pointAt(t, r.s, r.lat);
      const mesh = rampMesh(r.width, RAMP_LEN, RAMP_H);
      mesh.position.set(p.x, 0.02, p.z);
      mesh.rotation.y = headingAt(t, p.i);
      scene.add(mesh);
      return { s0: r.s, s1: r.s + RAMP_LEN, lat0: r.lat - r.width / 2, lat1: r.lat + r.width / 2 };
    });
    this.pads = layout.pads.map((pd) => {
      const p = pointAt(t, pd.s + PAD_LEN / 2, pd.lat);
      const holder = new THREE.Group();
      holder.add(boostPadMesh(PAD_W, PAD_LEN));
      holder.position.set(p.x, 0.05, p.z);
      holder.rotation.y = headingAt(t, p.i) + Math.PI;
      scene.add(holder);
      return { s0: pd.s, s1: pd.s + PAD_LEN, lat0: pd.lat - PAD_W / 2, lat1: pd.lat + PAD_W / 2 };
    });
    this.slop = layout.slop.map((sl) => {
      const p = pointAt(t, sl.s, sl.lat);
      const mesh = slopMesh(SLOP_R);
      mesh.position.set(p.x, 0, p.z);
      mesh.rotation.y = headingAt(t, p.i);
      scene.add(mesh);
      return { x: p.x, z: p.z, s: sl.s, lat: sl.lat, mesh };
    });
  }

  /** Ramp surface height under (s, lateral), or null when not on a ramp. `top` = near the lip. */
  rampAt(s: number, lat: number): { h: number; top: boolean } | null {
    for (const r of this.ramps) {
      if (s >= r.s0 && s <= r.s1 && lat >= r.lat0 && lat <= r.lat1) {
        const f = (s - r.s0) / RAMP_LEN;
        return { h: RAMP_H * f, top: f > 0.75 };
      }
    }
    return null;
  }

  padAt(s: number, lat: number): boolean {
    return this.pads.some((p) => s >= p.s0 && s <= p.s1 && lat >= p.lat0 && lat <= p.lat1);
  }

  slopAt(x: number, z: number): boolean {
    return this.slop.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < SLOP_R * SLOP_R * 0.8);
  }

  /** For AI lane choice: a ramp or pad lane worth aiming for within `range` ahead of s. */
  attractorAhead(s: number, range: number): { lat: number; key: number } | null {
    const L = this.track.length;
    let best: { lat: number; key: number } | null = null;
    let bestD = range;
    const consider = (s0: number, lat0: number, lat1: number, key: number) => {
      const d = (((s0 - s) % L) + L) % L;
      if (d < bestD) {
        bestD = d;
        best = { lat: (lat0 + lat1) / 2, key };
      }
    };
    this.ramps.forEach((r, i) => consider(r.s0, r.lat0, r.lat1, i));
    this.pads.forEach((p, i) => consider(p.s0, p.lat0, p.lat1, 100 + i));
    return best;
  }

  animate(dt: number, time: number): void {
    const tex = boostPadTexture();
    tex.offset.y = (tex.offset.y - dt * 2.2) % 1;
    for (const s of this.slop) {
      s.mesh.children.forEach((c) => {
        const bob = c.userData.bob as number | undefined;
        if (bob !== undefined) {
          const ph = (time * 0.8 + bob) % 1;
          c.position.y = 0.05 + ph * 0.25;
          c.scale.setScalar(ph < 0.9 ? 1 : 1 + (ph - 0.9) * 6);
          c.visible = ph < 0.97;
        }
      });
    }
  }
}
