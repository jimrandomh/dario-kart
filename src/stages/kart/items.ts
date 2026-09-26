// Items: roll odds, using items (player and AI), shells in flight, dropped bananas, blasts.

import * as THREE from 'three';
import { clamp, lerp, wrapAngle, type Rng } from '../../core/util';
import { nearestIndex, project, pointAt, headingAt, type Track } from './track';
import { bananaMesh, shellMesh, blueShellMesh, explosionMesh } from './models';
import type { ItemType, Kart, RaceEvent } from './types';

export interface ItemInfo {
  name: string;
  /** Emoji, or 'shell:<css color>' for a drawn shell icon. */
  icon: string;
}

export const ITEMS: Record<ItemType, ItemInfo> = {
  mushroom: { name: 'Mushroom', icon: '🍄' },
  triple: { name: 'Scaling Laws', icon: '🍄' },
  banana: { name: 'Banana', icon: '🍌' },
  star: { name: 'Moat', icon: '⭐' },
  red: { name: 'Red-Teaming Shell', icon: 'shell:#e8322e' },
  green: { name: 'Arms Race Shell', icon: 'shell:#2fb344' },
  blue: { name: 'Regulation', icon: 'shell:#2a6bff' },
  lightning: { name: 'Pause Letter', icon: '📜' },
};

// Roll weights at [1st place, last place]; interpolated by position. Leaders get defensive
// items, stragglers get the heavy artillery.
const ODDS: Record<ItemType, [number, number]> = {
  banana: [40, 2],
  green: [26, 6],
  mushroom: [16, 14],
  red: [12, 16],
  triple: [2, 18],
  star: [0, 14],
  lightning: [0, 12],
  blue: [0, 10],
};

/** Which items AI racers may roll. Early episodes keep them gentle so the first wins come easy. */
export function aiArsenal(level: number, mode: 'campaign' | 'turbo'): Set<ItemType> {
  const s = new Set<ItemType>(['mushroom', 'banana', 'triple', 'star']);
  if (mode === 'turbo' || level >= 2) s.add('green');
  if (mode === 'turbo' || level >= 3) s.add('red');
  if (mode === 'turbo' || level >= 4) {
    s.add('blue');
    s.add('lightning');
  }
  return s;
}

const SHELL_SPEED = { red: 60, green: 64, blue: 88 };
const HIT_R = 1.8;
const BLAST_R = 7;

export interface ItemHost {
  readonly scene: THREE.Scene;
  readonly track: Track;
  readonly karts: Kart[];
  readonly player: Kart;
  emit(e: RaceEvent): void;
  spin(k: Kart, cause: 'banana' | 'slop' | 'squash' | 'star'): void;
  tumble(k: Kart, blast: boolean): void;
  shrink(k: Kart): void;
}

interface Projectile {
  kind: 'red' | 'green' | 'blue';
  x: number;
  z: number;
  y: number;
  h: number;
  speed: number;
  owner: Kart;
  target: Kart | null;
  idx: number;
  sAlong: number;
  lap: number;
  life: number;
  bounces: number;
  armT: number;
  dive: number; // blue: seconds into the dive, -1 while cruising
  mesh: THREE.Group;
}

interface Banana {
  x: number;
  z: number;
  mesh: THREE.Object3D;
  owner: Kart;
  armT: number;
}

interface Blast {
  mesh: THREE.Mesh;
  t: number;
}

export class ItemSystem {
  private projectiles: Projectile[] = [];
  private bananas: Banana[] = [];
  private blasts: Blast[] = [];

  constructor(
    private host: ItemHost,
    private rng: Rng,
    private arsenal: Set<ItemType>,
  ) {}

  // ------------------------------------------------------------------------------------------
  // Getting items

  roll(k: Kart): void {
    const p = (k.place - 1) / Math.max(1, this.host.karts.length - 1);
    const entries = (Object.keys(ODDS) as ItemType[])
      .filter((it) => k.isPlayer || this.arsenal.has(it))
      .map((it) => [it, Math.max(0, lerp(ODDS[it][0], ODDS[it][1], p))] as const)
      .filter(([, w]) => w > 0);
    const total = entries.reduce((a, [, w]) => a + w, 0);
    let r = this.rng() * total;
    let item: ItemType = 'mushroom';
    for (const [it, w] of entries) {
      r -= w;
      if (r <= 0) {
        item = it;
        break;
      }
    }
    k.item = item;
    k.itemUses = item === 'triple' ? 3 : 1;
    k.aiItemT = 0;
    if (k.isPlayer) k.rollT = 1.1;
  }

  // ------------------------------------------------------------------------------------------
  // Using items

  /** Use the kart's held item. `backward` throws shells/bananas behind (hold ↓ while using). */
  use(k: Kart, backward = false): void {
    const it = k.item;
    if (!it || k.rollT > 0) return;
    k.itemUses--;
    if (k.itemUses <= 0) k.item = null;
    k.aiItemT = 0;
    k.aiUseCd = 1.1;
    switch (it) {
      case 'mushroom':
      case 'triple':
        k.boostT = Math.max(k.boostT, it === 'triple' ? 1.2 : 1.5);
        break;
      case 'star':
        k.starT = 7;
        k.boostT = Math.max(k.boostT, 0.6);
        break;
      case 'banana': {
        // Bananas always go behind.
        const bx = k.x - Math.sin(k.h) * 3;
        const bz = k.z - Math.cos(k.h) * 3;
        const mesh = bananaMesh();
        mesh.position.set(bx, 0, bz);
        this.host.scene.add(mesh);
        this.bananas.push({ x: bx, z: bz, mesh, owner: k, armT: 0.6 });
        break;
      }
      case 'red':
      case 'green':
      case 'blue':
        this.fire(k, it, backward && it === 'green');
        break;
      case 'lightning':
        this.pauseLetter(k);
        break;
    }
    if (k.isPlayer) this.host.emit({ type: 'useItem', item: it });
  }

  private fire(k: Kart, kind: 'red' | 'green' | 'blue', backward: boolean): void {
    const dir = backward ? -1 : 1;
    const h = k.h + (backward ? Math.PI : 0);
    const x = k.x + Math.sin(k.h) * 2.6 * dir;
    const z = k.z + Math.cos(k.h) * 2.6 * dir;
    const mesh = kind === 'blue' ? blueShellMesh() : shellMesh(kind === 'red' ? 0xe8322e : 0x2fb344);
    this.host.scene.add(mesh);
    const t = this.host.track;
    const idx = nearestIndex(t, x, z, k.idx, 30);
    const target = kind === 'red' ? this.host.karts.find((o) => o.place === k.place - 1 && !o.finished) ?? null : null;
    this.projectiles.push({
      kind,
      x,
      z,
      y: kind === 'blue' ? 7 : 0,
      h,
      speed: Math.max(SHELL_SPEED[kind], Math.abs(k.speed) * 1.3),
      owner: k,
      target,
      idx,
      sAlong: project(t, idx, x, z).s,
      lap: k.lap,
      life: kind === 'blue' ? 25 : kind === 'red' ? 8 : 10,
      bounces: 0,
      armT: 0.6,
      dive: -1,
      mesh,
    });
  }

  private pauseLetter(k: Kart): void {
    let hitPlayer = false;
    for (const o of this.host.karts) {
      if (o === k || o.starT > 0 || o.finished) continue;
      this.host.shrink(o);
      if (o.isPlayer) hitPlayer = true;
    }
    this.host.emit({ type: 'pauseLetter', byPlayer: k.isPlayer, hitPlayer });
  }

  // ------------------------------------------------------------------------------------------
  // AI item tactics

  aiThink(k: Kart, dt: number, straightAhead: boolean): void {
    k.aiUseCd = Math.max(0, k.aiUseCd - dt);
    if (!k.item || k.spinT > 0 || k.tumbleT > 0 || k.aiUseCd > 0) return;
    k.aiItemT += dt;
    const held = k.aiItemT;
    if (held < 0.7) return;
    const ahead = (maxD: number, maxLat: number) =>
      this.host.karts.find((o) => o !== k && o.progress - k.progress > 1 && o.progress - k.progress < maxD && Math.abs(o.lateral - k.lateral) < maxLat);
    const behind = (maxD: number, maxLat: number) =>
      this.host.karts.find((o) => o !== k && k.progress - o.progress > 1 && k.progress - o.progress < maxD && Math.abs(o.lateral - k.lateral) < maxLat);
    switch (k.item) {
      case 'mushroom':
      case 'triple':
        if (straightAhead || held > 6) this.use(k);
        break;
      case 'banana':
        if (behind(14, 4) || held > 9) this.use(k);
        break;
      case 'green':
        if (ahead(35, 2.5)) this.use(k);
        else if (behind(16, 2.5)) this.use(k, true);
        else if (held > 10) this.use(k);
        break;
      case 'red': {
        const target = this.host.karts.find((o) => o.place === k.place - 1);
        if ((target && target.progress - k.progress < 90) || held > 8) this.use(k);
        break;
      }
      case 'blue':
        if (held > 1.5) this.use(k);
        break;
      case 'lightning':
      case 'star':
        if (held > 2) this.use(k);
        break;
    }
  }

  // ------------------------------------------------------------------------------------------
  // Simulation

  update(dt: number, time: number): void {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.life -= dt;
      p.armT -= dt;
      const steps = Math.max(1, Math.ceil((p.speed * dt) / 1.5));
      const h = dt / steps;
      let dead = p.life <= 0;
      for (let s = 0; s < steps && !dead; s++) dead = this.stepProjectile(p, h);
      if (dead) {
        this.host.scene.remove(p.mesh);
        this.projectiles.splice(i, 1);
        continue;
      }
      p.mesh.position.set(p.x, p.y, p.z);
      p.mesh.rotation.y = p.kind === 'blue' ? p.h : time * 14;
      if (p.kind === 'blue') {
        for (const c of p.mesh.children) if (c.name === 'wing') c.rotation.x = Math.sin(time * 30) * 0.6;
      }
    }

    for (let i = this.bananas.length - 1; i >= 0; i--) {
      const b = this.bananas[i];
      b.armT -= dt;
      b.mesh.rotation.y += dt * 0.5;
      for (const k of this.host.karts) {
        if ((k === b.owner && b.armT > 0) || k.y > 1.5) continue;
        const dx = k.x - b.x;
        const dz = k.z - b.z;
        if (dx * dx + dz * dz < 1.7 * 1.7) {
          if (k.starT <= 0) {
            this.host.spin(k, 'banana');
            if (b.owner.isPlayer && !k.isPlayer) this.host.emit({ type: 'hitOther', by: 'banana' });
          }
          this.host.scene.remove(b.mesh);
          this.bananas.splice(i, 1);
          break;
        }
      }
    }

    for (let i = this.blasts.length - 1; i >= 0; i--) {
      const b = this.blasts[i];
      b.t += dt;
      const f = b.t / 0.5;
      b.mesh.scale.setScalar(0.5 + f * BLAST_R);
      (b.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.85 * (1 - f));
      if (f >= 1) {
        this.host.scene.remove(b.mesh);
        this.blasts.splice(i, 1);
      }
    }
  }

  /** Advance one projectile; returns true when it should be removed. */
  private stepProjectile(p: Projectile, dt: number): boolean {
    const t = this.host.track;
    const karts = this.host.karts;

    if (p.kind === 'blue') return this.stepBlue(p, dt);

    if (p.kind === 'red') {
      const tgt = p.target && !p.target.finished ? p.target : null;
      let desired: number;
      const dToTarget = tgt ? Math.hypot(tgt.x - p.x, tgt.z - p.z) : Infinity;
      if (tgt && dToTarget < 28) {
        desired = Math.atan2(tgt.x - p.x, tgt.z - p.z);
      } else {
        const lat = project(t, p.idx, p.x, p.z).lateral;
        const aimLat = tgt ? lerp(lat, tgt.lateral, 0.35) : lat * 0.8;
        const aim = pointAt(t, p.sAlong + 14, aimLat);
        desired = Math.atan2(aim.x - p.x, aim.z - p.z);
      }
      p.h += clamp(wrapAngle(desired - p.h), -5 * dt, 5 * dt);
    }

    p.x += Math.sin(p.h) * p.speed * dt;
    p.z += Math.cos(p.h) * p.speed * dt;
    p.idx = nearestIndex(t, p.x, p.z, p.idx, 30);
    const pr = project(t, p.idx, p.x, p.z);
    const d = pr.s - p.sAlong;
    if (d < -t.length / 2) p.lap++;
    else if (d > t.length / 2) p.lap--;
    p.sAlong = pr.s;

    // Walls: green shells ricochet, red shells slide along.
    const limit = t.wallDist - 0.9;
    if (Math.abs(pr.lateral) > limit) {
      const side = Math.sign(pr.lateral);
      const over = Math.abs(pr.lateral) - limit;
      const nx = t.nx[p.idx] * side;
      const nz = t.nz[p.idx] * side;
      p.x -= nx * over;
      p.z -= nz * over;
      if (p.kind === 'green') {
        let fx = Math.sin(p.h);
        let fz = Math.cos(p.h);
        const dot = fx * nx + fz * nz;
        if (dot > 0) {
          fx -= 2 * dot * nx;
          fz -= 2 * dot * nz;
          p.h = Math.atan2(fx, fz);
          p.bounces++;
          if (p.bounces > 5) return true;
        }
      } else {
        p.h = headingAt(t, p.idx);
      }
    }

    // Hits
    for (const k of karts) {
      if ((k === p.owner && p.armT > 0) || k.y > 1.8) continue;
      const dx = k.x - p.x;
      const dz = k.z - p.z;
      if (dx * dx + dz * dz < HIT_R * HIT_R) {
        if (k.starT <= 0) {
          this.host.tumble(k, false);
          if (k.isPlayer) this.host.emit({ type: 'hit', by: p.kind });
          else if (p.owner.isPlayer) this.host.emit({ type: 'hitOther', by: p.kind });
        }
        return true;
      }
    }
    for (let i = this.bananas.length - 1; i >= 0; i--) {
      const b = this.bananas[i];
      if ((b.x - p.x) ** 2 + (b.z - p.z) ** 2 < 2.2 * 2.2) {
        this.host.scene.remove(b.mesh);
        this.bananas.splice(i, 1);
        return true;
      }
    }
    return false;
  }

  /** Regulation: cruises high along the track to whoever is leading, then dives and explodes. */
  private stepBlue(p: Projectile, dt: number): boolean {
    const t = this.host.track;
    const leader = this.host.karts.find((k) => k.place === 1 && !k.finished) ?? this.host.karts.find((k) => !k.finished);
    if (!leader) return true;
    p.target = leader;
    const myProg = p.lap * t.length + p.sAlong;
    if (p.dive < 0) {
      const gap = leader.progress - myProg;
      if (gap < 14) p.dive = 0;
      const aim = pointAt(t, p.sAlong + 20, 0);
      const desired = Math.atan2(aim.x - p.x, aim.z - p.z);
      p.h += clamp(wrapAngle(desired - p.h), -4 * dt, 4 * dt);
      p.speed = Math.max(p.speed, Math.abs(leader.speed) * 1.4);
    } else {
      p.dive += dt;
      p.h = Math.atan2(leader.x - p.x, leader.z - p.z);
      p.y = Math.max(0.6, 7 * (1 - p.dive / 0.6));
      const d = Math.hypot(leader.x - p.x, leader.z - p.z);
      if (d < 2.5 || p.dive > 0.9) {
        this.explode(p, leader);
        return true;
      }
    }
    p.x += Math.sin(p.h) * p.speed * dt;
    p.z += Math.cos(p.h) * p.speed * dt;
    p.idx = nearestIndex(t, p.x, p.z, p.idx, 30);
    const s = project(t, p.idx, p.x, p.z).s;
    const ds = s - p.sAlong;
    if (ds < -t.length / 2) p.lap++;
    else if (ds > t.length / 2) p.lap--;
    p.sAlong = s;
    return false;
  }

  private explode(p: Projectile, at: Kart): void {
    const mesh = explosionMesh(0x3a7bff);
    mesh.position.set(at.x, 1, at.z);
    this.host.scene.add(mesh);
    this.blasts.push({ mesh, t: 0 });
    let hitPlayer = false;
    for (const k of this.host.karts) {
      if (Math.hypot(k.x - at.x, k.z - at.z) > BLAST_R || k.starT > 0) continue;
      this.host.tumble(k, true);
      if (k.isPlayer) hitPlayer = true;
    }
    this.host.emit({ type: 'regulation', hitPlayer, byPlayer: p.owner.isPlayer });
  }

  // ------------------------------------------------------------------------------------------
  // Queries

  /** Bananas on the road, for AI avoidance. */
  hazards(): { x: number; z: number }[] {
    return this.bananas;
  }

  /** A shell homing in on the player, for the HUD warning. */
  incoming(): 'red' | 'blue' | null {
    const pl = this.host.player;
    for (const p of this.projectiles) {
      if (p.kind === 'blue' && p.target === pl) return 'blue';
    }
    for (const p of this.projectiles) {
      if (p.kind === 'red' && p.target === pl && Math.hypot(pl.x - p.x, pl.z - p.z) < 80) return 'red';
    }
    return null;
  }

  minimap(): { x: number; z: number; color: string }[] {
    return this.projectiles.map((p) => ({ x: p.x, z: p.z, color: p.kind === 'red' ? '#ff4a3d' : p.kind === 'green' ? '#3ddc5a' : '#3a7bff' }));
  }
}
