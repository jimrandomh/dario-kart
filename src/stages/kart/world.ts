// Builds the static 3D world for a track: sky, ground, road, curbs, barriers, scenery.

import * as THREE from 'three';
import { mulberry32, randRange, pick, type Rng } from '../../core/util';
import { nearestIndex, pointAt, headingAt, type Track } from './track';
import { bannerTexture, canvasTexture, checkerTexture, groundTexture, roadTexture, stripeTexture } from './models';

export interface World {
  scene: THREE.Scene;
  roadMat: THREE.MeshLambertMaterial;
  skyMat: THREE.MeshBasicMaterial;
  sky: THREE.Mesh;
}

const BILLBOARDS = [
  'SCALE IS ALL YOU NEED',
  'WIN THE RACE',
  'CONSTITUTIONAL KARTS™',
  'RESPONSIBLE SCALING · IRRESPONSIBLE SPEEDS',
  'NOW WITH 10²⁶ FLOPS',
  'REWARD: +1.0',
  'ALIGNMENT TAX: 0%',
  'SAFETY FIRST*  *SECOND',
  'BRAKES ARE A CAPABILITIES LIMITATION',
  'ARE WE THERE YET?',
  'MOVE FAST AND BREAK THINGS',
  'THE BITTER LESSON: GO FASTER',
];

function ribbon(t: Track, offA: number, offB: number, y: number, vScale: number): THREE.BufferGeometry {
  const n = t.n;
  const pos = new Float32Array((n + 1) * 2 * 3);
  const uv = new Float32Array((n + 1) * 2 * 2);
  const nor = new Float32Array((n + 1) * 2 * 3);
  for (let k = 0; k <= n; k++) {
    const i = k % n;
    const v = (k === n ? t.length : t.s[i]) / vScale;
    const ax = t.px[i] + t.nx[i] * offA;
    const az = t.pz[i] + t.nz[i] * offA;
    const bx = t.px[i] + t.nx[i] * offB;
    const bz = t.pz[i] + t.nz[i] * offB;
    pos.set([ax, y, az, bx, y, bz], k * 6);
    uv.set([0, v, 1, v], k * 4);
    nor.set([0, 1, 0, 0, 1, 0], k * 6);
  }
  const idx: number[] = [];
  for (let k = 0; k < n; k++) {
    const a = k * 2;
    const b = a + 1;
    const c = a + 2;
    const d = a + 3;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

function wall(t: Track, off: number, height: number, vScale: number): THREE.BufferGeometry {
  const n = t.n;
  const pos = new Float32Array((n + 1) * 2 * 3);
  const uv = new Float32Array((n + 1) * 2 * 2);
  for (let k = 0; k <= n; k++) {
    const i = k % n;
    const v = (k === n ? t.length : t.s[i]) / vScale;
    const x = t.px[i] + t.nx[i] * off;
    const z = t.pz[i] + t.nz[i] * off;
    pos.set([x, 0, z, x, height, z], k * 6);
    uv.set([0, v, 1, v], k * 4);
  }
  const idx: number[] = [];
  for (let k = 0; k < n; k++) {
    const a = k * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function skyDome(top: number, bottom: number): { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial } {
  const geo = new THREE.SphereGeometry(1400, 32, 16);
  const colors = new Float32Array(geo.attributes.position.count * 3);
  const cTop = new THREE.Color(top);
  const cBot = new THREE.Color(bottom);
  const c = new THREE.Color();
  for (let i = 0; i < geo.attributes.position.count; i++) {
    const y = geo.attributes.position.getY(i) / 1400;
    c.copy(cBot).lerp(cTop, Math.pow(Math.max(0, y), 0.6));
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = -1;
  return { mesh, mat };
}

/**
 * Font size and greedy word wrap (up to 3 lines) that fit text in a w×h box, preferring large
 * text but penalizing unforced line breaks a little. " · " forces a line break.
 */
function fitText(g: CanvasRenderingContext2D, text: string, w: number, h: number): { lines: string[]; size: number } {
  const paragraphs = text.split(' · ').map((p) => p.split(/\s+/).filter(Boolean));
  let best: { lines: string[]; size: number; score: number } | null = null;
  for (let size = 56; size > 14; size -= 2) {
    g.font = `italic 900 ${size}px Arial Black, Arial, sans-serif`;
    const lines: string[] = [];
    let fits = true;
    for (const words of paragraphs) {
      let cur = '';
      for (const word of words) {
        const next = cur ? cur + ' ' + word : word;
        if (g.measureText(next).width <= w) {
          cur = next;
        } else if (!cur || g.measureText(word).width > w) {
          fits = false;
        } else {
          lines.push(cur);
          cur = word;
        }
      }
      if (cur) lines.push(cur);
    }
    if (fits && lines.length <= 3 && lines.length * size * 1.08 <= h) {
      const score = size - 4 * (lines.length - paragraphs.length);
      if (!best || score > best.score) best = { lines, size, score };
    }
  }
  return best ?? { lines: [text], size: 14 };
}

function distToTrack(t: Track, x: number, z: number): number {
  const i = nearestIndex(t, x, z, -1);
  return Math.hypot(t.px[i] - x, t.pz[i] - z);
}

function scatter(t: Track, rng: Rng, count: number, minDist: number, pad: number): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  const b = t.bounds;
  let tries = 0;
  while (out.length < count && tries < count * 20) {
    tries++;
    const x = randRange(rng, b.minX - pad, b.maxX + pad);
    const z = randRange(rng, b.minZ - pad, b.maxZ + pad);
    if (distToTrack(t, x, z) < minDist) continue;
    out.push({ x, z });
  }
  return out;
}

function instanced(geo: THREE.BufferGeometry, mat: THREE.Material, mats: THREE.Matrix4[]): THREE.InstancedMesh {
  const m = new THREE.InstancedMesh(geo, mat, Math.max(1, mats.length));
  mats.forEach((mx, i) => m.setMatrixAt(i, mx));
  m.count = mats.length;
  m.instanceMatrix.needsUpdate = true;
  return m;
}

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const tmpP = new THREE.Vector3();
function mat4(x: number, y: number, z: number, sx: number, sy: number, sz: number, ry = 0): THREE.Matrix4 {
  tmpQ.setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry);
  return tmpM.clone().compose(tmpP.set(x, y, z), tmpQ, tmpS.set(sx, sy, sz));
}

export function buildWorld(t: Track): World {
  const th = t.theme;
  const neon = th.id === 'neon';
  const rng = mulberry32(t.seed ^ 0x5bd1e995);
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(th.fog, th.fogNear, th.fogFar);

  const { mesh: sky, mat: skyMat } = skyDome(th.skyTop, th.skyBottom);
  scene.add(sky);

  scene.add(new THREE.HemisphereLight(th.hemiSky, th.hemiGround, neon ? 1.6 : 1.5));
  const sun = new THREE.DirectionalLight(th.sun, neon ? 0.8 : 1.8);
  sun.position.set(120, 260, 80);
  scene.add(sun);

  // Ground
  const gTex = groundTexture(th.ground, th.groundSpeck, neon);
  gTex.repeat.set(neon ? 60 : 120, neon ? 60 : 120);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), new THREE.MeshLambertMaterial({ map: gTex }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.05;
  scene.add(ground);

  // Road
  const rTex = roadTexture(th.road, th.roadLine, neon);
  const roadMat = new THREE.MeshLambertMaterial({
    map: rTex,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    emissive: neon ? 0x221133 : 0x000000,
  });
  scene.add(new THREE.Mesh(ribbon(t, t.halfWidth, -t.halfWidth, 0.02, 14), roadMat));

  // Curbs
  const curbMat = new THREE.MeshLambertMaterial({
    map: stripeTexture(th.curbA, th.curbB),
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    emissive: neon ? 0x333333 : 0x000000,
  });
  scene.add(new THREE.Mesh(ribbon(t, t.halfWidth + 1.4, t.halfWidth, 0.03, 6), curbMat));
  scene.add(new THREE.Mesh(ribbon(t, -t.halfWidth, -t.halfWidth - 1.4, 0.03, 6), curbMat));

  // Barriers
  const wallTex = stripeTexture(th.wallA, th.wallB);
  const wallMat = new THREE.MeshLambertMaterial({
    map: wallTex,
    side: THREE.DoubleSide,
    emissive: neon ? 0x442266 : 0x000000,
  });
  scene.add(new THREE.Mesh(wall(t, t.wallDist, 1.3, 8), wallMat));
  scene.add(new THREE.Mesh(wall(t, -t.wallDist, 1.3, 8), wallMat));
  const capMat = new THREE.MeshLambertMaterial({ color: neon ? 0x20e3ff : 0xeeeeee, emissive: neon ? 0x20e3ff : 0x000000 });
  scene.add(new THREE.Mesh(ribbon(t, t.wallDist + 0.25, t.wallDist - 0.25, 1.3, 8), capMat));
  scene.add(new THREE.Mesh(ribbon(t, -t.wallDist + 0.25, -t.wallDist - 0.25, 1.3, 8), capMat));

  // Start line + arch
  const h0 = headingAt(t, 0);
  const start = new THREE.Mesh(
    new THREE.PlaneGeometry(t.halfWidth * 2, 3),
    new THREE.MeshLambertMaterial({ map: checkerTexture('#111', '#fff', 8), polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
  );
  (start.material as THREE.MeshLambertMaterial).map!.repeat.set(3, 0.5);
  start.rotation.x = -Math.PI / 2;
  start.rotation.z = h0;
  start.position.set(t.px[0], 0.04, t.pz[0]);
  scene.add(start);

  const arch = new THREE.Group();
  arch.position.set(t.px[0], 0, t.pz[0]);
  arch.rotation.y = h0;
  const postMat = new THREE.MeshLambertMaterial({ color: 0xdddddd });
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.7, 11, 10), postMat);
    post.position.set(side * (t.halfWidth + 2.5), 5.5, 0);
    arch.add(post);
  }
  const front = new THREE.MeshLambertMaterial({ map: bannerTexture('DARIO KART', 'YOUR GOAL: WIN THE RACE'), emissive: 0x222222 });
  const back = new THREE.MeshLambertMaterial({ map: bannerTexture('WIN THE RACE', 'REWARD: +1.0 PER VICTORY'), emissive: 0x222222 });
  const edge = new THREE.MeshLambertMaterial({ color: 0xa3121b });
  const banner = new THREE.Mesh(new THREE.BoxGeometry(t.halfWidth * 2 + 7, 3.4, 0.6), [edge, edge, edge, edge, back, front]);
  banner.position.y = 10;
  arch.add(banner);
  scene.add(arch);

  // Billboards just outside the wall
  const boards = [...BILLBOARDS].sort(() => rng() - 0.5).slice(0, 6);
  boards.forEach((text, bi) => {
    const s = ((bi + 0.5) / boards.length) * t.length + randRange(rng, -20, 20);
    const side = rng() < 0.5 ? -1 : 1;
    const p = pointAt(t, s, side * (t.wallDist + 5));
    const tex = canvasTexture(
      512,
      160,
      (g) => {
        g.fillStyle = neon ? '#12002a' : '#fffbe8';
        g.fillRect(0, 0, 512, 160);
        g.strokeStyle = neon ? '#ff4fd8' : '#e8322e';
        g.lineWidth = 12;
        g.strokeRect(6, 6, 500, 148);
        g.fillStyle = neon ? '#20e3ff' : '#1d1d1d';
        const { lines, size } = fitText(g, text, 460, 124);
        g.font = `italic 900 ${size}px Arial Black, Arial, sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        const lh = size * 1.08;
        lines.forEach((ln, i) => g.fillText(ln, 256, 82 + (i - (lines.length - 1) / 2) * lh));
      },
      false,
    );
    const board = new THREE.Group();
    const face = new THREE.Mesh(new THREE.PlaneGeometry(16, 5), new THREE.MeshLambertMaterial({ map: tex, emissive: neon ? 0x444444 : 0x111111 }));
    face.position.y = 5.5;
    board.add(face);
    const backFace = new THREE.Mesh(new THREE.PlaneGeometry(16, 5), new THREE.MeshLambertMaterial({ color: 0x555555 }));
    backFace.position.y = 5.5;
    backFace.rotation.y = Math.PI;
    board.add(backFace);
    for (const lx of [-6, 6]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.4, 3.5, 0.4), postMat);
      leg.position.set(lx, 1.75, 0);
      board.add(leg);
    }
    board.position.set(p.x, 0, p.z);
    // Face the track centerline.
    board.lookAt(t.px[p.i], 0, t.pz[p.i]);
    scene.add(board);
  });

  // Scenery
  const spots = scatter(t, rng, 260, t.wallDist + 6, 140);
  const trunkMats: THREE.Matrix4[] = [];
  const leafMats: THREE.Matrix4[] = [];
  const extraMats: THREE.Matrix4[] = [];
  for (const { x, z } of spots) {
    const s = randRange(rng, 0.8, 1.6);
    const ry = rng() * Math.PI * 2;
    trunkMats.push(mat4(x, 1.5 * s, z, s, s, s, ry));
    leafMats.push(mat4(x, (th.id === 'snow' ? 4.5 : 4.2) * s, z, s, s, s, ry));
    if (th.id === 'snow') extraMats.push(mat4(x, 6.6 * s, z, s * 0.6, s * 0.6, s * 0.6, ry));
    if (th.id === 'desert' && rng() < 0.7) extraMats.push(mat4(x + 0.9 * s, 3 * s, z, s, s, s, ry));
  }
  if (th.id === 'grass') {
    scene.add(instanced(new THREE.CylinderGeometry(0.35, 0.5, 3, 7), new THREE.MeshLambertMaterial({ color: 0x7a4a26 }), trunkMats));
    const leaf = new THREE.IcosahedronGeometry(2.3, 0);
    scene.add(instanced(leaf, new THREE.MeshLambertMaterial({ color: 0x2f8f3a, flatShading: true }), leafMats));
  } else if (th.id === 'snow') {
    scene.add(instanced(new THREE.CylinderGeometry(0.3, 0.4, 3, 6), new THREE.MeshLambertMaterial({ color: 0x5a3a22 }), trunkMats));
    scene.add(instanced(new THREE.ConeGeometry(2.2, 5, 7), new THREE.MeshLambertMaterial({ color: 0x1f5b3f, flatShading: true }), leafMats));
    scene.add(instanced(new THREE.ConeGeometry(1.6, 2.2, 7), new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), extraMats));
  } else if (th.id === 'desert') {
    const cactus = new THREE.MeshLambertMaterial({ color: 0x3e8e41, flatShading: true });
    scene.add(instanced(new THREE.CylinderGeometry(0.55, 0.6, 5, 8), cactus, trunkMats.map((m) => m.clone().multiply(new THREE.Matrix4().makeTranslation(0, 1, 0)))));
    scene.add(instanced(new THREE.CylinderGeometry(0.35, 0.35, 2, 7), cactus, extraMats));
    scene.add(instanced(new THREE.DodecahedronGeometry(1.4, 0), new THREE.MeshLambertMaterial({ color: 0xb9794a, flatShading: true }), leafMats.filter((_, i) => i % 3 === 0).map((m) => m.clone().multiply(new THREE.Matrix4().makeTranslation(3, -3.5, 2)))));
  } else {
    const crystal = new THREE.MeshLambertMaterial({ color: 0x8a2cff, emissive: 0x5a1acc, flatShading: true });
    scene.add(instanced(new THREE.OctahedronGeometry(1.6, 0), crystal, leafMats.map((m) => m.clone().multiply(new THREE.Matrix4().makeScale(0.8, 2, 0.8)))));
    const stars = new Float32Array(1500 * 3);
    for (let i = 0; i < 1500; i++) {
      const u = rng() * Math.PI * 2;
      const v = Math.acos(rng() * 0.95);
      stars.set([Math.cos(u) * Math.sin(v) * 1300, Math.cos(v) * 1300, Math.sin(u) * Math.sin(v) * 1300], i * 3);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(stars, 3));
    scene.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, fog: false })));
  }

  // Mountains ring
  const cx = (t.bounds.minX + t.bounds.maxX) / 2;
  const cz = (t.bounds.minZ + t.bounds.maxZ) / 2;
  const R = Math.max(t.bounds.maxX - t.bounds.minX, t.bounds.maxZ - t.bounds.minZ) / 2 + 300;
  const mMats: THREE.Matrix4[] = [];
  const capMats: THREE.Matrix4[] = [];
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + randRange(rng, -0.1, 0.1);
    const r = R + randRange(rng, 0, 220);
    const h = randRange(rng, 90, 220);
    const w = randRange(rng, 90, 170);
    const x = cx + Math.cos(a) * r;
    const z = cz + Math.sin(a) * r;
    mMats.push(mat4(x, h / 2, z, w, h, w, rng() * 6));
    capMats.push(mat4(x, h * 0.86, z, w * 0.3, h * 0.28, w * 0.3, rng() * 6));
  }
  const coneGeo = new THREE.ConeGeometry(1, 1, 7);
  scene.add(instanced(coneGeo, new THREE.MeshLambertMaterial({ color: th.mountain, flatShading: true, emissive: neon ? 0x1a0833 : 0 }), mMats));
  scene.add(instanced(coneGeo, new THREE.MeshLambertMaterial({ color: th.mountainCap, flatShading: true, emissive: neon ? 0x661a55 : 0 }), capMats));

  // Clouds
  if (!neon) {
    const cloudMats: THREE.Matrix4[] = [];
    for (let i = 0; i < 18; i++) {
      const a = rng() * Math.PI * 2;
      const r = randRange(rng, 200, 800);
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r;
      const y = randRange(rng, 90, 160);
      const puffs = 4 + Math.floor(rng() * 4);
      for (let p = 0; p < puffs; p++) {
        const s = randRange(rng, 10, 20);
        cloudMats.push(mat4(x + (p - puffs / 2) * 12 + randRange(rng, -4, 4), y + randRange(rng, -3, 5), z + randRange(rng, -8, 8), s, s * 0.7, s));
      }
    }
    scene.add(instanced(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x777777, flatShading: true, fog: false }), cloudMats));
  }

  void pick;
  return { scene, roadMat, skyMat, sky };
}

export function disposeScene(scene: THREE.Scene): void {
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    const mats = Array.isArray(mat) ? mat : mat ? [mat] : [];
    for (const mm of mats) {
      const anyM = mm as THREE.Material & { map?: THREE.Texture | null };
      anyM.map?.dispose();
      mm.dispose();
    }
  });
}
