// Procedural meshes and canvas textures for the kart game. Everything is built from primitives.

import * as THREE from 'three';

export function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, repeat = true): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
  }
  tex.anisotropy = 4;
  return tex;
}

function speckle(g: CanvasRenderingContext2D, w: number, h: number, color: string, count: number, size: number) {
  g.fillStyle = color;
  for (let i = 0; i < count; i++) g.fillRect(Math.random() * w, Math.random() * h, size, size);
}

export function roadTexture(road: string, line: string, neon: boolean): THREE.CanvasTexture {
  return canvasTexture(256, 256, (g) => {
    g.fillStyle = road;
    g.fillRect(0, 0, 256, 256);
    if (neon) {
      // Rainbow road: soft bands across the track.
      const grad = g.createLinearGradient(0, 0, 256, 0);
      ['#ff3b6b', '#ffb13b', '#f7ff3b', '#3bff7a', '#3bd8ff', '#8a3bff', '#ff3bd2'].forEach((c, i, a) =>
        grad.addColorStop(i / (a.length - 1), c),
      );
      g.globalAlpha = 0.55;
      g.fillStyle = grad;
      g.fillRect(0, 0, 256, 256);
      g.globalAlpha = 1;
    } else {
      speckle(g, 256, 256, 'rgba(255,255,255,0.05)', 900, 2);
      speckle(g, 256, 256, 'rgba(0,0,0,0.08)', 900, 2);
    }
    g.fillStyle = line;
    g.fillRect(6, 0, 5, 256);
    g.fillRect(245, 0, 5, 256);
    g.fillRect(125, 0, 6, 110);
  });
}

export function stripeTexture(a: string, b: string, stripes = 2): THREE.CanvasTexture {
  return canvasTexture(64, 64, (g) => {
    for (let i = 0; i < stripes; i++) {
      g.fillStyle = i % 2 ? b : a;
      g.fillRect(0, (i * 64) / stripes, 64, 64 / stripes);
    }
  });
}

export function groundTexture(base: string, speck: string, neon: boolean): THREE.CanvasTexture {
  return canvasTexture(256, 256, (g) => {
    g.fillStyle = base;
    g.fillRect(0, 0, 256, 256);
    if (neon) {
      g.strokeStyle = 'rgba(160, 90, 255, 0.45)';
      g.lineWidth = 2;
      g.strokeRect(0, 0, 256, 256);
      speckle(g, 256, 256, 'rgba(255,255,255,0.5)', 30, 1.5);
    } else {
      speckle(g, 256, 256, speck, 2500, 3);
      speckle(g, 256, 256, 'rgba(255,255,255,0.06)', 600, 2);
    }
  });
}

export function checkerTexture(a: string, b: string, cells = 8): THREE.CanvasTexture {
  const tex = canvasTexture(128, 128, (g) => {
    const s = 128 / cells;
    for (let y = 0; y < cells; y++)
      for (let x = 0; x < cells; x++) {
        g.fillStyle = (x + y) % 2 ? a : b;
        g.fillRect(x * s, y * s, s, s);
      }
  });
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  return tex;
}

export function bannerTexture(text: string, sub: string): THREE.CanvasTexture {
  return canvasTexture(
    1024,
    192,
    (g) => {
      const grad = g.createLinearGradient(0, 0, 0, 192);
      grad.addColorStop(0, '#e8322e');
      grad.addColorStop(1, '#a3121b');
      g.fillStyle = grad;
      g.fillRect(0, 0, 1024, 192);
      g.fillStyle = '#ffd400';
      g.fillRect(0, 0, 1024, 10);
      g.fillRect(0, 182, 1024, 10);
      g.font = 'italic 900 104px Arial Black, Arial, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineWidth = 14;
      g.strokeStyle = '#000';
      g.strokeText(text, 512, 88);
      g.fillStyle = '#fff';
      g.fillText(text, 512, 88);
      g.font = 'bold 34px Arial, sans-serif';
      g.fillStyle = '#ffd400';
      g.fillText(sub, 512, 160);
    },
    false,
  );
}

export function labelTexture(text: string, color: string): THREE.CanvasTexture {
  return canvasTexture(
    256,
    64,
    (g) => {
      g.font = 'bold 30px Arial, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      const w = g.measureText(text).width + 24;
      g.fillStyle = 'rgba(0,0,0,0.55)';
      const x0 = 128 - w / 2;
      g.beginPath();
      g.roundRect(x0, 12, w, 40, 12);
      g.fill();
      g.fillStyle = color;
      g.fillText(text, 128, 33);
    },
    false,
  );
}

// ---------------------------------------------------------------------------------------------
// Karts

export type Headgear = 'cap' | 'crown' | 'ape' | 'dino' | 'hood';

export interface RacerDef {
  name: string;
  color: number;
  accent: number;
  skin: number;
  headgear: Headgear;
  letter: string;
  /** Relative mass for kart-to-kart shoving. */
  weight: number;
}

export const RACERS: RacerDef[] = [
  { name: 'Dario', color: 0xe8322e, accent: 0x2451c8, skin: 0xf5c9a0, headgear: 'cap', letter: 'D', weight: 1.0 },
  { name: 'Samuigi', color: 0x1f8a3a, accent: 0x243d8c, skin: 0xf5c9a0, headgear: 'cap', letter: 'S', weight: 0.95 },
  { name: 'Princess Demis', color: 0xff79c6, accent: 0xffffff, skin: 0xf5d2b0, headgear: 'crown', letter: 'P', weight: 0.85 },
  { name: 'Zucky Kong', color: 0x8a5a2b, accent: 0x3b82f6, skin: 0x6b4423, headgear: 'ape', letter: 'Z', weight: 1.4 },
  { name: 'WaLeCun', color: 0x7b2cbf, accent: 0x1a1a1a, skin: 0xf5c9a0, headgear: 'cap', letter: 'Γ', weight: 1.05 },
  { name: 'Yoshua', color: 0x7ddc3a, accent: 0xffffff, skin: 0x7ddc3a, headgear: 'dino', letter: 'Y', weight: 0.9 },
];

export interface KartMesh {
  root: THREE.Group;
  body: THREE.Group;
  wheels: THREE.Mesh[];
  frontWheels: THREE.Group[];
  sparks: THREE.Mesh[];
  shadow: THREE.Mesh;
  label: THREE.Sprite | null;
  paintMats: THREE.MeshLambertMaterial[];
}

const wheelGeo = new THREE.CylinderGeometry(0.45, 0.45, 0.42, 14);
wheelGeo.rotateZ(Math.PI / 2);
const rearWheelGeo = new THREE.CylinderGeometry(0.55, 0.55, 0.5, 14);
rearWheelGeo.rotateZ(Math.PI / 2);
const tireMat = new THREE.MeshLambertMaterial({ color: 0x1b1b1f });
const hubMat = new THREE.MeshLambertMaterial({ color: 0xd9d9e0 });
const darkMat = new THREE.MeshLambertMaterial({ color: 0x26262e });
const chromeMat = new THREE.MeshLambertMaterial({ color: 0xb8bcc8 });
const shadowTex = canvasTexture(
  64,
  64,
  (g) => {
    const grad = g.createRadialGradient(32, 32, 2, 32, 32, 32);
    grad.addColorStop(0, 'rgba(0,0,0,0.55)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
  },
  false,
);
const shadowMat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false });
const sparkGeo = new THREE.SphereGeometry(0.18, 6, 6);

function box(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}

export function buildKart(def: RacerDef, withLabel: boolean): KartMesh {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const paint = new THREE.MeshLambertMaterial({ color: def.color });
  const accent = new THREE.MeshLambertMaterial({ color: def.accent });
  const skin = new THREE.MeshLambertMaterial({ color: def.skin });

  // Chassis (forward is +Z).
  body.add(box(1.8, 0.42, 2.7, paint, 0, 0.55, 0));
  body.add(box(1.5, 0.3, 0.9, paint, 0, 0.72, 1.25));
  body.add(box(2.0, 0.28, 0.35, darkMat, 0, 0.45, 1.62)); // bumper
  body.add(box(1.9, 0.16, 0.6, accent, 0, 0.82, -1.45)); // spoiler
  body.add(box(0.12, 0.35, 0.12, darkMat, 0.6, 0.62, -1.4));
  body.add(box(0.12, 0.35, 0.12, darkMat, -0.6, 0.62, -1.4));
  body.add(box(1.0, 0.75, 0.22, darkMat, 0, 1.08, -0.55)); // seat back
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.06, 6, 14), darkMat);
  wheel.position.set(0, 1.12, 0.55);
  wheel.rotation.x = -0.9;
  body.add(wheel);
  for (const sx of [-0.35, 0.35]) {
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 0.5, 8), chromeMat);
    pipe.rotation.x = Math.PI / 2;
    pipe.position.set(sx, 0.6, -1.55);
    body.add(pipe);
  }

  // Driver
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.42, 0.7, 10), accent);
  torso.position.set(0, 1.2, -0.15);
  body.add(torso);
  const headR = def.headgear === 'ape' ? 0.46 : 0.38;
  const head = new THREE.Mesh(new THREE.SphereGeometry(headR, 14, 12), skin);
  head.position.set(0, 1.82, -0.12);
  body.add(head);
  if (def.headgear === 'cap') {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.4, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), paint);
    cap.position.set(0, 1.9, -0.12);
    body.add(cap);
    const brim = box(0.62, 0.06, 0.4, paint, 0, 1.92, 0.26);
    body.add(brim);
    const badge = new THREE.Mesh(
      new THREE.CircleGeometry(0.15, 16),
      new THREE.MeshBasicMaterial({ map: letterTexture(def.letter, def.color) }),
    );
    badge.position.set(0, 2.08, 0.2);
    badge.rotation.x = -0.35;
    body.add(badge);
  } else if (def.headgear === 'crown') {
    const gold = new THREE.MeshLambertMaterial({ color: 0xffd400, emissive: 0x3a2a00 });
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.22, 0.26, 6, 1, true), gold);
    crown.position.set(0, 2.28, -0.12);
    body.add(crown);
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 10), new THREE.MeshLambertMaterial({ color: 0xffe066 }));
    hair.scale.set(1, 0.9, 1);
    hair.position.set(0, 1.86, -0.22);
    body.add(hair);
  } else if (def.headgear === 'ape') {
    const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), new THREE.MeshLambertMaterial({ color: 0xd9a877 }));
    muzzle.scale.set(1.2, 0.8, 0.8);
    muzzle.position.set(0, 1.72, 0.25);
    body.add(muzzle);
    const tie = box(0.18, 0.4, 0.05, new THREE.MeshLambertMaterial({ color: 0x3b82f6 }), 0, 1.25, 0.24);
    body.add(tie);
  } else if (def.headgear === 'dino') {
    const snout = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), skin);
    snout.scale.set(1, 0.85, 1.4);
    snout.position.set(0, 1.8, 0.32);
    body.add(snout);
    const spikes = new THREE.MeshLambertMaterial({ color: 0xe8322e });
    for (let i = 0; i < 3; i++) {
      const sp = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.22, 6), spikes);
      sp.position.set(0, 2.15 - i * 0.18, -0.35 - i * 0.12);
      body.add(sp);
    }
  }

  // Wheels
  const wheels: THREE.Mesh[] = [];
  const frontWheels: THREE.Group[] = [];
  const wheelSpots: [number, number, boolean][] = [
    [1.0, 1.0, true],
    [-1.0, 1.0, true],
    [1.05, -0.95, false],
    [-1.05, -0.95, false],
  ];
  for (const [x, z, front] of wheelSpots) {
    const holder = new THREE.Group();
    holder.position.set(x, front ? 0.45 : 0.55, z);
    const w = new THREE.Mesh(front ? wheelGeo : rearWheelGeo, tireMat);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, front ? 0.44 : 0.52, 8), hubMat);
    hub.rotation.z = Math.PI / 2;
    w.add(hub);
    holder.add(w);
    root.add(holder);
    wheels.push(w);
    if (front) frontWheels.push(holder);
  }

  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 4.2), shadowMat);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.04;
  shadow.renderOrder = 1;
  root.add(shadow);

  // Drift sparks (hidden until drifting)
  const sparks: THREE.Mesh[] = [];
  for (let i = 0; i < 6; i++) {
    const s = new THREE.Mesh(sparkGeo, new THREE.MeshBasicMaterial({ color: 0x66ccff, transparent: true }));
    s.visible = false;
    root.add(s);
    sparks.push(s);
  }

  let label: THREE.Sprite | null = null;
  if (withLabel) {
    const css = '#' + def.color.toString(16).padStart(6, '0');
    label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(def.name, lighten(css)), depthTest: true, transparent: true }));
    label.scale.set(4, 1, 1);
    label.position.set(0, 3.3, 0);
    root.add(label);
  }

  return { root, body, wheels, frontWheels, sparks, shadow, label, paintMats: [paint] };
}

function lighten(css: string): string {
  const c = new THREE.Color(css);
  c.lerp(new THREE.Color(0xffffff), 0.45);
  return '#' + c.getHexString();
}

function letterTexture(letter: string, color: number): THREE.CanvasTexture {
  return canvasTexture(
    64,
    64,
    (g) => {
      g.fillStyle = '#fff';
      g.beginPath();
      g.arc(32, 32, 31, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#' + color.toString(16).padStart(6, '0');
      g.font = 'bold 44px Arial Black, Arial, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(letter, 32, 35);
    },
    false,
  );
}

// ---------------------------------------------------------------------------------------------
// Pickups and props

export const coinGeo = new THREE.CylinderGeometry(0.75, 0.75, 0.16, 20);
coinGeo.rotateX(Math.PI / 2);
export const coinMat = new THREE.MeshLambertMaterial({ color: 0xffc81a, emissive: 0x6b4a00 });

export const itemBoxGeo = new THREE.BoxGeometry(1.7, 1.7, 1.7);
export function itemBoxMaterial(): THREE.MeshLambertMaterial {
  const tex = canvasTexture(
    128,
    128,
    (g) => {
      const grad = g.createLinearGradient(0, 0, 128, 128);
      ['#ff4d6d', '#ffb13b', '#f7ff3b', '#3bff7a', '#3bd8ff', '#b03bff'].forEach((c, i, a) => grad.addColorStop(i / (a.length - 1), c));
      g.fillStyle = grad;
      g.fillRect(0, 0, 128, 128);
      g.fillStyle = 'rgba(255,255,255,0.35)';
      g.fillRect(8, 8, 112, 112);
      g.font = 'bold 84px Arial Black, Arial, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineWidth = 8;
      g.strokeStyle = '#333';
      g.strokeText('?', 64, 68);
      g.fillStyle = '#fff';
      g.fillText('?', 64, 68);
    },
    false,
  );
  return new THREE.MeshLambertMaterial({ map: tex, transparent: true, opacity: 0.88, emissive: 0x222222 });
}

export function bananaMesh(): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: 0xffe135, emissive: 0x332a00 });
  const peel = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.22, 8, 12, Math.PI * 1.1), mat);
  peel.rotation.z = Math.PI * 0.95;
  peel.position.y = 0.7;
  g.add(peel);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.25, 6), new THREE.MeshLambertMaterial({ color: 0x5a3a12 }));
  tip.position.set(-0.55, 0.6, 0);
  g.add(tip);
  return g;
}

/** The glitch: a "missing texture" cube, magenta/black checkerboard. */
export function glitchMesh(size: number): THREE.Group {
  const g = new THREE.Group();
  const tex = checkerTexture('#ff00ff', '#000000', 4);
  const core = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), new THREE.MeshBasicMaterial({ map: tex }));
  core.position.y = size / 2 + 0.3;
  g.add(core);
  const wire = new THREE.Mesh(
    new THREE.BoxGeometry(size * 1.25, size * 1.25, size * 1.25),
    new THREE.MeshBasicMaterial({ color: 0xff00ff, wireframe: true, transparent: true, opacity: 0.6 }),
  );
  wire.position.copy(core.position);
  g.add(wire);
  // Floating shards around it
  for (let i = 0; i < 6; i++) {
    const s = new THREE.Mesh(
      new THREE.BoxGeometry(size * 0.18, size * 0.18, size * 0.18),
      new THREE.MeshBasicMaterial({ map: tex }),
    );
    s.userData.orbit = { r: size * (0.9 + Math.random() * 0.5), a: Math.random() * Math.PI * 2, y: Math.random() * size, sp: 1 + Math.random() * 2 };
    g.add(s);
  }
  return g;
}

// ---------------------------------------------------------------------------------------------
// Items in flight

/** A shell: colored dome with a white rim. Forward is +Z. */
export function shellMesh(color: number): THREE.Group {
  const g = new THREE.Group();
  const shellMat = new THREE.MeshLambertMaterial({ color, emissive: new THREE.Color(color).multiplyScalar(0.25) });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.75, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), shellMat);
  dome.position.y = 0.35;
  g.add(dome);
  // Hex plates on the dome
  const plate = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x222222 });
  for (let i = 0; i < 5; i++) {
    const p = new THREE.Mesh(new THREE.CircleGeometry(0.18, 6), plate);
    const a = (i / 5) * Math.PI * 2;
    p.position.set(Math.cos(a) * 0.5, 0.75, Math.sin(a) * 0.5);
    p.lookAt(Math.cos(a) * 2, 2.2, Math.sin(a) * 2);
    g.add(p);
  }
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.74, 0.14, 8, 20), new THREE.MeshLambertMaterial({ color: 0xffffff }));
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.35;
  g.add(rim);
  return g;
}

/** "Regulation": a winged, spiked blue shell. */
export function blueShellMesh(): THREE.Group {
  const g = shellMesh(0x2a6bff);
  const spikeMat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x333333 });
  for (let i = 0; i < 6; i++) {
    const s = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.45, 6), spikeMat);
    const a = (i / 6) * Math.PI * 2;
    s.position.set(Math.cos(a) * 0.45, 0.95, Math.sin(a) * 0.45);
    s.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5);
    g.add(s);
  }
  const wingMat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x444444, side: THREE.DoubleSide });
  for (const side of [-1, 1]) {
    const w = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.6), wingMat);
    w.position.set(side * 1.2, 0.6, 0);
    w.rotation.z = side * 0.3;
    w.name = 'wing';
    g.add(w);
  }
  g.scale.setScalar(1.3);
  return g;
}

export function explosionMesh(color: number): THREE.Mesh {
  return new THREE.Mesh(
    new THREE.SphereGeometry(1, 20, 14),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false }),
  );
}

// ---------------------------------------------------------------------------------------------
// Track features

let chevronTex: THREE.CanvasTexture | null = null;
/** Shared, scrolling chevron texture for boost pads. Scroll it by animating `offset.y`. */
export function boostPadTexture(): THREE.CanvasTexture {
  if (chevronTex && (chevronTex.image as HTMLCanvasElement).width) return chevronTex;
  chevronTex = canvasTexture(128, 128, (g) => {
    g.fillStyle = '#ff7a00';
    g.fillRect(0, 0, 128, 128);
    g.fillStyle = '#ffe14d';
    g.beginPath();
    g.moveTo(14, 110);
    g.lineTo(64, 40);
    g.lineTo(114, 110);
    g.lineTo(88, 110);
    g.lineTo(64, 76);
    g.lineTo(40, 110);
    g.closePath();
    g.fill();
  });
  chevronTex.repeat.set(1, 2);
  return chevronTex;
}

export function boostPadMesh(width: number, length: number): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(width, length),
    new THREE.MeshBasicMaterial({ map: boostPadTexture(), transparent: true, opacity: 0.95, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
  );
  m.rotation.x = -Math.PI / 2;
  return m;
}

/** A wedge ramp: rises from 0 to `height` over `length` along +Z, `width` wide. */
export function rampMesh(width: number, length: number, height: number): THREE.Group {
  const g = new THREE.Group();
  const w = width / 2;
  const top = new THREE.BufferGeometry();
  top.setAttribute('position', new THREE.Float32BufferAttribute([-w, 0, 0, w, 0, 0, w, height, length, -w, height, length], 3));
  top.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  top.setIndex([0, 2, 1, 0, 3, 2]);
  top.computeVertexNormals();
  const tex = canvasTexture(128, 128, (c) => {
    c.fillStyle = '#1b1b22';
    c.fillRect(0, 0, 128, 128);
    c.fillStyle = '#ffd400';
    for (let i = -2; i < 6; i++) {
      c.beginPath();
      c.moveTo(i * 32, 128);
      c.lineTo(i * 32 + 16, 128);
      c.lineTo(i * 32 + 16 + 64, 0);
      c.lineTo(i * 32 + 64, 0);
      c.fill();
    }
  });
  tex.repeat.set(2, 1);
  g.add(new THREE.Mesh(top, new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide, emissive: 0x111111 })));
  const side = new THREE.BufferGeometry();
  side.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      [
        // left and right triangles
        -w, 0, 0, -w, 0, length, -w, height, length,
        w, 0, 0, w, height, length, w, 0, length,
        // front face
        -w, 0, length, w, 0, length, w, height, length,
        -w, 0, length, w, height, length, -w, height, length,
      ],
      3,
    ),
  );
  side.computeVertexNormals();
  g.add(new THREE.Mesh(side, new THREE.MeshLambertMaterial({ color: 0x3a3f4a, side: THREE.DoubleSide })));
  return g;
}

/** A puddle of slop: glossy, faintly iridescent, with a few bubbles. */
export function slopMesh(radius: number): THREE.Group {
  const g = new THREE.Group();
  const tex = canvasTexture(
    128,
    128,
    (c) => {
      const grad = c.createRadialGradient(64, 64, 4, 64, 64, 64);
      grad.addColorStop(0, '#5b3a6e');
      grad.addColorStop(0.55, '#3b2a4a');
      grad.addColorStop(0.85, '#2a4a3a');
      grad.addColorStop(1, 'rgba(30,40,30,0)');
      c.fillStyle = grad;
      c.fillRect(0, 0, 128, 128);
      c.globalAlpha = 0.35;
      for (let i = 0; i < 5; i++) {
        c.strokeStyle = ['#ff6bd6', '#6bf0ff', '#d4ff6b'][i % 3];
        c.lineWidth = 3;
        c.beginPath();
        c.arc(64 + (i - 2) * 6, 60 + i * 3, 18 + i * 7, 0.4 + i, 2.2 + i);
        c.stroke();
      }
    },
    false,
  );
  const puddle = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 28),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5 }),
  );
  puddle.rotation.x = -Math.PI / 2;
  puddle.position.y = 0.05;
  puddle.scale.set(1, 0.75, 1);
  g.add(puddle);
  const bubbleMat = new THREE.MeshLambertMaterial({ color: 0x7a4e8e, emissive: 0x2a1033, transparent: true, opacity: 0.85 });
  for (let i = 0; i < 4; i++) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.18 + Math.random() * 0.15, 8, 6), bubbleMat);
    b.position.set((Math.random() - 0.5) * radius, 0.1, (Math.random() - 0.5) * radius * 0.7);
    b.userData.bob = Math.random() * 6;
    g.add(b);
  }
  return g;
}

/** Wind streaks shown around the player's kart while slipstreaming or boosting. */
export function streakGroup(): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false });
  const geo = new THREE.BoxGeometry(0.05, 0.05, 3);
  for (let i = 0; i < 10; i++) {
    const s = new THREE.Mesh(geo, mat);
    s.userData.seed = Math.random();
    g.add(s);
  }
  g.visible = false;
  return g;
}
