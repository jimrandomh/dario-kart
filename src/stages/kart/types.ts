// Types shared by the race simulation, items and track features.

import type { KartMesh, RacerDef } from './models';

export type ItemType = 'mushroom' | 'triple' | 'banana' | 'star' | 'red' | 'green' | 'blue' | 'lightning';

export interface Controls {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  drift: boolean;
  item: boolean;
}

export type RaceEvent =
  | { type: 'countdown'; n: number }
  | { type: 'go'; rocket: boolean }
  | { type: 'coin'; total: number }
  | { type: 'itemBox' }
  | { type: 'item'; item: ItemType }
  | { type: 'useItem'; item: ItemType }
  | { type: 'boost' }
  | { type: 'bump'; hard: boolean }
  | { type: 'spin'; cause: 'banana' | 'slop' | 'squash' | 'star' }
  | { type: 'hit'; by: 'red' | 'green' | 'blue' }
  | { type: 'hitOther'; by: 'red' | 'green' | 'blue' | 'banana' }
  | { type: 'shrunk' }
  | { type: 'pauseLetter'; byPlayer: boolean; hitPlayer: boolean }
  | { type: 'regulation'; hitPlayer: boolean; byPlayer: boolean }
  | { type: 'pad' }
  | { type: 'jump' }
  | { type: 'trick' }
  | { type: 'land'; trick: boolean; hard: boolean }
  | { type: 'slipstream' }
  | { type: 'slingshot' }
  | { type: 'driftTier'; tier: number }
  | { type: 'lap'; lap: number; final: boolean }
  | { type: 'lead' }
  | { type: 'finish'; place: number; time: number }
  | { type: 'wrongWay' }
  | { type: 'glitchSeen'; dist: number; onRoad: boolean }
  | { type: 'glitchNear' }
  | { type: 'crash' }
  | { type: 'idle' }
  | { type: 'glitchesArmed' };

export interface Kart {
  def: RacerDef;
  mesh: KartMesh;
  isPlayer: boolean;
  x: number;
  z: number;
  /** Height above the road (ramps, jumps, blasts). */
  y: number;
  vy: number;
  air: boolean;
  airT: number;
  /** Currently on a ramp surface, and the ramp height last step. */
  onRamp: boolean;
  rampH: number;
  rampTop: boolean;
  /** Trick performed during the current jump (boost on landing). */
  trick: boolean;
  trickSpin: number;
  h: number;
  speed: number;
  steer: number;
  /** Knockback velocity from collisions, decays quickly. */
  kbx: number;
  kbz: number;
  idx: number;
  lateral: number;
  sAlong: number;
  lap: number;
  progress: number;
  maxLap: number;
  finished: boolean;
  finishTime: number;
  place: number;
  boostT: number;
  starT: number;
  spinT: number;
  /** Knocked over by a shell or blast. */
  tumbleT: number;
  tumbleDur: number;
  /** Shrunk by a Pause Letter. */
  shrinkT: number;
  hopT: number;
  bumpCd: number;
  /** Immunity to slop after spinning in it, so a stopped kart can drive out of the puddle. */
  slopCd: number;
  drift: { on: boolean; dir: number; charge: number; tier: number };
  /** Slipstream charge 0..1; `draftReady` once fully charged. */
  draft: number;
  draftReady: boolean;
  item: ItemType | null;
  /** Uses left (Scaling Laws has three). */
  itemUses: number;
  rollT: number;
  coinsRace: number;
  skill: number;
  lane: number;
  laneTarget: number;
  laneTimer: number;
  /** AI: seconds the current item has been held, and time since last use. */
  aiItemT: number;
  aiUseCd: number;
  wheelRot: number;
  glitchT: number;
}
