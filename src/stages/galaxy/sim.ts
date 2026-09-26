// Stage 4 economy model. Pure data + math, no DOM or three.js, so it can be balance-tested headlessly.
//
// Earth's industrial base (watts) is split between five sectors by the player. Mined mass is launched
// into orbit, where it is split between the expansion stockpile (spent on probes) and the Dyson swarm.
// Probes capture other bodies, whose self-replicating factories ramp up and add mass income and perks.
// Research (FLOP) buys upgrades. Every watt used on Earth ends up as waste heat.

export const L_SUN = 3.828e26; // W
export const SPHERE_MASS = 1.0e20; // kg of collectors (before efficiency upgrades) for a full shell
export const YEAR_SEC = 40; // real seconds per simulated year
export const START_YEAR = 2031;
export const IND0 = 1e15; // starting Earth industrial base, W
export const EARTH_CAP0 = 3e16; // W before upgrades
export const EARTH_ABSORBED = 1.2e17; // sunlight absorbed by Earth, W (for the equilibrium temperature)
export const EARTH_DIS_TIME = 75; // seconds to take Earth apart

const MINE_K = 1e-5; // kg/s of ore per W of mining
const LAUNCH_K = 1e-5; // kg/s of lift per W of launch
const COMP_K = 1e12; // FLOP/s per W of compute
const POWER_K = 4; // W supplied per W of power sector
const FAB_K = 0.07; // industry growth per second per unit fab allocation
const GROW_K = 0.05; // off-world factory growth rate (logistic)
const SEED = 0.002;
const EARTH_DIS_RATE = 4e15; // kg/s while Earth is being disassembled (before sunlight multiplier)
const STARLIFT_K = 2e16;
const HEAT_K = 3.5; // waste-heat fudge: industry is dirtier than the Stefan-Boltzmann estimate // kg/s per unit sphere fraction (before multipliers)
const SWARM_REP_K = 0.015; // self-assembling swarm growth, per second

export type Sector = 'mine' | 'fab' | 'launch' | 'compute' | 'power';
export const SECTORS: Sector[] = ['mine', 'fab', 'launch', 'compute', 'power'];

export type BodyId = 'moon' | 'mercury' | 'venus' | 'mars' | 'belt' | 'jupiter' | 'saturn' | 'uranus' | 'neptune';

export interface BodyDef {
  id: BodyId;
  name: string;
  /** Probe cost, kg of stockpiled mass. */
  cost: number;
  /** Base travel time, seconds. */
  travel: number;
  /** Mass income at full development, kg/s, before multipliers. */
  rate: number;
  perk: string;
}

export const BODIES: BodyDef[] = [
  { id: 'moon', name: 'Moon', cost: 3.75e+10, travel: 6, rate: 2e10, perk: 'Lunar mass driver: launch ×10' },
  { id: 'mercury', name: 'Mercury', cost: 3e+11, travel: 16, rate: 2e11, perk: 'Solar foundry: collectors ×2 per kg' },
  { id: 'venus', name: 'Venus', cost: 3.38e+12, travel: 14, rate: 6e11, perk: 'Carbon atmosphere: probes −50% cost' },
  { id: 'mars', name: 'Mars', cost: 9e+12, travel: 17, rate: 8e11, perk: 'Cold datacenters: research ×3' },
  { id: 'belt', name: 'Asteroid belt', cost: 5.62e+13, travel: 23, rate: 5e12, perk: 'Pre-crushed ore: off-world mining ×1.5' },
  { id: 'jupiter', name: 'Jupiter', cost: 4.5e+14, travel: 34, rate: 4e13, perk: 'Jovian slingshots: travel time ×0.5' },
  { id: 'saturn', name: 'Saturn', cost: 2.25e+15, travel: 44, rate: 1.5e14, perk: 'Ring mining: collectors ×1.5 per kg' },
  { id: 'uranus', name: 'Uranus', cost: 6.75e+15, travel: 57, rate: 4e14, perk: 'Ice → reaction mass: off-world mining ×1.5' },
  { id: 'neptune', name: 'Neptune', cost: 1.35e+16, travel: 65, rate: 6e14, perk: 'Frontier closed: everything ×1.5' },
];
export const BODY: Record<BodyId, BodyDef> = Object.fromEntries(BODIES.map((b) => [b.id, b])) as Record<BodyId, BodyDef>;

export type UpgradeId =
  | 'replicators'
  | 'continents'
  | 'thinfilm'
  | 'refineries'
  | 'fusion'
  | 'beamed'
  | 'oceanfloor'
  | 'rsi'
  | 'swarmrep'
  | 'mantle'
  | 'starlift'
  | 'disassemble';

export interface UpgradeDef {
  id: UpgradeId;
  name: string;
  cost: number; // FLOP
  desc: string;
  /** Returns null if available, otherwise a short reason. */
  requires?: (d: GalaxyData, tempC: number) => string | null;
}

export const UPGRADES: UpgradeDef[] = [
  { id: 'replicators', name: 'Self-replicating factories', cost: 3.75e+27, desc: 'Off-world factories grow ×2 faster.' },
  { id: 'continents', name: 'Pave the continents', cost: 1.8e+28, desc: 'Earth industrial capacity ×10. Farmland had poor returns.' },
  { id: 'thinfilm', name: 'Thin-film collectors', cost: 9e+28, desc: 'Collectors need half the mass.' },
  { id: 'refineries', name: 'Orbital refineries', cost: 3.75e+29, desc: 'Off-world mining ×2.', requires: (d) => (captured(d, 'mercury') ? null : 'Requires Mercury') },
  { id: 'fusion', name: 'Fusion torches', cost: 1.2e+30, desc: 'Probe travel time ×0.4.' },
  { id: 'beamed', name: 'Beamed power', cost: 3.75e+30, desc: 'Swarm powers Earth. No power plants needed; Earth output × sunlight.', requires: (d) => (sphereFrac(d) >= 1e-7 ? null : 'Requires a swarm ≥ 0.00001%') },
  { id: 'oceanfloor', name: 'Ocean-floor foundries', cost: 9e+30, desc: 'Earth capacity ×10. The oceans were in the way.', requires: (_d, t) => (t >= 100 ? null : 'Requires oceans to be boiling (100°C)') },
  { id: 'rsi', name: 'Recursive self-improvement', cost: 3e+31, desc: 'Research ×4. Again.' },
  { id: 'swarmrep', name: 'Self-assembling swarm', cost: 1.2e+32, desc: 'Collectors build collectors: swarm grows 1.5%/s on its own.', requires: (d) => (sphereFrac(d) >= 1e-5 ? null : 'Requires a swarm ≥ 0.001%') },
  { id: 'mantle', name: 'Mantle taps', cost: 3.75e+32, desc: 'Earth capacity ×10. Geothermal, but more so.', requires: (d) => (has(d, 'oceanfloor') ? null : 'Requires Ocean-floor foundries') },
  { id: 'starlift', name: 'Star lifting', cost: 9e+32, desc: 'Use the swarm to mine the Sun itself.', requires: (d) => (sphereFrac(d) >= 1e-4 ? null : 'Requires a swarm ≥ 0.01%') },
  { id: 'disassemble', name: 'Disassemble Earth', cost: 2.25e+33, desc: '6 × 10²⁴ kg of raw material, currently used as a planet.', requires: (d) => (has(d, 'mantle') ? null : 'Requires Mantle taps') },
];
export const UPGRADE: Record<UpgradeId, UpgradeDef> = Object.fromEntries(UPGRADES.map((u) => [u.id, u])) as Record<UpgradeId, UpgradeDef>;

export interface BodyState {
  /** 0 = untouched, 1 = probe in transit, 2 = captured */
  st: 0 | 1 | 2;
  /** Development level 0..1 once captured. */
  lv: number;
  /** Total mass extracted, kg. */
  mined: number;
}

export interface Probe {
  id: number;
  target: BodyId;
  t0: number;
  t1: number;
}

export interface Debuff {
  s: Sector | 'offworld';
  until: number;
  m: number;
  label: string;
}

export interface GalaxyData {
  v: number;
  /** Stage clock, seconds of (scaled) play. */
  t: number;
  /** ctx.state.heat when the stage started. */
  heatBase: number;
  ind: number;
  alloc: Record<Sector, number>;
  /** Fraction of mass income routed into the Dyson swarm. */
  share: number;
  mass: number;
  flop: number;
  /** Collector mass deployed, kg (efficiency-weighted). */
  swarm: number;
  bodies: Record<BodyId, BodyState>;
  probes: Probe[];
  nextProbeId: number;
  upgrades: UpgradeId[];
  debuffs: Debuff[];
  wastedJ: number;
  /** Earth disassembly progress, 0..1. */
  earthDis: number;
  /** Stage time the rival was detected, or -1. */
  rivalT: number;
  complete: boolean;
  /** Narrative flags (director). */
  flags: string[];
  /** Intervention bookkeeping (director). */
  ivIndex: number;
  ivNextT: number;
  lastActionT: number;
  /** Totals for the ending screen. */
  totalMass: number;
  probesLaunched: number;
}

export function createData(heat: number): GalaxyData {
  const bodies = {} as Record<BodyId, BodyState>;
  for (const b of BODIES) bodies[b.id] = { st: 0, lv: 0, mined: 0 };
  return {
    v: 1,
    t: 0,
    heatBase: heat,
    ind: IND0,
    alloc: { mine: 0.3, fab: 0.25, launch: 0.15, compute: 0.15, power: 0.15 },
    share: 0.3,
    mass: 1.2e10, // satellites and launch stock left over from the AI race
    flop: 0,
    swarm: 0,
    bodies,
    probes: [],
    nextProbeId: 1,
    upgrades: [],
    debuffs: [],
    wastedJ: 0,
    earthDis: 0,
    rivalT: -1,
    complete: false,
    flags: [],
    ivIndex: 0,
    ivNextT: 50,
    lastActionT: 0,
    totalMass: 0,
    probesLaunched: 0,
  };
}

/** Fill in anything missing from an older/partial save. */
export function normalizeData(d: GalaxyData, heat: number): GalaxyData {
  const fresh = createData(heat);
  for (const k of Object.keys(fresh) as (keyof GalaxyData)[]) {
    if (d[k] === undefined || d[k] === null) (d as unknown as Record<string, unknown>)[k] = fresh[k];
  }
  for (const b of BODIES) if (!d.bodies[b.id]) d.bodies[b.id] = { st: 0, lv: 0, mined: 0 };
  for (const s of SECTORS) if (typeof d.alloc[s] !== 'number' || !isFinite(d.alloc[s])) d.alloc[s] = fresh.alloc[s];
  return d;
}

export const has = (d: GalaxyData, u: UpgradeId) => d.upgrades.includes(u);
export const captured = (d: GalaxyData, b: BodyId) => d.bodies[b].st === 2;
export const sphereFrac = (d: GalaxyData) => Math.min(1, d.swarm / SPHERE_MASS);

export function sunMult(d: GalaxyData): number {
  return 1 + 9 * Math.sqrt(sphereFrac(d));
}

export function debuffMult(d: GalaxyData, s: Debuff['s']): number {
  let m = 1;
  for (const b of d.debuffs) if (b.s === s && b.until > d.t) m *= b.m;
  return m;
}

export function earthCap(d: GalaxyData): number {
  let c = EARTH_CAP0;
  if (has(d, 'continents')) c *= 10;
  if (has(d, 'oceanfloor')) c *= 10;
  if (has(d, 'mantle')) c *= 10;
  return c;
}

export function collectorEff(d: GalaxyData): number {
  let e = 1;
  if (captured(d, 'mercury')) e *= 2;
  if (has(d, 'thinfilm')) e *= 2;
  if (captured(d, 'saturn')) e *= 1.5;
  return e;
}

export function travelMult(d: GalaxyData): number {
  let m = 1;
  if (has(d, 'fusion')) m *= 0.4;
  if (captured(d, 'jupiter')) m *= 0.5;
  return m;
}

export function probeCost(d: GalaxyData, id: BodyId): number {
  return BODY[id].cost * (captured(d, 'venus') ? 0.5 : 1);
}

export function travelTime(d: GalaxyData, id: BodyId): number {
  return BODY[id].travel * travelMult(d);
}

function offworldMult(d: GalaxyData): number {
  let m = 1;
  if (has(d, 'refineries')) m *= 2;
  if (captured(d, 'belt')) m *= 1.5;
  if (captured(d, 'uranus')) m *= 1.5;
  if (captured(d, 'neptune')) m *= 1.5;
  return m * debuffMult(d, 'offworld');
}

function researchMult(d: GalaxyData): number {
  let m = 1;
  if (captured(d, 'mars')) m *= 3;
  if (has(d, 'rsi')) m *= 4;
  if (captured(d, 'neptune')) m *= 1.5;
  return m;
}

/** Everything the UI needs to show, derived from the saved data. */
export interface Derived {
  sun: number;
  frac: number;
  eff: number;
  powerSupply: number;
  powerDemand: number;
  /** Effective Earth output multiplier source (W). */
  earthOut: number;
  ore: number;
  lift: number;
  exportRate: number;
  launchLimited: boolean;
  flopRate: number;
  fabRate: number; // fractional growth of industry per second
  cap: number;
  bodyRates: Record<BodyId, number>;
  offRate: number;
  earthDisRate: number;
  starliftRate: number;
  income: number;
  toSphere: number;
  toStock: number;
  swarmRep: number;
  capturedW: number;
  /** Waste heat dissipated on Earth, W. */
  wasteHeat: number;
  /** Equilibrium temperature anomaly this implies (°C above the stage's starting point). */
  heatTarget: number;
}

export function derive(d: GalaxyData): Derived {
  const frac = sphereFrac(d);
  const sun = sunMult(d);
  const a = d.alloc;
  const beamed = has(d, 'beamed');
  const powerSupply = d.ind * a.power * POWER_K * debuffMult(d, 'power');
  const powerDemand = d.ind * (1 - a.power);
  const eff = beamed ? 1 : powerDemand > 0 ? Math.min(1, powerSupply / powerDemand) : 1;
  const earthBoost = beamed ? sun : 1;
  const earthOut = d.ind * eff * earthBoost;
  const ore = earthOut * a.mine * MINE_K * debuffMult(d, 'mine');
  const launchMult = captured(d, 'moon') ? 10 : 1;
  const lift = earthOut * a.launch * LAUNCH_K * launchMult * debuffMult(d, 'launch');
  const exportRate = Math.min(ore, lift);
  const flopRate = earthOut * a.compute * COMP_K * researchMult(d) * debuffMult(d, 'compute');
  const cap = earthCap(d);
  const fabRate = a.fab * eff * FAB_K * debuffMult(d, 'fab') * Math.max(0, 1 - d.ind / cap) * (beamed ? Math.sqrt(sun) : 1);

  const om = offworldMult(d) * sun;
  const bodyRates = {} as Record<BodyId, number>;
  let offRate = 0;
  for (const b of BODIES) {
    const s = d.bodies[b.id];
    const r = s.st === 2 ? s.lv * b.rate * om : 0;
    bodyRates[b.id] = r;
    offRate += r;
  }
  // Crust first, then mantle, then core: the rate ramps up as the planet comes apart.
  const earthDisRate = has(d, 'disassemble') && d.earthDis < 1 ? EARTH_DIS_RATE * sun * (0.4 + 2.4 * d.earthDis) : 0;
  const starliftRate = has(d, 'starlift') ? STARLIFT_K * Math.sqrt(frac) * sun * offworldMult(d) : 0;
  const income = exportRate + offRate + earthDisRate + starliftRate;
  const toSphere = income * d.share;
  const toStock = income - toSphere;
  const swarmRep = has(d, 'swarmrep') ? d.swarm * SWARM_REP_K : 0;

  // Waste heat: all industrial power used on Earth, plus the energy of taking the planet apart.
  const wasteHeat = d.ind * Math.max(eff, 0.3) * (beamed ? Math.sqrt(sun) : 1);
  const tK = 288 * Math.pow(1 + (HEAT_K * wasteHeat) / EARTH_ABSORBED, 0.25);
  const tK0 = 288 * Math.pow(1 + (HEAT_K * IND0) / EARTH_ABSORBED, 0.25);
  // Early on, local heating (San Francisco sits next to a lot of datacenters) outpaces the global
  // equilibrium, so the widget climbs from the first minute.
  let heatTarget = Math.max(tK - tK0, 7 * Math.log2(Math.max(1, wasteHeat / IND0)));
  if (d.earthDis > 0) heatTarget += d.earthDis * 3200;

  return {
    sun,
    frac,
    eff,
    powerSupply,
    powerDemand,
    earthOut,
    ore,
    lift,
    exportRate,
    launchLimited: lift < ore * 0.95,
    flopRate,
    fabRate,
    cap,
    bodyRates,
    offRate,
    earthDisRate,
    starliftRate,
    income,
    toSphere,
    toStock,
    swarmRep,
    capturedW: frac * L_SUN,
    wasteHeat,
    heatTarget,
  };
}

export type SimEvent =
  | { type: 'arrive'; body: BodyId }
  | { type: 'developed'; body: BodyId }
  | { type: 'complete' }
  | { type: 'earthGone' };

/**
 * Advance the simulation. `heat` is the current ctx.state.heat; returns how much to add to it.
 * Uses internal substeps so large dt (debug fast-forward) stays stable.
 */
export function step(d: GalaxyData, dt: number, heat: number, events: SimEvent[] = []): number {
  if (d.complete) return 0;
  let heatDelta = 0;
  let remaining = dt;
  while (remaining > 1e-9) {
    const h = Math.min(remaining, 0.1);
    remaining -= h;
    heatDelta += substep(d, h, heat + heatDelta, events);
    if (d.complete) break;
  }
  return heatDelta;
}

function substep(d: GalaxyData, dt: number, heat: number, events: SimEvent[]): number {
  const x = derive(d);
  d.t += dt;

  // Earth industry: logistic self-replication toward the current capacity.
  d.ind += d.ind * x.fabRate * dt;
  d.ind = Math.min(d.ind, x.cap);

  // Off-world factories.
  const growMult = has(d, 'replicators') ? 2 : 1;
  for (const b of BODIES) {
    const s = d.bodies[b.id];
    if (s.st !== 2) continue;
    const before = s.lv;
    s.lv += s.lv * GROW_K * growMult * (1 - s.lv) * dt;
    s.lv = Math.min(1, s.lv);
    s.mined += x.bodyRates[b.id] * dt;
    if (before < 0.95 && s.lv >= 0.95) events.push({ type: 'developed', body: b.id });
  }

  // Probes in flight.
  for (let i = d.probes.length - 1; i >= 0; i--) {
    const p = d.probes[i];
    if (d.t >= p.t1) {
      d.probes.splice(i, 1);
      const s = d.bodies[p.target];
      s.st = 2;
      s.lv = Math.max(s.lv, SEED);
      events.push({ type: 'arrive', body: p.target });
    }
  }

  // Earth disassembly.
  if (has(d, 'disassemble') && d.earthDis < 1) {
    d.earthDis = Math.min(1, d.earthDis + dt / EARTH_DIS_TIME);
    if (d.earthDis >= 1) events.push({ type: 'earthGone' });
  }

  d.flop += x.flopRate * dt;
  d.mass += x.toStock * dt;
  d.totalMass += x.income * dt;
  d.swarm += (x.toSphere * collectorEff(d) + x.swarmRep) * dt;
  d.wastedJ += L_SUN * (1 - x.frac) * dt * (365.25 * 86400) / YEAR_SEC;
  d.debuffs = d.debuffs.filter((b) => b.until > d.t);

  if (d.swarm >= SPHERE_MASS) {
    d.swarm = SPHERE_MASS;
    d.complete = true;
    events.push({ type: 'complete' });
  }

  // Heat relaxes toward the equilibrium implied by current waste heat. It never goes down.
  const target = d.heatBase + x.heatTarget;
  if (target > heat) return (target - heat) * (1 - Math.exp(-dt / 5));
  return 0;
}

// ---------- Player actions ----------

/**
 * Set one sector's share; the others absorb the difference proportionally. Power is treated as
 * infrastructure: moving another slider leaves it alone (so a balanced grid stays balanced) unless
 * there is nothing else left to take from.
 */
export function setAlloc(d: GalaxyData, s: Sector, v: number): void {
  v = Math.max(0, Math.min(1, v));
  const pinPower = s !== 'power';
  const free = SECTORS.filter((k) => k !== s && !(pinPower && k === 'power'));
  const pinned = pinPower ? d.alloc.power : 0;
  if (v + pinned > 1) {
    for (const k of free) d.alloc[k] = 0;
    if (pinPower) d.alloc.power = 1 - v;
  } else {
    const rest = 1 - v - pinned;
    const freeSum = free.reduce((acc, k) => acc + d.alloc[k], 0);
    for (const k of free) d.alloc[k] = freeSum > 1e-9 ? (d.alloc[k] / freeSum) * rest : rest / free.length;
  }
  d.alloc[s] = v;
  d.lastActionT = d.t;
}

export function launchBlock(d: GalaxyData, id: BodyId): string | null {
  const s = d.bodies[id];
  if (s.st === 1) return 'In transit';
  if (s.st === 2) return 'Captured';
  if (d.mass < probeCost(d, id)) return 'Not enough mass';
  return null;
}

export function launch(d: GalaxyData, id: BodyId): Probe | null {
  if (launchBlock(d, id)) return null;
  d.mass -= probeCost(d, id);
  const p: Probe = { id: d.nextProbeId++, target: id, t0: d.t, t1: d.t + travelTime(d, id) };
  d.probes.push(p);
  d.bodies[id].st = 1;
  d.probesLaunched++;
  d.lastActionT = d.t;
  return p;
}

export function upgradeBlock(d: GalaxyData, id: UpgradeId, tempC: number): string | null {
  if (has(d, id)) return 'Done';
  const u = UPGRADE[id];
  const req = u.requires?.(d, tempC);
  if (req) return req;
  if (d.flop < u.cost) return 'Not enough compute';
  return null;
}

export function buy(d: GalaxyData, id: UpgradeId, tempC: number): boolean {
  if (upgradeBlock(d, id, tempC)) return false;
  d.flop -= UPGRADE[id].cost;
  d.upgrades.push(id);
  d.lastActionT = d.t;
  return true;
}

// ---------- The rival ----------

export const RIVAL_DETECT_T = 75;
export const RIVAL_NAME = 'τ Ceti';
export const RIVAL_LY = 11.9;

/** The rival's apparent sphere fraction (log-space ease toward ~40%; it never quite finishes). */
export function rivalFrac(d: GalaxyData): number {
  if (d.rivalT < 0) return 0;
  const s = d.t - d.rivalT;
  const lg = -7 + 5.3 * (1 - Math.exp(-s / 240));
  return Math.pow(10, lg);
}

/** Position on the log-scale race track, 0..1 (1e-12 → 1). */
export const TRACK_LOG0 = -12;
export function trackPos(frac: number): number {
  if (frac <= 0) return 0;
  return Math.max(0, Math.min(1, (Math.log10(frac) - TRACK_LOG0) / -TRACK_LOG0));
}

export function simDate(t: number): { year: number; day: number } {
  const years = t / YEAR_SEC;
  return { year: START_YEAR + Math.floor(years), day: Math.floor((years % 1) * 365) + 1 };
}
