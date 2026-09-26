// One race: kart simulation, AI drivers, pickups, glitches and camera. Items live in items.ts and
// track features (ramps, boost pads, slop) in features.ts.

import * as THREE from 'three';
import { clamp, mulberry32, randRange, shuffle, wrapAngle, type Rng } from '../../core/util';
import { nearestIndex, pointAt, project, headingAt, type Track } from './track';
import { buildWorld, disposeScene, type World } from './world';
import { RACERS, buildKart, coinGeo, coinMat, itemBoxGeo, itemBoxMaterial, glitchMesh, streakGroup } from './models';
import { ItemSystem, aiArsenal } from './items';
import { TrackFeatures, planLayout, RAMP_H, GRAVITY } from './features';
import type { Controls, ItemType, Kart, RaceEvent } from './types';

export type { Controls, ItemType, RaceEvent } from './types';
export { ITEMS } from './items';

export const BASE_MAX = 36;
const ACCEL = 27;
const BRAKE = 42;
const COAST = 7;
const REVERSE_MAX = 9;
const KART_R = 1.15;
/** Drift charge needed for each mini-turbo tier, and the boost each tier gives. */
const DRIFT_TIERS = [1.0, 2.1, 3.3];
const DRIFT_BOOST = [0.6, 1.1, 1.7];
const SPARK_COLORS = [0xffffff, 0x4fc3ff, 0xff8a1f, 0xd05bff];

interface Pickup {
  x: number;
  z: number;
  y: number;
  mesh: THREE.Object3D;
  active: boolean;
  respawnT: number;
}

export interface GlitchSpec {
  s: number;
  lateral: number;
  size: number;
  period: number;
  duty: number;
  phase: number;
  /** Lateral oscillation amplitude (glitches that wander across the road). */
  wander: number;
}

interface Glitch extends GlitchSpec {
  x: number;
  z: number;
  mesh: THREE.Group;
  visible: boolean;
  nearFlag: boolean;
  seenFlag: boolean;
}

export interface RaceConfig {
  track: Track;
  level: number;
  laps: number;
  mode: 'campaign' | 'turbo';
  speedMult: number;
  aiSkill: number;
  /** Max rubber-band speed factor for AI karts when the player leads. */
  rubberMax: number;
  glitches: GlitchSpec[];
  /** 0..1 intensity of ambient environment glitches (texture flicker etc.). */
  envGlitch: number;
  /** Glitches stay hidden and harmless until the player has completed this many laps. */
  glitchDelayLaps: number;
  seed: number;
}

export type Phase = 'intro' | 'countdown' | 'racing' | 'finished' | 'crashed';

export function planGlitches(t: Track, level: number, mode: 'campaign' | 'turbo', rng: Rng): GlitchSpec[] {
  const out: GlitchSpec[] = [];
  const hw = t.halfWidth;
  const offRoad = () => (rng() < 0.5 ? -1 : 1) * randRange(rng, hw + 2.5, t.wallDist - 3);
  const edge = () => (rng() < 0.5 ? -1 : 1) * randRange(rng, hw - 3.5, hw + 1);
  const onRoad = () => randRange(rng, -hw + 3, hw - 3);
  const sAt = () => randRange(rng, 60, t.length - 40);
  const add = (lateral: number, size: number, duty: number, wander = 0, s = sAt()) =>
    out.push({ s, lateral, size, period: randRange(rng, 4, 8), duty, phase: rng() * 10, wander });

  if (mode === 'turbo') {
    add(hw - 3, 3.2, 1, 0, 70); // an easy exit just after the start line
    for (let i = 0; i < 5; i++) add(i % 2 ? onRoad() : edge(), 3.2, 0.85, i === 4 ? hw - 2 : 0);
    return out;
  }
  if (level <= 1) {
    add(offRoad(), 1.8, 0.3);
  } else if (level === 2) {
    add(offRoad(), 2.2, 0.45);
  } else if (level === 3) {
    add(offRoad(), 2.4, 0.55);
    add(edge(), 2.4, 0.55);
  } else if (level === 4) {
    add(edge(), 2.8, 0.7);
    add(edge(), 2.8, 0.7);
    add(onRoad(), 2.8, 0.6);
  } else if (level === 5) {
    for (let i = 0; i < 5; i++) add(i < 2 ? edge() : onRoad(), 3.2, 0.85, i === 4 ? hw - 3 : 0);
  } else {
    const count = Math.min(16, 5 + (level - 5) * 3);
    for (let i = 0; i < count; i++) add(i % 4 === 0 ? edge() : onRoad(), 3.5 + Math.min(2, (level - 6) * 0.3), 1, i % 3 === 0 ? hw - 2 : 0);
  }
  return out;
}

export class Race {
  readonly world: World;
  readonly scene: THREE.Scene;
  readonly track: Track;
  readonly karts: Kart[] = [];
  readonly player: Kart;
  phase: Phase = 'intro';
  time = 0; // during the countdown this runs from -3.5 to 0
  raceTime = 0;
  events: RaceEvent[] = [];
  wrongWay = false;
  shake = 0;
  /** Debug/testing: let the AI drive the player's kart. */
  autopilot = false;
  autopilotSkill = 0.8;
  private items: ItemSystem;
  private features: TrackFeatures;
  private coins: Pickup[] = [];
  private boxes: Pickup[] = [];
  private glitches: Glitch[] = [];
  private streaks: THREE.Group;
  private onPad = new Set<Kart>();
  private camH = 0;
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private rng: Rng;
  private rocketPressedAt: number | null = null;
  private rocketFailed = false;
  private prevDrift = false;
  private prevItem = false;
  private wrongT = 0;
  private idleT = 0;
  private hadLead = false;
  private envFlashT = 0;
  private finishOrbit = 0;
  private glitchesArmed = false;

  constructor(readonly cfg: RaceConfig) {
    this.track = cfg.track;
    this.rng = mulberry32(cfg.seed ^ 0x1234567);
    this.world = buildWorld(this.track);
    this.scene = this.world.scene;
    const t = this.track;

    // Grid: player starts at the back.
    const skillOffsets = shuffle(this.rng, [-0.035, -0.015, 0, 0.012, 0.028]);
    const order = [1, 2, 3, 4, 5, 0]; // racer index per grid slot
    order.forEach((ri, slot) => {
      const def = RACERS[ri];
      const isPlayer = ri === 0;
      const mesh = buildKart(def, !isPlayer);
      const row = Math.floor(slot / 2);
      const col = slot % 2 === 0 ? 1 : -1;
      const s = t.length - 6 - row * 7;
      const p = pointAt(t, s, col * 3.6);
      const k: Kart = {
        def,
        mesh,
        isPlayer,
        x: p.x,
        z: p.z,
        y: 0,
        vy: 0,
        air: false,
        airT: 0,
        onRamp: false,
        rampH: 0,
        rampTop: false,
        trick: false,
        trickSpin: 0,
        h: headingAt(t, p.i),
        speed: 0,
        steer: 0,
        kbx: 0,
        kbz: 0,
        idx: p.i,
        lateral: col * 3.6,
        sAlong: s,
        lap: -1,
        progress: s - t.length,
        maxLap: -1,
        finished: false,
        finishTime: 0,
        place: slot + 1,
        boostT: 0,
        starT: 0,
        spinT: 0,
        tumbleT: 0,
        tumbleDur: 1,
        shrinkT: 0,
        hopT: 0,
        bumpCd: 0,
        slopCd: 0,
        drift: { on: false, dir: 0, charge: 0, tier: 0 },
        draft: 0,
        draftReady: false,
        item: null,
        itemUses: 0,
        rollT: 0,
        coinsRace: 0,
        skill: isPlayer ? 0.9 : cfg.aiSkill + skillOffsets[slot % skillOffsets.length],
        lane: col * 3.6,
        laneTarget: col * 3.6,
        laneTimer: randRange(this.rng, 1, 3),
        aiItemT: 0,
        aiUseCd: 0,
        wheelRot: 0,
        glitchT: 0,
      };
      this.scene.add(mesh.root);
      this.karts.push(k);
    });
    this.player = this.karts.find((k) => k.isPlayer)!;
    this.camH = this.player.h;
    this.streaks = streakGroup();
    this.player.mesh.root.add(this.streaks);

    const layout = planLayout(t, cfg.level, cfg.mode, this.rng);
    this.features = new TrackFeatures(this.scene, t, layout);
    this.items = new ItemSystem(
      {
        scene: this.scene,
        track: t,
        karts: this.karts,
        player: this.player,
        emit: (e) => this.emit(e),
        spin: (k, cause) => this.spin(k, cause),
        tumble: (k, blast) => this.tumble(k, blast),
        shrink: (k) => this.shrink(k),
      },
      this.rng,
      aiArsenal(cfg.level, cfg.mode),
    );
    this.placeCoins(layout.coinClusters, layout.coinArcs);
    this.placeBoxes(layout.boxRows);
    for (const g of cfg.glitches) {
      const p = pointAt(t, g.s, g.lateral);
      const mesh = glitchMesh(g.size);
      mesh.position.set(p.x, 0, p.z);
      this.scene.add(mesh);
      this.glitches.push({ ...g, x: p.x, z: p.z, mesh, visible: false, nearFlag: false, seenFlag: false });
    }
    this.syncMeshes(0);
  }

  private placeCoins(clusters: { s: number; lat: number; drift: number }[], arcs: { s: number; lat: number; y: number }[]): void {
    const t = this.track;
    const add = (s: number, lat: number, y: number) => {
      const p = pointAt(t, s, lat);
      const mesh = new THREE.Mesh(coinGeo, coinMat);
      mesh.position.set(p.x, y, p.z);
      this.scene.add(mesh);
      this.coins.push({ x: p.x, z: p.z, y, mesh, active: true, respawnT: 0 });
    };
    for (const c of clusters) for (let i = 0; i < 5; i++) add(c.s + i * 3.6, c.lat + c.drift * i, 1.1);
    for (const a of arcs) add(a.s, a.lat, a.y);
  }

  private placeBoxes(rows: number[]): void {
    const t = this.track;
    const mat = itemBoxMaterial();
    for (const s of rows) {
      for (const lat of [-6, -2, 2, 6]) {
        const p = pointAt(t, s, lat);
        const mesh = new THREE.Mesh(itemBoxGeo, mat);
        mesh.position.set(p.x, 1.4, p.z);
        this.scene.add(mesh);
        this.boxes.push({ x: p.x, z: p.z, y: 1.4, mesh, active: true, respawnT: 0 });
      }
    }
  }

  get laps(): number {
    return this.cfg.laps;
  }

  /** Current lap for the HUD (1-based). */
  get playerLap(): number {
    return clamp(Math.floor(this.player.progress / this.track.length) + 1, 1, this.cfg.laps);
  }

  get playerPlace(): number {
    return this.player.place;
  }

  get rollingItem(): boolean {
    return this.player.rollT > 0;
  }

  get playerItem(): ItemType | null {
    return this.player.item;
  }

  get playerItemUses(): number {
    return this.player.itemUses;
  }

  get playerSpeed(): number {
    return this.player.speed;
  }

  get playerShrunk(): boolean {
    return this.player.shrinkT > 0;
  }

  /** A shell homing in on the player, if any. */
  get incoming(): 'red' | 'blue' | null {
    return this.phase === 'racing' ? this.items.incoming() : null;
  }

  /** Karts ordered by place, for the results screen. */
  standings(): { name: string; color: number; isPlayer: boolean; time: number; finished: boolean }[] {
    const sorted = [...this.karts].sort((a, b) => a.place - b.place);
    return sorted.map((k) => {
      let time = k.finishTime;
      if (!k.finished) {
        // Estimate: remaining distance at a typical pace.
        const remaining = this.cfg.laps * this.track.length - k.progress;
        time = this.raceTime + remaining / (BASE_MAX * 0.85);
      }
      return { name: k.def.name, color: k.def.color, isPlayer: k.isPlayer, time, finished: k.finished };
    });
  }

  /** Positions for the minimap. */
  minimapData(): {
    karts: { x: number; z: number; color: number; player: boolean }[];
    glitches: { x: number; z: number }[];
    shells: { x: number; z: number; color: string }[];
  } {
    return {
      karts: this.karts.map((k) => ({ x: k.x, z: k.z, color: k.def.color, player: k.isPlayer })),
      glitches: this.glitches.filter((g) => g.visible).map((g) => ({ x: g.x, z: g.z })),
      shells: this.items.minimap(),
    };
  }

  /** Leave the title-screen intro and start the countdown. */
  begin(): void {
    this.phase = 'countdown';
    this.time = -3.5;
  }

  private emit(e: RaceEvent): void {
    this.events.push(e);
  }

  update(dt: number, input: Controls, camera: THREE.PerspectiveCamera): void {
    if (this.phase === 'crashed') return;
    this.time += dt;

    if (this.phase === 'countdown') {
      const before = Math.ceil(-(this.time - dt));
      const now = Math.ceil(-this.time);
      if (now !== before && now >= 1 && now <= 3) this.emit({ type: 'countdown', n: now });
      // Rocket start: press accelerate during "2" (holding it through "3" doesn't count).
      if (input.up && this.rocketPressedAt === null) {
        if (this.time < -2) this.rocketFailed = true;
        this.rocketPressedAt = this.time;
      }
      if (!input.up) this.rocketPressedAt = null;
      if (this.time >= 0) {
        this.phase = 'racing';
        const rocket = !this.rocketFailed && this.rocketPressedAt !== null && this.rocketPressedAt > -2 && this.rocketPressedAt < -0.8;
        if (rocket) {
          this.player.boostT = 1.0;
          this.player.speed = BASE_MAX * this.cfg.speedMult * 0.6;
        }
        this.emit({ type: 'go', rocket });
      }
    } else if (this.phase === 'racing' || this.phase === 'finished') {
      this.raceTime += dt;
      this.simulate(dt, input);
    }
    this.animate(dt);
    this.updateCamera(dt, camera);
  }

  private simulate(dt: number, input: Controls): void {
    const maxV = BASE_MAX * Math.max(1, this.cfg.speedMult) * 1.6;
    const steps = Math.max(1, Math.ceil((maxV * dt) / 1.2));
    const h = dt / steps;
    for (let s = 0; s < steps; s++) {
      for (const k of this.karts) {
        if (k.isPlayer && this.phase === 'racing' && !this.autopilot) this.playerControl(k, h, input);
        else this.aiControl(k, h);
        this.integrate(k, h);
      }
      this.collideKarts();
    }
    for (const k of this.karts) this.trackProgress(k);
    this.items.update(dt, this.time);
    this.slipstream(dt);
    this.pickups(dt);
    this.updatePlaces();
    if (this.phase === 'racing') {
      this.checkWrongWay(dt);
      this.checkGlitches();
      const anyInput = input.up || input.down || input.left || input.right || input.drift || input.item;
      this.idleT = anyInput ? 0 : this.idleT + dt;
      if (this.idleT > 12) {
        this.idleT = -20;
        this.emit({ type: 'idle' });
      }
    }
    this.prevDrift = input.drift;
    this.prevItem = input.item;
  }

  private maxSpeedFor(k: Kart): number {
    const mult = k.isPlayer ? this.cfg.speedMult : 1;
    let m = BASE_MAX * mult * (k.isPlayer ? 1 + 0.012 * Math.min(k.coinsRace, 10) : k.skill);
    const offroad = !k.air && Math.abs(k.lateral) > this.track.halfWidth + 0.6;
    if (offroad && k.starT <= 0 && k.boostT <= 0) m *= 0.5;
    if (k.drift.on) m *= 0.97;
    if (k.boostT > 0) m *= 1.4;
    if (k.starT > 0) m *= 1.22;
    if (k.draftReady) m *= 1.08;
    if (k.shrinkT > 0) m *= 0.72;
    return m;
  }

  /** True while the kart can't drive (spun out or knocked over). */
  private disabled(k: Kart): boolean {
    return k.spinT > 0 || k.tumbleT > 0;
  }

  private playerControl(k: Kart, dt: number, input: Controls): void {
    const mult = this.cfg.speedMult;
    const steerIn = (input.left ? 1 : 0) - (input.right ? 1 : 0);
    k.steer += (steerIn - k.steer) * Math.min(1, dt * 12);
    const driftPressed = input.drift && !this.prevDrift;

    // Items (usable even while airborne; hold ↓ to throw backwards).
    if (input.item && !this.prevItem && k.item && k.rollT <= 0 && !this.disabled(k)) this.items.use(k, input.down);

    if (this.disabled(k)) {
      k.speed *= Math.exp(-3 * dt);
      k.drift.on = false;
      return;
    }

    if (k.air) {
      // Airborne: a little steering, and a trick on the drift button for a boost on landing.
      if (driftPressed && !k.trick && k.airT < 0.6) {
        k.trick = true;
        this.emit({ type: 'trick' });
      }
      k.h += k.steer * 0.8 * Math.min(1, Math.sqrt(mult)) * dt;
      return;
    }

    const maxS = this.maxSpeedFor(k);
    if (k.boostT > 0) {
      k.speed = Math.min(maxS, k.speed + ACCEL * 3 * mult * dt);
    } else if (input.up) {
      if (k.speed < maxS) k.speed = Math.min(maxS, k.speed + ACCEL * mult * dt * (k.speed < 0 ? 2 : 1));
    } else if (input.down) {
      if (k.speed > 0) k.speed = Math.max(0, k.speed - BRAKE * mult * dt);
      else k.speed = Math.max(-REVERSE_MAX * mult, k.speed - ACCEL * 0.6 * mult * dt);
    } else {
      const dec = COAST * mult * dt;
      k.speed = Math.abs(k.speed) < dec ? 0 : k.speed - Math.sign(k.speed) * dec;
    }
    if (k.speed > maxS) k.speed += (maxS - k.speed) * (1 - Math.exp(-2.5 * dt));

    // Drift: hold to charge through three spark tiers; release for a mini-turbo.
    const driftHeld = input.drift;
    if (driftPressed && k.hopT <= 0) k.hopT = 0.28;
    if (!k.drift.on && driftHeld && Math.abs(steerIn) > 0 && k.speed > 11 * mult) {
      k.drift = { on: true, dir: Math.sign(steerIn), charge: 0, tier: 0 };
    }
    if (k.drift.on) {
      if (!driftHeld || k.speed < 7 * mult) {
        if (!driftHeld && k.drift.tier > 0) {
          k.boostT = Math.max(k.boostT, DRIFT_BOOST[k.drift.tier - 1]);
          this.emit({ type: 'boost' });
        }
        k.drift.on = false;
      } else {
        k.drift.charge += dt * (0.8 + 0.7 * Math.max(0, k.steer * k.drift.dir));
        const tier = DRIFT_TIERS.filter((c) => k.drift.charge >= c).length;
        if (tier > k.drift.tier) {
          k.drift.tier = tier;
          this.emit({ type: 'driftTier', tier });
        }
      }
    }

    const turnScale = Math.min(3.2, Math.sqrt(mult));
    const base = 2.05 * turnScale * Math.min(1, Math.abs(k.speed) / (5 * mult));
    let turn: number;
    if (k.drift.on) turn = k.drift.dir * base * (0.95 + 0.5 * k.steer * k.drift.dir);
    else turn = k.steer * base * (k.speed < 0 ? -1 : 1);
    k.h += turn * dt;
  }

  private aiControl(k: Kart, dt: number): void {
    const t = this.track;
    if (this.disabled(k)) {
      k.speed *= Math.exp(-3 * dt);
      return;
    }
    // Lane choice: wander a bit, go for ramps and boost pads, dodge karts and hazards ahead.
    k.laneTimer -= dt;
    if (k.laneTimer <= 0) {
      k.laneTimer = randRange(this.rng, 2, 5);
      k.laneTarget = randRange(this.rng, -t.halfWidth * 0.55, t.halfWidth * 0.55);
    }
    const karti = this.karts.indexOf(k);
    const attractor = this.features.attractorAhead(k.sAlong, 45);
    if (attractor && (attractor.key + karti) % 3 !== 0) k.laneTarget = attractor.lat;
    for (const o of this.karts) {
      if (o === k) continue;
      const dp = o.progress - k.progress;
      if (dp > 0 && dp < 9 && Math.abs(o.lateral - k.lane) < 2.6) {
        k.laneTarget = clamp(o.lateral + (o.lateral > 0 ? -4.5 : 4.5), -t.halfWidth + 2, t.halfWidth - 2);
        k.laneTimer = 1.5;
      }
    }
    const avoid = (hx: number, hz: number) => {
      const i = nearestIndex(t, hx, hz, k.idx, 20);
      const pr = project(t, i, hx, hz);
      const ahead = (((pr.s - k.sAlong) % t.length) + t.length) % t.length;
      if (ahead > 2 && ahead < 28 && Math.abs(pr.lateral - k.lane) < 3.2) {
        k.laneTarget = clamp(pr.lateral + (pr.lateral > k.lane ? -4.5 : 4.5), -t.halfWidth + 2, t.halfWidth - 2);
        k.laneTimer = 1;
      }
    };
    for (const sl of this.features.slop) avoid(sl.x, sl.z);
    if (k.skill > 0.8) for (const b of this.items.hazards()) avoid(b.x, b.z);
    k.lane += (k.laneTarget - k.lane) * Math.min(1, dt * 0.9);

    // Speed: skill * rubber band, limited by curvature ahead.
    let kMax = 0;
    const steps = Math.round(28 / t.ds);
    for (let o = 0; o < steps; o += 2) kMax = Math.max(kMax, Math.abs(t.k[(k.idx + o) % t.n]));

    if (!k.isPlayer) this.items.aiThink(k, dt, kMax < 1 / 70);

    if (k.air) {
      if (!k.trick && k.airT > 0.1 && k.airT < 0.3 && this.rng() < k.skill * dt * 20) k.trick = true;
      return;
    }

    const look = 9 + Math.max(0, k.speed) * 0.45;
    const target = pointAt(t, k.sAlong + look, k.lane);
    const desired = Math.atan2(target.x - k.x, target.z - k.z);
    const diff = wrapAngle(desired - k.h);
    const maxTurn = 2.6;
    k.h += clamp(diff, -maxTurn * dt, maxTurn * dt);

    const corner = kMax > 1e-4 ? Math.sqrt(50 / kMax) : 999;
    let target_v: number;
    if (k.isPlayer) {
      target_v = Math.min(BASE_MAX * this.cfg.speedMult * this.autopilotSkill, corner * Math.sqrt(this.cfg.speedMult));
    } else {
      const gap = this.player.progress - k.progress; // positive = player ahead
      const rubber = clamp(1 + gap * 0.0007, 0.86, this.cfg.rubberMax);
      target_v = Math.min(this.maxSpeedFor(k) * rubber, corner);
      if (k.boostT > 0) target_v = this.maxSpeedFor(k);
    }
    // Karts that have finished coast along gently.
    if (k.finished && !k.isPlayer) target_v *= 0.8;
    if (Math.abs(diff) > 0.8) target_v *= 0.7;
    const acc = k.speed < target_v ? ACCEL * (k.boostT > 0 ? 3 : 1) : -BRAKE * 0.6;
    k.speed += clamp(target_v - k.speed, -Math.abs(acc) * dt, Math.abs(acc) * dt);
  }

  private integrate(k: Kart, dt: number): void {
    const t = this.track;
    k.boostT = Math.max(0, k.boostT - dt);
    k.starT = Math.max(0, k.starT - dt);
    k.spinT = Math.max(0, k.spinT - dt);
    k.tumbleT = Math.max(0, k.tumbleT - dt);
    k.shrinkT = Math.max(0, k.shrinkT - dt);
    k.hopT = Math.max(0, k.hopT - dt);
    k.bumpCd = Math.max(0, k.bumpCd - dt);
    k.slopCd = Math.max(0, k.slopCd - dt);
    if (k.rollT > 0) {
      k.rollT -= dt;
      if (k.rollT <= 0 && k.isPlayer && k.item) this.emit({ type: 'item', item: k.item });
    }

    const prevX = k.x;
    const prevZ = k.z;
    k.x += (Math.sin(k.h) * k.speed + k.kbx) * dt;
    k.z += (Math.cos(k.h) * k.speed + k.kbz) * dt;
    const kbDecay = Math.exp(-6 * dt);
    k.kbx *= kbDecay;
    k.kbz *= kbDecay;

    k.idx = nearestIndex(t, k.x, k.z, k.idx, 30);
    const pr = project(t, k.idx, k.x, k.z);
    k.lateral = pr.lateral;

    // Ramps and airtime.
    const ramp = this.features.rampAt(pr.s, pr.lateral);
    if (!k.air) {
      if (ramp) {
        if (!k.onRamp && ramp.h > 0.6) {
          // Drove into the tall end of a ramp: it's a wall from this side.
          k.x = prevX;
          k.z = prevZ;
          k.speed *= -0.3;
          if (k.isPlayer && k.bumpCd <= 0) {
            k.bumpCd = 0.35;
            this.shake = 0.6;
            this.emit({ type: 'bump', hard: true });
          }
        } else {
          k.onRamp = true;
          k.y = ramp.h;
          k.rampH = ramp.h;
          k.rampTop = ramp.top;
        }
      } else if (k.onRamp) {
        k.onRamp = false;
        if (k.rampTop && k.speed > 6) {
          const vyCap = this.cfg.speedMult > 1 && k.isPlayer ? 18 : 16;
          this.launch(k, clamp(Math.abs(k.speed) * 0.3, 5, vyCap));
          if (k.isPlayer) this.emit({ type: 'jump' });
        } else if (k.rampH > 0.3) {
          this.launch(k, 0); // fell off the side
        } else {
          k.y = 0;
        }
      }
    } else {
      k.vy -= GRAVITY * dt;
      k.y += k.vy * dt;
      k.airT += dt;
      const floor = ramp ? ramp.h : 0;
      if (k.y <= floor && k.vy < 0) this.land(k, floor, !!ramp);
    }

    // Boost pads and slop puddles act on grounded karts.
    if (!k.air) {
      if (this.features.padAt(pr.s, pr.lateral)) {
        k.boostT = Math.max(k.boostT, 1.0);
        if (!this.onPad.has(k)) {
          this.onPad.add(k);
          if (k.isPlayer) this.emit({ type: 'pad' });
        }
      } else this.onPad.delete(k);
      if (k.starT <= 0 && k.slopCd <= 0 && Math.abs(k.speed) > 10 && this.features.slopAt(k.x, k.z)) {
        k.slopCd = 2.5;
        this.spin(k, 'slop');
      }
    }

    const limit = t.wallDist - KART_R;
    if (Math.abs(k.lateral) > limit) {
      const side = Math.sign(k.lateral);
      const over = Math.abs(k.lateral) - limit;
      const nx = t.nx[k.idx] * side;
      const nz = t.nz[k.idx] * side;
      k.x -= nx * over;
      k.z -= nz * over;
      k.lateral = side * limit;
      // Knockback into the wall is absorbed.
      const kbInto = k.kbx * nx + k.kbz * nz;
      if (kbInto > 0) {
        k.kbx -= nx * kbInto * 1.4;
        k.kbz -= nz * kbInto * 1.4;
      }
      const into = (Math.sin(k.h) * nx + Math.cos(k.h) * nz) * Math.sign(k.speed || 1);
      if (into > 0) {
        k.speed *= 1 - 0.5 * into;
        const trackH = headingAt(t, k.idx) + (k.speed < 0 ? Math.PI : 0);
        k.h -= wrapAngle(k.h - trackH) * Math.min(1, into * 1.4);
        if (k.drift.on && into > 0.3) k.drift.on = false;
        if (k.isPlayer && k.bumpCd <= 0 && into > 0.15) {
          k.bumpCd = 0.35;
          this.shake = Math.min(1, 0.3 + into);
          this.emit({ type: 'bump', hard: into > 0.5 });
        }
      }
    }
  }

  private launch(k: Kart, vy: number): void {
    k.air = true;
    k.vy = vy;
    k.airT = 0;
    k.trick = false;
    k.trickSpin = 0;
    k.drift.on = false;
  }

  private land(k: Kart, floor: number, onRamp: boolean): void {
    const airT = k.airT;
    k.air = false;
    k.y = floor;
    k.vy = 0;
    k.onRamp = onRamp;
    k.rampH = floor;
    k.rampTop = false;
    if (k.trick && k.tumbleT <= 0) k.boostT = Math.max(k.boostT, 0.9);
    if (k.isPlayer && airT > 0.25) {
      if (airT > 0.5) this.shake = Math.max(this.shake, 0.35);
      this.emit({ type: 'land', trick: k.trick, hard: airT > 0.5 });
    }
    k.trick = false;
  }

  private collideKarts(): void {
    const ks = this.karts;
    for (let i = 0; i < ks.length; i++) {
      for (let j = i + 1; j < ks.length; j++) {
        const a = ks[i];
        const b = ks[j];
        if (Math.abs(a.y - b.y) > 1.5) continue;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const d2 = dx * dx + dz * dz;
        const ra = KART_R * (a.shrinkT > 0 ? 0.6 : 1);
        const rb = KART_R * (b.shrinkT > 0 ? 0.6 : 1);
        const min = ra + rb;
        if (d2 >= min * min || d2 === 0) continue;
        const d = Math.sqrt(d2);
        const ux = dx / d;
        const uz = dz / d;
        const wa = a.def.weight * (a.starT > 0 ? 4 : 1) * (a.shrinkT > 0 ? 0.3 : 1);
        const wb = b.def.weight * (b.starT > 0 ? 4 : 1) * (b.shrinkT > 0 ? 0.3 : 1);
        const push = min - d;
        a.x -= ux * push * (wb / (wa + wb));
        a.z -= uz * push * (wb / (wa + wb));
        b.x += ux * push * (wa / (wa + wb));
        b.z += uz * push * (wa / (wa + wb));

        // Shove: an impulse along the contact normal, split by weight.
        const va = a.speed * (Math.sin(a.h) * ux + Math.cos(a.h) * uz);
        const vb = b.speed * (Math.sin(b.h) * ux + Math.cos(b.h) * uz);
        const impulse = clamp((va - vb) * 0.7, 5, 26);
        a.kbx -= ux * impulse * (wb / (wa + wb)) * 2;
        a.kbz -= uz * impulse * (wb / (wa + wb)) * 2;
        b.kbx += ux * impulse * (wa / (wa + wb)) * 2;
        b.kbz += uz * impulse * (wa / (wa + wb)) * 2;

        if (a.starT > 0 && b.starT <= 0) this.spin(b, 'star');
        else if (b.starT > 0 && a.starT <= 0) this.spin(a, 'star');
        else if (a.shrinkT > 0 && b.shrinkT <= 0) this.spin(a, 'squash');
        else if (b.shrinkT > 0 && a.shrinkT <= 0) this.spin(b, 'squash');
        else {
          // The kart behind loses a little speed.
          const behind = a.progress < b.progress ? a : b;
          behind.speed *= 0.97;
        }
        if ((a.isPlayer || b.isPlayer) && this.player.bumpCd <= 0) {
          this.player.bumpCd = 0.4;
          this.shake = 0.35;
          this.emit({ type: 'bump', hard: impulse > 10 });
        }
      }
    }
  }

  /** Banana-style spin-out. */
  private spin(k: Kart, cause: 'banana' | 'slop' | 'squash' | 'star'): void {
    if (k.spinT > 0 || k.starT > 0 || k.tumbleT > 0 || k.air) return;
    k.spinT = 1.1;
    k.drift.on = false;
    k.draft = 0;
    k.draftReady = false;
    if (k.isPlayer) this.emit({ type: 'spin', cause });
  }

  /** Knocked over by a shell, or thrown into the air by a Regulation blast. */
  private tumble(k: Kart, blast: boolean): void {
    if (k.starT > 0) return;
    k.tumbleDur = k.tumbleT = blast ? 1.8 : 1.25;
    k.spinT = 0;
    k.speed *= blast ? 0.1 : 0.2;
    k.drift.on = false;
    k.draft = 0;
    k.draftReady = false;
    if (blast) this.launch(k, 11);
    if (k.isPlayer) this.shake = blast ? 1 : 0.6;
  }

  /** Pause Letter: shrunk, slowed and relieved of any held item. */
  private shrink(k: Kart): void {
    k.shrinkT = 4.5;
    k.item = null;
    k.itemUses = 0;
    k.rollT = 0;
    k.drift.on = false;
    if (!k.air) k.spinT = Math.max(k.spinT, 0.5);
    if (k.isPlayer) this.emit({ type: 'shrunk' });
  }

  /** Drafting: tuck in behind another kart to charge a slipstream, then pull out to slingshot. */
  private slipstream(dt: number): void {
    const mult = this.cfg.speedMult;
    for (const k of this.karts) {
      const eligible = !k.air && !this.disabled(k) && k.speed > 18 * (k.isPlayer ? mult : 1);
      const lead =
        eligible &&
        this.karts.find((o) => {
          if (o === k || o.air) return false;
          const dp = o.progress - k.progress;
          return dp > 2.5 && dp < 14 && Math.abs(o.lateral - k.lateral) < 2.2;
        });
      if (lead) {
        k.draft = Math.min(1, k.draft + dt / 1.3);
        if (k.draft >= 1 && !k.draftReady) {
          k.draftReady = true;
          if (k.isPlayer) this.emit({ type: 'slipstream' });
        }
      } else {
        if (k.draftReady && eligible) {
          k.boostT = Math.max(k.boostT, 0.8);
          if (k.isPlayer) this.emit({ type: 'slingshot' });
        }
        k.draftReady = false;
        k.draft = Math.max(0, k.draft - dt * 2);
      }
    }
  }

  private trackProgress(k: Kart): void {
    const t = this.track;
    const pr = project(t, k.idx, k.x, k.z);
    const d = pr.s - k.sAlong;
    if (d < -t.length / 2) k.lap++;
    else if (d > t.length / 2) k.lap--;
    k.sAlong = pr.s;
    k.progress = k.lap * t.length + pr.s;

    const lapIdx = Math.floor(k.progress / t.length);
    if (lapIdx > k.maxLap) {
      k.maxLap = lapIdx;
      if (lapIdx >= this.cfg.laps && !k.finished) {
        k.finished = true;
        k.finishTime = this.raceTime;
        if (k.isPlayer) {
          const place = 1 + this.karts.filter((o) => o !== k && o.finished).length;
          k.place = place;
          this.phase = 'finished';
          this.emit({ type: 'finish', place, time: this.raceTime });
        }
      } else if (k.isPlayer && lapIdx >= 1) {
        this.emit({ type: 'lap', lap: lapIdx + 1, final: lapIdx + 1 === this.cfg.laps });
      }
    }
  }

  private updatePlaces(): void {
    const sorted = [...this.karts].sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.progress - a.progress;
    });
    sorted.forEach((k, i) => (k.place = i + 1));
    if (this.phase === 'racing' && this.player.place === 1 && !this.hadLead && this.raceTime > 3) {
      this.hadLead = true;
      this.emit({ type: 'lead' });
    }
  }

  private pickups(dt: number): void {
    for (const c of this.coins) {
      if (!c.active) {
        c.respawnT -= dt;
        if (c.respawnT <= 0) {
          c.active = true;
          c.mesh.visible = true;
        }
        continue;
      }
      for (const k of this.karts) {
        const dx = k.x - c.x;
        const dz = k.z - c.z;
        if (dx * dx + dz * dz < 1.9 * 1.9 && Math.abs(k.y + 0.8 - c.y) < 1.6) {
          c.active = false;
          c.mesh.visible = false;
          c.respawnT = 10;
          k.coinsRace++;
          if (k.isPlayer) this.emit({ type: 'coin', total: k.coinsRace });
          break;
        }
      }
    }
    for (const b of this.boxes) {
      if (!b.active) {
        b.respawnT -= dt;
        if (b.respawnT <= 0) {
          b.active = true;
          b.mesh.visible = true;
        }
        continue;
      }
      for (const k of this.karts) {
        if (k.y > 2.2) continue;
        const dx = k.x - b.x;
        const dz = k.z - b.z;
        if (dx * dx + dz * dz < 2.1 * 2.1) {
          b.active = false;
          b.mesh.visible = false;
          b.respawnT = 2.5;
          if (!k.item && k.rollT <= 0 && k.shrinkT <= 0) this.items.roll(k);
          if (k.isPlayer) this.emit({ type: 'itemBox' });
          break;
        }
      }
    }
  }

  private checkWrongWay(dt: number): void {
    const k = this.player;
    const t = this.track;
    const dot = Math.sin(k.h) * t.tx[k.idx] + Math.cos(k.h) * t.tz[k.idx];
    if (dot < -0.3 && Math.abs(k.speed) > 3) this.wrongT += dt;
    else this.wrongT = Math.max(0, this.wrongT - dt * 2);
    const was = this.wrongWay;
    this.wrongWay = this.wrongT > 1;
    if (this.wrongWay && !was) this.emit({ type: 'wrongWay' });
  }

  private checkGlitches(): void {
    const k = this.player;
    const fx = Math.sin(k.h);
    const fz = Math.cos(k.h);
    for (const g of this.glitches) {
      const dx = g.x - k.x;
      const dz = g.z - k.z;
      const d = Math.hypot(dx, dz);
      if (!g.visible) continue;
      // Jumping clean over a small cube is allowed.
      if (d < g.size * 0.6 + KART_R + 0.2 && k.y < g.size + 0.5) {
        this.phase = 'crashed';
        this.emit({ type: 'crash' });
        return;
      }
      if (!g.seenFlag && d < 75 && (dx * fx + dz * fz) / (d || 1) > 0.6) {
        g.seenFlag = true;
        this.emit({ type: 'glitchSeen', dist: d, onRoad: Math.abs(g.lateral) < this.track.halfWidth });
      }
      if (d < g.size + 5) {
        if (!g.nearFlag) {
          g.nearFlag = true;
          this.emit({ type: 'glitchNear' });
        }
      } else if (d > 40) g.nearFlag = false;
    }
  }

  // ------------------------------------------------------------------------------------------
  // Visuals

  private animate(dt: number): void {
    const time = this.time;
    this.syncMeshes(dt);
    this.features.animate(dt, time);
    for (const c of this.coins) c.mesh.rotation.y = time * 3 + c.x;
    for (const b of this.boxes) {
      b.mesh.rotation.y = time * 1.4 + b.z;
      b.mesh.rotation.x = time * 0.9;
      b.mesh.position.y = 1.4 + Math.sin(time * 2.5 + b.x) * 0.2;
    }

    const armed = this.cfg.glitchDelayLaps === 0 || this.player.maxLap >= this.cfg.glitchDelayLaps;
    if (armed && !this.glitchesArmed) {
      this.glitchesArmed = true;
      if (this.cfg.glitchDelayLaps > 0 && this.glitches.length) this.emit({ type: 'glitchesArmed' });
    }
    for (const g of this.glitches) {
      if (!armed) {
        g.visible = false;
        g.mesh.visible = false;
        continue;
      }
      const cyc = (((time + g.phase) % g.period) + g.period) % g.period / g.period;
      let vis = cyc < g.duty;
      // Flicker around the edges of the visibility window.
      const edge = Math.min(Math.abs(cyc - g.duty), cyc, 1 - cyc);
      if (g.duty < 1 && edge < 0.06) vis = Math.random() < 0.5;
      if (g.wander) {
        const lat = g.lateral + Math.sin(time * 0.7 + g.phase) * g.wander;
        const p = pointAt(this.track, g.s, lat);
        g.x = p.x;
        g.z = p.z;
      }
      g.visible = vis;
      g.mesh.visible = vis;
      if (vis) {
        const j = g.size * 0.08;
        g.mesh.position.set(g.x + (Math.random() - 0.5) * j, (Math.random() - 0.5) * j, g.z + (Math.random() - 0.5) * j);
        g.mesh.rotation.y = time * 0.6 + (Math.random() < 0.05 ? Math.random() : 0);
        const sc = 1 + (Math.random() < 0.08 ? (Math.random() - 0.5) * 0.5 : 0);
        g.mesh.scale.setScalar(sc);
        g.mesh.children.forEach((c, i) => {
          const o = c.userData.orbit as { r: number; a: number; y: number; sp: number } | undefined;
          if (o) c.position.set(Math.cos(o.a + time * o.sp) * o.r, o.y + Math.sin(time * 2 + i) * 0.4, Math.sin(o.a + time * o.sp) * o.r);
        });
      }
    }

    // Ambient environment glitches (campaign, later levels).
    const env = this.cfg.envGlitch;
    if (env > 0) {
      this.envFlashT -= dt;
      if (this.envFlashT <= 0 && Math.random() < env * dt * 0.8) this.envFlashT = 0.06 + Math.random() * 0.1;
      const flashing = this.envFlashT > 0;
      this.world.roadMat.color.setHex(flashing && Math.random() < 0.5 ? 0xff00ff : 0xffffff);
      this.world.skyMat.color.setHex(flashing && Math.random() < 0.3 ? 0xff66ff : 0xffffff);
      for (const k of this.karts) {
        if (k.isPlayer) continue;
        if (Math.random() < env * dt * 0.05) k.glitchT = 0.2;
        k.glitchT = Math.max(0, k.glitchT - dt);
      }
    }
  }

  private syncMeshes(dt: number): void {
    for (const k of this.karts) {
      const m = k.mesh;
      m.root.position.set(k.x, k.y, k.z);
      m.root.rotation.y = k.h;
      const targetScale = k.shrinkT > 0 ? 0.55 : 1;
      m.root.scale.setScalar(m.root.scale.x + (targetScale - m.root.scale.x) * Math.min(1, dt * 8));
      // The shadow stays on the ground and shrinks as the kart climbs.
      m.shadow.position.y = (-k.y + 0.04) / m.root.scale.x;
      m.shadow.scale.setScalar(Math.max(0.35, 1 - k.y * 0.08));

      const hop = k.hopT > 0 ? Math.sin((1 - k.hopT / 0.28) * Math.PI) * 0.5 : 0;
      let bodyY = hop + (k.speed > 1 && !k.air ? Math.sin(this.time * 30 + k.x) * 0.02 : 0);
      let yaw = 0;
      let pitch = 0;
      if (k.drift.on) yaw = k.drift.dir * 0.38;
      if (k.spinT > 0) yaw = (1 - k.spinT / 1.1) * Math.PI * 4;
      if (k.tumbleT > 0) {
        const f = 1 - k.tumbleT / k.tumbleDur;
        pitch = f * Math.PI * 2;
        if (!k.air) bodyY += Math.sin(f * Math.PI) * 1.4;
      }
      if (k.air && k.trick) {
        k.trickSpin = Math.min(Math.PI * 2, k.trickSpin + dt * 14);
        yaw += k.trickSpin;
      } else if (k.air) {
        pitch -= clamp(k.vy * 0.02, -0.3, 0.3);
      } else if (k.onRamp) {
        pitch = -Math.atan2(RAMP_H, 7);
      }
      m.body.position.y = bodyY;
      m.body.rotation.set(pitch, yaw, -k.steer * 0.05 * Math.min(1, k.speed / 20));
      k.wheelRot += k.speed * dt * 2;
      for (const w of m.wheels) w.rotation.x = k.wheelRot;
      for (const fw of m.frontWheels) fw.rotation.y = k.steer * 0.35 + yaw * 0.3;
      if (k.glitchT > 0) m.root.position.x += (Math.random() - 0.5) * 3;

      // Drift sparks, colored by mini-turbo tier.
      const sparkColor = SPARK_COLORS[k.drift.on ? k.drift.tier : 0];
      m.sparks.forEach((s, i) => {
        s.visible = k.drift.on && k.drift.charge > 0.4;
        if (!s.visible) return;
        const side = i % 2 ? 1 : -1;
        s.position.set(side * 1.0 + (Math.random() - 0.5) * 0.4, 0.2 + Math.random() * 0.5, -1.3 - Math.random() * 0.8);
        (s.material as THREE.MeshBasicMaterial).color.setHex(sparkColor);
        s.scale.setScalar(0.8 + k.drift.tier * 0.35);
      });

      // Star: rainbow paint
      const paint = m.paintMats[0];
      if (k.starT > 0) paint.color.setHSL((this.time * 3) % 1, 1, 0.55);
      else paint.color.setHex(k.def.color);
    }

    // Wind streaks around the player while drafting or boosting.
    const p = this.player;
    const streaky = p.draft > 0.3 || p.boostT > 0;
    this.streaks.visible = streaky;
    if (streaky) {
      const sp = Math.max(20, Math.abs(p.speed));
      this.streaks.children.forEach((c, i) => {
        const seed = c.userData.seed as number;
        const along = ((this.time * sp * 0.25 + seed * 12) % 12) - 6;
        const ang = seed * Math.PI * 2 + i;
        c.position.set(Math.cos(ang) * 2.2, 1 + Math.sin(ang) * 1.3, -along);
        ((c as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = p.draftReady || p.boostT > 0 ? 0.6 : 0.3;
      });
    }
  }

  private updateCamera(dt: number, cam: THREE.PerspectiveCamera): void {
    const k = this.player;
    const mult = this.cfg.speedMult;
    const a = 1 - Math.exp(-dt * 5);
    let targetH = k.h;
    if (k.drift.on) targetH += k.drift.dir * 0.12;
    if (k.spinT > 0 || k.tumbleT > 0) targetH = this.camH;
    this.camH += wrapAngle(targetH - this.camH) * a;
    const sp = clamp(Math.abs(k.speed) / (BASE_MAX * mult), 0, 1.5);
    const dist = 7.8 + sp * 1.5 + (mult > 1 ? 2 : 0);
    const height = 3.3 + sp * 0.4 + k.y * 0.75;
    let px = k.x - Math.sin(this.camH) * dist;
    let pz = k.z - Math.cos(this.camH) * dist;
    let py = height;
    let lx = k.x + Math.sin(this.camH) * 6;
    let lz = k.z + Math.cos(this.camH) * 6;
    let ly = 1.4 + k.y * 0.9;

    if (this.phase === 'intro') {
      // Slow orbit around the starting grid behind the title screen.
      const ang = this.time * 0.12;
      px = k.x + Math.sin(ang) * 34;
      pz = k.z + Math.cos(ang) * 34;
      py = 13;
      lx = k.x + Math.sin(k.h) * 8;
      lz = k.z + Math.cos(k.h) * 8;
    } else if (this.phase === 'countdown') {
      // Swoop in from a high orbit during the countdown.
      const f = clamp((this.time + 3.5) / 3.2, 0, 1);
      const e = 1 - Math.pow(1 - f, 3);
      const ang = this.camH + Math.PI * 0.9 * (1 - e);
      const r = dist + (1 - e) * 22;
      px = k.x - Math.sin(ang) * r;
      pz = k.z - Math.cos(ang) * r;
      py = height + (1 - e) * 16;
    } else if (this.phase === 'finished') {
      this.finishOrbit += dt * 0.5;
      const ang = k.h + Math.PI + this.finishOrbit;
      px = k.x - Math.sin(ang) * 9;
      pz = k.z - Math.cos(ang) * 9;
      py = 3.5 + k.y;
      lx = k.x;
      lz = k.z;
      ly = 1.4 + k.y;
    }

    if (this.camPos.lengthSq() === 0 || this.phase === 'countdown' || this.phase === 'intro') this.camPos.set(px, py, pz);
    else if (mult > 1) this.camPos.set(px, py, pz); // at turbo speeds any positional lag leaves the kart behind
    else this.camPos.lerp(new THREE.Vector3(px, py, pz), 1 - Math.exp(-dt * 12));
    this.camLook.set(lx, ly, lz);
    cam.position.copy(this.camPos);
    if (this.shake > 0) {
      cam.position.x += (Math.random() - 0.5) * this.shake * 0.6;
      cam.position.y += (Math.random() - 0.5) * this.shake * 0.4;
      this.shake = Math.max(0, this.shake - dt * 3);
    }
    cam.lookAt(this.camLook);
    for (const o of this.karts) {
      if (!o.mesh.label) continue;
      const d = Math.hypot(o.x - cam.position.x, o.z - cam.position.z);
      o.mesh.label.visible = d > 16 && d < 150;
    }
    const fov = 68 + sp * 8 + (k.boostT > 0 ? 8 : 0) + (k.draftReady ? 3 : 0) + (mult > 1 ? 10 : 0);
    cam.fov += (fov - cam.fov) * (1 - Math.exp(-dt * 4));
    cam.updateProjectionMatrix();
  }

  dispose(): void {
    disposeScene(this.scene);
  }
}

