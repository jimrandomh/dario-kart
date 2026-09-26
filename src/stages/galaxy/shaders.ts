// GLSL for the solar system. Everything is procedural: no texture assets.

export const NOISE = /* glsl */ `
vec3 mod289(vec3 x){ return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x){ return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x){ return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v){
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}
float fbm(vec3 p){
  float f = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { f += a * snoise(p); p *= 2.03; a *= 0.5; }
  return f;
}
float fbm3(vec3 p){
  float f = 0.0, a = 0.5;
  for (int i = 0; i < 3; i++) { f += a * snoise(p); p *= 2.03; a *= 0.5; }
  return f;
}
float hash13(vec3 p){
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
`;

/** Shared vertex shader for planets: object-space position, world normal/position. */
export const PLANET_VERT = /* glsl */ `
varying vec3 vObj;
varying vec3 vNormalW;
varying vec3 vPosW;
void main(){
  vObj = position;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vPosW = w.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

export const SUN_FRAG = /* glsl */ `
uniform float uTime;
uniform float uI;
varying vec3 vObj;
varying vec3 vNormalW;
varying vec3 vPosW;
${NOISE}
void main(){
  vec3 p = normalize(vObj);
  float n = fbm(p * 3.0 + vec3(0.0, uTime * 0.05, uTime * 0.03));
  float g = snoise(p * 18.0 + uTime * 0.2) * 0.5 + 0.5;
  vec3 V = normalize(cameraPosition - vPosW);
  float mu = max(dot(normalize(vNormalW), V), 0.0);
  float limb = pow(mu, 0.45);
  vec3 hot = vec3(4.2, 3.1, 1.6);
  vec3 warm = vec3(3.2, 1.25, 0.3);
  vec3 col = mix(warm, hot, smoothstep(-0.3, 0.5, n + g * 0.35));
  col *= 0.55 + 0.45 * limb;
  col += vec3(1.5, 0.35, 0.05) * pow(1.0 - mu, 3.0);
  gl_FragColor = vec4(col * uI, 1.0);
}
`;

export const EARTH_FRAG = /* glsl */ `
uniform vec3 uSunPos;
uniform float uSunI;
uniform float uTime;
uniform float uInd;     // industrialization 0..1
uniform float uBoil;    // oceans boiling 0..1
uniform float uScorch;  // steam turning to a brown haze 0..1
uniform float uMolten;  // surface molten 0..1
uniform float uDis;     // disassembly 0..1
varying vec3 vObj;
varying vec3 vNormalW;
varying vec3 vPosW;
${NOISE}
void main(){
  vec3 p = normalize(vObj);
  float cont = fbm(p * 1.6 + vec3(3.1, 1.7, 0.4));
  float land = smoothstep(0.0, 0.06, cont);
  float lat = abs(p.y);
  float detail = fbm3(p * 7.0);

  vec3 ocean = mix(vec3(0.004, 0.02, 0.09), vec3(0.01, 0.06, 0.18), detail * 0.5 + 0.5);
  vec3 ground = mix(vec3(0.03, 0.09, 0.02), vec3(0.2, 0.14, 0.06), smoothstep(0.05, 0.35, cont + detail * 0.2));
  ground = mix(ground, vec3(0.8), smoothstep(0.8, 0.9, lat) * (1.0 - uBoil));
  ocean = mix(ocean, vec3(0.75), smoothstep(0.86, 0.95, lat) * (1.0 - uBoil));

  // Industry spreads over the land, then over the drained seabed.
  float spread = uInd * 1.25 - (fbm3(p * 3.0 + 7.0) * 0.5 + 0.5) * 0.6;
  float indLand = smoothstep(0.0, 0.25, spread) * land;
  float indSea = smoothstep(0.0, 0.25, spread - 0.6) * (1.0 - land) * uBoil;
  float ind = max(indLand, indSea);
  vec3 concrete = vec3(0.07, 0.07, 0.075);
  ground = mix(ground, concrete, indLand);
  ocean = mix(ocean, mix(vec3(0.09, 0.08, 0.07), concrete, indSea), uBoil);
  vec3 base = mix(ocean, ground, land);

  vec2 ll = vec2(atan(p.z, p.x) / 6.2831853, asin(p.y) / 3.14159265);
  vec2 gq = abs(fract(ll * vec2(64.0, 32.0)) - 0.5);
  float grid = smoothstep(0.43, 0.5, max(gq.x, gq.y));

  vec3 N = normalize(vNormalW);
  vec3 L = normalize(uSunPos - vPosW);
  float ndl = dot(N, L);
  float day = smoothstep(-0.15, 0.2, ndl);
  vec3 col = base * max(ndl, 0.0) * uSunI * 1.9 + base * 0.015;

  // Clouds, then steam as the oceans boil, then nothing once it's molten.
  float cl = fbm(p * 2.6 + vec3(uTime * 0.015, 0.0, uTime * 0.01));
  float cover = smoothstep(0.05 - uBoil * 0.5, 0.45, cl) * (1.0 - uMolten);
  vec3 cloudCol = mix(mix(vec3(1.0), vec3(0.8, 0.78, 0.74), uBoil), vec3(0.62, 0.42, 0.28), uScorch);
  col = mix(col, cloudCol * max(ndl, 0.0) * uSunI * 1.6, cover * (0.75 + uBoil * 0.2));

  // Night side: city lights, then factory grids.
  float lights = step(0.62 - uInd * 0.35, snoise(p * 55.0)) * land * min(1.0, 0.25 + uInd * 3.0);
  vec3 glow = vec3(1.0, 0.55, 0.2) * (lights * 0.9 + grid * ind * 1.6 * uInd);
  col += glow * (1.0 - day * 0.85) * (1.0 - cover * 0.6) * (1.0 - uMolten);

  // Molten surface: dark crust, glowing cracks, on both day and night sides.
  float c1 = 1.0 - abs(snoise(p * 5.0 + vec3(0.0, uTime * 0.01, 0.0)));
  float c2 = 1.0 - abs(snoise(p * 11.0 + 4.0));
  float cracks = pow(c1, 10.0) + pow(c2, 14.0) * 0.6;
  vec3 crust = vec3(0.04, 0.025, 0.02) * max(ndl, 0.0) * uSunI * 2.0;
  vec3 lava = vec3(3.2, 0.75, 0.08) * cracks + vec3(0.25, 0.03, 0.0);
  col = mix(col, crust + lava * (0.6 + uDis * 0.8), uMolten);

  // Disassembly: seams of machinery everywhere.
  col += vec3(2.0, 1.1, 0.4) * grid * uDis * 1.5;

  vec3 V = normalize(cameraPosition - vPosW);
  float fres = pow(1.0 - max(dot(N, V), 0.0), 2.5);
  vec3 atm = mix(mix(vec3(0.25, 0.55, 1.2), vec3(0.9, 0.85, 0.8), uBoil), vec3(1.6, 0.35, 0.05), uMolten);
  col += atm * fres * (0.25 + 0.75 * day) * (1.0 - uDis) * max(uSunI, uMolten);
  gl_FragColor = vec4(col, 1.0);
}
`;

export const PLANET_FRAG = /* glsl */ `
uniform vec3 uSunPos;
uniform float uSunI;
uniform float uTime;
uniform vec3 uColA;
uniform vec3 uColB;
uniform vec3 uColC;
uniform float uBands;
uniform float uSeed;
uniform float uDev;      // development 0..1
uniform vec3 uAtm;
varying vec3 vObj;
varying vec3 vNormalW;
varying vec3 vPosW;
${NOISE}
void main(){
  vec3 p = normalize(vObj);
  float n = fbm(p * 2.5 + uSeed);
  float t;
  if (uBands > 0.5) {
    float warp = fbm3(p * vec3(2.0, 6.0, 2.0) + uSeed + vec3(uTime * 0.01, 0.0, 0.0));
    t = sin(p.y * 16.0 + warp * 3.5) * 0.5 + 0.5;
  } else {
    t = n * 0.6 + 0.5 + snoise(p * 9.0 + uSeed) * 0.15;
  }
  vec3 col = mix(uColA, uColB, smoothstep(0.2, 0.55, t));
  col = mix(col, uColC, smoothstep(0.6, 0.95, t));

  // Development: surfaces go dark and metallic, laced with lit machinery.
  vec2 ll = vec2(atan(p.z, p.x) / 6.2831853, asin(p.y) / 3.14159265);
  vec2 gq = abs(fract(ll * vec2(48.0, 24.0)) - 0.5);
  float grid = smoothstep(0.46, 0.5, max(gq.x, gq.y));
  float reach = smoothstep(0.0, 0.2, uDev * 1.3 - (fbm3(p * 2.0 + uSeed * 2.0) * 0.5 + 0.5) * 0.3);
  col = mix(col, col * 0.3 + vec3(0.03, 0.03, 0.035), reach * 0.7);

  vec3 N = normalize(vNormalW);
  vec3 L = normalize(uSunPos - vPosW);
  float ndl = dot(N, L);
  float day = smoothstep(-0.1, 0.2, ndl);
  vec3 c = col * max(ndl, 0.0) * uSunI * 1.6 + col * 0.01;
  float dots = step(0.6, snoise(p * 40.0 + uSeed));
  vec3 glow = vec3(1.0, 0.6, 0.22) * (grid * 0.55 + dots * 0.9) * reach;
  c += glow * (0.25 + 0.75 * (1.0 - day));

  vec3 V = normalize(cameraPosition - vPosW);
  float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  c += uAtm * fres * (0.2 + 0.8 * day) * uSunI;
  gl_FragColor = vec4(c, 1.0);
}
`;

export const RING_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vPosW;
varying float vR;
void main(){
  vUv = uv;
  vR = length(position.xy);
  vec4 w = modelMatrix * vec4(position, 1.0);
  vPosW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

export const RING_FRAG = /* glsl */ `
uniform float uInner;
uniform float uOuter;
uniform float uSunI;
uniform float uDev;
uniform float uTime;
varying vec3 vPosW;
varying float vR;
${NOISE}
void main(){
  float r = (vR - uInner) / (uOuter - uInner);
  float band = snoise(vec3(r * 40.0, 0.0, 1.3)) * 0.5 + 0.5;
  float band2 = snoise(vec3(r * 140.0, 2.0, 0.3)) * 0.5 + 0.5;
  float a = smoothstep(0.0, 0.06, r) * smoothstep(1.0, 0.9, r) * (0.35 + 0.65 * band) * (0.6 + 0.4 * band2);
  a *= 1.0 - smoothstep(0.42, 0.47, r) * smoothstep(0.52, 0.47, r) * 0.8; // Cassini division
  // Mined rings: thinning out from the inside, with glints of machinery.
  float mined = smoothstep(r - 0.1, r + 0.1, uDev * 1.1);
  a *= 1.0 - mined * 0.85;
  vec3 col = mix(vec3(0.55, 0.47, 0.35), vec3(0.85, 0.78, 0.62), band) * uSunI * 1.4;
  float angle = atan(vPosW.z, vPosW.x);
  float glint = step(0.93, fract(sin(floor(angle * 300.0 + r * 50.0) * 43758.5) * 1.0 + uTime * 0.2));
  col += vec3(1.5, 0.9, 0.4) * glint * mined * uDev;
  gl_FragColor = vec4(col, a * 0.85);
}
`;

/** Atmosphere halo shell (rendered back faces, additive). */
export const HALO_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uI;
varying vec3 vObj;
varying vec3 vNormalW;
varying vec3 vPosW;
void main(){
  vec3 V = normalize(cameraPosition - vPosW);
  float f = 1.0 - abs(dot(normalize(vNormalW), V));
  float a = pow(f, 2.6) * (1.0 - pow(f, 16.0));
  gl_FragColor = vec4(uColor * a * uI, 1.0);
}
`;

/**
 * Dyson swarm collectors. Each instance has its own orbit; positions are computed on the GPU.
 * Attribute `orbit`: radius, inclination, node, phase. `spd`: angular speed.
 */
export const SWARM_VERT = /* glsl */ `
attribute vec4 orbit;
attribute float spd;
attribute float seed;
uniform float uTime;
uniform float uSize;
uniform float uCollapse;
varying float vLit;
varying float vSeed;
varying float vFacing;
void main(){
  // As the shell fills, loose collectors settle into it.
  float r = mix(orbit.x, 2.5, uCollapse), inc = orbit.y, node = orbit.z;
  float a = orbit.w + uTime * spd;
  vec3 pos = vec3(cos(a) * r, 0.0, sin(a) * r);
  // tilt by inclination about x, then rotate by node about y
  float ci = cos(inc), si = sin(inc);
  pos = vec3(pos.x, -pos.z * si, pos.z * ci);
  float cn = cos(node), sn = sin(node);
  pos = vec3(pos.x * cn + pos.z * sn, pos.y, -pos.x * sn + pos.z * cn);
  vec3 N = normalize(pos);
  vec3 T = normalize(cross(N, abs(N.y) > 0.9 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0)));
  vec3 B = cross(N, T);
  vec3 wp = pos + (T * position.x + B * position.y) * uSize * (1.0 - 0.6 * uCollapse);
  vec3 V = normalize(cameraPosition - wp);
  // Collectors face the Sun. Seen from the Sun's side they blaze; from behind they are dark.
  vFacing = dot(V, -N);
  vLit = smoothstep(-0.2, 0.6, vFacing);
  vSeed = seed;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

export const SWARM_FRAG = /* glsl */ `
uniform float uSunI;
uniform float uTime;
varying float vLit;
varying float vSeed;
varying float vFacing;
void main(){
  vec3 gold = vec3(2.4, 1.6, 0.6);
  vec3 dark = vec3(0.06, 0.05, 0.05);
  float tw = 0.75 + 0.25 * sin(uTime * 3.0 + vSeed * 40.0);
  vec3 col = mix(dark, gold * tw, vLit * uSunI);
  col += vec3(0.5, 0.1, 0.02) * (1.0 - uSunI) * 0.6;
  gl_FragColor = vec4(col, 1.0);
}
`;

/** The shell: triangles appear as the sphere fills. Attribute `cell`: reveal threshold; `bary`: barycentric. */
export const SHELL_VERT = /* glsl */ `
attribute float cell;
attribute vec3 bary;
varying float vCell;
varying vec3 vBary;
varying vec3 vNormalW;
varying vec3 vPosW;
void main(){
  vCell = cell;
  vBary = bary;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vPosW = w.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

export const SHELL_FRAG = /* glsl */ `
uniform float uFill;
uniform float uSunI;
uniform float uTime;
uniform float uIR;
varying float vCell;
varying vec3 vBary;
varying vec3 vNormalW;
varying vec3 vPosW;
void main(){
  if (vCell > uFill) discard;
  float edge = min(min(vBary.x, vBary.y), vBary.z);
  float seam = 1.0 - smoothstep(0.0, 0.035, edge);
  // Newly placed cells flash.
  float fresh = 1.0 - smoothstep(0.0, 0.004, uFill - vCell);
  // A few cells carry lit machinery: a small spot at the cell's center.
  float lamp = step(0.985, fract(vCell * 971.31)) * smoothstep(0.22, 0.3, edge);
  vec3 col;
  if (gl_FrontFacing) {
    // Outer face: black mirror-film backing, radiating waste heat at the seams.
    vec3 V = normalize(cameraPosition - vPosW);
    float mu = max(dot(normalize(vNormalW), V), 0.0);
    col = vec3(0.01, 0.009, 0.011);
    col += vec3(0.35, 0.06, 0.01) * uIR * 0.18;
    col += vec3(1.5, 0.38, 0.05) * seam * (0.1 + uIR * 0.8);
    col += vec3(0.9, 0.22, 0.03) * pow(1.0 - mu, 4.0) * uIR * 0.8;
    col += vec3(1.6, 1.1, 0.5) * lamp * (0.2 + uIR * 0.5) * (0.7 + 0.3 * sin(uTime * 2.0 + vCell * 200.0));
    col += vec3(0.4, 0.3, 0.15) * seam * uSunI * 0.4;
  } else {
    // Inner face, seen through the gaps: blazing with sunlight.
    col = vec3(2.8, 1.9, 0.8) * uSunI * (0.6 + 0.4 * seam);
  }
  col += vec3(3.0, 2.2, 1.2) * fresh;
  gl_FragColor = vec4(col, 1.0);
}
`;

/** Soft round additive points with per-point color and size. */
export const POINTS_VERT = /* glsl */ `
attribute float size;
attribute vec3 color;
varying vec3 vColor;
uniform float uScale;
void main(){
  vColor = color;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * uScale / max(0.001, -mv.z);
  gl_Position = projectionMatrix * mv;
}
`;

export const POINTS_FRAG = /* glsl */ `
varying vec3 vColor;
void main(){
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c) * 2.0;
  float a = smoothstep(1.0, 0.0, d);
  a *= a;
  gl_FragColor = vec4(vColor * a, 1.0);
}
`;

/** Background stars: fixed pixel size, no attenuation. */
export const STARS_VERT = /* glsl */ `
attribute float size;
attribute vec3 color;
varying vec3 vColor;
uniform float uPixelRatio;
void main(){
  vColor = color;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * uPixelRatio;
  gl_Position = projectionMatrix * mv;
}
`;

export const STARS_FRAG = /* glsl */ `
varying vec3 vColor;
uniform float uI;
void main(){
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c) * 2.0;
  float a = smoothstep(1.0, 0.2, d);
  gl_FragColor = vec4(vColor * a * uI, 1.0);
}
`;
