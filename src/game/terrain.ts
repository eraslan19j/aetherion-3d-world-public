import * as THREE from "three";
import { fbm, ridged, vnoise, smoothstep, lerp, clamp, hash2 } from "./noise";

export const HALF = 360;
export const CHUNK = 90;
export const NCH = 8;
export const SEG = 36;
export const WORLD_R = 342;

export interface Region {
  id: number;
  name: string;
  sub: string;
  cx: number;
  cz: number;
  r: number;
  color: string;
}

export const REGIONS: Region[] = [
  { id: 0, name: "Gümüş Koru", sub: "Fısıldayan ağaçların diyarı", cx: 0, cz: 175, r: 150, color: "#8fe8b0" },
  { id: 1, name: "Eterya Kalıntıları", sub: "Unutulmuş şehir", cx: 0, cz: 0, r: 100, color: "#ffe9a8" },
  { id: 2, name: "Kızıl Kanyon", sub: "Küllerin mesaları", cx: 215, cz: -5, r: 130, color: "#ff9a5c" },
  { id: 3, name: "Kristal Vadisi", sub: "Şarkı söyleyen taşlar", cx: -215, cz: -5, r: 130, color: "#c59bff" },
  { id: 4, name: "Donmuş Zirveler", sub: "Rüzgârın tahtı", cx: 0, cz: -215, r: 135, color: "#bfe6ff" },
];

export interface Site {
  x: number;
  z: number;
}
export const SITES = {
  spawn: { x: 0, z: 150 },
  forestObelisk: { x: 78, z: 252 },
  bigTree: { x: -38, z: 268 },
  shrineForest: { x: 22, z: 128 },
  cave: { x: 138, z: 205 },
  city: { x: 0, z: 0 },
  gate: { x: 0, z: -56 },
  shrineCity: { x: 0, z: 52 },
  canyonObelisk: { x: 245, z: -62 },
  shrineCanyon: { x: 172, z: 14 },
  colossus: { x: 205, z: -125 },
  arch: { x: 285, z: 10 },
  crystalObelisk: { x: -245, z: -72 },
  shrineCrystal: { x: -172, z: 14 },
  snowObelisk: { x: -12, z: -255 },
  shrineSnow: { x: 34, z: -172 },
  iceTemple: { x: 72, z: -268 },
  portalA: { x: -118, z: 98 },
  islandCenter: { x: -118, z: 98 },
};

export const CAMPS: { x: number; z: number; region: number }[] = [
  { x: 62, z: 208, region: 0 },
  { x: -62, z: 150, region: 0 },
  { x: 24, z: 300, region: 0 },
  { x: 100, z: 150, region: 0 },
  { x: 34, z: -34, region: 1 },
  { x: -38, z: 22, region: 1 },
  { x: 190, z: -45, region: 2 },
  { x: 205, z: 45, region: 2 },
  { x: -190, z: -60, region: 3 },
  { x: -245, z: 25, region: 3 },
  { x: -205, z: -115, region: 3 },
  { x: 22, z: -200, region: 4 },
  { x: -55, z: -235, region: 4 },
  { x: 52, z: -215, region: 4 },
];

export interface Pool {
  x: number;
  z: number;
  r: number;
  level: number;
  depth: number;
  type: "water" | "lava";
  glow?: boolean;
}

// ---------- height ----------
const w5 = new Float32Array(5);

export function weights(x: number, z: number, out: Float32Array = w5) {
  let sum = 0;
  for (let i = 0; i < 5; i++) {
    const R = REGIONS[i];
    const dx = x - R.cx;
    const dz = z - R.cz;
    const d = Math.sqrt(dx * dx + dz * dz) / R.r;
    const v = Math.exp(-d * d * (i === 1 ? 2.4 : 1.7));
    out[i] = v;
    sum += v;
  }
  if (sum < 1e-5) {
    out.fill(0);
    out[0] = 1;
    return out;
  }
  for (let i = 0; i < 5; i++) out[i] /= sum;
  return out;
}

export function regionAt(x: number, z: number): number {
  weights(x, z);
  let b = 0;
  for (let i = 1; i < 5; i++) if (w5[i] > w5[b]) b = i;
  return b;
}

function baseHeight(x: number, z: number): number {
  const wx = x + (fbm(x * 0.004 + 10, z * 0.004, 2) - 0.5) * 70;
  const wz = z + (fbm(x * 0.004, z * 0.004 + 20, 2) - 0.5) * 70;
  const w = weights(wx, wz);
  const n1 = fbm(x * 0.011, z * 0.011, 4);
  const n2 = fbm(x * 0.035 + 5, z * 0.035, 3);
  const hF = 6 + n1 * 15 + n2 * 2.5;
  const hC = 12 + n2 * 1.1;
  const m = fbm(x * 0.007 + 3, z * 0.007 + 9, 3);
  const t = clamp((m - 0.3) * 2.6, 0, 1) * 3;
  const f = Math.floor(t);
  const fr = t - f;
  const stair = (f + smoothstep(0.55, 1.0, fr)) / 3;
  const hK = 5 + stair * 26 + n2 * 2.2;
  const rid = ridged(x * 0.0075 + 7, z * 0.0075 + 3, 4);
  const hX = 8 + rid * 24 + n2 * 3;
  const rs = ridged(x * 0.0065 + 1, z * 0.0065 + 11, 5);
  const hS = 26 + rs * 70 + n1 * 14;
  let h = w[0] * hF + w[1] * hC + w[2] * hK + w[3] * hX + w[4] * hS;
  const r = Math.sqrt(x * x + z * z);
  const rim = smoothstep(262, 345, r);
  h += rim * (60 + ridged(x * 0.012 + 4, z * 0.012, 4) * 110);
  return h;
}

export const pools: Pool[] = [];
export interface Zone {
  x: number;
  z: number;
  r0: number;
  r1: number;
  h: number;
}
export const zones: Zone[] = [];

function addZone(s: Site, r0: number, r1: number, h?: number): number {
  const hh = h ?? baseHeight(s.x, s.z);
  zones.push({ x: s.x, z: s.z, r0, r1, h: hh });
  return hh;
}

export const siteH: Record<string, number> = {};
function initLayout() {
  const S = SITES;
  const zs: [string, number, number, number?][] = [
    ["spawn", 12, 30],
    ["forestObelisk", 24, 46],
    ["bigTree", 14, 34],
    ["shrineForest", 6, 16],
    ["cave", 20, 40],
    ["shrineCity", 6, 14],
    ["canyonObelisk", 28, 52],
    ["shrineCanyon", 6, 16],
    ["colossus", 20, 40],
    ["arch", 18, 36],
    ["crystalObelisk", 28, 52],
    ["shrineCrystal", 6, 16],
    ["snowObelisk", 26, 50],
    ["shrineSnow", 6, 16],
    ["iceTemple", 22, 44],
    ["portalA", 9, 20],
  ];
  for (const [k, r0, r1] of zs) siteH[k] = addZone((S as any)[k], r0, r1);
  CAMPS.forEach((c, i) => {
    if (c.region !== 1) siteH['camp' + i] = addZone(c, 7, 15);
  });
  // city plateau
  siteH.city = 12.5;
  zones.push({ x: 0, z: 0, r0: 66, r1: 96, h: 12.5 });
  siteH.gate = 12.5;
  // pools
  const lakeL = 3.0;
  pools.push({ x: -105, z: 205, r: 42, level: lakeL, depth: 7, type: "water" });
  const cp = { x: -255, z: 62 };
  const cl = baseHeight(cp.x, cp.z) - 1.5;
  pools.push({ x: cp.x, z: cp.z, r: 20, level: cl, depth: 5, type: "water", glow: true });
  const lp = { x: 255, z: 78 };
  const ll = baseHeight(lp.x, lp.z) - 2;
  pools.push({ x: lp.x, z: lp.z, r: 26, level: ll, depth: 5, type: "lava" });
}
initLayout();

export function terrainHeight(x: number, z: number): number {
  let h = baseHeight(x, z);
  for (let i = 0; i < zones.length; i++) {
    const zn = zones[i];
    const dx = x - zn.x;
    const dz = z - zn.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > zn.r1 * zn.r1) continue;
    const d = Math.sqrt(d2);
    const m = 1 - smoothstep(zn.r0, zn.r1, d);
    h = lerp(h, zn.h, m);
  }
  for (let i = 0; i < pools.length; i++) {
    const p = pools[i];
    const dx = x - p.x;
    const dz = z - p.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > p.r * p.r * 3.6) continue;
    const d = Math.sqrt(d2);
    if (d < p.r * 1.9) {
      const f = 1 - smoothstep(p.r * 1.4, p.r * 1.9, d);
      h += Math.max(0, p.level + 0.7 - h) * f;
    }
    const m = smoothstep(p.r * 1.25, p.r * 0.5, d);
    // wobbly shore
    const bottom = p.level - p.depth * (0.4 + 0.6 * smoothstep(p.r * 1.0, 0, d));
    h = lerp(h, bottom, m);
  }
  return h;
}

export function waterLevelAt(x: number, z: number, type: "water" | "lava" = "water"): number {
  for (let i = 0; i < pools.length; i++) {
    const p = pools[i];
    if (p.type !== type) continue;
    const dx = x - p.x;
    const dz = z - p.z;
    if (dx * dx + dz * dz < p.r * p.r * 2.5) {
      if (hAt(x, z) < p.level) return p.level;
    }
  }
  return -1e9;
}

const _n = new THREE.Vector3();
export function terrainNormal(x: number, z: number, out: THREE.Vector3 = _n): THREE.Vector3 {
  const e = 0.9;
  const hl = terrainHeight(x - e, z);
  const hr = terrainHeight(x + e, z);
  const hd = terrainHeight(x, z - e);
  const hu = terrainHeight(x, z + e);
  return out.set(hl - hr, 2 * e, hd - hu).normalize();
}

// ---------- cached height grid (matches terrain mesh triangulation) ----------
export const GN = NCH * SEG + 1;
export const GS = CHUNK / SEG;
export const grid = new Float32Array(GN * GN);
let gridReady = false;
export function fillGridRows(j0: number, j1: number) {
  for (let j = j0; j < Math.min(j1, GN); j++)
    for (let i = 0; i < GN; i++) grid[j * GN + i] = terrainHeight(-HALF + i * GS, -HALF + j * GS);
}
export function markGridReady() {
  gridReady = true;
}
export function groundH(x: number, z: number): number {
  let fx = (x + HALF) / GS;
  let fz = (z + HALF) / GS;
  if (fx < 0) fx = 0;
  else if (fx > GN - 1.001) fx = GN - 1.001;
  if (fz < 0) fz = 0;
  else if (fz > GN - 1.001) fz = GN - 1.001;
  const i = fx | 0;
  const j = fz | 0;
  const u = fx - i;
  const v = fz - j;
  const k = j * GN + i;
  const a = grid[k];
  const b = grid[k + 1];
  const c = grid[k + GN];
  const d = grid[k + GN + 1];
  return u + v <= 1 ? a + (b - a) * u + (c - a) * v : d + (c - d) * (1 - u) + (b - d) * (1 - v);
}
export function groundN(x: number, z: number, out: THREE.Vector3 = _n): THREE.Vector3 {
  const e = 1.2;
  return out.set(groundH(x - e, z) - groundH(x + e, z), 2 * e, groundH(x, z - e) - groundH(x, z + e)).normalize();
}
const hAt = (x: number, z: number) => (gridReady ? groundH(x, z) : terrainHeight(x, z));

// ---------- colors ----------
const col = (s: string) => {
  const c = new THREE.Color(s);
  return [c.r, c.g, c.b] as [number, number, number];
};
const K = {
  grassA: col("#5a9a3e"),
  grassB: col("#2f6b3c"),
  grassC: col("#7aa845"),
  forestRock: col("#6f6b66"),
  dirt: col("#6b5a3e"),
  city: col("#a39d8c"),
  cityMoss: col("#5f7d4a"),
  can1: col("#b8472a"),
  can2: col("#d57d3a"),
  can3: col("#8a3828"),
  can4: col("#e3a65c"),
  canRock: col("#7d3a2b"),
  cry1: col("#2e2656"),
  cry2: col("#3e338a"),
  cry3: col("#1b6b7e"),
  cry4: col("#7a2f93"),
  cryRock: col("#3a2d5e"),
  snow: col("#f0f5fb"),
  ice: col("#b4d3ea"),
  snowRock: col("#505a66"),
  sand: col("#c9b384"),
  mud: col("#4a3d2c"),
};

function mix3(a: number[], b: number[], t: number, o: number[]) {
  o[0] = a[0] + (b[0] - a[0]) * t;
  o[1] = a[1] + (b[1] - a[1]) * t;
  o[2] = a[2] + (b[2] - a[2]) * t;
}

const _c = [0, 0, 0];
const wcol = new Float32Array(5);

export function terrainColor(x: number, z: number, h: number, slope: number, out: number[]) {
  weights(x, z, wcol);
  const n = fbm(x * 0.045, z * 0.045, 3);
  const n2 = vnoise(x * 0.35, z * 0.35);
  const n3 = fbm(x * 0.012 + 40, z * 0.012, 2);
  let r = 0,
    g = 0,
    b = 0;
  // forest
  mix3(K.grassA, K.grassB, n, _c);
  mix3(_c, K.grassC, smoothstep(0.55, 0.8, n3) * 0.7, _c);
  const dk = 0.88 + n2 * 0.2;
  r += wcol[0] * _c[0] * dk;
  g += wcol[0] * _c[1] * dk;
  b += wcol[0] * _c[2] * dk;
  // city
  mix3(K.city, K.cityMoss, smoothstep(0.4, 0.7, n) * 0.8, _c);
  r += wcol[1] * _c[0] * dk;
  g += wcol[1] * _c[1] * dk;
  b += wcol[1] * _c[2] * dk;
  // canyon
  const band = Math.sin(h * 0.55 + n * 4) * 0.5 + 0.5;
  mix3(K.can1, K.can2, band, _c);
  mix3(_c, K.can3, smoothstep(0.5, 0.9, Math.sin(h * 1.3 + n3 * 6) * 0.5 + 0.5) * 0.5, _c);
  mix3(_c, K.can4, smoothstep(0.55, 0.8, n3) * (1 - slope) * 0.8, _c);
  r += wcol[2] * _c[0] * dk;
  g += wcol[2] * _c[1] * dk;
  b += wcol[2] * _c[2] * dk;
  // crystal
  mix3(K.cry1, K.cry2, n, _c);
  mix3(_c, K.cry3, smoothstep(0.5, 0.75, n3) * 0.9, _c);
  mix3(_c, K.cry4, smoothstep(0.62, 0.85, n2 * 0.5 + n * 0.6) * 0.6, _c);
  r += wcol[3] * _c[0] * dk;
  g += wcol[3] * _c[1] * dk;
  b += wcol[3] * _c[2] * dk;
  // snow
  mix3(K.snow, K.ice, smoothstep(0.35, 0.7, n) * 0.6, _c);
  r += wcol[4] * _c[0] * (0.95 + n2 * 0.08);
  g += wcol[4] * _c[1] * (0.95 + n2 * 0.08);
  b += wcol[4] * _c[2] * (0.95 + n2 * 0.08);
  // rock on slopes
  const rock = smoothstep(0.5, 0.95, slope);
  if (rock > 0) {
    const rr = wcol[0] * K.forestRock[0] + wcol[1] * K.city[0] * 0.7 + wcol[2] * K.canRock[0] + wcol[3] * K.cryRock[0] + wcol[4] * K.snowRock[0];
    const rg = wcol[0] * K.forestRock[1] + wcol[1] * K.city[1] * 0.7 + wcol[2] * K.canRock[1] + wcol[3] * K.cryRock[1] + wcol[4] * K.snowRock[1];
    const rb = wcol[0] * K.forestRock[2] + wcol[1] * K.city[2] * 0.7 + wcol[2] * K.canRock[2] + wcol[3] * K.cryRock[2] + wcol[4] * K.snowRock[2];
    const v = 0.8 + n2 * 0.35;
    r = lerp(r, rr * v, rock);
    g = lerp(g, rg * v, rock);
    b = lerp(b, rb * v, rock);
  }
  // high altitude snow cap
  const snowCap = smoothstep(58, 80, h + n * 12) * (1 - smoothstep(0.7, 1.1, slope));
  if (snowCap > 0 && wcol[2] < 0.5) {
    r = lerp(r, K.snow[0], snowCap);
    g = lerp(g, K.snow[1], snowCap);
    b = lerp(b, K.snow[2], snowCap);
  }
  // shores
  for (let i = 0; i < pools.length; i++) {
    const p = pools[i];
    const dx = x - p.x;
    const dz = z - p.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d < p.r * 1.7) {
      if (p.type === "water") {
        const s = 1 - smoothstep(p.level + 0.2, p.level + 1.6, h);
        const mud = smoothstep(p.level + 0.3, p.level - 2, h);
        const sand = i === 0 ? K.sand : K.cry3;
        r = lerp(r, sand[0], s * 0.8);
        g = lerp(g, sand[1], s * 0.8);
        b = lerp(b, sand[2], s * 0.8);
        r = lerp(r, K.mud[0], mud * 0.7);
        g = lerp(g, K.mud[1], mud * 0.7);
        b = lerp(b, K.mud[2], mud * 0.7);
      } else {
        const s = 1 - smoothstep(p.level, p.level + 3, h);
        r = lerp(r, 0.03, s);
        g = lerp(g, 0.02, s);
        b = lerp(b, 0.02, s);
      }
    }
  }
  // zones: worn paths / pads (lighter stone-ish dirt)
  out[0] = r;
  out[1] = g;
  out[2] = b;
}

// surface type for footsteps: 0 grass 1 stone 2 snow 3 sand 4 water
export function surfaceAt(x: number, z: number, h: number): number {
  weights(x, z, wcol);
  if (waterLevelAt(x, z) > h + 0.1) return 4;
  const maxI = wcol.indexOf(Math.max(...wcol));
  if (h > 60 && maxI !== 2) return 2;
  switch (maxI) {
    case 0:
      return 0;
    case 1:
      return 1;
    case 2:
      return 3;
    case 3:
      return 1;
    default:
      return 2;
  }
}

// ---------- textures ----------
function tileNoise(x: number, y: number, p: number) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const w = (n: number) => ((n % p) + p) % p;
  const a = hash2(w(xi), w(yi));
  const b = hash2(w(xi + 1), w(yi));
  const c = hash2(w(xi), w(yi + 1));
  const d = hash2(w(xi + 1), w(yi + 1));
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export function makeDetailTextures(size = 256) {
  const hgt = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = 0;
      let a = 0.5;
      let f = 4;
      for (let o = 0; o < 5; o++) {
        v += a * tileNoise((x / size) * f, (y / size) * f, f);
        a *= 0.55;
        f *= 2;
      }
      hgt[y * size + x] = v / 0.95;
    }
  }
  const albedo = new Uint8Array(size * size * 4);
  const normal = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const v = hgt[i];
      const g = clamp(0.62 + v * 0.55, 0, 1);
      albedo[i * 4] = g * 255;
      albedo[i * 4 + 1] = g * 255;
      albedo[i * 4 + 2] = g * 255;
      albedo[i * 4 + 3] = 255;
      const l = hgt[y * size + ((x - 1 + size) % size)];
      const r = hgt[y * size + ((x + 1) % size)];
      const u = hgt[((y - 1 + size) % size) * size + x];
      const d = hgt[((y + 1) % size) * size + x];
      const nx = (l - r) * 3.2;
      const ny = (u - d) * 3.2;
      const len = Math.sqrt(nx * nx + ny * ny + 1);
      normal[i * 4] = (nx / len * 0.5 + 0.5) * 255;
      normal[i * 4 + 1] = (ny / len * 0.5 + 0.5) * 255;
      normal[i * 4 + 2] = (1 / len * 0.5 + 0.5) * 255;
      normal[i * 4 + 3] = 255;
    }
  }
  const mk = (data: Uint8Array, srgb: boolean) => {
    const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = 4;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  };
  return { albedo: mk(albedo, true), normal: mk(normal, false) };
}

// ---------- chunk mesh ----------
export function buildChunkGeometry(cx: number, cz: number, seg = SEG): THREE.BufferGeometry {
  const n = seg + 1;
  const pos = new Float32Array(n * n * 3);
  const nor = new Float32Array(n * n * 3);
  const colr = new Float32Array(n * n * 3);
  const uv = new Float32Array(n * n * 2);
  const idx: number[] = [];
  const c = [0, 0, 0];
  const G = (i: number, j: number) => grid[Math.min(GN - 1, Math.max(0, j)) * GN + Math.min(GN - 1, Math.max(0, i))];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const gi = cx * SEG + i;
      const gj = cz * SEG + j;
      const x = -HALF + gi * GS;
      const z = -HALF + gj * GS;
      const h = G(gi, gj);
      let nx = G(gi - 1, gj) - G(gi + 1, gj);
      let nz = G(gi, gj - 1) - G(gi, gj + 1);
      let ny = 2 * GS;
      const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
      nx /= l;
      ny /= l;
      nz /= l;
      const k = j * n + i;
      pos[k * 3] = x;
      pos[k * 3 + 1] = h;
      pos[k * 3 + 2] = z;
      nor[k * 3] = nx;
      nor[k * 3 + 1] = ny;
      nor[k * 3 + 2] = nz;
      const slope = Math.sqrt(1 - ny * ny) / Math.max(0.0001, ny);
      terrainColor(x, z, h, clamp(slope, 0, 2), c);
      colr[k * 3] = c[0];
      colr[k * 3 + 1] = c[1];
      colr[k * 3 + 2] = c[2];
      uv[k * 2] = x / 7;
      uv[k * 2 + 1] = z / 7;
    }
  }
  for (let j = 0; j < seg; j++) {
    for (let i = 0; i < seg; i++) {
      const a = j * n + i;
      const b = a + 1;
      const cc = a + n;
      const d = cc + 1;
      idx.push(a, cc, b, b, cc, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  g.setAttribute("color", new THREE.BufferAttribute(colr, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

export function makeTerrainMaterial(albedo: THREE.Texture, normal: THREE.Texture) {
  const m = new THREE.MeshStandardMaterial({
    vertexColors: true,
    map: albedo,
    normalMap: normal,
    normalScale: new THREE.Vector2(0.9, 0.9),
    roughness: 0.93,
    metalness: 0,
  });
  m.onBeforeCompile = (s) => {
    s.fragmentShader = s.fragmentShader.replace(
      "#include <map_fragment>",
      `#include <map_fragment>
       diffuseColor.rgb *= 0.55 + 0.9 * texture2D(map, vMapUv * 0.131 + vec2(0.37, 0.11)).r;`
    );
  };
  return m;
}

// minimap image
export function renderMapCanvas(size = 220): HTMLCanvasElement {
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  const ctx = cv.getContext("2d")!;
  const img = ctx.createImageData(size, size);
  const c = [0, 0, 0];
  const hs = new Float32Array(size * size);
  for (let j = 0; j < size; j++)
    for (let i = 0; i < size; i++) hs[j * size + i] = hAt(-HALF + (i / size) * 2 * HALF, -HALF + (j / size) * 2 * HALF);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const x = -HALF + (i / size) * 2 * HALF;
      const z = -HALF + (j / size) * 2 * HALF;
      const h = hs[j * size + i];
      const hx = hs[j * size + Math.min(size - 1, i + 1)] - hs[j * size + Math.max(0, i - 1)];
      const hz = hs[Math.min(size - 1, j + 1) * size + i] - hs[Math.max(0, j - 1) * size + i];
      terrainColor(x, z, h, clamp(Math.hypot(hx, hz) / 6, 0, 2), c);
      const shade = clamp(0.8 + (-hx * 0.5 - hz * 0.35) * 0.06, 0.45, 1.3);
      let r = c[0],
        g = c[1],
        b = c[2];
      const wl = waterLevelAt(x, z);
      if (wl > h) {
        r = 0.04;
        g = 0.25;
        b = 0.4;
      }
      const wlv = waterLevelAt(x, z, "lava");
      if (wlv > h) {
        r = 1;
        g = 0.3;
        b = 0.05;
      }
      const f = (v: number) => Math.pow(clamp(v * shade, 0, 1), 1 / 2.2) * 255;
      const k = (j * size + i) * 4;
      img.data[k] = f(r);
      img.data[k + 1] = f(g);
      img.data[k + 2] = f(b);
      img.data[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}
