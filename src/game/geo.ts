import * as THREE from "three";
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { vnoise, mulberry32, hash2 } from "./noise";
import { mats } from "./materials";
import type { LightSource } from "./fx";

export interface Collider {
  kind: 0 | 1; // 0 cylinder, 1 box
  x: number;
  z: number;
  r: number;
  hw: number;
  hd: number;
  c: number;
  s: number;
  y0: number;
  y1: number;
  enabled: boolean;
  tag?: string;
}

export class ColliderGrid {
  cell = 16;
  map = new Map<number, Collider[]>();
  all: Collider[] = [];
  private key(i: number, j: number) {
    return (i + 200) * 1000 + (j + 200);
  }
  add(c: Collider) {
    this.all.push(c);
    const rad = (c.kind === 0 ? c.r : Math.hypot(c.hw, c.hd)) + 1.5;
    const i0 = Math.floor((c.x - rad) / this.cell);
    const i1 = Math.floor((c.x + rad) / this.cell);
    const j0 = Math.floor((c.z - rad) / this.cell);
    const j1 = Math.floor((c.z + rad) / this.cell);
    for (let i = i0; i <= i1; i++)
      for (let j = j0; j <= j1; j++) {
        const k = this.key(i, j);
        let a = this.map.get(k);
        if (!a) this.map.set(k, (a = []));
        a.push(c);
      }
  }
  get(x: number, z: number): Collider[] | undefined {
    return this.map.get(this.key(Math.floor(x / this.cell), Math.floor(z / this.cell)));
  }
}

// ---------- geometry helpers ----------
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);

export function prep(g: THREE.BufferGeometry): THREE.BufferGeometry {
  let r = g;
  if (r.index) r = r.toNonIndexed();
  r.deleteAttribute("uv");
  return r;
}

export function paint(g: THREE.BufferGeometry, color: THREE.ColorRepresentation | THREE.Color, jitter = 0.08, ao = 0, baseY = 0) {
  const c = new THREE.Color(color as any);
  const pos = g.attributes.position;
  const arr = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    let k = 1 + (hash2(Math.floor(x * 3.1), Math.floor(z * 3.1 + y * 2.3)) - 0.5) * jitter * 2;
    if (ao) k *= 1 - ao + ao * Math.min(1, Math.max(0, (y - baseY) / 4));
    arr[i * 3] = c.r * k;
    arr[i * 3 + 1] = c.g * k;
    arr[i * 3 + 2] = c.b * k;
  }
  g.setAttribute("color", new THREE.BufferAttribute(arr, 3));
  return g;
}

export function gradientY(g: THREE.BufferGeometry, y0: number, y1: number, c0: THREE.ColorRepresentation, c1: THREE.ColorRepresentation) {
  const a = new THREE.Color(c0 as any);
  const b = new THREE.Color(c1 as any);
  const pos = g.attributes.position;
  const arr = new Float32Array(pos.count * 3);
  const t = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const k = Math.min(1, Math.max(0, (pos.getY(i) - y0) / (y1 - y0)));
    t.copy(a).lerp(b, k);
    arr[i * 3] = t.r;
    arr[i * 3 + 1] = t.g;
    arr[i * 3 + 2] = t.b;
  }
  g.setAttribute("color", new THREE.BufferAttribute(arr, 3));
  return g;
}

export function displace(g: THREE.BufferGeometry, amp: number, freq: number, seed = 0) {
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const len = v.length() || 1;
    const n = vnoise(v.x * freq + seed + v.z * freq * 0.37, v.y * freq + seed * 0.7 - v.z * freq * 0.61) * 2 - 1;
    const n2 = vnoise(v.x * freq * 2.3 + 11 + seed, v.z * freq * 2.3 + v.y * freq * 1.7) * 2 - 1;
    const f = 1 + (n * amp + n2 * amp * 0.4);
    v.multiplyScalar(f);
    void len;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

export function smoothRock(radius: number, detail = 1, amp = 0.28, seed = 0): THREE.BufferGeometry {
  let g: THREE.BufferGeometry = new THREE.IcosahedronGeometry(radius, detail);
  g.deleteAttribute("uv");
  g.deleteAttribute("normal");
  g = mergeVertices(g, 1e-3);
  displace(g, amp, 0.9 / radius, seed);
  return g;
}

function xf(g: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  _e.set(rx, ry, rz);
  _q.setFromEuler(_e);
  _p.set(x, y, z);
  _s.set(sx, sy, sz);
  _m.compose(_p, _q, _s);
  g.applyMatrix4(_m);
  return g;
}

// ---------- Builder: accumulates merged geometry per material ----------
export class Builder {
  parts: Record<string, THREE.BufferGeometry[]> = {};
  colliders: Collider[] = [];
  lights: LightSource[] = [];
  ox = 0;
  oy = 0;
  oz = 0;
  ry = 0;
  private fm = new THREE.Matrix4();
  frame(x: number, y: number, z: number, ry = 0) {
    this.ox = x;
    this.oy = y;
    this.oz = z;
    this.ry = ry;
    this.fm.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry), new THREE.Vector3(1, 1, 1));
    return this;
  }
  toWorld(lx: number, lz: number): [number, number] {
    const c = Math.cos(this.ry);
    const s = Math.sin(this.ry);
    return [this.ox + lx * c + lz * s, this.oz - lx * s + lz * c];
  }
  add(mat: string, g: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    xf(g, x, y, z, rx, ry, rz, sx, sy, sz);
    g.applyMatrix4(this.fm);
    (this.parts[mat] ||= []).push(g);
    return g;
  }
  box(mat: string, w: number, h: number, d: number, x: number, y: number, z: number, color: THREE.ColorRepresentation, ry = 0, rx = 0, rz = 0, jit = 0.08) {
    const g = prep(new THREE.BoxGeometry(w, h, d));
    paint(g, color, jit, 0.3, -h / 2);
    return this.add(mat, g, x, y, z, rx, ry, rz);
  }
  cyl(mat: string, rt: number, rb: number, h: number, x: number, y: number, z: number, color: THREE.ColorRepresentation, seg = 10, ry = 0, rx = 0, rz = 0, open = false) {
    const g = prep(new THREE.CylinderGeometry(rt, rb, h, seg, 1, open));
    paint(g, color, 0.07, 0.25, -h / 2);
    return this.add(mat, g, x, y, z, rx, ry, rz);
  }
  cone(mat: string, r: number, h: number, x: number, y: number, z: number, color: THREE.ColorRepresentation, seg = 8, rx = 0, rz = 0) {
    const g = prep(new THREE.ConeGeometry(r, h, seg));
    paint(g, color, 0.07);
    return this.add(mat, g, x, y, z, rx, 0, rz);
  }
  sphere(mat: string, r: number, x: number, y: number, z: number, color: THREE.ColorRepresentation, sx = 1, sy = 1, sz = 1, seg = 12) {
    const g = prep(new THREE.SphereGeometry(r, seg, Math.max(6, seg - 4)));
    paint(g, color, 0.06);
    return this.add(mat, g, x, y, z, 0, 0, 0, sx, sy, sz);
  }
  torus(mat: string, R: number, r: number, x: number, y: number, z: number, color: THREE.ColorRepresentation, rx = 0, ry = 0, rz = 0, seg = 24, arc = Math.PI * 2) {
    const g = prep(new THREE.TorusGeometry(R, r, 8, seg, arc));
    paint(g, color, 0.04);
    return this.add(mat, g, x, y, z, rx, ry, rz);
  }
  octa(mat: string, r: number, x: number, y: number, z: number, color: THREE.ColorRepresentation, sy = 1.6, detail = 0) {
    const g = prep(new THREE.OctahedronGeometry(r, detail));
    paint(g, color, 0.02);
    return this.add(mat, g, x, y, z, 0, 0, 0, 1, sy, 1);
  }
  rock(mat: string, r: number, x: number, y: number, z: number, color: THREE.ColorRepresentation, sy = 0.8, seed = 0, detail = 1, ry = 0) {
    const g = prep(smoothRock(r, detail, 0.3, seed));
    paint(g, color, 0.1, 0.35, -r);
    return this.add(mat, g, x, y, z, 0, ry, 0, 1, sy, 1);
  }
  // colliders (local -> world)
  cCyl(lx: number, lz: number, r: number, y0: number, y1: number, tag?: string) {
    const [x, z] = this.toWorld(lx, lz);
    const c: Collider = { kind: 0, x, z, r, hw: 0, hd: 0, c: 1, s: 0, y0: this.oy + y0, y1: this.oy + y1, enabled: true, tag };
    this.colliders.push(c);
    return c;
  }
  cBox(lx: number, lz: number, w: number, d: number, y0: number, y1: number, ryL = 0, tag?: string) {
    const [x, z] = this.toWorld(lx, lz);
    const a = this.ry + ryL;
    const c: Collider = { kind: 1, x, z, r: 0, hw: w / 2, hd: d / 2, c: Math.cos(a), s: Math.sin(a), y0: this.oy + y0, y1: this.oy + y1, enabled: true, tag };
    this.colliders.push(c);
    return c;
  }
  light(lx: number, ly: number, lz: number, color: THREE.ColorRepresentation, intensity: number, range: number, flicker = 0) {
    const [x, z] = this.toWorld(lx, lz);
    const l: LightSource = { x, y: this.oy + ly, z, color: new THREE.Color(color as any), intensity, range, flicker, seed: Math.random() * 100 };
    this.lights.push(l);
    return l;
  }
  build(castShadow = true): THREE.Group {
    const grp = new THREE.Group();
    for (const key of Object.keys(this.parts)) {
      const list = this.parts[key];
      if (!list.length) continue;
      const merged = mergeGeometries(list, false);
      if (!merged) continue;
      merged.computeBoundingSphere();
      const m = new THREE.Mesh(merged, (mats as any)[key] as THREE.Material);
      m.castShadow = castShadow && key !== "glow" && key !== "glowSoft" && key !== "glowBright" && key !== "ice";
      m.receiveShadow = true;
      grp.add(m);
      list.forEach((g) => g.dispose());
    }
    this.parts = {};
    return grp;
  }
}

// ---------- instanced vegetation geometry ----------
function merge(list: THREE.BufferGeometry[]) {
  const g = mergeGeometries(list, false)!;
  g.computeBoundingSphere();
  return g;
}

function blob(r: number, x: number, y: number, z: number, color: THREE.ColorRepresentation, seed: number, sy = 0.8) {
  const g = prep(smoothRock(r, 1, 0.22, seed));
  // two-tone: lighter on top
  const pos = g.attributes.position;
  const a = new THREE.Color(color as any);
  const arr = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const k = 0.72 + 0.4 * ((pos.getY(i) / r + 1) * 0.5) + (hash2(pos.getX(i) * 5, pos.getZ(i) * 5) - 0.5) * 0.15;
    arr[i * 3] = a.r * k;
    arr[i * 3 + 1] = a.g * k;
    arr[i * 3 + 2] = a.b * k;
  }
  g.setAttribute("color", new THREE.BufferAttribute(arr, 3));
  return xf(g, x, y, z, 0, 0, 0, 1, sy, 1);
}

export function pineGeo(lod: boolean, tint: string, trunk = "#5b4130") {
  const l: THREE.BufferGeometry[] = [];
  l.push(paint(prep(new THREE.CylinderGeometry(0.16, 0.34, 2.6, lod ? 5 : 7)), trunk, 0.1, 0.4, -1.3));
  xf(l[0], 0, 1.3, 0);
  const n = lod ? 3 : 6;
  for (let k = 0; k < n; k++) {
    const t = k / (n - 1);
    const r = (lod ? 2.1 : 1.9) * (1 - t * 0.78) + 0.35;
    const h = lod ? 3.2 : 2.3;
    const g = prep(new THREE.ConeGeometry(r, h, lod ? 7 : 11, 1, false));
    paint(g, new THREE.Color(tint).multiplyScalar(0.7 + t * 0.4), 0.1, 0.0);
    xf(g, 0, 1.8 + t * (lod ? 5 : 5.8), 0, 0, k * 0.7, 0);
    l.push(g);
  }
  return merge(l);
}

export function silverTreeGeo(lod: boolean, leaf: string, trunk = "#d9d3c4") {
  const l: THREE.BufferGeometry[] = [];
  const t = prep(new THREE.CylinderGeometry(0.13, 0.28, 4.8, lod ? 5 : 8, 4));
  // bend trunk
  const p = t.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i) / 4.8 + 0.5;
    p.setX(i, p.getX(i) + Math.sin(y * 2.5) * 0.35 * y);
  }
  t.computeVertexNormals();
  paint(t, trunk, 0.18, 0.4, -2.4);
  xf(t, 0, 2.4, 0);
  l.push(t);
  const bl = lod ? 3 : 5;
  for (let i = 0; i < bl; i++) {
    const a = (i / bl) * Math.PI * 2 + 0.5;
    const r = 1.5 + (i % 2) * 0.5;
    l.push(blob(r, Math.cos(a) * 1.4 + 0.5, 5.0 + (i % 3) * 0.6, Math.sin(a) * 1.4, new THREE.Color(leaf).offsetHSL((i % 3) * 0.015, 0, 0.0), i * 3.1, 0.75));
  }
  l.push(blob(2.1, 0.5, 6.4, 0, leaf, 9, 0.7));
  return merge(l);
}

export function oakGeo(lod: boolean, leaf: string, trunk = "#4d3a2a") {
  const l: THREE.BufferGeometry[] = [];
  const t = prep(new THREE.CylinderGeometry(0.28, 0.55, 3.6, lod ? 5 : 8, 1));
  paint(t, trunk, 0.12, 0.45, -1.8);
  xf(t, 0, 1.8, 0);
  l.push(t);
  const bl = lod ? 3 : 5;
  for (let i = 0; i < bl; i++) {
    const a = (i / bl) * Math.PI * 2;
    l.push(blob(2.0 + (i % 2) * 0.4, Math.cos(a) * 1.6, 4.4 + (i % 3) * 0.5, Math.sin(a) * 1.6, leaf, i * 5.3, 0.8));
  }
  l.push(blob(2.5, 0, 5.8, 0, leaf, 4, 0.8));
  return merge(l);
}

export function deadTreeGeo(color: string) {
  const l: THREE.BufferGeometry[] = [];
  const t = prep(new THREE.CylinderGeometry(0.1, 0.38, 5, 6, 5));
  const p = t.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i) / 5 + 0.5;
    p.setX(i, p.getX(i) + Math.pow(y, 2) * 0.9);
    p.setZ(i, p.getZ(i) + Math.sin(y * 4) * 0.2);
  }
  t.computeVertexNormals();
  paint(t, color, 0.12, 0.4, -2.5);
  xf(t, 0, 2.5, 0);
  l.push(t);
  for (let i = 0; i < 4; i++) {
    const b = prep(new THREE.CylinderGeometry(0.03, 0.12, 2.0, 5));
    paint(b, color, 0.12);
    xf(b, 0, 1.0, 0);
    const a = i * 1.7;
    xf(b, 0.4, 2.6 + i * 0.5, 0, 0, a, 0.9 + (i % 2) * 0.3);
    l.push(b);
  }
  return merge(l);
}

export function crystalGeo(seed = 0, base = "#66e6ff", tip = "#d8fbff") {
  const rng = mulberry32(seed + 99);
  const l: THREE.BufferGeometry[] = [];
  const n = 6;
  for (let i = 0; i < n; i++) {
    const h = 1.2 + rng() * 2.4 * (i === 0 ? 1.6 : 1);
    const r = 0.16 + rng() * 0.2;
    const shaft = prep(new THREE.CylinderGeometry(r, r * 1.1, h, 6, 1));
    const tipG = prep(new THREE.ConeGeometry(r, h * 0.35, 6));
    xf(shaft, 0, h / 2, 0);
    xf(tipG, 0, h + h * 0.175, 0);
    gradientY(shaft, 0, h, new THREE.Color(base).multiplyScalar(0.35), new THREE.Color(base).multiplyScalar(0.9));
    gradientY(tipG, h, h * 1.35, new THREE.Color(base).multiplyScalar(0.9), tip);
    const a = (i / n) * Math.PI * 2 + rng();
    const tilt = i === 0 ? 0.05 : 0.25 + rng() * 0.45;
    const off = i === 0 ? 0 : 0.2 + rng() * 0.25;
    for (const g of [shaft, tipG]) xf(g, Math.cos(a) * off, 0, Math.sin(a) * off, Math.sin(a) * tilt, a, -Math.cos(a) * tilt * 0 + tilt);
    l.push(shaft, tipG);
  }
  return merge(l);
}

export function rockGeo(seed: number, detail = 1) {
  const g = prep(smoothRock(1, detail, 0.32, seed * 7.3));
  paint(g, "#9a958d", 0.14, 0.4, -1);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, pos.getY(i) * 0.78);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

export function spireGeo(seed: number) {
  const g = prep(new THREE.CylinderGeometry(0.28, 1, 1, 8, 6));
  displace(g, 0.12, 2.2, seed * 4.1);
  xf(g, 0, 0.5, 0);
  gradientY(g, 0, 1, "#6a2e22", "#c9663b");
  // banding
  const pos = g.attributes.position;
  const col = g.attributes.color;
  for (let i = 0; i < pos.count; i++) {
    const b = 0.78 + 0.22 * Math.sin(pos.getY(i) * 28 + seed);
    col.setXYZ(i, col.getX(i) * b, col.getY(i) * b, col.getZ(i) * b);
  }
  g.computeBoundingSphere();
  return g;
}

export function grassGeo(blades = 7) {
  const rng = mulberry32(5);
  const pos: number[] = [];
  const col: number[] = [];
  const nor: number[] = [];
  for (let i = 0; i < blades; i++) {
    const ang = rng() * Math.PI * 2;
    const ox = (rng() - 0.5) * 0.45;
    const oz = (rng() - 0.5) * 0.45;
    const h = 0.55 + rng() * 0.6;
    const w = 0.055 + rng() * 0.03;
    const bend = (rng() - 0.3) * 0.35;
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    const pts = [
      [-w, 0, 0],
      [w, 0, 0],
      [-w * 0.6, h * 0.5, bend * 0.3],
      [w * 0.6, h * 0.5, bend * 0.3],
      [0, h, bend],
    ];
    const tri = [
      [0, 1, 2],
      [1, 3, 2],
      [2, 3, 4],
    ];
    for (const t of tri)
      for (const k of t) {
        const p = pts[k];
        pos.push(ox + p[0] * ca + p[2] * sa, p[1], oz - p[0] * sa + p[2] * ca);
        const f = p[1] / h;
        col.push(0.1 + f * 0.45, 0.22 + f * 0.6, 0.06 + f * 0.2);
        nor.push(0, 1, 0.1);
      }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.computeBoundingSphere();
  return g;
}

export function flowerGeo() {
  const l: THREE.BufferGeometry[] = [];
  const stem = prep(new THREE.CylinderGeometry(0.012, 0.018, 0.5, 4));
  paint(stem, "#1c3a1a", 0);
  xf(stem, 0, 0.25, 0);
  // stems should not glow -> make them very dark (glow uses vColor)
  l.push(stem);
  const head = prep(new THREE.OctahedronGeometry(0.1, 0));
  paint(head, "#ffffff", 0);
  xf(head, 0, 0.55, 0, 0, 0, 0, 1, 0.55, 1);
  l.push(head);
  const stemC = stem.attributes.color;
  for (let i = 0; i < stemC.count; i++) stemC.setXYZ(i, 0.01, 0.04, 0.01);
  return merge(l);
}

export function mushroomGeo() {
  const l: THREE.BufferGeometry[] = [];
  const stem = prep(new THREE.CylinderGeometry(0.07, 0.1, 0.5, 6));
  paint(stem, "#1c2030", 0);
  xf(stem, 0, 0.25, 0);
  const cap = prep(new THREE.SphereGeometry(0.28, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2));
  paint(cap, "#ffffff", 0.05);
  xf(cap, 0, 0.48, 0, 0, 0, 0, 1, 0.8, 1);
  l.push(stem, cap);
  return merge(l);
}

export function iceSpikeGeo(seed = 0) {
  const rng = mulberry32(seed + 3);
  const l: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) {
    const h = 1.5 + rng() * 3;
    const r = 0.2 + rng() * 0.3;
    const g = prep(new THREE.ConeGeometry(r, h, 5));
    gradientY(g, -h / 2, h / 2, "#3b6f9c", "#cdeeff");
    const a = rng() * 6.28;
    const off = i === 0 ? 0 : 0.3 + rng() * 0.5;
    xf(g, Math.cos(a) * off, h / 2, Math.sin(a) * off, Math.sin(a) * 0.2, 0, Math.cos(a) * 0.25);
    l.push(g);
  }
  return merge(l);
}
