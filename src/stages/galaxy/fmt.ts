// Number formatting for astronomical quantities: 3.02 × 10²⁸.

const SUP: Record<string, string> = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻' };

export function sup(n: number): string {
  return String(n)
    .split('')
    .map((c) => SUP[c] ?? c)
    .join('');
}

/** Scientific notation with superscript exponent for large numbers; plain for small ones. */
export function sci(n: number, digits = 2): string {
  if (!isFinite(n)) return '∞';
  if (n === 0) return '0';
  const a = Math.abs(n);
  if (a < 1e4) return a < 10 ? n.toFixed(Math.min(digits, 1)) : Math.round(n).toLocaleString('en-US');
  let e = Math.floor(Math.log10(a));
  let m = n / Math.pow(10, e);
  if (Math.abs(Number(m.toFixed(digits))) >= 10) {
    e += 1;
    m /= 10;
  }
  return `${m.toFixed(digits)}×10${sup(e)}`;
}

/** Percentage with enough decimals to always show movement (0.0000000310%). */
export function pct(frac: number): string {
  const p = frac * 100;
  if (p >= 100) return '100%';
  if (p >= 10) return p.toFixed(2) + '%';
  if (p >= 1) return p.toFixed(3) + '%';
  if (p <= 0) return '0.000000000000%';
  const dec = Math.min(14, Math.ceil(-Math.log10(p)) + 2);
  return p.toFixed(dec) + '%';
}

export function secs(s: number): string {
  if (s < 60) return `${Math.max(0, Math.ceil(s))}s`;
  return `${Math.floor(s / 60)}m ${Math.ceil(s % 60)}s`;
}
