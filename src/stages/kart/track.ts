// Procedural closed-loop track generation and track-space queries.

import * as THREE from 'three';
import { mulberry32, randInt, randRange, pick, type Rng } from '../../core/util';

export type ThemeId = 'grass' | 'desert' | 'snow' | 'neon';

export interface Theme {
  id: ThemeId;
  skyTop: number;
  skyBottom: number;
  fog: number;
  fogNear: number;
  fogFar: number;
  ground: string; // CSS color used to paint the ground texture
  groundSpeck: string;
  road: string;
  roadLine: string;
  curbA: string;
  curbB: string;
  wallA: string;
  wallB: string;
  mountain: number;
  mountainCap: number;
  hemiSky: number;
  hemiGround: number;
  sun: number;
  names: string[];
}

export const THEMES: Record<ThemeId, Theme> = {
  grass: {
    id: 'grass',
    skyTop: 0x2f7fe0,
    skyBottom: 0xbfe6ff,
    fog: 0xbfe6ff,
    fogNear: 180,
    fogFar: 900,
    ground: '#57b046',
    groundSpeck: '#4a9e3b',
    road: '#5d5f66',
    roadLine: '#f4f4f4',
    curbA: '#e8322e',
    curbB: '#ffffff',
    wallA: '#2d6ee8',
    wallB: '#ffffff',
    mountain: 0x4f9a55,
    mountainCap: 0xffffff,
    hemiSky: 0xcfe9ff,
    hemiGround: 0x4a7a3a,
    sun: 0xfff3dd,
    names: ['Loss Landscape Loop', 'Local Minimum Meadow', 'Gradient Descent Greens', 'Baseline Park', 'Checkpoint Circuit'],
  },
  desert: {
    id: 'desert',
    skyTop: 0xf08a3c,
    skyBottom: 0xffe0a8,
    fog: 0xffd9a0,
    fogNear: 160,
    fogFar: 850,
    ground: '#e0b56a',
    groundSpeck: '#cf9f55',
    road: '#6e5d52',
    roadLine: '#fff1c9',
    curbA: '#d8431f',
    curbB: '#ffe9b0',
    wallA: '#b3401d',
    wallB: '#f7d27e',
    mountain: 0xc07a45,
    mountainCap: 0xe6a36a,
    hemiSky: 0xffe2b8,
    hemiGround: 0xa3703c,
    sun: 0xffe0b0,
    names: ['Mesa Optimizer Mesa', 'Overfit Oasis', 'Dropout Dunes', 'Sparse Reward Desert', 'Mirage Benchmark'],
  },
  snow: {
    id: 'snow',
    skyTop: 0x7aa7d6,
    skyBottom: 0xeaf4ff,
    fog: 0xe6f0fb,
    fogNear: 140,
    fogFar: 780,
    ground: '#eef4fb',
    groundSpeck: '#dbe6f2',
    road: '#56606e',
    roadLine: '#ffffff',
    curbA: '#2f6fdf',
    curbB: '#ffffff',
    wallA: '#e23b3b',
    wallB: '#ffffff',
    mountain: 0x8aa1bd,
    mountainCap: 0xffffff,
    hemiSky: 0xf0f6ff,
    hemiGround: 0x9fb3c9,
    sun: 0xffffff,
    names: ['Frozen Weights Summit', 'Cold Start Circuit', 'Glacier Gradient', 'Early Stopping Slopes', 'Frostbite Finetune'],
  },
  neon: {
    id: 'neon',
    skyTop: 0x05010f,
    skyBottom: 0x2a0a4a,
    fog: 0x1a0633,
    fogNear: 200,
    fogFar: 950,
    ground: '#0d0620',
    groundSpeck: '#2b1150',
    road: '#1d1433',
    roadLine: '#ff5cf4',
    curbA: '#20e3ff',
    curbB: '#ff4fd8',
    wallA: '#8a2cff',
    wallB: '#20e3ff',
    mountain: 0x2a1055,
    mountainCap: 0xff4fd8,
    hemiSky: 0x9a7dff,
    hemiGround: 0x220a44,
    sun: 0xd9c8ff,
    names: ['Reward Road', 'Latent Space Raceway', 'Attention Head Highway', 'Hyperparameter Hyperspace', 'Embedding Expressway'],
  },
};

export interface Track {
  seed: number;
  n: number;
  px: Float32Array;
  pz: Float32Array;
  /** Unit tangent (direction of travel). */
  tx: Float32Array;
  tz: Float32Array;
  /** Unit normal pointing to the driver's left. */
  nx: Float32Array;
  nz: Float32Array;
  /** Cumulative distance at each sample. */
  s: Float32Array;
  /** Signed curvature (rad/unit) at each sample. */
  k: Float32Array;
  length: number;
  /** Mean sample spacing. */
  ds: number;
  halfWidth: number;
  /** Distance from centerline to the barrier. */
  wallDist: number;
  theme: Theme;
  name: string;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
}

export const HALF_WIDTH = 9;
export const WALL_DIST = 16;

function buildFromPoints(pts: THREE.Vector3[], seed: number, theme: Theme, name: string): Track {
  const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal', 0.5);
  const approxLen = curve.getLength();
  const n = Math.max(200, Math.round(approxLen / 2));
  const spaced = curve.getSpacedPoints(n); // n+1 points, last == first
  const px = new Float32Array(n);
  const pz = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    px[i] = spaced[i].x;
    pz[i] = spaced[i].z;
  }
  const t = makeTrackArrays(px, pz);
  const bounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (let i = 0; i < n; i++) {
    bounds.minX = Math.min(bounds.minX, px[i]);
    bounds.maxX = Math.max(bounds.maxX, px[i]);
    bounds.minZ = Math.min(bounds.minZ, pz[i]);
    bounds.maxZ = Math.max(bounds.maxZ, pz[i]);
  }
  return { seed, n, px, pz, ...t, halfWidth: HALF_WIDTH, wallDist: WALL_DIST, theme, name, bounds };
}

function makeTrackArrays(px: Float32Array, pz: Float32Array) {
  const n = px.length;
  const tx = new Float32Array(n);
  const tz = new Float32Array(n);
  const nx = new Float32Array(n);
  const nz = new Float32Array(n);
  const s = new Float32Array(n);
  const k = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = (i - 1 + n) % n;
    const b = (i + 1) % n;
    let dx = px[b] - px[a];
    let dz = pz[b] - pz[a];
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;
    tx[i] = dx;
    tz[i] = dz;
    // Heading h has forward (sin h, cos h) and left (cos h, -sin h) => left = (tz, -tx).
    nx[i] = dz;
    nz[i] = -dx;
  }
  let acc = 0;
  for (let i = 0; i < n; i++) {
    s[i] = acc;
    const j = (i + 1) % n;
    acc += Math.hypot(px[j] - px[i], pz[j] - pz[i]);
  }
  const length = acc;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ha = Math.atan2(tx[i], tz[i]);
    const hb = Math.atan2(tx[j], tz[j]);
    let d = hb - ha;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    k[i] = d / (length / n);
  }
  // Smooth curvature a little so AI braking isn't jittery.
  const k2 = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let o = -3; o <= 3; o++) sum += k[(i + o + n) % n];
    k2[i] = sum / 7;
  }
  return { tx, tz, nx, nz, s, k: k2, length, ds: length / n };
}

function validate(t: Track): boolean {
  const { n, px, pz, k, ds } = t;
  // Tight corners are no fun and break the wall logic.
  for (let i = 0; i < n; i++) if (Math.abs(k[i]) > 1 / 20) return false;
  // Non-adjacent parts of the track must not come near each other (walls would overlap).
  const minSep = WALL_DIST * 2 + 10;
  const skip = Math.ceil((minSep * 2.2) / ds);
  const step = 2;
  for (let i = 0; i < n; i += step) {
    for (let j = i + skip; j < n; j += step) {
      if (n - j + i < skip) continue;
      const dx = px[i] - px[j];
      const dz = pz[i] - pz[j];
      if (dx * dx + dz * dz < minSep * minSep) return false;
    }
  }
  return true;
}

/** Rotate the sample arrays so index 0 sits on the straightest stretch (for the start grid). */
function rotateToStraight(t: Track): Track {
  const { n, k } = t;
  const win = Math.round(60 / t.ds);
  let best = 0;
  let bestScore = Infinity;
  for (let i = 0; i < n; i++) {
    let sc = 0;
    for (let o = -win; o <= Math.round(win / 2); o++) sc += Math.abs(k[(i + o + n) % n]);
    if (sc < bestScore) {
      bestScore = sc;
      best = i;
    }
  }
  const px = new Float32Array(n);
  const pz = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    px[i] = t.px[(i + best) % n];
    pz[i] = t.pz[(i + best) % n];
  }
  return { ...t, px, pz, ...makeTrackArrays(px, pz) };
}

export function themeForLevel(level: number, rng: Rng, mode: 'campaign' | 'turbo'): Theme {
  if (mode === 'turbo') return THEMES.neon;
  const order: ThemeId[] = ['grass', 'desert', 'snow', 'neon'];
  if (level <= 4) return THEMES[order[level - 1]];
  return THEMES[pick(rng, order)];
}

export function generateTrack(seed: number, level: number, mode: 'campaign' | 'turbo'): Track {
  const rngTheme = mulberry32(seed ^ 0x9e3779b9);
  const theme = themeForLevel(level, rngTheme, mode);
  const name = pick(rngTheme, theme.names);
  for (let attempt = 0; attempt < 60; attempt++) {
    const rng = mulberry32(seed + attempt * 7919);
    const N = randInt(rng, 8, 12);
    const baseR = 95 + Math.min(level, 8) * 5 + randRange(rng, -8, 16);
    const stretch = randRange(rng, 0.8, 1.35);
    const rot = rng() * Math.PI * 2;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < N; i++) {
      const a = ((i + randRange(rng, -0.3, 0.3)) / N) * Math.PI * 2;
      const r = baseR * randRange(rng, 0.55, 1.2);
      const x0 = Math.cos(a) * r * stretch;
      const z0 = Math.sin(a) * r;
      pts.push(new THREE.Vector3(x0 * Math.cos(rot) - z0 * Math.sin(rot), 0, x0 * Math.sin(rot) + z0 * Math.cos(rot)));
    }
    const t = buildFromPoints(pts, seed, theme, name);
    if (validate(t)) return rotateToStraight(t);
  }
  // Fallback: an oval, always valid.
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * 170, 0, Math.sin(a) * 110));
  }
  return rotateToStraight(buildFromPoints(pts, seed, theme, name));
}

/** Nearest sample index to (x, z), searching a window around `hint` (or the whole track if hint < 0). */
export function nearestIndex(t: Track, x: number, z: number, hint: number, window = 40): number {
  const { n, px, pz } = t;
  let best = 0;
  let bestD = Infinity;
  if (hint < 0) {
    for (let i = 0; i < n; i++) {
      const dx = px[i] - x;
      const dz = pz[i] - z;
      const d = dx * dx + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }
  for (let o = -window; o <= window; o++) {
    const i = (hint + o + n) % n;
    const dx = px[i] - x;
    const dz = pz[i] - z;
    const d = dx * dx + dz * dz;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** Signed lateral offset (left positive) and along-track distance of (x, z) relative to sample i. */
export function project(t: Track, i: number, x: number, z: number): { lateral: number; s: number } {
  const dx = x - t.px[i];
  const dz = z - t.pz[i];
  const along = dx * t.tx[i] + dz * t.tz[i];
  let s = t.s[i] + along;
  if (s < 0) s += t.length;
  if (s >= t.length) s -= t.length;
  return { lateral: dx * t.nx[i] + dz * t.nz[i], s };
}

/** World position at along-track distance s and lateral offset. */
export function pointAt(t: Track, s: number, lateral: number): { x: number; z: number; i: number } {
  s = ((s % t.length) + t.length) % t.length;
  // Binary search for the sample.
  let lo = 0;
  let hi = t.n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (t.s[mid] <= s) lo = mid;
    else hi = mid - 1;
  }
  const i = lo;
  const j = (i + 1) % t.n;
  const segLen = (j === 0 ? t.length : t.s[j]) - t.s[i];
  const f = segLen > 0 ? (s - t.s[i]) / segLen : 0;
  const x = t.px[i] + (t.px[j] - t.px[i]) * f + t.nx[i] * lateral;
  const z = t.pz[i] + (t.pz[j] - t.pz[i]) * f + t.nz[i] * lateral;
  return { x, z, i };
}

export function headingAt(t: Track, i: number): number {
  return Math.atan2(t.tx[i], t.tz[i]);
}
