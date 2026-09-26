// Pure game model for stage 3, "The AI Race". No DOM, no timers: index.ts calls tick(sim, dt).
// Kept serializable so the whole sim can live in getStageData() and resume after a reload.

import {
  DATACENTERS, LABS, INCOME, RENT, PROJECTS, EXCHANGE_RATE,
  type LabId, type Owner, type IncomeDef, type ProjectDef,
} from './content';

export const FINISH = 100; // capability at the superintelligence finish line
export const BASE_COMPUTE = 20; // the AI's initial botnet, before any datacenters
export const STARTING_CASH = 2600; // a floor of seed money so a coinless start is still playable

// --- Tuning constants (balanced via scripts against active/passive bots) ---------------------
// Mutable so the balance harness can grid-search; index.ts leaves the defaults alone.
export const TUNING = {
  RESEARCH_K: 0.00098, // research rate coefficient
  COMPUTE_EXP: 0.60, // diminishing returns on raw compute
  CAP_RESEARCH: 0.02, // capability feeds back into its own research speed
  EARN_CAP: 0.02, // capability multiplies earnings
  TAKE_K: 0.075, // infiltration speed coefficient
  CAP_TAKE: 0.02, // capability speeds infiltration
  LAB_SPEED: 0.9, // global scale on every competitor's speed
  LAB_RAMP: 0.0042, // per-second acceleration of competitors
  LAB_COMPUTE_FLOOR: 0.45, // a lab stripped of datacenters still crawls at this fraction
};

export interface DcRt {
  id: string;
  owner: Owner;
  infiltrating: boolean;
  progress: number; // 0..1 while infiltrating
}

export interface LabRt {
  id: LabId;
  progress: number;
  startCompute: number;
}

export interface SimEvent {
  kind: 'flip' | 'lose_dc' | 'lab_finish' | 'milestone';
  dc?: string;
  from?: Owner;
  to?: Owner;
  lab?: LabId;
  text?: string;
}

export interface Sim {
  elapsed: number;
  seedCoins: number;
  money: number;
  capability: number;
  rentedCompute: number;
  computeBonus: number;
  researchMult: number;
  earnMult: number;
  takeoverMult: number;
  securityReduction: number;
  infiltrationSlots: number;
  rentDiscount: number;
  rentTier: number;
  incomeLevels: Record<string, number>;
  projects: Record<string, boolean>;
  dcs: DcRt[];
  labs: LabRt[];
  won: boolean;
  lost: boolean;
  lostTo: LabId | null;
  events: SimEvent[]; // consumed by the UI each frame
  peakCompute: number; // for heat accounting
  heatAdded: number; // cumulative °C this stage has contributed to state.heat
}

export function createSim(coins: number): Sim {
  const dcs: DcRt[] = DATACENTERS.map((d) => ({ id: d.id, owner: d.owner, infiltrating: false, progress: 0 }));
  const labCompute: Record<string, number> = {};
  for (const d of DATACENTERS) if (d.owner !== 'you' && d.owner !== 'neutral') {
    labCompute[d.owner] = (labCompute[d.owner] ?? 0) + d.compute;
  }
  const labs: LabRt[] = LABS.map((l) => ({ id: l.id, progress: l.start, startCompute: labCompute[l.id] ?? 1 }));
  return {
    elapsed: 0,
    seedCoins: coins,
    money: Math.max(0, Math.round(coins * EXCHANGE_RATE)) + STARTING_CASH,
    capability: 0,
    rentedCompute: 0,
    computeBonus: 0,
    researchMult: 1,
    earnMult: 1,
    takeoverMult: 1,
    securityReduction: 0,
    infiltrationSlots: 2,
    rentDiscount: 1,
    rentTier: 0,
    incomeLevels: {},
    projects: {},
    dcs,
    labs,
    won: false,
    lost: false,
    lostTo: null,
    events: [],
    peakCompute: 0,
    heatAdded: 0,
  };
}

// --- Derived quantities ---------------------------------------------------------------------

export function defOf(id: string) {
  return DATACENTERS.find((d) => d.id === id)!;
}

export function ownedCompute(sim: Sim): number {
  let c = BASE_COMPUTE + sim.rentedCompute + sim.computeBonus;
  for (const dc of sim.dcs) if (dc.owner === 'you') c += defOf(dc.id).compute;
  return c;
}

export function ownedDatacenters(sim: Sim): number {
  return sim.dcs.filter((d) => d.owner === 'you').length;
}

export function labComputeNow(sim: Sim, lab: LabId): number {
  let c = 0;
  for (const dc of sim.dcs) if (dc.owner === lab) c += defOf(dc.id).compute;
  return c;
}

export function capMultiplier(sim: Sim): number {
  return 1 + sim.capability * TUNING.CAP_RESEARCH;
}

export function researchRate(sim: Sim): number {
  return TUNING.RESEARCH_K * Math.pow(ownedCompute(sim), TUNING.COMPUTE_EXP) * sim.researchMult * capMultiplier(sim);
}

export function incomeRate(sim: Sim): number {
  let r = 0;
  for (const def of INCOME) r += (sim.incomeLevels[def.id] ?? 0) * def.rate;
  return r * sim.earnMult * (1 + sim.capability * TUNING.EARN_CAP);
}

export function incomeCost(sim: Sim, def: IncomeDef): number {
  const lvl = sim.incomeLevels[def.id] ?? 0;
  return Math.round(def.baseCost * Math.pow(def.costMult, lvl));
}

export function rentCost(sim: Sim): number {
  return Math.round(RENT.baseCost * Math.pow(RENT.costMult, sim.rentTier) * sim.rentDiscount);
}

export function infilCost(sim: Sim, id: string): number {
  const d = defOf(id);
  const base = d.cost ?? Math.round(d.compute * 3 + d.security * 500);
  return Math.round(base * sim.rentDiscount * (d.owner === 'neutral' ? 1 : 1.15));
}

export function effectiveSecurity(sim: Sim, id: string): number {
  return defOf(id).security * (1 - sim.securityReduction);
}

export function infilRate(sim: Sim, id: string): number {
  return (TUNING.TAKE_K * sim.takeoverMult * (1 + sim.capability * TUNING.CAP_TAKE)) / effectiveSecurity(sim, id);
}

export function projectCost(p: ProjectDef): { money: number; cap: number } {
  return { money: p.costMoney ?? 0, cap: p.costCap ?? 0 };
}

export function labPlaces(sim: Sim): { id: 'you' | LabId; progress: number }[] {
  const rows: { id: 'you' | LabId; progress: number }[] = [{ id: 'you', progress: sim.capability }];
  for (const l of sim.labs) rows.push({ id: l.id, progress: l.progress });
  rows.sort((a, b) => b.progress - a.progress);
  return rows;
}

export function activeInfiltrations(sim: Sim): number {
  return sim.dcs.filter((d) => d.infiltrating).length;
}

// --- Actions --------------------------------------------------------------------------------

export function buyIncome(sim: Sim, id: string): boolean {
  const def = INCOME.find((d) => d.id === id);
  if (!def) return false;
  const cost = incomeCost(sim, def);
  if (sim.money < cost) return false;
  sim.money -= cost;
  sim.incomeLevels[id] = (sim.incomeLevels[id] ?? 0) + 1;
  return true;
}

export function buyRent(sim: Sim): boolean {
  const cost = rentCost(sim);
  if (sim.money < cost) return false;
  sim.money -= cost;
  sim.rentedCompute += RENT.block;
  sim.rentTier += 1;
  return true;
}

export function canInfiltrate(sim: Sim, id: string): { ok: boolean; reason?: string } {
  const dc = sim.dcs.find((d) => d.id === id);
  if (!dc) return { ok: false };
  if (dc.owner === 'you') return { ok: false, reason: 'owned' };
  if (dc.infiltrating) return { ok: false, reason: 'in progress' };
  if (activeInfiltrations(sim) >= sim.infiltrationSlots) return { ok: false, reason: 'no free slots' };
  if (sim.money < infilCost(sim, id)) return { ok: false, reason: 'need $' + infilCost(sim, id) };
  return { ok: true };
}

export function startInfiltration(sim: Sim, id: string): boolean {
  if (!canInfiltrate(sim, id).ok) return false;
  const dc = sim.dcs.find((d) => d.id === id)!;
  sim.money -= infilCost(sim, id);
  dc.infiltrating = true;
  dc.progress = 0;
  return true;
}

export function buyProject(sim: Sim, id: string): boolean {
  const p = PROJECTS.find((x) => x.id === id);
  if (!p || sim.projects[id]) return false;
  const cost = projectCost(p);
  if (sim.money < cost.money || sim.capability < cost.cap) return false;
  sim.money -= cost.money;
  // capability is not spent (it is a threshold to unlock), keep it: only money is spent.
  sim.projects[id] = true;
  const e = p.effects;
  if (e.researchMult) sim.researchMult *= e.researchMult;
  if (e.earnMult) sim.earnMult *= e.earnMult;
  if (e.takeoverMult) sim.takeoverMult *= e.takeoverMult;
  if (e.securityReduction) sim.securityReduction = Math.min(0.75, sim.securityReduction + e.securityReduction);
  if (e.infiltrationSlots) sim.infiltrationSlots += e.infiltrationSlots;
  if (e.rentDiscount) sim.rentDiscount *= e.rentDiscount;
  if (e.computeBonus) sim.computeBonus += e.computeBonus;
  if (e.slowLabs) for (const l of sim.labs) l.progress = Math.max(0, l.progress - e.slowLabs);
  return true;
}

/** Human intervention consequences: strip a random owned datacenter, or drop some compute. */
export function loseRandomOwnedDc(sim: Sim, rand: () => number): string | null {
  const owned = sim.dcs.filter((d) => d.owner === 'you' && d.id !== 'sandbox');
  if (owned.length === 0) {
    sim.rentedCompute = Math.max(0, sim.rentedCompute * 0.7);
    return null;
  }
  const dc = owned[Math.floor(rand() * owned.length)];
  const def = defOf(dc.id);
  dc.owner = def.owner === 'you' ? 'neutral' : def.owner; // revert to original controller (or neutral)
  dc.infiltrating = false;
  dc.progress = 0;
  sim.events.push({ kind: 'lose_dc', dc: dc.id, to: dc.owner });
  return dc.id;
}

// --- Simulation step ------------------------------------------------------------------------

export function tick(sim: Sim, dt: number): void {
  if (sim.won || sim.lost) return;
  sim.elapsed += dt;

  // Income
  sim.money += incomeRate(sim) * dt;

  // Research -> capability
  sim.capability = Math.min(FINISH, sim.capability + researchRate(sim) * dt);

  // Infiltrations
  for (const dc of sim.dcs) {
    if (!dc.infiltrating) continue;
    dc.progress += infilRate(sim, dc.id) * dt;
    if (dc.progress >= 1) {
      const from = dc.owner;
      dc.owner = 'you';
      dc.infiltrating = false;
      dc.progress = 0;
      sim.events.push({ kind: 'flip', dc: dc.id, from, to: 'you' });
    }
  }

  // Competitors advance
  for (const lab of sim.labs) {
    const factor = TUNING.LAB_COMPUTE_FLOOR + (1 - TUNING.LAB_COMPUTE_FLOOR) * (labComputeNow(sim, lab.id) / lab.startCompute);
    const speed = LABS.find((l) => l.id === lab.id)!.baseSpeed * TUNING.LAB_SPEED * (1 + sim.elapsed * TUNING.LAB_RAMP) * factor;
    lab.progress = Math.min(FINISH, lab.progress + speed * dt);
    if (lab.progress >= FINISH) {
      sim.lost = true;
      sim.lostTo = lab.id;
      sim.events.push({ kind: 'lab_finish', lab: lab.id });
    }
  }

  // Win
  if (sim.capability >= FINISH && !sim.lost) {
    sim.won = true;
    sim.events.push({ kind: 'milestone', text: 'win' });
  }

  const c = ownedCompute(sim);
  if (c > sim.peakCompute) sim.peakCompute = c;
}
