import * as THREE from "three";
import {
  CHUNK,
  NCH,
  HALF,
  GN,
  zones,
  pools,
  weights,
  fillGridRows,
  markGridReady,
  buildChunkGeometry,
  makeDetailTextures,
  makeTerrainMaterial,
  groundH,
  groundN,
  waterLevelAt,
  SITES,
  siteH,
  REGIONS,
  renderMapCanvas,
} from "./terrain";
import { fbm, mulberry32, smoothstep, clamp } from "./noise";
import { ColliderGrid, Builder, pineGeo, silverTreeGeo, oakGeo, deadTreeGeo, crystalGeo, rockGeo, spireGeo, grassGeo, flowerGeo, mushroomGeo, iceSpikeGeo } from "./geo";
import { mats, U, waterVert, waterFrag, lavaFrag, glowMaterial } from "./materials";
import * as S from "./structures";
import { Particles, Debris, Rings, Lightning, LightManager, Decals } from "./fx";
import { SkySystem } from "./sky";
import { Gameplay } from "./objects";

export interface FX {
  glow: Particles;
  smoke: Particles;
  debris: Debris;
  rings: Rings;
  lights: LightManager;
  lightning: Lightning;
  decals: Decals;
}

export interface WorldEvents {
  toast(text: string, kind?: "info" | "shard" | "discover" | "quest" | "warn", sub?: string): void;
  banner(title: string, sub: string): void;
  sfx(name: string, ...a: any[]): void;
  pickup(type: number): void;
  obelisk(i: number): void;
  gateOpen(): void;
  victory(): void;
  shrine(x: number, y: number, z: number): void;
  teleport(x: number, y: number, z: number): void;
  shake(a: number): void;
  hurtPlayer(d: number, from: THREE.Vector3, kb: number): void;
  killed(type: string): void;
  levelProgress(): void;
}

interface Inst {
  x: number;
  y: number;
  z: number;
  s: number;
  sy?: number;
  ry: number;
  c?: number;
}
interface VegDef {
  geo: THREE.BufferGeometry;
  lod?: THREE.BufferGeometry;
  mat: THREE.Material;
  cast: boolean;
  hide: number;
  hideLod?: number;
  shadowDist?: number;
}
interface VegEntry {
  mesh: THREE.InstancedMesh;
  key: string;
  lod: boolean;
  fullCount: number;
}
interface ChunkRec {
  cx: number;
  cz: number;
  x: number;
  z: number;
  terrain: THREE.Mesh;
  entries: VegEntry[];
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

export class World {
  scene: THREE.Scene;
  root = new THREE.Group();
  colliders = new ColliderGrid();
  fx: FX;
  sky: SkySystem;
  ev!: WorldEvents;
  tickers: ((t: number, dt: number) => void)[] = [];
  chunks: ChunkRec[] = [];
  veg: Record<string, VegDef> = {};
  excl: { x: number; z: number; r: number }[] = [];
  gp: Gameplay;
  mapCanvas!: HTMLCanvasElement;
  waterMats: THREE.ShaderMaterial[] = [];
  lavaMats: THREE.ShaderMaterial[] = [];
  shafts: THREE.Mesh[] = [];
  shaftUni: { uOpacity: { value: number } }[] = [];
  creatures: ((t: number, dt: number) => void)[] = [];
  time = 0;
  vegScale = 1;
  grassDensity = 1;
  lodTimer = 0;
  emitters: { x: number; y: number; z: number; kind: number; c: THREE.Color }[] = [];
  terrainMat!: THREE.MeshStandardMaterial;

  constructor(scene: THREE.Scene, fx: FX, sky: SkySystem) {
    this.scene = scene;
    this.fx = fx;
    this.sky = sky;
    scene.add(this.root);
    this.gp = new Gameplay(this);
  }

  blockedAt(x: number, z: number, pad = 0) {
    for (let i = 0; i < zones.length; i++) {
      const zn = zones[i];
      const dx = x - zn.x;
      const dz = z - zn.z;
      const r = zn.r0 * 0.85 + pad;
      if (dx * dx + dz * dz < r * r) return true;
    }
    for (let i = 0; i < this.excl.length; i++) {
      const e = this.excl[i];
      const dx = x - e.x;
      const dz = z - e.z;
      if (dx * dx + dz * dz < (e.r + pad) * (e.r + pad)) return true;
    }
    return false;
  }

  finish(b: Builder, castShadow = true) {
    const grp = b.build(castShadow);
    this.root.add(grp);
    b.colliders.forEach((c) => this.colliders.add(c));
    b.lights.forEach((l) => this.fx.lights.statics.push(l));
    return grp;
  }

  async build(progress: (p: number, t: string) => void) {
    const step = async (p: number, t: string) => {
      progress(p, t);
      await tick();
    };
    await step(0.02, "Gökyüzü örülüyor…");
    const tex = makeDetailTextures(256);
    this.terrainMat = makeTerrainMaterial(tex.albedo, tex.normal);
    // height grid
    for (let j = 0; j < GN; j += 24) {
      fillGridRows(j, j + 24);
      await step(0.04 + (0.22 * j) / GN, "Dağlar yükseliyor…");
    }
    markGridReady();
    // terrain chunks
    for (let cz = 0; cz < NCH; cz++) {
      for (let cx = 0; cx < NCH; cx++) {
        const g = buildChunkGeometry(cx, cz);
        const m = new THREE.Mesh(g, this.terrainMat);
        m.receiveShadow = true;
        this.root.add(m);
        this.chunks.push({ cx, cz, x: -HALF + (cx + 0.5) * CHUNK, z: -HALF + (cz + 0.5) * CHUNK, terrain: m, entries: [] });
      }
      await step(0.27 + (0.2 * cz) / NCH, "Vadiler şekilleniyor…");
    }
    this.buildPools();
    await step(0.48, "Göller dolduruluyor…");
    this.initVeg();
    this.registerExclusions();
    for (let i = 0; i < this.chunks.length; i++) {
      this.placeChunk(this.chunks[i]);
      if (i % 3 === 2) await step(0.5 + (0.25 * i) / this.chunks.length, "Ormanlar filizleniyor…");
    }
    await step(0.76, "Kadim yapılar yükseliyor…");
    this.buildStructures();
    await step(0.86, "Yaratıklar uyanıyor…");
    this.gp.build();
    await step(0.93, "Eter dokunuyor…");
    this.buildCreatures();
    this.buildShafts();
    this.mapCanvas = renderMapCanvas(240);
    await step(0.98, "Son rötuşlar…");
    this.updateLod(new THREE.Vector3(SITES.spawn.x, 30, SITES.spawn.z), true);
  }

  // ------------- pools -------------
  buildPools() {
    for (const p of pools) {
      const size = p.r * 3.9;
      const n = Math.round(size / 2.2);
      const geo = new THREE.PlaneGeometry(size, size, n, n);
      geo.rotateX(-Math.PI / 2);
      const pos = geo.attributes.position;
      const depth = new Float32Array(pos.count);
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i) + p.x;
        const z = pos.getZ(i) + p.z;
        pos.setXYZ(i, x, p.level, z);
        depth[i] = p.level - groundH(x, z);
      }
      geo.setAttribute("aDepth", new THREE.BufferAttribute(depth, 1));
      geo.computeBoundingSphere();
      let mat: THREE.ShaderMaterial;
      const common = {
        uTime: { value: 0 },
        uFogDensity: { value: 0.003 },
        uCam: { value: new THREE.Vector3() },
        uFogColor: { value: new THREE.Color() },
      };
      if (p.type === "water") {
        mat = new THREE.ShaderMaterial({
          vertexShader: waterVert,
          fragmentShader: waterFrag,
          transparent: true,
          depthWrite: false,
          uniforms: {
            ...common,
            uSunI: { value: 1 },
            uGlow: { value: p.glow ? 0.5 : 0 },
            uSunDir: { value: new THREE.Vector3() },
            uSunCol: { value: new THREE.Color() },
            uHorizon: { value: new THREE.Color() },
            uZenith: { value: new THREE.Color() },
            uShallow: { value: new THREE.Color(p.glow ? "#1fd6c8" : "#2f9a95") },
            uDeep: { value: new THREE.Color(p.glow ? "#0a4f8a" : "#0a3a55") },
          },
        });
        this.waterMats.push(mat);
      } else {
        mat = new THREE.ShaderMaterial({ vertexShader: waterVert, fragmentShader: lavaFrag, uniforms: common });
        this.lavaMats.push(mat);
        this.fx.lights.statics.push({ x: p.x, y: p.level + 3, z: p.z, color: new THREE.Color("#ff6a1a"), intensity: 120, range: 70, flicker: 0.2, seed: 3 });
        for (let i = 0; i < 14; i++) {
          const a = Math.random() * 6.28;
          const r = Math.random() * p.r * 0.8;
          this.emitters.push({ x: p.x + Math.cos(a) * r, y: p.level + 0.3, z: p.z + Math.sin(a) * r, kind: 1, c: new THREE.Color("#ff7a2a") });
        }
      }
      const mesh = new THREE.Mesh(geo, mat);
      mesh.renderOrder = 5;
      this.root.add(mesh);
    }
  }

  // ------------- vegetation -------------
  initVeg() {
    const V = this.veg;
    V.silver = { geo: silverTreeGeo(false, "#7fd8bf"), lod: silverTreeGeo(true, "#7fd8bf"), mat: mats.foliage, cast: true, hide: 130, hideLod: 360, shadowDist: 80 };
    V.oak = { geo: oakGeo(false, "#3f8a42"), lod: oakGeo(true, "#3f8a42"), mat: mats.foliage, cast: true, hide: 130, hideLod: 360, shadowDist: 80 };
    V.pine = { geo: pineGeo(false, "#2f7a4c"), lod: pineGeo(true, "#2f7a4c"), mat: mats.foliage, cast: true, hide: 130, hideLod: 360, shadowDist: 80 };
    V.pineSnow = { geo: pineGeo(false, "#dfeeea", "#4a3a30"), lod: pineGeo(true, "#dfeeea", "#4a3a30"), mat: mats.foliage, cast: true, hide: 130, hideLod: 360, shadowDist: 80 };
    V.dead = { geo: deadTreeGeo("#4a3b34"), mat: mats.treeBark, cast: true, hide: 260, shadowDist: 60 };
    V.deadPale = { geo: deadTreeGeo("#a79fc4"), mat: mats.treeBark, cast: true, hide: 260, shadowDist: 60 };
    for (let i = 0; i < 3; i++) V["rock" + i] = { geo: rockGeo(i + 1, 1), mat: mats.rock, cast: true, hide: 220, shadowDist: 60 };
    V.spire = { geo: spireGeo(1), mat: mats.rock, cast: true, hide: 340, shadowDist: 70 };
    V.spire2 = { geo: spireGeo(2), mat: mats.rock, cast: true, hide: 340, shadowDist: 70 };
    V.crystal0 = { geo: crystalGeo(1, "#6fe8ff", "#e8ffff"), mat: mats.crystal, cast: false, hide: 230 };
    V.crystal1 = { geo: crystalGeo(2, "#a07bff", "#f0e8ff"), mat: mats.crystal, cast: false, hide: 230 };
    V.crystal2 = { geo: crystalGeo(3, "#ff7ad9", "#ffe8f8"), mat: mats.crystal, cast: false, hide: 230 };
    V.mush = { geo: mushroomGeo(), mat: mats.glow, cast: false, hide: 80 };
    V.ice = { geo: iceSpikeGeo(1), mat: mats.ice, cast: false, hide: 220 };
    V.grass = { geo: grassGeo(7), mat: mats.grass, cast: false, hide: 80 };
    V.grassGlow = { geo: grassGeo(6), mat: mats.grassGlow, cast: false, hide: 70 };
    V.flower = { geo: flowerGeo(), mat: mats.grassGlow, cast: false, hide: 60 };
  }

  registerExclusions() {
    const add = (x: number, z: number, r: number) => this.excl.push({ x, z, r });
    // camps, lake, structures
    for (const c of this.gp.campSites()) add(c.x, c.z, 9);
    add(-105, 205, 70);
    add(-255, 62, 32);
    add(255, 78, 40);
    add(SITES.portalA.x, SITES.portalA.z, 10);
    add(SITES.gate.x, SITES.gate.z + 5, 20);
    // path from spawn to city (gentle clearing)
    for (let i = 0; i < 12; i++) add(0 + Math.sin(i * 0.5) * 4, 140 - i * 7.5, 5.5);
  }

  placeChunk(ch: ChunkRec) {
    const { cx, cz } = ch;
    const x0 = -HALF + cx * CHUNK;
    const z0 = -HALF + cz * CHUNK;
    const rng = mulberry32(cx * 977 + cz * 131 + 7);
    const B: Record<string, Inst[]> = {};
    const add = (k: string, i: Inst) => (B[k] ||= []).push(i);
    const wt = new Float32Array(5);
    const nrm = new THREE.Vector3();
    const treeCols = [new THREE.Color(1, 1, 1)];
    void treeCols;
    const tintR = [
      [0.8, 0.85, 0.76],
      [1.0, 0.96, 0.9],
      [1.3, 0.72, 0.52],
      [0.72, 0.62, 1.05],
      [0.85, 0.95, 1.15],
    ];
    const wet = (x: number, z: number, h: number) => waterLevelAt(x, z) > h - 0.7 || waterLevelAt(x, z, "lava") > h - 1.5;

    // trees
    for (let gx = 0; gx < 15; gx++)
      for (let gz = 0; gz < 15; gz++) {
        const x = x0 + (gx + rng()) * 6;
        const z = z0 + (gz + rng()) * 6;
        const r1 = rng();
        const r2 = rng();
        const r3 = rng();
        const r4 = rng();
        weights(x, z, wt);
        const n = fbm(x * 0.018 + 3, z * 0.018, 3);
        let key = "";
        let tint = 1;
        if (wt[0] > 0.5 && n > 0.36 && r1 < smoothstep(0.36, 0.55, n) * 0.92) key = r2 < 0.4 ? "silver" : r2 < 0.78 ? "oak" : "pine";
        else if (wt[2] > 0.45 && r1 < 0.07) key = "dead";
        else if (wt[3] > 0.45 && r1 < 0.1) key = "deadPale";
        else if (wt[4] > 0.45 && n > 0.4 && r1 < 0.55) key = "pineSnow";
        else if (wt[1] > 0.4 && wt[1] < 0.75 && r1 < 0.12) key = "oak";
        if (!key) continue;
        const h = groundH(x, z);
        if (key === "pineSnow" && h > 64) continue;
        if (this.blockedAt(x, z, 1.5) || wet(x, z, h)) continue;
        if (groundN(x, z, nrm).y < 0.8) continue;
        const s = 0.75 + r3 * 0.75;
        tint = 0.85 + r4 * 0.3;
        add(key, { x, y: h - 0.15, z, s, ry: r4 * 6.28, c: tint });
        const tr = key.startsWith("dead") ? 0.35 : key === "silver" ? 0.3 : 0.42;
        this.colliders.add({ kind: 0, x, z, r: tr * s, hw: 0, hd: 0, c: 1, s: 0, y0: h - 1, y1: h + 14, enabled: true });
      }

    // rocks
    for (let gx = 0; gx < 10; gx++)
      for (let gz = 0; gz < 10; gz++) {
        const x = x0 + (gx + rng()) * 9;
        const z = z0 + (gz + rng()) * 9;
        const r1 = rng();
        const r2 = rng();
        const r3 = rng();
        weights(x, z, wt);
        const pr = wt[0] * 0.22 + wt[1] * 0.2 + wt[2] * 0.55 + wt[3] * 0.35 + wt[4] * 0.55;
        if (r1 > pr) continue;
        const h = groundH(x, z);
        if (this.blockedAt(x, z, 1) || wet(x, z, h)) continue;
        let bi = 0;
        for (let i = 1; i < 5; i++) if (wt[i] > wt[bi]) bi = i;
        const s = (0.7 + r2 * r2 * 2.4) * (bi >= 2 ? 1.5 : 1) * (r3 < 0.06 ? 2.2 : 1);
        const t = tintR[bi];
        add("rock" + Math.floor(r3 * 2.999), { x, y: h + s * 0.1, z, s, sy: s * (0.8 + r2 * 0.5), ry: r3 * 6.28, c: bi * 10 + r2 });
        if (s > 1.4) this.colliders.add({ kind: 0, x, z, r: s * 0.85, hw: 0, hd: 0, c: 1, s: 0, y0: h - 1, y1: h + s * 0.7, enabled: true });
        void t;
      }

    // spires (canyon)
    for (let gx = 0; gx < 6; gx++)
      for (let gz = 0; gz < 6; gz++) {
        const x = x0 + (gx + rng()) * 15;
        const z = z0 + (gz + rng()) * 15;
        const r1 = rng();
        const r2 = rng();
        weights(x, z, wt);
        if (wt[2] < 0.5 || r1 > 0.4) continue;
        const h = groundH(x, z);
        if (this.blockedAt(x, z, 3) || wet(x, z, h)) continue;
        const r = 1.6 + r2 * 2.6;
        const hh = 8 + rng() * 24;
        add(r1 < 0.2 ? "spire" : "spire2", { x, y: h - 1.5, z, s: r, sy: hh, ry: rng() * 6.28 });
        this.colliders.add({ kind: 0, x, z, r: r * 0.85, hw: 0, hd: 0, c: 1, s: 0, y0: h - 2, y1: h + hh, enabled: true });
      }

    // crystals
    for (let gx = 0; gx < 20; gx++)
      for (let gz = 0; gz < 20; gz++) {
        const x = x0 + (gx + rng()) * 4.5;
        const z = z0 + (gz + rng()) * 4.5;
        const r1 = rng();
        const r2 = rng();
        const r3 = rng();
        weights(x, z, wt);
        if (wt[3] < 0.45 || r1 > 0.33 * smoothstep(0.45, 0.75, wt[3])) continue;
        const h = groundH(x, z);
        if (this.blockedAt(x, z, 1) || wet(x, z, h)) continue;
        const s = 0.7 + r2 * r2 * 1.9;
        add("crystal" + Math.floor(r3 * 2.999), { x, y: h - 0.1, z, s, ry: r2 * 6.28, c: 0.8 + r1 });
        if (s > 1.6) this.colliders.add({ kind: 0, x, z, r: 0.45 * s, hw: 0, hd: 0, c: 1, s: 0, y0: h - 1, y1: h + 4, enabled: true });
      }

    // mushrooms
    for (let gx = 0; gx < 22; gx++)
      for (let gz = 0; gz < 22; gz++) {
        const x = x0 + (gx + rng()) * 4;
        const z = z0 + (gz + rng()) * 4;
        const r1 = rng();
        const r2 = rng();
        weights(x, z, wt);
        const nn = fbm(x * 0.04 + 9, z * 0.04, 2);
        const p = wt[0] > 0.5 ? (nn > 0.55 ? 0.22 : 0.015) : wt[3] > 0.5 ? 0.04 : 0;
        if (r1 > p) continue;
        const h = groundH(x, z);
        if (this.blockedAt(x, z, 0) || wet(x, z, h)) continue;
        add("mush", { x, y: h - 0.05, z, s: 0.5 + r2 * 1.1, ry: r2 * 6, c: wt[3] > 0.5 ? 100 + r2 : 200 + r2 });
      }

    // ice
    for (let gx = 0; gx < 8; gx++)
      for (let gz = 0; gz < 8; gz++) {
        const x = x0 + (gx + rng()) * 11;
        const z = z0 + (gz + rng()) * 11;
        const r1 = rng();
        weights(x, z, wt);
        if (wt[4] < 0.5 || r1 > 0.25) continue;
        const h = groundH(x, z);
        if (this.blockedAt(x, z, 2)) continue;
        add("ice", { x, y: h - 0.2, z, s: 0.8 + rng() * 1.4, ry: rng() * 6.28 });
      }

    // grass
    for (let gx = 0; gx < 45; gx++)
      for (let gz = 0; gz < 45; gz++) {
        const x = x0 + (gx + rng()) * 2;
        const z = z0 + (gz + rng()) * 2;
        const r1 = rng();
        const r2 = rng();
        weights(x, z, wt);
        const nn = fbm(x * 0.03, z * 0.03, 2);
        const pf = wt[0] * 0.95 * (0.5 + nn * 0.7) + wt[1] * 0.4 + wt[2] * 0.07 + wt[4] * 0.02;
        const pg = wt[3] * 0.5;
        const isGlow = r1 < pg / (pf + pg + 1e-4) && pg > 0.05;
        const p = pf + pg;
        if (rng() > p) continue;
        const h = groundH(x, z);
        if (h > 70) continue;
        if (this.blockedAt(x, z, -4) || wet(x, z, h)) continue;
        if (groundN(x, z, nrm).y < 0.78) continue;
        const key = isGlow ? "grassGlow" : "grass";
        add(key, { x, y: h - 0.03, z, s: 0.7 + r2 * 0.8, ry: r2 * 6.28, c: wt[2] > 0.4 ? 300 + r2 : wt[4] > 0.4 ? 400 + r2 : wt[3] > 0.4 ? 500 + r2 : r2 });
      }

    // flowers
    for (let gx = 0; gx < 30; gx++)
      for (let gz = 0; gz < 30; gz++) {
        const x = x0 + (gx + rng()) * 3;
        const z = z0 + (gz + rng()) * 3;
        const r1 = rng();
        const r2 = rng();
        weights(x, z, wt);
        const fl = fbm(x * 0.05 + 50, z * 0.05, 2);
        if (wt[0] < 0.4 || fl < 0.55 || r1 > 0.5) continue;
        const h = groundH(x, z);
        if (this.blockedAt(x, z, -2) || wet(x, z, h)) continue;
        add("flower", { x, y: h - 0.02, z, s: 0.8 + r2 * 0.7, ry: r2 * 6, c: 600 + Math.floor(fl * 40) % 5 });
      }

    // build instanced meshes
    const dummy = new THREE.Object3D();
    const col = new THREE.Color();
    for (const key of Object.keys(B)) {
      const list = B[key];
      const def = this.veg[key];
      if (!def || !list.length) continue;
      const mesh = new THREE.InstancedMesh(def.geo, def.mat, list.length);
      for (let i = 0; i < list.length; i++) {
        const it = list[i];
        dummy.position.set(it.x, it.y, it.z);
        dummy.rotation.set(0, it.ry, 0);
        const sx = it.s * (0.92 + ((i * 37) % 17) / 100);
        dummy.scale.set(sx, it.sy ?? it.s, sx);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        // color
        const c = it.c ?? 1;
        if (c < 5 && key !== "grass" && key !== "grassGlow") col.setRGB(c, c, c);
        else if (key.startsWith("rock")) {
          const bi = Math.floor(c / 10);
          const t = tintR[bi];
          const j = 0.85 + (c % 1) * 0.3;
          col.setRGB(t[0] * j, t[1] * j, t[2] * j);
        } else if (key === "mush") {
          if (c >= 200) col.set(c % 2 < 1 ? "#7affc8" : "#c8ff6a");
          else col.set(c % 2 < 1 ? "#ff7ad9" : "#6fe8ff");
          col.multiplyScalar(0.9);
        } else if (key === "flower") {
          const pal = ["#ff9ad5", "#9ad8ff", "#ffe27a", "#ffffff", "#c59bff"];
          col.set(pal[Math.floor(c) % 5]);
        } else if (key.startsWith("crystal")) {
          col.setRGB(c, c, c);
        } else {
          // grass tints
          if (c >= 500) col.setRGB(0.5 + (c % 1) * 0.5, 1.3, 1.5);
          else if (c >= 400) col.setRGB(0.9, 1.2, 1.3);
          else if (c >= 300) col.setRGB(1.7, 1.2, 0.45 + (c % 1) * 0.2);
          else col.setRGB(0.85 + c * 0.3, 1.0 + c * 0.2, 0.8 + c * 0.2);
        }
        mesh.setColorAt(i, col);
      }
      mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
      mesh.castShadow = def.cast;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      this.root.add(mesh);
      ch.entries.push({ mesh, key, lod: false, fullCount: list.length });
      if (def.lod) {
        const l = new THREE.InstancedMesh(def.lod, def.mat, list.length);
        l.instanceMatrix = mesh.instanceMatrix;
        if (mesh.instanceColor) l.instanceColor = mesh.instanceColor;
        l.castShadow = false;
        l.receiveShadow = true;
        l.computeBoundingSphere();
        l.visible = false;
        this.root.add(l);
        ch.entries.push({ mesh: l, key, lod: true, fullCount: list.length });
      }
    }
  }

  updateLod(cam: THREE.Vector3, force = false) {
    const vs = this.vegScale;
    for (const ch of this.chunks) {
      const dx = cam.x - ch.x;
      const dz = cam.z - ch.z;
      const d = Math.max(0, Math.sqrt(dx * dx + dz * dz) - CHUNK * 0.62);
      for (const e of ch.entries) {
        const def = this.veg[e.key];
        let vis: boolean;
        if (def.lod) {
          if (e.lod) vis = d >= def.hide * vs && d < def.hideLod! * Math.max(0.6, vs);
          else vis = d < def.hide * vs;
        } else vis = d < def.hide * vs;
        if (e.mesh.visible !== vis || force) e.mesh.visible = vis;
        if (vis) {
          if (!e.lod && def.cast) {
            const cs = d < (def.shadowDist ?? 70) * Math.min(1, vs);
            if (e.mesh.castShadow !== cs) e.mesh.castShadow = cs;
          }
          if (e.key === "grass" || e.key === "grassGlow" || e.key === "flower") {
            const cnt = Math.max(1, Math.floor(e.fullCount * this.grassDensity * (d > 40 ? 0.6 : 1)));
            if (e.mesh.count !== cnt) e.mesh.count = cnt;
          }
        }
      }
    }
  }

  // ------------- structures -------------
  buildStructures() {
    const mk = (): S.Ctx => ({ b: new Builder(), root: this.root, tick: this.tickers });
    const done = (c: S.Ctx) => this.finish(c.b);

    let c = mk();
    S.buildCity(c);
    done(c);

    c = mk();
    S.buildSpawnCircle(c);
    S.buildBigTree(c);
    S.buildObeliskGround(c, SITES.forestObelisk, "forestObelisk", "#6c8a52");
    S.buildForestExtras(c);
    done(c);

    c = mk();
    S.buildCave(c);
    done(c);

    c = mk();
    S.buildColossus(c);
    S.buildRockArch(c);
    S.buildArenaPillars(c, SITES.canyonObelisk, "canyonObelisk", "#6a3e30", "#ff9a5c");
    done(c);

    c = mk();
    S.buildCrystalGiants(c);
    S.buildObeliskGround(c, SITES.crystalObelisk, "crystalObelisk", "#4a3d78", 6, 12);
    done(c);

    c = mk();
    S.buildObeliskGround(c, SITES.snowObelisk, "snowObelisk", "#6e7f90", 10, 20);
    S.buildIceTemple(c);
    done(c);

    // camps
    c = mk();
    for (const cs of this.gp.campSites()) S.buildCamp(c, cs.x, cs.z);
    for (const cs of this.gp.campSites()) {
      this.emitters.push({ x: cs.x, y: groundH(cs.x, cs.z) + 0.6, z: cs.z, kind: 0, c: new THREE.Color("#ff9a4a") });
    }
    done(c);

    // floating islands
    c = mk();
    const ic = SITES.islandCenter;
    const iy = groundH(ic.x, ic.z) + 62;
    S.buildFloatingIsland(c, ic.x, iy, ic.z, 24, 11, true);
    S.buildFloatingIsland(c, 150, 120, -150, 32, 3, true);
    S.buildFloatingIsland(c, -190, 100, -180, 18, 5, false);
    S.buildFloatingIsland(c, 190, 92, 160, 15, 7, false);
    S.buildFloatingIsland(c, -30, 135, -120, 12, 9, false);
    S.buildFloatingIsland(c, 70, 85, 70, 10, 2, false);
    S.buildFloatingIsland(c, -80, 150, 20, 9, 13, false);
    done(c);
    this.islandY = iy;

    // island waterfalls (decor) - thin glowing streams
    for (const [x, y, z, r] of [
      [150, 120, -150, 32],
      [ic.x, iy, ic.z, 24],
    ] as number[][]) {
      const g = new THREE.CylinderGeometry(0.5, 0.15, y - groundH(x + r * 0.7, z) , 6, 1, true);
      g.translate(0, -(y - groundH(x + r * 0.7, z)) / 2, 0);
      const m = new THREE.Mesh(
        g,
        new THREE.MeshBasicMaterial({ color: new THREE.Color("#8fe8ff").multiplyScalar(0.6), transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
      );
      m.position.set(x + r * 0.7, y - 1, z);
      this.root.add(m);
    }
  }
  islandY = 80;

  // ------------- creatures -------------
  buildCreatures() {
    // birds
    const wingGeo = new THREE.PlaneGeometry(0.9, 0.3);
    wingGeo.translate(0.45, 0, 0);
    const birdMat = new THREE.MeshBasicMaterial({ color: "#1a1f2a", side: THREE.DoubleSide });
    const bodyGeo = new THREE.ConeGeometry(0.1, 0.5, 5);
    bodyGeo.rotateX(Math.PI / 2);
    for (let i = 0; i < 18; i++) {
      const g = new THREE.Group();
      const b = new THREE.Mesh(bodyGeo, birdMat);
      const w1 = new THREE.Mesh(wingGeo, birdMat);
      const w2 = new THREE.Mesh(wingGeo, birdMat);
      w2.scale.x = -1;
      g.add(b, w1, w2);
      g.scale.setScalar(1.6);
      this.root.add(g);
      const cx = (Math.random() - 0.5) * 500;
      const cz = (Math.random() - 0.5) * 500;
      const R = 40 + Math.random() * 80;
      const sp = (0.15 + Math.random() * 0.15) * (Math.random() < 0.5 ? 1 : -1);
      const ph = Math.random() * 6.28;
      const alt = 35 + Math.random() * 40;
      this.creatures.push((t) => {
        const a = ph + t * sp;
        const x = cx + Math.cos(a) * R;
        const z = cz + Math.sin(a) * R;
        g.position.set(x, groundH(x, z) + alt + Math.sin(t * 0.5 + ph) * 4, z);
        g.rotation.y = -a + (sp > 0 ? Math.PI : 0);
        const f = Math.sin(t * 9 + ph) * 0.7;
        w1.rotation.z = f;
        w2.rotation.z = -f;
        g.rotation.z = Math.sin(t * 0.8 + ph) * 0.3;
      });
    }
    // dragon
    this.buildDragon();
    // mantas
    for (let i = 0; i < 3; i++) this.buildManta(i);
  }

  buildDragon() {
    const g = new THREE.Group();
    const skin = new THREE.MeshStandardMaterial({ color: "#2a2438", roughness: 0.6, metalness: 0.2, emissive: "#220a40", emissiveIntensity: 0.6 });
    const wingMat = new THREE.MeshStandardMaterial({ color: "#4a2a5a", roughness: 0.7, side: THREE.DoubleSide, emissive: "#5a1a7a", emissiveIntensity: 0.5 });
    const segs: THREE.Mesh[] = [];
    const N = 9;
    for (let i = 0; i < N; i++) {
      const r = 2.4 * Math.sin((i / (N - 1)) * Math.PI * 0.8 + 0.5) + 0.3;
      const m = new THREE.Mesh(new THREE.SphereGeometry(Math.max(0.5, r), 10, 8), skin);
      m.scale.z = 1.8;
      segs.push(m);
      g.add(m);
    }
    const head = new THREE.Mesh(new THREE.ConeGeometry(1.1, 3.2, 6), skin);
    head.rotation.x = -Math.PI / 2;
    g.add(head);
    const eyeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color("#ff7a30").multiplyScalar(6) });
    for (const sx of [-1, 1]) {
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.22, 6, 5), eyeMat);
      e.position.set(sx * 0.55, 0.5, -1.2);
      head.add(e);
    }
    const ws = new THREE.Shape();
    ws.moveTo(0, 0);
    ws.lineTo(8, 4);
    ws.lineTo(18, 5);
    ws.lineTo(24, 1);
    ws.lineTo(19, -1.5);
    ws.lineTo(21, -4);
    ws.lineTo(14, -3.5);
    ws.lineTo(15, -7);
    ws.lineTo(8, -4.5);
    ws.lineTo(0, -3);
    const wg = new THREE.ShapeGeometry(ws);
    wg.rotateX(-Math.PI / 2);
    const wL = new THREE.Mesh(wg, wingMat);
    const wR = new THREE.Mesh(wg, wingMat);
    wR.scale.x = -1;
    const wp = new THREE.Group();
    wp.position.set(0, 1.5, -1);
    wL.position.x = 0.8;
    wR.position.x = -0.8;
    const wLg = new THREE.Group();
    const wRg = new THREE.Group();
    wLg.add(wL);
    wRg.add(wR);
    wp.add(wLg, wRg);
    g.add(wp);
    g.scale.setScalar(1.7);
    this.root.add(g);
    const hist: THREE.Vector3[] = [];
    for (let i = 0; i < 40; i++) hist.push(new THREE.Vector3());
    this.creatures.push((t) => {
      const a = t * 0.05;
      const R = 210;
      const x = Math.cos(a) * R;
      const z = Math.sin(a) * R;
      const y = 150 + Math.sin(t * 0.2) * 12;
      hist.unshift(new THREE.Vector3(x, y, z));
      hist.length = 40;
      g.position.set(x, y, z);
      g.rotation.y = -a;
      g.rotation.z = -0.25;
      const f = Math.sin(t * 1.3) * 0.5;
      wLg.rotation.z = f;
      wRg.rotation.z = -f;
      head.position.set(0, 0.2, -4.5);
      segs.forEach((s, i) => {
        s.position.set(0, -Math.sin(t * 1.3 - i * 0.4) * 0.35, -2.5 + i * 2.0);
      });
    });
  }

  buildManta(i: number) {
    const g = new THREE.Group();
    const sh = new THREE.Shape();
    sh.moveTo(0, 3);
    sh.quadraticCurveTo(6, 2, 9, -1);
    sh.quadraticCurveTo(4, -1.5, 0, -3);
    sh.quadraticCurveTo(-4, -1.5, -9, -1);
    sh.quadraticCurveTo(-6, 2, 0, 3);
    const geo = new THREE.ShapeGeometry(sh, 6);
    geo.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ color: "#26324a", emissive: "#4af0ff", emissiveIntensity: 0.5, roughness: 0.5, side: THREE.DoubleSide })
    );
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.15, 9, 5), m.material);
    tail.rotation.x = Math.PI / 2;
    tail.position.z = 7;
    g.add(m, tail);
    g.scale.setScalar(2.2);
    this.root.add(g);
    const ph = i * 2.1;
    this.creatures.push((t) => {
      const a = ph + t * 0.03 * (i % 2 ? 1 : -1);
      const R = 130 + i * 40;
      g.position.set(Math.cos(a) * R, 105 + i * 18 + Math.sin(t * 0.3 + ph) * 3, Math.sin(a) * R);
      g.rotation.y = -a + (i % 2 ? 0 : Math.PI);
      g.rotation.z = Math.sin(t * 0.7 + ph) * 0.15;
      m.rotation.z = Math.sin(t * 1.2 + ph) * 0.12;
    });
  }

  buildShafts() {
    const pts: [number, number][] = [];
    const rng = mulberry32(5);
    for (let i = 0; i < 12; i++) pts.push([SITES.spawn.x + (rng() - 0.5) * 110, SITES.spawn.z - 10 - rng() * 90]);
    for (let i = 0; i < 4; i++) pts.push([SITES.bigTree.x + (rng() - 0.5) * 40, SITES.bigTree.z + (rng() - 0.5) * 40]);
    for (let i = 0; i < 6; i++) pts.push([(rng() - 0.5) * 90, (rng() - 0.5) * 90]);
    pts.push([SITES.cave.x - 6, SITES.cave.z]);
    for (const [x, z] of pts) {
      const uni = { uColor: { value: new THREE.Color("#fff2c8") }, uOpacity: { value: 0 }, uTime: { value: 0 }, uFade: { value: 0 } };
      const m = new THREE.ShaderMaterial({
        vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vV; varying float vD; void main(){ vUv=uv; vec4 mv=modelViewMatrix*vec4(position,1.0); vD=length(mv.xyz); vN=normalize(normalMatrix*normal); vV=normalize(-mv.xyz); gl_Position=projectionMatrix*mv; }`,
        fragmentShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vV; varying float vD; uniform vec3 uColor; uniform float uOpacity; uniform float uTime;
          void main(){ float e = pow(abs(dot(normalize(vN),normalize(vV))), 2.0); float v = smoothstep(0.0,0.2,vUv.y)*smoothstep(1.0,0.5,vUv.y); gl_FragColor = vec4(uColor, e*v*uOpacity*smoothstep(10.0,40.0,vD)*(0.8+0.2*sin(uTime+vUv.y*5.0))); }`,
        uniforms: uni,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      const geo = new THREE.CylinderGeometry(1.2 + rng() * 1.8, 2.5 + rng() * 3.5, 70, 14, 1, true);
      const mesh = new THREE.Mesh(geo, m);
      const h = groundH(x, z);
      mesh.position.set(x, h + 20, z);
      mesh.frustumCulled = false;
      mesh.renderOrder = 6;
      this.root.add(mesh);
      this.shafts.push(mesh);
      this.shaftUni.push(uni);
    }
  }

  // ------------- per frame -------------
  update(dt: number, P: { pos: THREE.Vector3; vel: THREE.Vector3; grounded: boolean; cam: THREE.Vector3; alive: boolean; speed: number }) {
    this.time += dt;
    const t = this.time;
    U.uTime.value = t;
    U.uPlayer.value.copy(P.pos);
    U.uGlowPulse.value = 0.88 + 0.12 * Math.sin(t * 2.2);
    // wave decay
    const w = U.uWave.value as THREE.Vector4;
    if (w.w > 0.001) {
      w.z += dt * 26;
      w.w *= Math.exp(-dt * 1.6);
    }
    for (const fn of this.tickers) fn(t, dt);
    for (const fn of this.creatures) fn(t, dt);
    // water & lava uniforms
    const sky = this.sky;
    const sunI = clamp(sky.elev * 1.6, 0, 1) * (1 - sky.storm);
    for (const m of this.waterMats) {
      const u = m.uniforms;
      u.uTime.value = t;
      u.uCam.value.copy(P.cam);
      u.uFogColor.value.copy(sky.fog.color);
      u.uFogDensity.value = sky.fog.density;
      u.uSunDir.value.copy(sky.sunDir);
      u.uSunCol.value.copy(sky.sunCol);
      u.uSunI.value = sunI;
      u.uHorizon.value.copy(sky.horizon);
      u.uZenith.value.copy(sky.zenith);
    }
    for (const m of this.lavaMats) {
      const u = m.uniforms;
      u.uTime.value = t;
      u.uCam.value.copy(P.cam);
      u.uFogColor.value.copy(sky.fog.color);
      u.uFogDensity.value = sky.fog.density;
    }
    // light shafts
    const op = clamp(sky.elev * 2.2, 0, 1) * (1 - sky.storm) * 0.085;
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), sky.sunDir);
    for (let i = 0; i < this.shafts.length; i++) {
      this.shafts[i].quaternion.copy(q);
      this.shaftUni[i].uOpacity.value = op;
      (this.shaftUni[i] as any).uTime.value = t;
      this.shafts[i].visible = op > 0.001;
    }
    // lod
    this.lodTimer -= dt;
    if (this.lodTimer <= 0) {
      this.lodTimer = 0.25;
      this.updateLod(P.cam);
    }
    // emitters near player
    for (const e of this.emitters) {
      const dx = e.x - P.pos.x;
      const dz = e.z - P.pos.z;
      if (dx * dx + dz * dz > 3600) continue;
      if (e.kind === 0) {
        if (Math.random() < dt * 40) {
          this.fx.glow.spawn(e.x + (Math.random() - 0.5) * 0.5, e.y, e.z + (Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.5, 1.5 + Math.random() * 1.5, (Math.random() - 0.5) * 0.5, 0.8 + Math.random() * 0.6, 0.9 + Math.random() * 0.6, 1.3, 0.55, 0.15, 0.9, 0, 0.3);
        }
        if (Math.random() < dt * 8) this.fx.smoke.spawn(e.x, e.y + 0.6, e.z, (Math.random() - 0.5) * 0.4, 1.2, (Math.random() - 0.5) * 0.4, 2.2, 0.9, 0.18, 0.17, 0.17, 0.35, 0, 0.3, 0.6);
      } else {
        if (Math.random() < dt * 3) this.fx.glow.spawn(e.x, e.y, e.z, (Math.random() - 0.5) * 1.5, 3 + Math.random() * 4, (Math.random() - 0.5) * 1.5, 1.2 + Math.random(), 0.5, 1.5, 0.5, 0.1, 1, 6, 0.1);
      }
    }
    this.gp.update(dt, P);
  }

  // minimap
  drawMap(ctx: CanvasRenderingContext2D, size: number, px: number, pz: number, yaw: number, mode: "mini" | "full") {
    const cv = this.mapCanvas;
    ctx.clearRect(0, 0, size, size);
    ctx.save();
    const span = mode === "mini" ? 190 : 2 * HALF;
    const scale = size / span; // px per meter
    if (mode === "mini") {
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2);
      ctx.clip();
      ctx.translate(size / 2, size / 2);
      ctx.rotate(yaw + Math.PI);
      ctx.translate(-px * scale, -pz * scale);
    } else {
      ctx.translate(size / 2, size / 2);
      ctx.translate(-0 * scale, -0 * scale);
    }
    const mw = 2 * HALF * scale;
    ctx.imageSmoothingEnabled = true;
    ctx.globalAlpha = 0.95;
    ctx.drawImage(cv, -HALF * scale, -HALF * scale, mw, mw);
    ctx.globalAlpha = 1;
    this.gp.drawMarkers(ctx, scale, mode, px, pz);
    if (mode === "full") {
      ctx.font = "600 11px Georgia, serif";
      ctx.textAlign = "center";
      for (const r of REGIONS) {
        ctx.fillStyle = "rgba(0,0,0,0.6)";
        ctx.fillText(r.name.toUpperCase(), r.cx * scale + 1, r.cz * scale + 1);
        ctx.fillStyle = r.color;
        ctx.fillText(r.name.toUpperCase(), r.cx * scale, r.cz * scale);
      }
    }
    ctx.restore();
    // player marker
    ctx.save();
    if (mode === "mini") ctx.translate(size / 2, size / 2);
    else ctx.translate(size / 2 + px * scale, size / 2 + pz * scale);
    if (mode === "full") ctx.rotate(-yaw + Math.PI);
    else ctx.rotate(0);
    ctx.fillStyle = "#fff";
    ctx.strokeStyle = "#0a1020";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(5, 6);
    ctx.lineTo(0, 3);
    ctx.lineTo(-5, 6);
    ctx.closePath();
    ctx.stroke();
    ctx.fill();
    ctx.restore();
  }
}

export { siteH, glowMaterial };
