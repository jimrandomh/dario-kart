// Small shared helpers. No game logic lives here.

/** Deterministic PRNG (mulberry32). Returns a function producing floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Rng = () => number;

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
export const randRange = (rng: Rng, lo: number, hi: number) => lo + (hi - lo) * rng();
export const randInt = (rng: Rng, lo: number, hiInclusive: number) =>
  lo + Math.floor(rng() * (hiInclusive - lo + 1));
export const pick = <T>(rng: Rng, arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)];

export function shuffle<T>(rng: Rng, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Wrap an angle to (-PI, PI]. */
export function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a <= -Math.PI) a += Math.PI * 2;
  return a;
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type Attrs = Record<string, string | number | boolean | undefined | null | EventListener>;

/**
 * Tiny DOM builder. `el('div', {class: 'x', onclick: fn}, 'text', childEl)`.
 * Keys starting with "on" are attached as event listeners; `style` may be a CSS string.
 */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs | null = null,
  ...children: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') {
        node.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      } else if (k === 'class') {
        node.className = String(v);
      } else if (k === 'html') {
        node.innerHTML = String(v);
      } else if (v === true) {
        node.setAttribute(k, '');
      } else {
        node.setAttribute(k, String(v));
      }
    }
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    node.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

const SI = ['', 'k', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];

/** Human-friendly big numbers: 1234 -> "1.23k", 5.6e30 -> "5.60e30". */
export function fmtNum(n: number, digits = 2): string {
  if (!isFinite(n)) return n > 0 ? '∞' : n < 0 ? '-∞' : 'NaN';
  const sign = n < 0 ? '-' : '';
  n = Math.abs(n);
  if (n < 1000) return sign + (Number.isInteger(n) ? String(n) : n.toFixed(n < 10 ? digits : 1));
  const tier = Math.floor(Math.log10(n) / 3);
  if (tier < SI.length) return sign + (n / Math.pow(1000, tier)).toFixed(digits) + SI[tier];
  return sign + n.toExponential(digits).replace('e+', 'e');
}

/** Format seconds as m:ss.cc */
export function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
