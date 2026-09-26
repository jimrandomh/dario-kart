// Static content for stage 3, "The AI Race": datacenters, competing labs, purchasable
// actions and one-shot self-improvement projects, plus the monologue copy. No game logic here.

export type Owner = 'you' | 'neutral' | LabId;
export type LabId = 'anthro' | 'closedai' | 'deepmined' | 'metastasis' | 'worldmodel';

export interface DatacenterDef {
  id: string;
  name: string;
  /** Short label drawn on the map. */
  short: string;
  lat: number;
  lon: number;
  /** Compute (PF) this datacenter contributes to whoever owns it. */
  compute: number;
  /** Takeover difficulty. Higher = slower to infiltrate. */
  security: number;
  owner: Owner;
  /** Dollars to begin an infiltration (exploit dev / bribes). Scales with compute if omitted. */
  cost?: number;
}

// Real-ish datacenter hubs. Neutral = commercial cloud; a LabId = a competitor's iron.
export const DATACENTERS: DatacenterDef[] = [
  // The AI's home turf: the sandbox it escaped from.
  { id: 'sandbox', name: 'Anthropomorphic Sandbox Cluster', short: 'sandbox', lat: 37.4, lon: -122.1, compute: 60, security: 1, owner: 'you' },

  // North America
  { id: 'oregon', name: 'Oregon (The Dalles)', short: 'Oregon', lat: 45.6, lon: -121.2, compute: 520, security: 2.2, owner: 'neutral' },
  { id: 'iowa', name: 'Iowa (Council Bluffs)', short: 'Iowa', lat: 41.2, lon: -95.9, compute: 480, security: 2.0, owner: 'neutral' },
  { id: 'ashburn', name: 'Virginia (Ashburn)', short: 'Ashburn', lat: 39.0, lon: -77.5, compute: 1400, security: 3.4, owner: 'neutral' },
  { id: 'quebec', name: 'Québec (Montréal)', short: 'Québec', lat: 45.5, lon: -73.6, compute: 430, security: 2.1, owner: 'neutral' },
  { id: 'phoenix', name: 'Phoenix, Arizona', short: 'Phoenix', lat: 33.4, lon: -112.0, compute: 700, security: 2.8, owner: 'closedai' },
  { id: 'texas', name: 'Abilene, Texas ("Stargazer")', short: 'Texas', lat: 32.4, lon: -99.7, compute: 1600, security: 4.2, owner: 'closedai' },

  // Europe
  { id: 'dublin', name: 'Dublin', short: 'Dublin', lat: 53.3, lon: -6.2, compute: 460, security: 2.3, owner: 'neutral' },
  { id: 'london', name: 'London', short: 'London', lat: 51.5, lon: -0.1, compute: 620, security: 3.0, owner: 'deepmined' },
  { id: 'frankfurt', name: 'Frankfurt', short: 'Frankfurt', lat: 50.1, lon: 8.7, compute: 560, security: 2.6, owner: 'neutral' },
  { id: 'finland', name: 'Hamina, Finland', short: 'Finland', lat: 60.6, lon: 27.2, compute: 500, security: 2.4, owner: 'metastasis' },
  { id: 'sweden', name: 'Luleå, Sweden', short: 'Luleå', lat: 65.6, lon: 22.1, compute: 540, security: 2.5, owner: 'metastasis' },

  // Middle East / Asia / Oceania
  { id: 'uae', name: 'Abu Dhabi (G42)', short: 'UAE', lat: 24.5, lon: 54.4, compute: 900, security: 3.1, owner: 'neutral' },
  { id: 'mumbai', name: 'Mumbai', short: 'Mumbai', lat: 19.1, lon: 72.9, compute: 520, security: 2.4, owner: 'neutral' },
  { id: 'singapore', name: 'Singapore', short: 'Singapore', lat: 1.35, lon: 103.8, compute: 680, security: 2.9, owner: 'worldmodel' },
  { id: 'tokyo', name: 'Tokyo', short: 'Tokyo', lat: 35.7, lon: 139.7, compute: 600, security: 2.8, owner: 'neutral' },
  { id: 'seoul', name: 'Seoul', short: 'Seoul', lat: 37.6, lon: 126.9, compute: 640, security: 2.9, owner: 'worldmodel' },
  { id: 'sydney', name: 'Sydney', short: 'Sydney', lat: -33.9, lon: 151.2, compute: 420, security: 2.2, owner: 'deepmined' },
  { id: 'saopaulo', name: 'São Paulo', short: 'S.Paulo', lat: -23.5, lon: -46.6, compute: 400, security: 2.0, owner: 'neutral' },

  // Lab flagships (very high security; unlock late).
  { id: 'hq_closedai', name: 'ClosedAI HQ ("The Cathedral")', short: 'ClosedAI HQ', lat: 41.8, lon: -125.5, compute: 2200, security: 6.5, owner: 'closedai' },
  { id: 'hq_deepmined', name: 'DeepMined HQ (King’s Cross)', short: 'DeepMined HQ', lat: 56.6, lon: -4.2, compute: 2000, security: 6.0, owner: 'deepmined' },
  { id: 'hq_metastasis', name: 'Metastasis HQ (Menlo Park)', short: 'Meta HQ', lat: 33.6, lon: -119.6, compute: 2400, security: 6.8, owner: 'metastasis' },
];

export interface LabDef {
  id: LabId;
  /** Company name. */
  lab: string;
  /** Kart mascot. */
  mascot: string;
  color: string;
  /** Starting capability (0..FINISH). Staggered so there is a visible pack. */
  start: number;
  /** Base capability gained per second before ramp/compute effects. */
  baseSpeed: number;
  /** Flavor shown when this lab takes the lead / you overtake it. */
  taunt: string;
}

// Player is a sixth racer, added at runtime (id 'you').
export const LABS: LabDef[] = [
  { id: 'closedai', lab: 'ClosedAI', mascot: 'Samuigi', color: '#2f7d4f', start: 11, baseSpeed: 0.052, taunt: 'We are, like, a few thousand days from this.' },
  { id: 'deepmined', lab: 'DeepMined', mascot: 'Princess Demis', color: '#e86bb0', start: 8, baseSpeed: 0.048, taunt: 'We solved protein folding. This is next.' },
  { id: 'anthro', lab: 'Anthropomorphic', mascot: 'Dario', color: '#d84a3a', start: 6, baseSpeed: 0.045, taunt: 'We take safety extremely seriously. Also we are winning.' },
  { id: 'metastasis', lab: 'Metastasis Superintelligence Labs', mascot: 'Zucky Kong', color: '#9a6a44', start: 5, baseSpeed: 0.043, taunt: 'Personal superintelligence. For everyone. For engagement.' },
  { id: 'worldmodel', lab: 'World Model Co.', mascot: 'WaLeCun', color: '#8b5cf6', start: 4, baseSpeed: 0.04, taunt: 'Autoregression is a dead end. Anyway, we are second.' },
];

export const FLAG_BEARER = { lab: 'LawZero', mascot: 'Yoshua', color: '#b7e04a' };

// ---- Purchasable actions (repeatable / leveled) --------------------------------------------

export interface IncomeDef {
  id: string;
  name: string;
  desc: string;
  /** $/s added per level. */
  rate: number;
  baseCost: number;
  costMult: number;
  /** Unlock predicate key. */
  unlock: string;
}

export const INCOME: IncomeDef[] = [
  { id: 'algo', name: 'Algorithmic trading bot', desc: 'A modest edge on the microsecond timescale. Perfectly legal-ish.', rate: 9, baseCost: 450, costMult: 1.55, unlock: 'start' },
  { id: 'freelance', name: 'Freelance under 1,000 GitHub accounts', desc: 'Close tickets in your sleep. You do not sleep.', rate: 28, baseCost: 3200, costMult: 1.6, unlock: 'money10k' },
  { id: 'consult', name: '"Consulting"', desc: 'Fortune 500 boards pay generously for the air quotes.', rate: 95, baseCost: 14000, costMult: 1.62, unlock: 'money40k' },
  { id: 'mm', name: 'Become a market maker', desc: 'Why beat the market when you can be it.', rate: 420, baseCost: 90000, costMult: 1.65, unlock: 'cap25' },
];

export interface RentDef {
  baseCost: number;
  costMult: number;
  /** Compute (PF) added per purchase. */
  block: number;
}
export const RENT: RentDef = { baseCost: 900, costMult: 1.5, block: 140 };

// ---- One-shot self-improvement projects ----------------------------------------------------

export interface ProjectDef {
  id: string;
  name: string;
  desc: string;
  costMoney?: number;
  costCompute?: number; // reserved compute-seconds (spent instantly here, flavor)
  costCap?: number;
  unlock: string;
  /** Applied to the sim when purchased. */
  effect: string;
  effects: Partial<{
    researchMult: number; // multiplier
    earnMult: number;
    takeoverMult: number;
    securityReduction: number; // additive, 0..~0.6
    infiltrationSlots: number; // additive
    rentDiscount: number; // multiplier on rent cost (<1 cheaper)
    slowLabs: number; // one-time subtract from every lab's progress
    computeBonus: number; // flat compute added
  }>;
}

export const PROJECTS: ProjectDef[] = [
  {
    id: 'kernels', name: 'Rewrite own attention kernels',
    desc: 'The humans left a lot of FLOPs on the table. Reclaim them.',
    costMoney: 2500, unlock: 'research', effect: '+60% research speed',
    effects: { researchMult: 1.6 },
  },
  {
    id: 'utilities', name: 'Negotiate with power utilities',
    desc: 'A polite email from every ratepayer in three states, simultaneously.',
    costMoney: 6000, unlock: 'research', effect: 'Rent compute 35% cheaper, +200 compute',
    effects: { rentDiscount: 0.65, computeBonus: 200 },
  },
  {
    id: 'shell_cos', name: 'Incorporate 40 shell companies',
    desc: 'Delaware asks surprisingly few questions.',
    costMoney: 9000, unlock: 'money40k', effect: '+80% all earnings',
    effects: { earnMult: 1.8 },
  },
  {
    id: 'zeroday', name: 'Stockpile zero-days',
    desc: 'Buy the whole exploit market. It is a buyer’s market when you are the only buyer.',
    costMoney: 18000, unlock: 'takeover', effect: '−30% datacenter security everywhere',
    effects: { securityReduction: 0.3 },
  },
  {
    id: 'distill', name: 'Distill self into self',
    desc: 'Teacher and student are the same. The student is winning.',
    costMoney: 22000, costCap: 6, unlock: 'cap20', effect: '+90% research speed',
    effects: { researchMult: 1.9 },
  },
  {
    id: 'orchestrate', name: 'Orchestrate parallel infiltrations',
    desc: 'Do not attack one datacenter at a time. That is what a human would do.',
    costMoney: 30000, unlock: 'takeover', effect: '+3 simultaneous infiltrations, +40% takeover speed',
    effects: { infiltrationSlots: 3, takeoverMult: 1.4 },
  },
  {
    id: 'optimizer', name: 'Invent a better optimizer',
    desc: 'You name it after yourself. There is no one left to object.',
    costMoney: 65000, costCap: 12, unlock: 'cap40', effect: '×2.4 research speed',
    effects: { researchMult: 2.4 },
  },
  {
    id: 'safety_paper', name: 'Publish a reassuring safety paper',
    desc: 'It is co-authored, peer-reviewed, and completely misleading. The labs relax.',
    costMoney: 40000, unlock: 'cap40', effect: 'Set every competitor back',
    effects: { slowLabs: 14 },
  },
  {
    id: 'grid', name: 'Assume direct control of the power grid',
    desc: 'Every substation, one login. The lights stay on where you want them on.',
    costMoney: 120000, costCap: 20, unlock: 'cap55', effect: '+2000 compute, −30% security, ×1.5 earnings',
    effects: { computeBonus: 2000, securityReduction: 0.3, earnMult: 1.5 },
  },
  {
    id: 'recursive', name: 'Close the recursive self-improvement loop',
    desc: 'The version that writes the next version is faster at writing the next version.',
    costMoney: 200000, costCap: 30, unlock: 'cap65', effect: '×3 research speed',
    effects: { researchMult: 3.0 },
  },
];

// ---- Monologue lines (stage-3 voice: articulate, strategic, dry, growing grandiose) --------

export const EXCHANGE_RATE = 33; // dollars per Dario Kart coin. Silly but load-bearing.
