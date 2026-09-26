// The solar system view: Sun, planets, Dyson swarm/shell, probes, mass streams, background stars.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { mulberry32, smoothstep, clamp } from '../../core/util';
import {
  BODIES,
  YEAR_SEC,
  trackPos,
  type BodyId,
  type Derived,
  type GalaxyData,
  IND0,
} from './sim';
import {
  PLANET_VERT,
  SUN_FRAG,
  EARTH_FRAG,
  PLANET_FRAG,
  RING_VERT,
  RING_FRAG,
  HALO_FRAG,
  SWARM_VERT,
  SWARM_FRAG,
  SHELL_VERT,
  SHELL_FRAG,
  POINTS_VERT,
  POINTS_FRAG,
  STARS_VERT,
  STARS_FRAG,
} from './shaders';

export type VisId = BodyId | 'earth';

interface VisDef {
  id: VisId;
  name: string;
  r: number; // orbit radius (scene units)
  period: number; // years
  phase: number;
  size: number;
  parent?: VisId;
  bands?: number;
  cols: [string, string, string];
  atm?: string;
  rings?: boolean;
}

// Orbit radii are compressed (10 * AU^0.55) so the whole system fits; sizes are wildly exaggerated.
const VIS: VisDef[] = [
  { id: 'mercury', name: 'Mercury', r: 5.96, period: 0.241, phase: 2.1, size: 0.25, cols: ['#3c3530', '#6e655c', '#9c948a'] },
  { id: 'venus', name: 'Venus', r: 8.35, period: 0.615, phase: 4.0, size: 0.45, cols: ['#8a6a3a', '#c8aa70', '#eedcae'], atm: '#ffcf80' },
  { id: 'earth', name: 'Earth', r: 10, period: 1, phase: 0.6, size: 0.52, cols: ['#000', '#000', '#000'] },
  { id: 'moon', name: 'Moon', r: 1.15, period: 0.2, phase: 0, size: 0.14, parent: 'earth', cols: ['#4a4a4c', '#78787a', '#a8a8aa'] },
  { id: 'mars', name: 'Mars', r: 12.6, period: 1.88, phase: 5.3, size: 0.34, cols: ['#4a1a0a', '#9a4422', '#cc8455'], atm: '#ff8a60' },
  { id: 'belt', name: 'Asteroid belt', r: 17.3, period: 4.6, phase: 1.2, size: 0.15, cols: ['#3a3634', '#5e5854', '#8a847e'] },
  { id: 'jupiter', name: 'Jupiter', r: 24.7, period: 11.86, phase: 3.3, size: 1.4, bands: 1, cols: ['#7a5a3c', '#caa47c', '#f0e2cc'], atm: '#ffe0b0' },
  { id: 'saturn', name: 'Saturn', r: 34.6, period: 29.5, phase: 5.9, size: 1.15, bands: 1, rings: true, cols: ['#8a7048', '#d0b680', '#f2e4bc'], atm: '#ffe8b0' },
  { id: 'uranus', name: 'Uranus', r: 50.8, period: 84, phase: 0.4, size: 0.8, bands: 1, cols: ['#4f8e9c', '#86c8d2', '#b4eaee'], atm: '#aef4ff' },
  { id: 'neptune', name: 'Neptune', r: 64.9, period: 165, phase: 2.6, size: 0.78, bands: 1, cols: ['#15307e', '#3462c8', '#86a8f8'], atm: '#7aa0ff' },
];
const VISMAP = Object.fromEntries(VIS.map((v) => [v.id, v])) as Record<VisId, VisDef>;

const SUN_R = 1.5;
const SHELL_R = 2.6;
const SWARM_MAX = 6000;
const FREIGHT_MAX = 1400;
const TAU_CETI_DIR = new THREE.Vector3(-0.62, 0.22, -0.75).normalize();

interface Ship {
  sprite: THREE.Sprite;
  trail: THREE.Line;
  pts: THREE.Vector3[];
  start: THREE.Vector3;
  side: number;
}

interface Flash {
  sprite: THREE.Sprite;
  t: number;
  dur: number;
  size: number;
}

function glowTexture(stops: [number, string][]): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  for (const [o, col] of stops) grad.addColorStop(o, col);
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class GalaxyScene {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private useBloom: boolean;
  private container: HTMLElement;
  private ro: ResizeObserver;
  private disposed = false;

  private sun: THREE.Mesh;
  private sunMat: THREE.ShaderMaterial;
  private corona: THREE.Sprite[] = [];
  private meshes = new Map<VisId, THREE.Mesh>();
  private mats = new Map<VisId, THREE.ShaderMaterial>();
  private halos = new Map<VisId, THREE.Mesh>();
  private orbitLines = new Map<VisId, THREE.Line>();
  private ringMat: THREE.ShaderMaterial | null = null;
  private jupMoons: THREE.Mesh[] = [];
  private belt: THREE.Points;
  private swarmGeo: THREE.InstancedBufferGeometry;
  private swarmMat: THREE.ShaderMaterial;
  private shellMat: THREE.ShaderMaterial;
  private shell: THREE.Mesh;
  private freight: THREE.Points;
  private freightPos: Float32Array;
  private freightCol: Float32Array;
  private freightSize: Float32Array;
  private freightData: { alive: boolean; src: VisId; from: THREE.Vector3; to: THREE.Vector3; ctrl: THREE.Vector3; t: number; dur: number; size: number; col: THREE.Color }[] = [];
  private freightAcc = new Map<VisId, number>();
  private debris: THREE.Points;
  private debrisData: { a: number; r: number; y: number; spd: number }[] = [];
  private stars: THREE.Points;
  private starsMat: THREE.ShaderMaterial;
  private tauCeti: THREE.Sprite;
  private tauRing: THREE.Sprite;
  private ships = new Map<number, Ship>();
  private flashes: Flash[] = [];
  private flashTex: THREE.Texture;
  private shipTex: THREE.Texture;
  private rng = mulberry32(7);
  private raycaster = new THREE.Raycaster();
  private tmp = new THREE.Vector3();
  private pos = new Map<VisId, THREE.Vector3>();

  // Camera rig
  private camTheta = 0.9;
  private camPhi = 1.02;
  private camDist = 40;
  private camDistTarget = 40;
  private zoomMul = 1;
  private zoomUntil = 0;
  private focus: VisId | null = null;
  private focusUntil = Infinity;
  private focusBlend = 1;
  private focusFrom = new THREE.Vector3();
  private camTarget = new THREE.Vector3();
  private dragging = false;
  private lastPointer = { x: 0, y: 0 };
  private dragMoved = 0;
  /** Extra orbital time after the sim stops (the planets keep turning in the dark). */
  private afterT = 0;
  private realT = 0;
  private recentArrivals = new Map<VisId, number>();
  private sunI = 1;

  /** Label elements for bodies, positioned each frame. The UI fills their contents. */
  readonly labels = new Map<VisId | 'tauceti', HTMLElement>();
  onPick: (id: VisId) => void = () => {};
  onPickNothing: () => void = () => {};

  constructor(container: HTMLElement, labelLayer: HTMLElement, opts: { bloom: boolean }) {
    this.container = container;
    this.useBloom = opts.bloom;
    const w = Math.max(1, container.clientWidth);
    const h = Math.max(1, container.clientHeight);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.domElement.className = 'gal-canvas';
    container.append(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(40, w / h, 0.05, 4000);
    this.scene.background = new THREE.Color('#010104');

    this.flashTex = glowTexture([
      [0, 'rgba(255,255,255,1)'],
      [0.15, 'rgba(255,230,180,0.8)'],
      [0.45, 'rgba(255,140,60,0.2)'],
      [1, 'rgba(0,0,0,0)'],
    ]);
    this.shipTex = glowTexture([
      [0, 'rgba(255,255,255,1)'],
      [0.25, 'rgba(160,240,255,0.7)'],
      [1, 'rgba(0,0,0,0)'],
    ]);

    // ---- Sun ----
    this.sunMat = new THREE.ShaderMaterial({ vertexShader: PLANET_VERT, fragmentShader: SUN_FRAG, uniforms: { uTime: { value: 0 }, uI: { value: 1 } } });
    this.sun = new THREE.Mesh(new THREE.SphereGeometry(SUN_R, 64, 48), this.sunMat);
    this.scene.add(this.sun);
    const coronaTex = glowTexture([
      [0, 'rgba(255,240,200,1)'],
      [0.2, 'rgba(255,200,120,0.55)'],
      [0.45, 'rgba(255,120,40,0.14)'],
      [1, 'rgba(0,0,0,0)'],
    ]);
    for (const [s, o] of [
      [6.5, 0.8],
      [15, 0.22],
      [34, 0.07],
    ] as const) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: coronaTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: o, color: new THREE.Color(1.6, 1.2, 0.9) }));
      sp.scale.setScalar(s);
      sp.userData.base = o;
      this.corona.push(sp);
      this.scene.add(sp);
    }

    // ---- Planets ----
    const sphere = new THREE.SphereGeometry(1, 48, 32);
    for (const v of VIS) {
      let mat: THREE.ShaderMaterial;
      if (v.id === 'earth') {
        mat = new THREE.ShaderMaterial({
          vertexShader: PLANET_VERT,
          fragmentShader: EARTH_FRAG,
          uniforms: {
            uSunPos: { value: new THREE.Vector3() },
            uSunI: { value: 1 },
            uTime: { value: 0 },
            uInd: { value: 0 },
            uBoil: { value: 0 },
            uScorch: { value: 0 },
            uMolten: { value: 0 },
            uDis: { value: 0 },
          },
        });
      } else {
        mat = new THREE.ShaderMaterial({
          vertexShader: PLANET_VERT,
          fragmentShader: PLANET_FRAG,
          uniforms: {
            uSunPos: { value: new THREE.Vector3() },
            uSunI: { value: 1 },
            uTime: { value: 0 },
            uColA: { value: new THREE.Color(v.cols[0]) },
            uColB: { value: new THREE.Color(v.cols[1]) },
            uColC: { value: new THREE.Color(v.cols[2]) },
            uBands: { value: v.bands ?? 0 },
            uSeed: { value: v.phase * 13.7 },
            uDev: { value: 0 },
            uAtm: { value: new THREE.Color(v.atm ?? '#000000').multiplyScalar(v.atm ? 0.6 : 0) },
          },
        });
      }
      const m = new THREE.Mesh(sphere, mat);
      m.scale.setScalar(v.size);
      m.userData.id = v.id;
      this.scene.add(m);
      this.meshes.set(v.id, m);
      this.mats.set(v.id, mat);
      this.pos.set(v.id, new THREE.Vector3());

      if (v.atm || v.id === 'earth') {
        const hm = new THREE.ShaderMaterial({
          vertexShader: PLANET_VERT,
          fragmentShader: HALO_FRAG,
          uniforms: { uColor: { value: new THREE.Color(v.id === 'earth' ? '#5aa0ff' : v.atm) }, uI: { value: 0.5 } },
          blending: THREE.AdditiveBlending,
          transparent: true,
          depthWrite: false,
          side: THREE.BackSide,
        });
        const halo = new THREE.Mesh(sphere, hm);
        halo.scale.setScalar(v.size * 1.07);
        this.scene.add(halo);
        this.halos.set(v.id, halo);
      }

      if (!v.parent) {
        const pts: THREE.Vector3[] = [];
        for (let i = 0; i <= 256; i++) {
          const a = (i / 256) * Math.PI * 2;
          pts.push(new THREE.Vector3(Math.cos(a) * v.r, 0, Math.sin(a) * v.r));
        }
        const line = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(pts),
          new THREE.LineBasicMaterial({ color: new THREE.Color('#3a4a6a'), transparent: true, opacity: 0.35, depthWrite: false }),
        );
        this.scene.add(line);
        this.orbitLines.set(v.id, line);
      }

      if (v.rings) {
        this.ringMat = new THREE.ShaderMaterial({
          vertexShader: RING_VERT,
          fragmentShader: RING_FRAG,
          uniforms: { uInner: { value: 1.25 }, uOuter: { value: 2.3 }, uSunI: { value: 1 }, uDev: { value: 0 }, uTime: { value: 0 } },
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
        });
        const ring = new THREE.Mesh(new THREE.RingGeometry(1.25, 2.3, 128, 1), this.ringMat);
        ring.rotation.x = -Math.PI / 2 + 0.45;
        ring.rotation.y = 0.2;
        m.add(ring);
      }
    }
    // Jupiter's Galilean moons (decorative).
    const jmMat = new THREE.MeshBasicMaterial({ color: '#8a8070' });
    for (let i = 0; i < 4; i++) {
      const jm = new THREE.Mesh(sphere, jmMat.clone());
      jm.scale.setScalar(0.07 + (i % 2) * 0.02);
      this.scene.add(jm);
      this.jupMoons.push(jm);
    }

    // ---- Asteroid belt ----
    {
      const n = 2200;
      const p = new Float32Array(n * 3);
      const c = new Float32Array(n * 3);
      const s = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const a = this.rng() * Math.PI * 2;
        const r = 15.6 + this.rng() * 3.6 + (this.rng() - 0.5) * 1.2;
        p[i * 3] = Math.cos(a) * r;
        p[i * 3 + 1] = (this.rng() - 0.5) * 0.7;
        p[i * 3 + 2] = Math.sin(a) * r;
        const g = 0.25 + this.rng() * 0.3;
        c[i * 3] = g * 1.05;
        c[i * 3 + 1] = g;
        c[i * 3 + 2] = g * 0.92;
        s[i] = 0.9 + this.rng() * 1.8;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(p, 3));
      g.setAttribute('color', new THREE.BufferAttribute(c, 3));
      g.setAttribute('size', new THREE.BufferAttribute(s, 1));
      this.belt = new THREE.Points(g, this.pointsMaterial(0.2));
      this.scene.add(this.belt);
    }

    // ---- Dyson swarm (instanced collectors) ----
    {
      const base = new THREE.CircleGeometry(1, 6);
      const g = new THREE.InstancedBufferGeometry();
      g.index = base.index;
      g.setAttribute('position', base.getAttribute('position'));
      const orbit = new Float32Array(SWARM_MAX * 4);
      const spd = new Float32Array(SWARM_MAX);
      const seed = new Float32Array(SWARM_MAX);
      for (let i = 0; i < SWARM_MAX; i++) {
        // Early collectors hug the equator (a ring first), later ones spread to every inclination.
        const f = i / SWARM_MAX;
        const spread = 0.12 + Math.pow(f, 0.7) * Math.PI;
        const r = SHELL_R - 0.35 + this.rng() * 1.1;
        orbit[i * 4] = r;
        orbit[i * 4 + 1] = (this.rng() - 0.5) * spread;
        orbit[i * 4 + 2] = this.rng() * Math.PI * 2;
        orbit[i * 4 + 3] = this.rng() * Math.PI * 2;
        spd[i] = (0.9 / Math.pow(r / SHELL_R, 1.5)) * (this.rng() < 0.5 ? 1 : 1) * 0.35;
        seed[i] = this.rng();
      }
      g.setAttribute('orbit', new THREE.InstancedBufferAttribute(orbit, 4));
      g.setAttribute('spd', new THREE.InstancedBufferAttribute(spd, 1));
      g.setAttribute('seed', new THREE.InstancedBufferAttribute(seed, 1));
      g.instanceCount = 0;
      this.swarmGeo = g;
      this.swarmMat = new THREE.ShaderMaterial({
        vertexShader: SWARM_VERT,
        fragmentShader: SWARM_FRAG,
        uniforms: { uTime: { value: 0 }, uSize: { value: 0.045 }, uSunI: { value: 1 }, uCollapse: { value: 0 } },
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(g, this.swarmMat);
      mesh.frustumCulled = false;
      this.scene.add(mesh);
    }

    // ---- Shell ----
    {
      const g = new THREE.IcosahedronGeometry(SHELL_R, 14);
      const n = g.getAttribute('position').count;
      const cell = new Float32Array(n);
      const bary = new Float32Array(n * 3);
      const pa = g.getAttribute('position');
      for (let f = 0; f < n / 3; f++) {
        let cy = 0;
        for (let k = 0; k < 3; k++) cy += pa.getY(f * 3 + k);
        cy = Math.abs(cy / 3 / SHELL_R);
        // Fill from the equator outward (ring → band → sphere), with some randomness.
        const v = Math.min(0.999, Math.pow(cy, 1.4) * 0.72 + this.rng() * 0.28);
        for (let k = 0; k < 3; k++) {
          cell[f * 3 + k] = v;
          bary[(f * 3 + k) * 3 + k] = 1;
        }
      }
      g.setAttribute('cell', new THREE.BufferAttribute(cell, 1));
      g.setAttribute('bary', new THREE.BufferAttribute(bary, 3));
      this.shellMat = new THREE.ShaderMaterial({
        vertexShader: SHELL_VERT,
        fragmentShader: SHELL_FRAG,
        uniforms: { uFill: { value: 0 }, uSunI: { value: 1 }, uTime: { value: 0 }, uIR: { value: 0 } },
        side: THREE.DoubleSide,
      });
      this.shell = new THREE.Mesh(g, this.shellMat);
      this.scene.add(this.shell);
    }

    // ---- Freight (mass streams into the swarm) ----
    {
      this.freightPos = new Float32Array(FREIGHT_MAX * 3);
      this.freightCol = new Float32Array(FREIGHT_MAX * 3);
      this.freightSize = new Float32Array(FREIGHT_MAX);
      for (let i = 0; i < FREIGHT_MAX; i++) {
        this.freightData.push({ alive: false, src: 'earth', from: new THREE.Vector3(), to: new THREE.Vector3(), ctrl: new THREE.Vector3(), t: 0, dur: 1, size: 1, col: new THREE.Color() });
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(this.freightPos, 3));
      g.setAttribute('color', new THREE.BufferAttribute(this.freightCol, 3));
      g.setAttribute('size', new THREE.BufferAttribute(this.freightSize, 1));
      this.freight = new THREE.Points(g, this.pointsMaterial(1));
      this.freight.frustumCulled = false;
      this.scene.add(this.freight);
    }

    // ---- Earth debris (disassembly) ----
    {
      const n = 1600;
      const p = new Float32Array(n * 3);
      const c = new Float32Array(n * 3);
      const s = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        this.debrisData.push({ a: this.rng() * Math.PI * 2, r: 0.3 + this.rng() * 1.3, y: (this.rng() - 0.5) * 0.25, spd: 0.4 + this.rng() * 1.2 });
        const hot = this.rng();
        c[i * 3] = 1.6 + hot;
        c[i * 3 + 1] = 0.5 + hot * 0.6;
        c[i * 3 + 2] = 0.15 + hot * 0.2;
        s[i] = 0;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(p, 3));
      g.setAttribute('color', new THREE.BufferAttribute(c, 3));
      g.setAttribute('size', new THREE.BufferAttribute(s, 1));
      this.debris = new THREE.Points(g, this.pointsMaterial(1));
      this.debris.frustumCulled = false;
      this.scene.add(this.debris);
    }

    // ---- Background stars ----
    {
      const n = 5200;
      const p = new Float32Array(n * 3);
      const c = new Float32Array(n * 3);
      const s = new Float32Array(n);
      const band = new THREE.Vector3(0.3, 1, 0.2).normalize();
      for (let i = 0; i < n; i++) {
        const v = new THREE.Vector3(this.rng() * 2 - 1, this.rng() * 2 - 1, this.rng() * 2 - 1);
        if (v.lengthSq() > 1 || v.lengthSq() < 0.01) {
          i--;
          continue;
        }
        v.normalize();
        const milky = i > n * 0.45;
        if (milky) {
          // Squash toward the galactic plane.
          const d = v.dot(band);
          v.addScaledVector(band, -d * (0.85 + this.rng() * 0.13)).normalize();
        }
        v.multiplyScalar(1500);
        p.set([v.x, v.y, v.z], i * 3);
        const temp = this.rng();
        const col = temp < 0.15 ? [0.7, 0.8, 1.2] : temp < 0.75 ? [1, 1, 1] : temp < 0.93 ? [1.1, 0.95, 0.75] : [1.2, 0.7, 0.5];
        const b = milky ? 0.12 + this.rng() * 0.35 : 0.25 + Math.pow(this.rng(), 6) * 2.2;
        c.set([col[0] * b, col[1] * b, col[2] * b], i * 3);
        s[i] = milky ? 1.3 + this.rng() * 1.2 : 1.2 + Math.pow(this.rng(), 4) * 2.8;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(p, 3));
      g.setAttribute('color', new THREE.BufferAttribute(c, 3));
      g.setAttribute('size', new THREE.BufferAttribute(s, 1));
      this.starsMat = new THREE.ShaderMaterial({
        vertexShader: STARS_VERT,
        fragmentShader: STARS_FRAG,
        uniforms: { uPixelRatio: { value: this.renderer.getPixelRatio() }, uI: { value: 1 } },
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
      });
      this.stars = new THREE.Points(g, this.starsMat);
      this.stars.frustumCulled = false;
      this.scene.add(this.stars);
    }

    // ---- τ Ceti ----
    this.tauCeti = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: this.flashTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, color: new THREE.Color(1.0, 0.95, 0.8) }),
    );
    this.tauCeti.position.copy(TAU_CETI_DIR).multiplyScalar(1400);
    this.tauCeti.scale.setScalar(30);
    this.scene.add(this.tauCeti);
    const ringTex = (() => {
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const g = c.getContext('2d')!;
      g.strokeStyle = 'rgba(255,90,90,0.9)';
      g.lineWidth = 5;
      g.beginPath();
      g.arc(64, 64, 52, 0, Math.PI * 2);
      g.stroke();
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })();
    this.tauRing = new THREE.Sprite(new THREE.SpriteMaterial({ map: ringTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.tauRing.position.copy(this.tauCeti.position);
    this.tauRing.scale.setScalar(80);
    this.tauRing.visible = false;
    this.scene.add(this.tauRing);

    // ---- Labels ----
    for (const v of VIS) {
      const l = document.createElement('div');
      l.className = 'gal-label';
      l.dataset.id = v.id;
      l.addEventListener('click', () => this.onPick(v.id));
      labelLayer.append(l);
      this.labels.set(v.id, l);
    }
    const tl = document.createElement('div');
    tl.className = 'gal-label gal-label-rival hidden';
    labelLayer.append(tl);
    this.labels.set('tauceti', tl);

    // ---- Post ----
    if (this.useBloom) this.setupComposer(w, h);

    // ---- Input ----
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    el.addEventListener('wheel', this.onWheel, { passive: false });

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
  }

  private pointsMaterial(scale: number): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      vertexShader: POINTS_VERT,
      fragmentShader: POINTS_FRAG,
      uniforms: { uScale: { value: 60 * scale * this.renderer.getPixelRatio() } },
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    });
  }

  private setupComposer(w: number, h: number): void {
    const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.55, 0.5, 0.78);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  /** Turn bloom off (e.g. on slow machines). */
  disableBloom(): void {
    if (!this.composer) return;
    this.composer.dispose();
    this.composer = null;
    this.bloom = null;
    this.useBloom = false;
  }

  get bloomEnabled(): boolean {
    return this.useBloom;
  }

  private onDown = (e: PointerEvent) => {
    this.dragging = true;
    this.dragMoved = 0;
    this.lastPointer = { x: e.clientX, y: e.clientY };
  };
  private onMove = (e: PointerEvent) => {
    if (!this.dragging) return;
    const dx = e.clientX - this.lastPointer.x;
    const dy = e.clientY - this.lastPointer.y;
    this.lastPointer = { x: e.clientX, y: e.clientY };
    this.dragMoved += Math.abs(dx) + Math.abs(dy);
    this.camTheta -= dx * 0.005;
    this.camPhi = clamp(this.camPhi - dy * 0.004, 0.15, 1.5);
  };
  private onUp = (e: PointerEvent) => {
    if (!this.dragging) return;
    this.dragging = false;
    if (this.dragMoved < 5 && e.target === this.renderer.domElement) {
      const id = this.pick(e.clientX, e.clientY);
      if (id) this.onPick(id);
      else this.onPickNothing();
    }
  };
  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.zoomMul = clamp(this.zoomMul * Math.exp(e.deltaY * 0.0012), 0.3, 4);
    this.zoomUntil = this.realT + 30;
  };

  /** Point the camera at a body (null = whole system). With `seconds`, return afterwards. */
  focusOn(id: VisId | null, seconds?: number): void {
    if (id === this.focus && !seconds) return;
    this.focusFrom.copy(this.camTarget);
    this.focusBlend = 0;
    this.focus = id;
    this.focusUntil = seconds ? this.realT + seconds : Infinity;
    this.zoomMul = 1;
  }

  get focused(): VisId | null {
    return this.focus;
  }

  pick(cx: number, cy: number): VisId | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((cx - rect.left) / rect.width) * 2 - 1, -((cy - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    // Generous picking: test enlarged spheres.
    let best: VisId | null = null;
    let bestD = Infinity;
    for (const v of VIS) {
      const m = this.meshes.get(v.id)!;
      if (!m.visible) continue;
      const r = Math.max(m.scale.x * 1.6, this.camDist * 0.012);
      const s = new THREE.Sphere(m.position, r);
      const hit = this.raycaster.ray.intersectSphere(s, this.tmp);
      if (hit) {
        const d = hit.distanceTo(this.camera.position);
        if (d < bestD) {
          bestD = d;
          best = v.id;
        }
      }
    }
    return best;
  }

  private resize(): void {
    if (this.disposed) return;
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.composer?.setSize(w, h);
    this.bloom?.setSize(w, h);
  }

  bodyPos(id: VisId): THREE.Vector3 {
    return this.pos.get(id)!;
  }

  private orbitPos(v: VisDef, t: number, out: THREE.Vector3): THREE.Vector3 {
    const a = v.phase + (t / (v.period * YEAR_SEC)) * Math.PI * 2;
    out.set(Math.cos(a) * v.r, 0, -Math.sin(a) * v.r);
    if (v.parent) out.add(this.pos.get(v.parent)!);
    return out;
  }

  /** Notify the scene that a probe arrived, for a flash and to pull the camera out briefly. */
  arrival(id: VisId): void {
    this.recentArrivals.set(id, this.realT);
    const p = this.pos.get(id)!;
    this.flash(p, VISMAP[id].size * 9 + 1.5, 1.4);
  }

  flash(p: THREE.Vector3, size: number, dur: number): void {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.flashTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, color: new THREE.Color(2, 1.7, 1.2) }));
    s.position.copy(p);
    s.scale.setScalar(0.1);
    this.scene.add(s);
    this.flashes.push({ sprite: s, t: 0, dur, size });
  }

  /**
   * Advance visuals. `finale` goes 0 → 1 as the sphere closes and the Sun goes dark.
   */
  update(d: GalaxyData, x: Derived, dt: number, tempC: number, finale: number): void {
    this.realT += dt;
    if (d.complete) this.afterT += dt * 0.5;
    const t = d.t + this.afterT;

    // Sun dims as the shell closes: first subtly, then completely in the finale.
    const frac = x.frac;
    this.sunI = Math.max(0.02, (1 - Math.pow(frac, 3) * 0.35) * (1 - finale));
    this.sunMat.uniforms.uTime.value = this.realT;
    this.sunMat.uniforms.uI.value = Math.max(0.05, 1 - finale);
    for (const c of this.corona) {
      (c.material as THREE.SpriteMaterial).opacity = c.userData.base * Math.max(0, 1 - Math.pow(frac, 1.5) * 0.85) * (1 - finale);
    }

    // Planets
    for (const v of VIS) {
      if (v.parent) continue;
      this.orbitPos(v, t, this.pos.get(v.id)!);
    }
    for (const v of VIS) {
      if (v.parent) this.orbitPos(v, t, this.pos.get(v.id)!);
    }
    const sunPos = new THREE.Vector3(0, 0, 0);
    for (const v of VIS) {
      const m = this.meshes.get(v.id)!;
      const p = this.pos.get(v.id)!;
      m.position.copy(p);
      m.rotation.y = this.realT * (v.bands ? 0.25 : 0.1) + v.phase;
      const mat = this.mats.get(v.id)!;
      mat.uniforms.uSunPos.value.copy(sunPos);
      mat.uniforms.uSunI.value = this.sunI;
      mat.uniforms.uTime.value = this.realT;
      const halo = this.halos.get(v.id);
      if (halo) halo.position.copy(p);
      if (v.id === 'earth') {
        const indN = clamp(Math.log10(Math.max(d.ind, IND0) / IND0) / 4.2, 0, 1);
        mat.uniforms.uInd.value = indN;
        mat.uniforms.uBoil.value = smoothstep(75, 220, tempC);
        mat.uniforms.uScorch.value = smoothstep(220, 650, tempC);
        mat.uniforms.uMolten.value = smoothstep(450, 1100, tempC);
        mat.uniforms.uDis.value = d.earthDis;
        const s = v.size * Math.max(0, 1 - Math.pow(d.earthDis, 0.9));
        m.scale.setScalar(Math.max(0.0001, s));
        m.visible = d.earthDis < 0.995;
        if (halo) {
          halo.scale.setScalar(Math.max(0.0001, s * 1.07));
          halo.visible = m.visible;
          const hm = halo.material as THREE.ShaderMaterial;
          const col = hm.uniforms.uColor.value as THREE.Color;
          col.set('#5aa0ff').lerp(new THREE.Color('#d8d0c8'), smoothstep(75, 220, tempC)).lerp(new THREE.Color('#ff5a10'), smoothstep(450, 1100, tempC));
          hm.uniforms.uI.value = 0.4 * Math.max(this.sunI, smoothstep(450, 1100, tempC));
        }
      } else {
        const st = d.bodies[v.id as BodyId];
        const dev = st.st === 2 ? st.lv : 0;
        mat.uniforms.uDev.value = dev;
        let s = v.size;
        // Mercury is the feedstock: it visibly shrinks as it is taken apart.
        if (v.id === 'mercury' && st.st === 2) s *= 1 - 0.45 * dev - 0.3 * Math.min(1, frac * 3);
        m.scale.setScalar(s);
        if (halo) {
          halo.scale.setScalar(s * 1.07);
          (halo.material as THREE.ShaderMaterial).uniforms.uI.value = 0.35 * this.sunI * (1 - dev * 0.7);
        }
        if (v.id === 'saturn' && this.ringMat) {
          this.ringMat.uniforms.uDev.value = dev;
          this.ringMat.uniforms.uSunI.value = this.sunI;
          this.ringMat.uniforms.uTime.value = this.realT;
        }
      }
    }
    // Galilean moons
    const jp = this.pos.get('jupiter')!;
    const jdev = d.bodies.jupiter.st === 2 ? d.bodies.jupiter.lv : 0;
    this.jupMoons.forEach((jm, i) => {
      const a = this.realT * (0.9 / (i + 1)) + i * 1.7;
      const r = 1.7 + i * 0.45;
      jm.position.set(jp.x + Math.cos(a) * r, 0, jp.z + Math.sin(a) * r);
      (jm.material as THREE.MeshBasicMaterial).color.setRGB(0.35 * this.sunI + jdev * 1.2, 0.32 * this.sunI + jdev * 0.7, 0.28 * this.sunI + jdev * 0.3);
    });
    this.belt.rotation.y = -(t / (4.6 * YEAR_SEC)) * Math.PI * 2 * 0.2;
    {
      const bdev = d.bodies.belt.st === 2 ? d.bodies.belt.lv : 0;
      (this.belt.material as THREE.ShaderMaterial).uniforms.uScale.value = 60 * this.renderer.getPixelRatio() * (0.2 + bdev * 0.25);
    }

    // Orbit lines: brighter for captured bodies.
    for (const [id, line] of this.orbitLines) {
      const lm = line.material as THREE.LineBasicMaterial;
      if (id === 'earth') {
        lm.color.set('#4a7ab0');
        lm.opacity = 0.45 * (1 - d.earthDis);
      } else {
        const st = d.bodies[id as BodyId].st;
        lm.color.set(st === 2 ? '#c89a50' : st === 1 ? '#50c8e8' : '#3a4a6a');
        lm.opacity = (st === 0 ? 0.3 : 0.5) * Math.max(0.3, this.sunI);
      }
    }

    // Swarm
    const tp = trackPos(frac);
    const count = frac > 0 ? Math.min(SWARM_MAX, 10 + Math.floor(SWARM_MAX * Math.pow(tp, 1.7))) : 0;
    this.swarmGeo.instanceCount = count;
    this.swarmMat.uniforms.uTime.value = this.realT;
    this.swarmMat.uniforms.uSunI.value = Math.max(this.sunI, 0.05);
    this.swarmMat.uniforms.uSize.value = 0.035 + 0.03 * tp;
    this.swarmMat.uniforms.uCollapse.value = smoothstep(0.3, 1, frac);
    this.shellMat.uniforms.uFill.value = frac >= 1 ? 1.01 : frac;
    this.shellMat.uniforms.uSunI.value = this.sunI;
    this.shellMat.uniforms.uTime.value = this.realT;
    this.shellMat.uniforms.uIR.value = smoothstep(0.2, 1, frac) * 0.3 + finale * 0.4;

    // Ships
    const live = new Set<number>();
    for (const p of d.probes) {
      live.add(p.id);
      let ship = this.ships.get(p.id);
      if (!ship) ship = this.makeShip(p.id, d);
      const target = this.pos.get(p.target)!;
      const k = clamp((d.t - p.t0) / (p.t1 - p.t0), 0, 1);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      const from = ship.start;
      const mid = this.tmp.copy(from).add(target).multiplyScalar(0.5);
      const dir = new THREE.Vector3().subVectors(target, from);
      const perp = new THREE.Vector3(-dir.z, 0, dir.x).normalize().multiplyScalar(dir.length() * 0.22 * ship.side);
      const ctrl = mid.add(perp).add(new THREE.Vector3(0, dir.length() * 0.06, 0));
      const q = new THREE.Vector3()
        .copy(from)
        .multiplyScalar((1 - e) * (1 - e))
        .addScaledVector(ctrl, 2 * (1 - e) * e)
        .addScaledVector(target, e * e);
      ship.sprite.position.copy(q);
      ship.sprite.scale.setScalar(Math.max(0.35, this.camDist * 0.018));
      ship.pts.push(q.clone());
      if (ship.pts.length > 48) ship.pts.shift();
      const pa = ship.trail.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < 48; i++) {
        const pt = ship.pts[Math.max(0, ship.pts.length - 48 + i)] ?? q;
        pa.setXYZ(i, pt.x, pt.y, pt.z);
      }
      pa.needsUpdate = true;
    }
    for (const [id, ship] of this.ships) {
      if (!live.has(id)) {
        this.scene.remove(ship.sprite, ship.trail);
        ship.sprite.material.dispose();
        ship.trail.geometry.dispose();
        (ship.trail.material as THREE.Material).dispose();
        this.ships.delete(id);
      }
    }

    // Flashes
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.t += dt;
      const k = f.t / f.dur;
      f.sprite.scale.setScalar(f.size * (0.3 + Math.pow(k, 0.4)));
      f.sprite.material.opacity = Math.max(0, 1 - k);
      if (k >= 1) {
        this.scene.remove(f.sprite);
        f.sprite.material.dispose();
        this.flashes.splice(i, 1);
      }
    }

    this.updateFreight(d, x, dt, finale);
    this.updateDebris(d, dt);

    // τ Ceti: visible once detected, dims as its own swarm grows.
    const rivalOn = d.rivalT >= 0;
    this.tauRing.visible = rivalOn && !d.complete;
    if (rivalOn) {
      const pulse = 0.5 + 0.5 * Math.sin(this.realT * 2.5);
      this.tauRing.material.opacity = 0.35 + 0.4 * pulse;
      this.tauRing.scale.setScalar(70 + 20 * pulse);
    }
    this.starsMat.uniforms.uI.value = 1 + finale * 0.6;

    // Camera
    this.updateCamera(d, frac, finale, dt);
    this.updateLabels();
  }

  private makeShip(id: number, d: GalaxyData): Ship {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.shipTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, color: new THREE.Color(1.8, 2.2, 2.4) }));
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(48 * 3), 3));
    const cols = new Float32Array(48 * 3);
    for (let i = 0; i < 48; i++) {
      const a = Math.pow(i / 47, 1.6);
      cols.set([0.3 * a, 0.9 * a, 1.2 * a], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    const trail = new THREE.Line(g, new THREE.LineBasicMaterial({ vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
    trail.frustumCulled = false;
    this.scene.add(sprite, trail);
    const probe = d.probes.find((p) => p.id === id)!;
    // Launch from Earth (or where Earth was, if it has been taken apart).
    const vis = VISMAP.earth;
    const start = new THREE.Vector3();
    const a = vis.phase + (probe.t0 / (vis.period * YEAR_SEC)) * Math.PI * 2;
    start.set(Math.cos(a) * vis.r, 0, -Math.sin(a) * vis.r);
    const ship: Ship = { sprite, trail, pts: [], start, side: id % 2 ? 1 : -1 };
    this.ships.set(id, ship);
    return ship;
  }

  private spawnFreight(src: VisId, from: THREE.Vector3, col: THREE.Color, size: number, speed: number): void {
    const f = this.freightData.find((q) => !q.alive);
    if (!f) return;
    f.alive = true;
    f.src = src;
    f.from.copy(from);
    // Random point on the swarm.
    const u = this.rng() * 2 - 1;
    const th = this.rng() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    const r = SHELL_R + (this.rng() - 0.3) * 0.8;
    f.to.set(Math.cos(th) * s * r, u * r * 0.5, Math.sin(th) * s * r);
    const dist = f.from.distanceTo(f.to);
    f.ctrl.copy(f.from).add(f.to).multiplyScalar(0.5);
    f.ctrl.y += (this.rng() - 0.5) * dist * 0.2;
    f.ctrl.x += (this.rng() - 0.5) * dist * 0.15;
    f.ctrl.z += (this.rng() - 0.5) * dist * 0.15;
    f.t = 0;
    f.dur = Math.max(1.2, dist / speed);
    f.size = size;
    f.col.copy(col);
  }

  private updateFreight(d: GalaxyData, x: Derived, dt: number, finale: number): void {
    const gold = new THREE.Color(2.0, 1.3, 0.55);
    const blue = new THREE.Color(0.9, 1.4, 2.2);
    const red = new THREE.Color(2.4, 0.8, 0.2);
    const emit = (src: VisId, rate: number, col: THREE.Color, size: number, speed: number) => {
      const acc = (this.freightAcc.get(src) ?? 0) + rate * dt;
      let n = Math.floor(acc);
      this.freightAcc.set(src, acc - n);
      while (n-- > 0) this.spawnFreight(src, this.pos.get(src)!, col, size, speed);
    };
    if (!d.complete && finale <= 0) {
      const share = d.share;
      for (const b of BODIES) {
        const r = x.bodyRates[b.id];
        if (r <= 0) continue;
        const rate = (1.5 + Math.max(0, Math.log10(r) - 9) * 1.6) * (0.3 + share) * Math.min(1, d.bodies[b.id].lv * 3);
        emit(b.id, rate, gold, 0.9, 7 + VISMAP[b.id].r * 0.25);
      }
      if (x.exportRate > 0 && d.earthDis < 0.99) {
        emit('earth', (1 + Math.max(0, Math.log10(x.exportRate) - 8) * 1.2) * (0.3 + share), blue, 0.7, 6);
      }
      if (x.earthDisRate > 0) emit('earth', 40, red, 1.4, 8);
    }
    let i = 0;
    for (const f of this.freightData) {
      if (f.alive) {
        f.t += dt;
        const k = f.t / f.dur;
        if (k >= 1) {
          f.alive = false;
        } else {
          const e = k;
          const px = (1 - e) * (1 - e) * f.from.x + 2 * (1 - e) * e * f.ctrl.x + e * e * f.to.x;
          const py = (1 - e) * (1 - e) * f.from.y + 2 * (1 - e) * e * f.ctrl.y + e * e * f.to.y;
          const pz = (1 - e) * (1 - e) * f.from.z + 2 * (1 - e) * e * f.ctrl.z + e * e * f.to.z;
          this.freightPos[i * 3] = px;
          this.freightPos[i * 3 + 1] = py;
          this.freightPos[i * 3 + 2] = pz;
          const fade = Math.min(1, k * 6) * Math.min(1, (1 - k) * 4);
          this.freightCol[i * 3] = f.col.r * fade;
          this.freightCol[i * 3 + 1] = f.col.g * fade;
          this.freightCol[i * 3 + 2] = f.col.b * fade;
          this.freightSize[i] = f.size * (0.4 + this.camDist * 0.012);
        }
      }
      if (!f.alive) this.freightSize[i] = 0;
      i++;
    }
    const g = this.freight.geometry;
    g.getAttribute('position').needsUpdate = true;
    g.getAttribute('color').needsUpdate = true;
    g.getAttribute('size').needsUpdate = true;
  }

  private updateDebris(d: GalaxyData, dt: number): void {
    const g = this.debris.geometry;
    const pa = g.getAttribute('position') as THREE.BufferAttribute;
    const sa = g.getAttribute('size') as THREE.BufferAttribute;
    const ep = this.pos.get('earth')!;
    const dis = d.earthDis;
    const n = this.debrisData.length;
    const shown = Math.floor(n * Math.min(1, dis * 1.5));
    for (let i = 0; i < n; i++) {
      const q = this.debrisData[i];
      if (i >= shown) {
        sa.setX(i, 0);
        continue;
      }
      q.a += q.spd * dt * (0.6 + dis);
      const r = (0.35 + q.r * (0.4 + dis * 0.9)) * (1 + (1 - Math.min(1, dis * 2)) * 0.2);
      pa.setXYZ(i, ep.x + Math.cos(q.a) * r, ep.y + q.y * (1 + dis), ep.z + Math.sin(q.a) * r);
      sa.setX(i, 0.35 + (i % 3) * 0.2);
    }
    pa.needsUpdate = true;
    sa.needsUpdate = true;
  }

  private updateCamera(d: GalaxyData, frac: number, finale: number, dt: number): void {
    // Frame whatever is interesting: probes in flight, fresh arrivals, otherwise the inner system.
    let focusR = 12;
    for (const p of d.probes) focusR = Math.max(focusR, VISMAP[p.target].r);
    for (const [id, at] of this.recentArrivals) {
      if (this.realT - at < 7) focusR = Math.max(focusR, VISMAP[id].r);
      else this.recentArrivals.delete(id);
    }
    let want = clamp(focusR * 2.4 + 10, 34, 185);
    // Late game: come back in to watch the sphere close.
    want = want * (1 - smoothstep(0.003, 0.3, frac) * 0.3);
    if (finale > 0) want = 30 - finale * 12;

    if (this.focus && (this.realT > this.focusUntil || d.complete || (this.focus === 'earth' && d.earthDis >= 0.99))) this.focusOn(null);
    const goal = new THREE.Vector3();
    if (this.focus) {
      const v = VISMAP[this.focus];
      want = v.size * 7 + 2.2 + (this.focus === 'earth' ? d.earthDis * 3 : 0) + (v.rings ? 2 : 0);
      goal.copy(this.pos.get(this.focus)!);
    }
    this.focusBlend = Math.min(1, this.focusBlend + dt / 1.6);
    const fb = this.focusBlend * this.focusBlend * (3 - 2 * this.focusBlend);
    this.camTarget.copy(this.focusFrom).lerp(goal, fb);

    if (this.realT < this.zoomUntil && finale <= 0) want *= this.zoomMul;
    else this.zoomMul = 1;
    this.camDistTarget = want;
    const k = 1 - Math.exp(-dt * (this.focus ? 2.2 : this.realT < this.zoomUntil ? 5 : 0.9));
    this.camDist += (this.camDistTarget - this.camDist) * k;
    if (!this.dragging) this.camTheta += dt * (0.012 + finale * 0.05);
    if (finale > 0) this.camPhi += (1.2 - this.camPhi) * (1 - Math.exp(-dt * 0.5));
    const r = this.camDist;
    this.camera.position.set(
      this.camTarget.x + Math.sin(this.camPhi) * Math.cos(this.camTheta) * r,
      this.camTarget.y + Math.cos(this.camPhi) * r,
      this.camTarget.z + Math.sin(this.camPhi) * Math.sin(this.camTheta) * r,
    );
    this.camera.lookAt(this.camTarget);
    // The top panel covers the upper part of the view; nudge the system down into the open space.
    const w = this.renderer.domElement.clientWidth;
    const h = this.renderer.domElement.clientHeight;
    this.camera.setViewOffset(w, h, 0, -h * 0.07, w, h);
  }

  private updateLabels(): void {
    const w = this.renderer.domElement.clientWidth;
    const h = this.renderer.domElement.clientHeight;
    this.camera.updateMatrixWorld();
    const place = (el: HTMLElement, p: THREE.Vector3, offsetPx: number) => {
      this.tmp.copy(p).project(this.camera);
      if (this.tmp.z > 1 || this.tmp.x < -1.1 || this.tmp.x > 1.1 || this.tmp.y < -1.1 || this.tmp.y > 1.1) {
        el.style.visibility = 'hidden';
        return;
      }
      el.style.visibility = '';
      const sx = (this.tmp.x * 0.5 + 0.5) * w;
      const sy = (-this.tmp.y * 0.5 + 0.5) * h;
      el.style.transform = `translate(${sx.toFixed(1)}px, ${(sy + offsetPx).toFixed(1)}px) translateX(-50%)`;
    };
    for (const v of VIS) {
      const el = this.labels.get(v.id)!;
      const m = this.meshes.get(v.id)!;
      // Offset below the body by its projected radius.
      const dist = this.camera.position.distanceTo(m.position);
      const pxPerUnit = h / (2 * Math.tan((this.camera.fov * Math.PI) / 360) * dist);
      if (v.id === 'moon') {
        // Beside the Moon rather than below it, so it doesn't collide with Earth's label.
        place(el, m.position, -8);
        el.style.transform += ` translateX(calc(50% + ${Math.max(8, m.scale.x * pxPerUnit + 6).toFixed(1)}px))`;
        if (this.camDist > 70) el.style.visibility = 'hidden';
      } else {
        place(el, m.position, Math.max(6, m.scale.x * pxPerUnit + 4));
      }
    }
    const tl = this.labels.get('tauceti')!;
    place(tl, this.tauCeti.position, 22);
  }

  render(): void {
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.disposed = true;
    this.ro.disconnect();
    const el = this.renderer.domElement;
    el.removeEventListener('pointerdown', this.onDown);
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    el.removeEventListener('wheel', this.onWheel);
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
    this.flashTex.dispose();
    this.shipTex.dispose();
    this.composer?.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    el.remove();
    for (const l of this.labels.values()) l.remove();
  }
}
