import * as THREE from "three";
import { Builder, prep, paint, smoothRock, crystalGeo } from "./geo";
import { mats, U, portalFrag, beamVert, beamFrag } from "./materials";
import { mulberry32 } from "./noise";
import { SITES, siteH, groundH } from "./terrain";

export interface Ctx {
  b: Builder;
  root: THREE.Group;
  tick: ((t: number, dt: number) => void)[];
}

const STONE = "#8f897c";
const STONE2 = "#756f66";
const MOSS = "#6c8a52";
const GOLD = "#d9b05a";
const RUNE = "#6fe8ff";

export function column(b: Builder, x: number, z: number, h: number, r = 0.8, color = STONE, broken = false, y = 0) {
  b.cyl("stone", r * 1.35, r * 1.4, 0.5, x, y + 0.25, z, STONE2, 10);
  const hh = broken ? h * (0.35 + Math.random() * 0.3) : h;
  b.cyl("stone", r * 0.9, r, hh, x, y + 0.5 + hh / 2, z, color, 12);
  if (!broken) {
    b.cyl("stone", r * 1.3, r * 1.0, 0.45, x, y + 0.5 + hh + 0.22, z, STONE2, 10);
    b.box("stone", r * 3, 0.5, r * 3, x, y + 0.5 + hh + 0.7, z, color);
  } else {
    b.rock("stone", r * 0.9, x + r * 1.5, y + 0.3, z + r, color, 0.6, x);
    b.cyl("stone", r * 0.9, r * 0.85, h * 0.25, x + r * 2.5, y + r * 0.8, z - r, color, 10, 0, 0, 1.3);
  }
  b.cCyl(x, z, r * 1.1, y, y + (broken ? hh + 0.5 : h + 1.2));
}

export function standingStone(b: Builder, x: number, z: number, h: number, w: number, ry: number, tilt = 0, glow = true) {
  b.box("stone", w, h, w * 0.55, x, h / 2 - 0.2, z, STONE, ry, tilt, 0, 0.12);
  if (glow) {
    // rune glyph strip facing local +z of the stone
    const cs = Math.cos(ry);
    const sn = Math.sin(ry);
    b.box("glow", w * 0.12, h * 0.5, 0.05, x + sn * w * 0.3, h * 0.55, z + cs * w * 0.3, RUNE, ry);
    b.box("glow", w * 0.4, 0.08, 0.05, x + sn * w * 0.3, h * 0.7, z + cs * w * 0.3, RUNE, ry);
  }
  b.cCyl(x, z, w * 0.55, 0, h);
}

export function statue(b: Builder, x: number, z: number, ry: number) {
  const f = new Builder();
  void f;
  b.cyl("stone", 1.9, 2.2, 1.2, x, 0.6, z, STONE2, 8, ry);
  b.cyl("stone", 1.0, 1.3, 3.2, x, 2.8, z, STONE, 8, ry);
  b.cyl("stone", 1.35, 1.0, 0.7, x, 4.7, z, STONE, 8, ry);
  b.sphere("stone", 0.7, x, 5.8, z, STONE, 1, 1.1, 1);
  b.cone("stone", 0.8, 0.9, x, 6.7, z, STONE2, 6);
  const c = Math.cos(ry);
  const s = Math.sin(ry);
  b.cyl("gold", 0.05, 0.05, 6.5, x + c * 1.7, 3.6, z - s * 1.7, GOLD, 6);
  b.cone("gold", 0.25, 0.8, x + c * 1.7, 7.1, z - s * 1.7, GOLD, 6);
  b.box("glow", 0.5, 0.1, 0.1, x + s * 0.7, 5.85, z + c * 0.7, RUNE, ry);
  b.cCyl(x, z, 1.8, 0, 7);
}

export function houseRuin(b: Builder, x: number, z: number, ry: number, y = 0) {
  b.frame(b.ox, b.oy, b.oz, b.ry);
  const W = 8;
  const D = 7;
  const c = Math.cos(ry);
  const s = Math.sin(ry);
  const L = (lx: number, lz: number): [number, number] => [x + lx * c + lz * s, z - lx * s + lz * c];
  const wall = (lx: number, lz: number, w: number, d: number, h: number, wry: number) => {
    const [wx, wz] = L(lx, lz);
    b.box("stone", w, h, d, wx, y + h / 2, wz, STONE, ry + wry, 0, 0, 0.1);
    const a = ry + wry;
    b.cBox(wx - b.ox, wz - b.oz, w, d, y, y + h, 0);
    // fix collider orientation
    const col = b.colliders[b.colliders.length - 1];
    col.c = Math.cos(a);
    col.s = Math.sin(a);
    col.x = wx;
    col.z = wz;
  };
  const [fx, fz] = L(0, 0);
  b.box("stone", W, 0.3, D, fx, y + 0.15, fz, "#a49c8b", ry);
  wall(0, -D / 2, W, 0.7, 4.8, 0);
  wall(-W / 2, 0, D, 0.7, 4.2, Math.PI / 2);
  wall(W / 2, 0, D, 0.7, 3.2 + Math.random() * 1.4, Math.PI / 2);
  wall(-W / 4 - 0.6, D / 2, W / 2 - 1.2, 0.7, 2.4, 0);
  const [bx, bz] = L(0, -D / 2 + 0.3);
  b.box("stone", W + 0.6, 0.45, 1.0, bx, y + 4.9, bz, STONE2, ry);
  const [wx, wz] = L(-1, -D / 2 + 0.5);
  b.box("glow", 1.0, 1.2, 0.1, wx, y + 2.2, wz, "#ffcf7a", ry);
  const [rx, rz] = L(W / 4, 1);
  b.rock("stone", 0.8, rx, y + 0.3, rz, STONE, 0.6, x);
  b.cyl("wood", 0.12, 0.12, 6, rx - 1, y + 0.5, rz, "#5c4333", 6, ry, 0, 1.5);
}

function ringWall(b: Builder, cx: number, cz: number, y: number, R: number, n: number, gaps: number[], rng: () => number) {
  const seg = (2 * Math.PI * R) / n;
  for (let i = 0; i < n; i++) {
    const th = (i / n) * Math.PI * 2;
    if (gaps.some((g) => Math.abs(Math.atan2(Math.sin(th - g), Math.cos(th - g))) < 0.1)) continue;
    if (rng() < 0.16) continue;
    const h = rng() < 0.3 ? 3.2 + rng() * 2 : 6.5 + rng() * 1.2;
    const x = cx + Math.cos(th) * R;
    const z = cz + Math.sin(th) * R;
    const ry = -(th + Math.PI / 2);
    b.box("stone", seg + 0.3, h, 2.4, x, y + h / 2, z, STONE, ry, 0, 0, 0.1);
    b.cBox(x - b.ox, z - b.oz, seg + 0.3, 2.4, y, y + h, 0);
    const col = b.colliders[b.colliders.length - 1];
    col.c = Math.cos(ry);
    col.s = Math.sin(ry);
    col.x = x;
    col.z = z;
    if (h > 6) {
      for (let k = -1; k <= 1; k += 2) b.box("stone", 1.4, 1.1, 2.7, x + Math.cos(ry) * k * seg * 0.25, y + h + 0.5, z - Math.sin(ry) * k * seg * 0.25, STONE2, ry);
      b.box("glow", 0.12, 2.2, 0.08, x + Math.sin(ry) * 1.25, y + h * 0.5, z + Math.cos(ry) * 1.25, RUNE, ry);
    }
  }
}

export function tower(b: Builder, x: number, z: number, r: number, h: number, y: number, roof = true) {
  b.cyl("stone", r * 1.1, r * 1.25, h, x, y + h / 2, z, STONE, 14);
  b.cyl("stone", r * 1.35, r * 1.1, 1.2, x, y + h + 0.6, z, STONE2, 14);
  if (roof) {
    b.cone("stone", r * 1.5, r * 2.4, x, y + h + 1.2 + r * 1.2, z, "#3b4f78", 14);
    b.sphere("glow", 0.4, x, y + h + 1.2 + r * 2.5, z, "#ffd98a", 1, 1, 1, 8);
  } else {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * 6.28;
      if (Math.random() < 0.4) continue;
      b.box("stone", 1.6, 1.4, 1.2, x + Math.cos(a) * r * 1.15, y + h + 1.6, z + Math.sin(a) * r * 1.15, STONE2, -a);
    }
  }
  for (let i = 0; i < 3; i++) {
    const a = i * 2.1 + x;
    b.box("glow", 0.35, 1.6, 0.2, x + Math.cos(a) * r * 1.08, y + h * (0.35 + i * 0.2), z + Math.sin(a) * r * 1.08, "#ffcf7a", -a + Math.PI / 2);
  }
  b.cCyl(x, z, r * 1.25, y, y + h + 1.2);
}

export function buildCity(ctx: Ctx) {
  const b = ctx.b;
  const Y = siteH.city;
  b.frame(0, Y, 0, 0);
  const rng = mulberry32(777);
  // temple tiers
  b.cyl("stone", 26, 26.6, 0.5, 0, 0.25, 0, "#93897a", 56);
  b.cCyl(0, 0, 26.2, 0, 0.5);
  b.cyl("stone", 23, 23.4, 0.5, 0, 0.75, 0, "#a39a8a", 56);
  b.cCyl(0, 0, 23.2, 0, 1.0);
  b.cyl("stone", 20, 20.3, 0.5, 0, 1.25, 0, "#b3aa98", 56);
  b.cCyl(0, 0, 20.2, 0, 1.5);
  b.torus("glow", 14.5, 0.12, 0, 1.52, 0, RUNE, Math.PI / 2, 0, 0, 64);
  b.torus("glow", 9, 0.1, 0, 1.52, 0, "#ffd98a", Math.PI / 2, 0, 0, 48);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    b.box("glow", 0.2, 0.05, 5, Math.cos(a) * 12, 1.52, Math.sin(a) * 12, i % 2 ? RUNE : "#ffd98a", -a + Math.PI / 2);
  }
  // columns
  const cols: [number, number, boolean][] = [];
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    const broken = i % 5 === 2 || i % 7 === 3;
    column(b, Math.cos(a) * 18, Math.sin(a) * 18, 10, 0.85, "#b6ad9c", broken, 1.0);
    cols.push([a, 0, broken]);
  }
  // lintel beams between intact neighbours
  for (let i = 0; i < 14; i++) {
    const j = (i + 1) % 14;
    if (cols[i][2] || cols[j][2]) continue;
    const a0 = cols[i][0];
    const a1 = cols[j][0];
    const x = (Math.cos(a0) + Math.cos(a1)) * 9;
    const z = (Math.sin(a0) + Math.sin(a1)) * 9;
    const len = Math.hypot(Math.cos(a1) - Math.cos(a0), Math.sin(a1) - Math.sin(a0)) * 18;
    b.box("stone", len, 0.9, 1.5, x, 1.0 + 11.9, z, "#b6ad9c", -Math.atan2(Math.sin(a1) - Math.sin(a0), Math.cos(a1) - Math.cos(a0)));
  }
  // Spire
  b.cyl("stone", 4.2, 5.8, 26, 0, 1.5 + 13, 0, "#9c9484", 20);
  b.cyl("stone", 2.6, 4.2, 44, 0, 1.5 + 26 + 22, 0, "#b4ac9b", 18);
  b.cyl("stone", 1.0, 2.6, 60, 0, 1.5 + 70 + 30, 0, "#cfc7b5", 16);
  for (let i = 0; i < 8; i++) {
    const y = 12 + i * 15.5;
    const r = 5.8 - (y / 130) * 4.8 + 0.2;
    b.torus("glow", Math.max(1.2, r), 0.18, 0, 1.5 + y, 0, i % 2 ? RUNE : "#ffd98a", Math.PI / 2, 0, 0, 24);
  }
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * 6.28 + 0.78;
    b.box("glow", 0.35, 70, 0.1, Math.cos(a) * 3.2, 1.5 + 50, Math.sin(a) * 3.2, "#9ff3ff", -a + Math.PI / 2);
  }
  b.octa("glowBright", 3.2, 0, 1.5 + 134, 0, "#bff6ff", 1.9, 1);
  b.cCyl(0, 0, 5.8, 0, 140);
  b.light(0, 6, 0, "#ffd98a", 90, 40, 0.05);
  b.light(0, 134, 0, "#9ff3ff", 400, 90, 0.05);

  // wall ring + towers
  ringWall(b, 0, 0, 0, 62, 48, [0, Math.PI / 2, Math.PI, Math.PI * 1.5], rng);
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2;
    tower(b, Math.cos(a) * 62, Math.sin(a) * 62, 4.3, 14 + rng() * 6, 0, k % 2 === 0);
  }
  // gate flanking towers at south entrance (z=+62)
  for (const sx of [-1, 1]) tower(b, sx * 9, 62, 3.2, 11, 0, true);
  b.box("stone", 15, 2.2, 3, 0, 12.8, 62, STONE2);
  b.box("glow", 5, 0.2, 0.1, 0, 12.8, 63.6, "#ffd98a");
  // houses
  const hs = [0.3, 0.9, 1.5, 2.15, 2.8, 3.5, 4.1, 5.0, 5.7];
  hs.forEach((a, i) => {
    const r = 40 + (i % 3) * 5;
    houseRuin(b, Math.cos(a) * r, Math.sin(a) * r, -(a + Math.PI / 2) + Math.PI, 0);
  });
  // statues
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + 0.5;
    statue(b, Math.cos(a) * 31, Math.sin(a) * 31, -a);
  }
  // pavement strips
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    b.box("stone", 33, 0.12, 6, Math.cos(a) * 44, 0.06, Math.sin(a) * 44, "#aaa291", -a, 0, 0, 0.12);
    b.box("glow", 33, 0.04, 0.12, Math.cos(a) * 44, 0.14, Math.sin(a) * 44, "#6fe8ff", -a);
  }
  // rubble
  for (let i = 0; i < 28; i++) {
    const a = rng() * 6.28;
    const r = 27 + rng() * 34;
    b.rock("stone", 0.5 + rng() * 1.1, Math.cos(a) * r, 0.2, Math.sin(a) * r, STONE, 0.6, i);
  }
  // Gate (static part): pylons and ring at (0,-56)
  buildGateStatic(ctx);

  // rotating halos (animated)
  for (let i = 0; i < 3; i++) {
    const g = prep(new THREE.TorusGeometry(8 + i * 2.5, 0.28, 8, 64));
    paint(g, i % 2 ? "#6fe8ff" : "#ffd98a", 0);
    const m = new THREE.Mesh(g, mats.glow);
    m.position.set(0, Y + 1.5 + 70 + i * 24, 0);
    ctx.root.add(m);
    const k = i;
    ctx.tick.push((t) => {
      m.rotation.set(Math.PI / 2 + Math.sin(t * 0.3 + k) * 0.25, t * (0.2 + k * 0.08), Math.cos(t * 0.25 + k) * 0.25);
    });
  }
}

export function buildGateStatic(ctx: Ctx) {
  const b = ctx.b;
  const gx = SITES.gate.x;
  const gz = SITES.gate.z;
  b.frame(gx, siteH.gate, gz, 0);
  b.box("stone", 6, 1.4, 14, 0, 0.7, 6, "#a39a8a");
  b.cBox(0, 6, 6, 14, 0, 1.4);
  for (let i = 0; i < 4; i++) b.box("stone", 22 - i * 2, 0.4, 3, 0, 0.2 + i * 0.2, 12 + i * 0, "#a39a8a");
  for (const sx of [-1, 1]) {
    b.box("stone", 3, 18, 3, sx * 9.2, 9, 0, "#a29a8a", 0, 0, 0, 0.1);
    b.cBox(sx * 9.2, 0, 3, 3, 0, 18);
    b.box("glow", 0.2, 12, 0.1, sx * 9.2, 9, 1.55, RUNE);
    b.box("gold", 3.6, 0.5, 3.6, sx * 9.2, 18.2, 0, GOLD);
    b.octa("glow", 0.7, sx * 9.2, 19.8, 0, RUNE, 1.8);
  }
  // ring (gap at bottom)
  b.torus("stone", 8.2, 1.1, 0, 8.4, 0, "#b2a998", 0, 0, -Math.PI / 2 + 0.38, 48, Math.PI * 2 - 0.76);
  b.torus("gold", 8.2, 0.14, 0, 8.4, 1.1, GOLD, 0, 0, -Math.PI / 2 + 0.38, 48, Math.PI * 2 - 0.76);
  for (let i = 0; i < 4; i++) {
    const a = Math.PI * 0.25 + (i * Math.PI) / 2 - 0.3;
    b.box("gold", 1.4, 1.4, 1.5, Math.cos(a) * 8.2, 8.4 + Math.sin(a) * 8.2, 0, GOLD, 0, 0, a);
  }
  b.light(0, 8, 4, "#bfe6ff", 25, 40, 0);
}

// ---------- forest structures ----------
export function buildSpawnCircle(ctx: Ctx) {
  const b = ctx.b;
  const S = SITES.spawn;
  b.frame(S.x, siteH.spawn, S.z, 0);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    standingStone(b, Math.cos(a) * 9, Math.sin(a) * 9, 3.6 + (i % 3) * 1.1, 1.5, a + Math.PI / 2 + Math.PI, (i % 2 ? 0.05 : -0.04));
  }
  b.cyl("stone", 3.2, 3.4, 0.35, 0, 0.17, 0, "#8b8576", 24);
  b.torus("glow", 2.6, 0.08, 0, 0.38, 0, RUNE, Math.PI / 2, 0, 0, 40);
  b.torus("glow", 1.4, 0.06, 0, 0.38, 0, "#ffd98a", Math.PI / 2, 0, 0, 32);
  b.light(0, 2, 0, "#7fe7ff", 14, 18, 0.08);
  // moss rocks
  for (let i = 0; i < 6; i++) {
    const a = i * 1.1 + 0.3;
    b.rock("rock", 1 + (i % 3) * 0.4, Math.cos(a) * 13, 0.1, Math.sin(a) * 13, MOSS, 0.7, i);
  }
}

export function buildBigTree(ctx: Ctx) {
  const b = ctx.b;
  const S = SITES.bigTree;
  b.frame(S.x, siteH.bigTree, S.z, 0);
  b.cyl("treeBark", 2.4, 4.4, 34, 0, 17, 0, "#6b5a4a", 14);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    b.cyl("treeBark", 0.5, 1.5, 9, Math.cos(a) * 4, 2.2, Math.sin(a) * 4, "#5c4b3b", 7, 0, Math.sin(a) * 1.0, -Math.cos(a) * 1.0);
  }
  // branches
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    b.cyl("treeBark", 0.4, 1.1, 14, Math.cos(a) * 6, 31, Math.sin(a) * 6, "#675545", 7, 0, Math.sin(a) * 1.15, -Math.cos(a) * 1.15);
  }
  const rng = mulberry32(31);
  for (let i = 0; i < 11; i++) {
    const a = rng() * 6.28;
    const r = 5 + rng() * 9;
    b.rock("foliage", 7 + rng() * 5, Math.cos(a) * r, 36 + rng() * 9, Math.sin(a) * r, i % 3 ? "#5fcfae" : "#8fe8c8", 0.62, i * 3, 1);
  }
  b.rock("foliage", 12, 0, 46, 0, "#7fe0c0", 0.55, 99, 1);
  for (let i = 0; i < 16; i++) {
    const a = rng() * 6.28;
    const r = 6 + rng() * 10;
    const hy = 24 + rng() * 10;
    b.cyl("wood", 0.02, 0.02, 4, Math.cos(a) * r, hy + 2, Math.sin(a) * r, "#3a2d22", 4);
    b.sphere("glowSoft", 0.45, Math.cos(a) * r, hy, Math.sin(a) * r, i % 2 ? "#ffd98a" : "#9ff3ff", 1, 1.2, 1, 8);
  }
  b.cCyl(0, 0, 4.2, 0, 40);
  b.light(0, 22, 0, "#ffd98a", 60, 40, 0.1);
  b.light(0, 6, 8, "#9ff3ff", 20, 24, 0.1);
}

export function buildObeliskGround(ctx: Ctx, site: { x: number; z: number }, key: string, rockColor: string, ringN = 8, ringR = 11) {
  const b = ctx.b;
  b.frame(site.x, siteH[key], site.z, 0);
  b.cyl("stone", 6.5, 7, 0.6, 0, 0.3, 0, "#7f7a70", 8, 0.4);
  b.cCyl(0, 0, 6.8, 0, 0.6);
  b.cyl("stone", 5, 5.4, 0.5, 0, 0.85, 0, "#8d887c", 8, 0.4);
  b.cCyl(0, 0, 5.2, 0, 1.1);
  b.torus("glow", 4.2, 0.08, 0, 1.12, 0, RUNE, Math.PI / 2, 0, 0, 40);
  for (let i = 0; i < ringN; i++) {
    const a = (i / ringN) * Math.PI * 2 + 0.2;
    const hh = 3 + (i % 3) * 1.4;
    standingStone(b, Math.cos(a) * ringR, Math.sin(a) * ringR, hh, 1.5, a + Math.PI / 2 + Math.PI, 0.03, i % 2 === 0);
    if (i % 2) b.rock("rock", 1.0, Math.cos(a + 0.3) * (ringR + 2), 0.2, Math.sin(a + 0.3) * (ringR + 2), rockColor, 0.7, i);
  }
}

export function buildForestExtras(ctx: Ctx) {
  const b = ctx.b;
  // sunken temple columns in the lake
  const lx = -105;
  const lz = 205;
  b.frame(lx, 3, lz, 0);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const r = i % 2 ? 15 : 22;
    const h = 5 + (i % 3) * 2.5;
    const gy = groundH(lx + Math.cos(a) * r, lz + Math.sin(a) * r) - 3;
    b.cyl("stone", 0.9, 1.05, h + 3 - gy + 0, Math.cos(a) * r, gy + (h + 3 - gy) / 2 - 0.0, Math.sin(a) * r, "#8e9a88", 10);
    b.box("stone", 2.4, 0.5, 2.4, Math.cos(a) * r, h + 3.2, Math.sin(a) * r, "#8e9a88");
    b.cCyl(Math.cos(a) * r, Math.sin(a) * r, 1.0, -20, h + 3.5);
  }
  b.box("glow", 0.3, 0.1, 6, 0, 3.3, 0, RUNE);
  b.light(0, 6, 0, "#7fe7ff", 20, 30, 0.1);
  // ancient arch near the lake road
  b.frame(40, groundH(40, 175), 175, 0.6);
  for (const sx of [-1, 1]) {
    column(b, sx * 4.2, 0, 8, 0.9, "#a8a090", false, 0);
  }
  b.box("stone", 10.6, 1.2, 2.2, 0, 10.6, 0, "#a8a090");
  b.box("glow", 7, 0.1, 0.1, 0, 10.0, 1.15, "#ffd98a");
  b.cCyl(0, 0, 0.1, 0, 0);
}

export function buildCave(ctx: Ctx) {
  const b = ctx.b;
  const S = SITES.cave;
  const Y = siteH.cave;
  b.frame(S.x, Y, S.z, 0);
  // floor
  b.box("stone", 28, 0.3, 9.4, 14, 0.1, 0, "#6b6677");
  // walls
  for (const sz of [-1, 1]) {
    b.box("stone", 28, 7, 1.6, 14, 3.5, sz * 5.2, "#5b5767", 0, 0, 0, 0.14);
    b.cBox(14, sz * 5.2, 28, 1.6, 0, 7);
  }
  b.box("stone", 1.6, 7, 12, 28.4, 3.5, 0, "#5b5767");
  b.cBox(28.4, 0, 1.6, 12, 0, 7);
  b.box("stone", 28, 1.2, 12, 14, 7.2, 0, "#615d70");
  b.cBox(14, 0, 28, 12, 6.6, 7.8);
  // mound
  const rng = mulberry32(55);
  for (let i = 0; i < 16; i++) {
    const x = 2 + rng() * 28;
    const z = (rng() - 0.5) * 14;
    const r = 4 + rng() * 5;
    const y = 6.5 + rng() * 3;
    b.rock("rock", r, x, y, z, i % 2 ? "#6c6878" : "#5e5a6b", 0.75, i * 2, 2);
    b.cCyl(x, z, r * 0.7, y - 1, y + r * 0.45);
  }
  for (let i = 0; i < 6; i++) b.rock("rock", 5 + rng() * 3, 8 + rng() * 22, 4, (rng() > 0.5 ? 1 : -1) * (7 + rng() * 5), "#5f5b6d", 0.9, i, 2);
  // entrance pillars & lintel
  for (const sz of [-1, 1]) {
    b.box("stone", 2.2, 9, 2.2, -0.2, 4.5, sz * 5.5, "#6f6a7e");
    b.cCyl(-0.2, sz * 5.5, 1.3, 0, 9);
    b.box("glow", 0.12, 5, 0.08, -1.35, 4.5, sz * 5.5, "#c59bff");
  }
  b.box("stone", 2.6, 1.6, 13.2, -0.2, 9.7, 0, "#7a7589");
  b.box("glow", 0.1, 0.25, 9, -1.55, 9.7, 0, "#c59bff");
  // interior crystals
  const cg = crystalGeo(5, "#9a7bff", "#e8dcff");
  for (let i = 0; i < 7; i++) {
    const gg = cg.clone();
    const x = 6 + i * 3.1;
    const z = (i % 2 ? 1 : -1) * 3.2;
    b.add("crystal", gg, x, 0.2, z, 0, i, 0, 1.2, 1.2, 1.2);
  }
  b.add("crystal", crystalGeo(9, "#6fe8ff", "#ffffff").clone(), 24, 0.2, 0, 0, 0, 0, 2.2, 2.2, 2.2);
  b.light(8, 3, 0, "#b79bff", 18, 14, 0.15);
  b.light(22, 3, 0, "#6fe8ff", 22, 14, 0.15);
}

// ---------- canyon ----------
export function buildColossus(ctx: Ctx) {
  const b = ctx.b;
  const S = SITES.colossus;
  b.frame(S.x, siteH.colossus - 1, S.z, Math.PI * 0.85);
  const C = "#b7714a";
  const C2 = "#9a5a3a";
  b.box("stone", 26, 3, 32, 0, 1.5, 0, C2, 0, 0, 0, 0.1);
  b.cBox(0, 0, 26, 32, 0, 3);
  // legs
  for (const sx of [-1, 1]) {
    b.box("stone", 7, 8, 20, sx * 5.5, 7, 6, C, 0, 0, 0, 0.1);
    b.cBox(sx * 5.5, 6, 7, 20, 3, 11);
    b.box("stone", 6, 3, 6, sx * 5.5, 4.5, 17.5, C2);
  }
  // torso
  b.box("stone", 15, 15, 10, 0, 17.5, -4, C, 0, 0.05, 0);
  b.cBox(0, -4, 15, 10, 3, 25);
  b.box("stone", 22, 4, 11, 0, 25, -4, C2, 0, 0.05, 0);
  // head
  b.box("stone", 7.5, 7.5, 7.5, 0, 31, -3, C, 0, -0.1, 0.06);
  b.box("stone", 8.5, 1.2, 8.5, 0, 35.2, -3, C2, 0, -0.1, 0.06);
  for (let i = -2; i <= 2; i++) b.cone("stone", 0.6, 3 + Math.abs(i) * -0.4 + 1.5, i * 1.5, 37.6, -3, C2, 5);
  for (const sx of [-1, 1]) b.box("glowBright", 1.4, 0.6, 0.4, sx * 1.8, 31.8, 0.9, "#ffb36b");
  b.box("glowSoft", 3, 0.3, 0.3, 0, 29.4, 0.9, "#ff9a5c");
  // arms resting on knees
  for (const sx of [-1, 1]) {
    b.box("stone", 3.6, 3.6, 13, sx * 9.5, 20, 2, C, 0, 0.0, 0);
    b.box("stone", 3.6, 12, 3.6, sx * 9.5, 12.5, 8.5, C, 0, 0, 0);
    b.cBox(sx * 9.5, 8.5, 3.6, 3.6, 3, 18);
  }
  b.octa("glowBright", 1.5, 0, 20, 1.2, "#ffb36b", 1.6);
  b.light(0, 31, 4, "#ff9a5c", 40, 40, 0.1);
  b.light(0, 20, 4, "#ffb36b", 30, 30, 0.1);
  // climbing blocks to the knee
  for (let i = 0; i < 8; i++) {
    b.box("stone", 3, 1.2 * (i + 1) + 0.0, 3, -13 - 0.0, 0.6 * (i + 1) - 0.0, 20 - i * 3.0 + 0, C2);
  }
  for (let i = 0; i < 8; i++) b.cBox(-13, 20 - i * 3.0, 3, 3, 0, 1.2 * (i + 1));
  // scattered boulders
  const rng = mulberry32(8);
  for (let i = 0; i < 10; i++) b.rock("rock", 1.2 + rng() * 1.8, (rng() - 0.5) * 50, 0.5, (rng() - 0.5) * 50 + 8, "#a2593a", 0.8, i);
}

export function buildRockArch(ctx: Ctx) {
  const b = ctx.b;
  const S = SITES.arch;
  b.frame(S.x, siteH.arch, S.z, 0.3);
  const C = "#b3562f";
  for (const sx of [-1, 1]) {
    const g = prep(smoothRock(1, 2, 0.2, sx + 3));
    paint(g, C, 0.12, 0.35, -1);
    b.add("rock", g, sx * 11, 12, 0, 0, 0, 0, 6.5, 14, 6.5);
    b.cCyl(sx * 11, 0, 5.8, 0, 26);
  }
  const lg = prep(smoothRock(1, 2, 0.18, 2));
  paint(lg, "#c76a3a", 0.12, 0.2, -1);
  b.add("rock", lg, 0, 25, 0, 0, 0, 0, 17, 3.4, 5);
  for (let i = 0; i < 5; i++) b.box("glow", 0.2, 3, 0.1, -6 + i * 3, 21.5, 4.8, "#ffb36b", 0);
  b.octa("glowBright", 1.5, 0, 14, 0, "#ffd98a", 1.5);
  b.light(0, 14, 0, "#ffb36b", 55, 40, 0.1);
}

export function buildArenaPillars(ctx: Ctx, site: { x: number; z: number }, key: string, col: string, accent: string) {
  const b = ctx.b;
  b.frame(site.x, siteH[key], site.z, 0);
  const rng = mulberry32(site.x);
  b.cyl("stone", 6.2, 6.6, 0.6, 0, 0.3, 0, "#5b3a30", 10);
  b.cCyl(0, 0, 6.4, 0, 0.6);
  b.torus("glow", 5, 0.1, 0, 0.64, 0, accent, Math.PI / 2, 0, 0, 40);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const R = 20;
    const h = 7 + rng() * 5;
    const broken = i % 3 === 0;
    b.box("stone", 2.4, broken ? h * 0.5 : h, 2.4, Math.cos(a) * R, (broken ? h * 0.5 : h) / 2, Math.sin(a) * R, col, a, 0, 0, 0.1);
    b.cCyl(Math.cos(a) * R, Math.sin(a) * R, 1.6, 0, broken ? h * 0.5 : h);
    if (!broken) {
      b.sphere("glowBright", 0.5, Math.cos(a) * R, h + 0.7, Math.sin(a) * R, accent, 1, 1, 1, 8);
      b.light(Math.cos(a) * R, h + 1, Math.sin(a) * R, accent, 10, 14, 0.4);
    }
  }
}

// ---------- crystal ----------
export function buildCrystalGiants(ctx: Ctx) {
  const b = ctx.b;
  b.frame(0, 0, 0, 0);
  const rng = mulberry32(21);
  const defs: [number, number, number, string, string, number][] = [
    [-250, -140, 9, "#c59bff", "#f0e4ff", 1],
    [-170, -100, 7.5, "#6fe8ff", "#e4ffff", 2],
    [-300, -20, 10, "#ff7ad9", "#ffe0f6", 3],
    [-190, 90, 8, "#6fe8ff", "#ffffff", 4],
    [-285, 110, 7, "#c59bff", "#f0e4ff", 5],
    [-160, -10, 6.5, "#ff7ad9", "#ffe0f6", 6],
    [-225, 30, 11, "#9a7bff", "#eee6ff", 7],
    [-300, -100, 9.5, "#6fe8ff", "#ffffff", 8],
  ];
  for (const [x, z, s, c1, c2, seed] of defs) {
    const g = crystalGeo(seed, c1, c2);
    const y = groundH(x, z) - 0.5;
    b.add("crystal", g, x, y, z, 0, rng() * 6, 0, s, s, s);
    b.cCyl(x, z, s * 0.62, y - 2, y + s * 4);
    b.light(x, y + s * 1.5, z, c1, 55 + s * 4, 55, 0.1);
  }
}

// ---------- snow ----------
export function buildIceTemple(ctx: Ctx) {
  const b = ctx.b;
  const S = SITES.iceTemple;
  b.frame(S.x, siteH.iceTemple, S.z, 0.4);
  b.cyl("stone", 12, 12.5, 0.6, 0, 0.3, 0, "#9fb4c8", 24);
  b.cCyl(0, 0, 12.2, 0, 0.6);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const h = 8 + (i % 3) * 2;
    b.cyl("ice", 0.9, 1.2, h, Math.cos(a) * 9, h / 2 + 0.6, Math.sin(a) * 9, "#9fd8ff", 6);
    b.cCyl(Math.cos(a) * 9, Math.sin(a) * 9, 1.1, 0, h + 0.6);
    b.cone("ice", 1.0, 3, Math.cos(a) * 9, h + 2.1, Math.sin(a) * 9, "#cdeeff", 6);
  }
  b.torus("ice", 9.5, 0.5, 0, 12, 0, "#bfe6ff", Math.PI / 2, 0, 0, 32, Math.PI);
  b.torus("glow", 4, 0.08, 0, 0.65, 0, "#9fe8ff", Math.PI / 2, 0, 0, 40);
  b.octa("glow", 1.2, 0, 4, 0, "#bff6ff", 2.2, 1);
  b.light(0, 5, 0, "#9fe8ff", 35, 30, 0.1);
}

// ---------- camps ----------
export function buildCamp(ctx: Ctx, x: number, z: number, col = "#5c4333") {
  const b = ctx.b;
  const y = groundH(x, z);
  b.frame(x, y, z, Math.random() * 6);
  // fire pit
  b.cyl("stone", 1.3, 1.5, 0.3, 0, 0.15, 0, "#55504a", 10);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * 6.28;
    b.cyl("wood", 0.1, 0.1, 1.5, Math.cos(a) * 0.4, 0.5, Math.sin(a) * 0.4, "#3b2a1f", 5, 0, Math.sin(a) * 0.9, -Math.cos(a) * 0.9);
    b.rock("rock", 0.32, Math.cos(a) * 1.3, 0.2, Math.sin(a) * 1.3, "#6b665f", 0.8, i, 0);
  }
  b.light(0, 1.4, 0, "#ff9a4a", 12, 18, 0.5);
  // tents (cones)
  for (let i = 0; i < 2; i++) {
    const a = 2.2 + i * 2.5;
    b.cone("wood", 2.3, 3.2, Math.cos(a) * 5, 1.6, Math.sin(a) * 5, i ? "#7a5c48" : "#6a4a58", 5);
    b.cCyl(Math.cos(a) * 5, Math.sin(a) * 5, 1.9, 0, 3);
  }
  b.cyl("wood", 0.08, 0.1, 3.5, -3.5, 1.75, -2, col, 5);
  b.box("wood", 1.4, 0.9, 0.05, -3.0, 3.0, -2, "#8a1f45");
}

// ---------- islands ----------
export function buildFloatingIsland(ctx: Ctx, cx: number, cy: number, cz: number, r: number, seed: number, castle: boolean) {
  const b = ctx.b;
  b.frame(cx, cy, cz, 0);
  const rng = mulberry32(seed);
  // top disc
  const top = prep(new THREE.CylinderGeometry(r, r * 0.92, 2.2, 28, 1));
  const p = top.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const a = Math.atan2(p.getZ(i), p.getX(i));
    const k = 1 + Math.sin(a * 3 + seed) * 0.08 + Math.sin(a * 7 + seed * 2) * 0.04;
    p.setX(i, p.getX(i) * k);
    p.setZ(i, p.getZ(i) * k);
  }
  top.computeVertexNormals();
  const cols = top.attributes.position.count;
  const arr = new Float32Array(cols * 3);
  const gc = new THREE.Color("#5ea044");
  const dc = new THREE.Color("#6b5a48");
  for (let i = 0; i < cols; i++) {
    const c = top.attributes.normal.getY(i) > 0.5 ? gc : dc;
    arr[i * 3] = c.r * (0.9 + rng() * 0.2);
    arr[i * 3 + 1] = c.g * (0.9 + rng() * 0.2);
    arr[i * 3 + 2] = c.b * (0.9 + rng() * 0.2);
  }
  top.setAttribute("color", new THREE.BufferAttribute(arr, 3));
  b.add("stone", top, 0, 0, 0);
  b.cCyl(0, 0, r * 0.95, -1.1, 1.1);
  // underside rock
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * 6.28;
    b.rock("rock", r * (0.34 + rng() * 0.15), Math.cos(a) * r * 0.35, -r * 0.45 - rng() * 3, Math.sin(a) * r * 0.35, "#6b6558", 1.3, i + seed, 2);
  }
  b.rock("rock", r * 0.45, 0, -r * 0.8, 0, "#5c564a", 1.6, seed, 2);
  b.cone("rock", r * 0.25, r * 0.9, 0, -r * 1.25, 0, "#524c42", 7, Math.PI);
  // crystals on rim
  const cg = crystalGeo(seed, "#6fe8ff", "#ffffff");
  for (let i = 0; i < 4; i++) {
    const a = rng() * 6.28;
    b.add("crystal", cg.clone(), Math.cos(a) * r * 0.7, 1.0, Math.sin(a) * r * 0.7, 0, rng() * 6, 0, 1.4, 1.4, 1.4);
  }
  b.light(0, 6, 0, "#6fe8ff", 40, r * 2, 0.1);
  if (castle) {
    b.box("stone", 10, 7, 8, 0, 4.6, 0, STONE);
    b.cBox(0, 0, 10, 8, 1, 8);
    for (const sx of [-1, 1]) {
      tower(b, sx * 7, 0, 2.6, 11, 1.1, true);
      tower(b, sx * 3.5, -7, 2, 8, 1.1, false);
    }
    b.cone("stone", 4, 6, 0, 11.5, 0, "#3b4f78", 8);
    b.sphere("glowBright", 0.7, 0, 14.8, 0, "#ffd98a", 1, 1, 1, 8);
    b.light(0, 15, 0, "#ffd98a", 40, 40, 0.1);
  }
}

// ---------- prefabs ----------
export interface Powered {
  group: THREE.Group;
  setPower(p: number): void;
}

export function powerMat(color: string, max = 3.5) {
  const uPow = { value: 0 };
  const m = new THREE.MeshStandardMaterial({ color: new THREE.Color(color).multiplyScalar(0.12), roughness: 0.3, metalness: 0.1 });
  const c = new THREE.Color(color);
  m.onBeforeCompile = (s) => {
    s.uniforms.uPow = uPow;
    s.uniforms.uGC = { value: c };
    s.fragmentShader = s.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uPow; uniform vec3 uGC;")
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>\n totalEmissiveRadiance += uGC * uPow * ${max.toFixed(1)};`);
  };
  m.customProgramCacheKey = () => "pm" + max;
  return { m, uPow, c };
}

export function makeObelisk(color: string): Powered & { gem: THREE.Mesh } {
  const g = new THREE.Group();
  const stone = new THREE.MeshStandardMaterial({ color: "#2b2a33", roughness: 0.6, metalness: 0.2 });
  const { m: glow, uPow } = powerMat(color, 4);
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.7, 10, 4), stone);
  shaft.rotation.y = Math.PI / 4;
  shaft.position.y = 5.8;
  shaft.castShadow = true;
  g.add(shaft);
  const base = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.8, 4.6), stone);
  base.position.y = 0.4;
  g.add(base);
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    for (let k = 0; k < 4; k++) {
      const r = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.1 - k * 0.15, 0.06), glow);
      const rr = 1.55 - k * 0.5;
      r.position.set(Math.sin(a) * (rr + 0.06), 2.2 + k * 2.1, Math.cos(a) * (rr + 0.06));
      r.rotation.y = a;
      g.add(r);
    }
  }
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.9, 0), glow);
  gem.scale.y = 1.7;
  gem.position.y = 12.5;
  g.add(gem);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.08, 6, 32), glow);
  ring.position.y = 12.5;
  ring.rotation.x = Math.PI / 2;
  g.add(ring);
  return {
    group: g,
    gem,
    setPower(p: number) {
      uPow.value = p;
    },
  };
}

export function makeRuneStone(color: string): Powered & { glyph: THREE.Mesh } {
  const g = new THREE.Group();
  const stone = new THREE.MeshStandardMaterial({ color: "#3b3945", roughness: 0.7 });
  const { m: glow, uPow } = powerMat(color, 4.5);
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.5, 3.4, 1.0), stone);
  body.position.y = 1.7;
  body.castShadow = true;
  g.add(body);
  const top = new THREE.Mesh(new THREE.ConeGeometry(0.9, 0.7, 4), stone);
  top.position.y = 3.7;
  top.rotation.y = Math.PI / 4;
  g.add(top);
  const glyph = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.7, 0.06), glow);
  glyph.position.set(0, 1.9, 0.53);
  g.add(glyph);
  const eye = new THREE.Mesh(new THREE.OctahedronGeometry(0.28, 0), glow);
  eye.position.set(0, 2.9, 0.53);
  g.add(eye);
  return {
    group: g,
    glyph,
    setPower(p: number) {
      uPow.value = p;
    },
  };
}

export function makeResonanceCrystal(color: string, seed: number): Powered {
  const g = new THREE.Group();
  const geo = crystalGeo(seed, color, "#ffffff");
  const { m, uPow } = powerMat(color, 2.4);
  // use vertex colors for subtle tint
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.15, metalness: 0.2 });
  const base = new THREE.Color(color);
  mat.onBeforeCompile = (s) => {
    s.uniforms.uPow = uPow;
    s.fragmentShader = s.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uPow;")
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n totalEmissiveRadiance += vColor.rgb * (0.12 + uPow * 2.6);");
  };
  mat.customProgramCacheKey = () => "res";
  void m;
  void base;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.scale.setScalar(2.4);
  mesh.castShadow = true;
  g.add(mesh);
  return {
    group: g,
    setPower(p: number) {
      uPow.value = p;
    },
  };
}

export function makeShrine() {
  const g = new THREE.Group();
  const stone = new THREE.MeshStandardMaterial({ color: "#8a8478", roughness: 0.85 });
  const { m: glow, uPow } = powerMat("#ffd98a", 3.5);
  const cyan = powerMat("#7fe7ff", 4);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 2.1, 0.5, 8), stone);
  base.position.y = 0.25;
  g.add(base);
  const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.85, 1.6, 8), stone);
  ped.position.y = 1.3;
  ped.castShadow = true;
  g.add(ped);
  const ring1 = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.06, 6, 40), glow);
  ring1.rotation.x = Math.PI / 2;
  ring1.position.y = 0.52;
  g.add(ring1);
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.5, 0), cyan.m);
  gem.scale.y = 1.6;
  gem.position.y = 2.7;
  g.add(gem);
  const halo = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.04, 6, 32), cyan.m);
  halo.position.y = 2.7;
  g.add(halo);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * 6.28;
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.35, 2.6, 0.35), stone);
    p.position.set(Math.cos(a) * 1.5, 1.8, Math.sin(a) * 1.5);
    p.castShadow = true;
    g.add(p);
    const tip = new THREE.Mesh(new THREE.OctahedronGeometry(0.18, 0), glow);
    tip.position.set(Math.cos(a) * 1.5, 3.3, Math.sin(a) * 1.5);
    g.add(tip);
  }
  return {
    group: g,
    gem,
    halo,
    setPower(p: number) {
      uPow.value = p;
      cyan.uPow.value = 0.3 + p * 0.7;
    },
  };
}

export function makeChest() {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: "#6b4a30", roughness: 0.7 });
  const gold = new THREE.MeshStandardMaterial({ color: "#e0b45c", roughness: 0.3, metalness: 0.9 });
  const { m: glow, uPow } = powerMat("#ffd98a", 4);
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.8, 0.95), wood);
  body.position.y = 0.4;
  body.castShadow = true;
  g.add(body);
  const lid = new THREE.Group();
  lid.position.set(0, 0.8, -0.47);
  const lidM = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.48, 1.5, 12, 1, false, 0, Math.PI), wood);
  lidM.rotation.set(0, 0, Math.PI / 2);
  lidM.rotation.order = "XYZ";
  lidM.position.set(0, 0, 0.47);
  lidM.rotation.y = 0;
  lidM.rotation.x = Math.PI / 2;
  lid.add(lidM);
  g.add(lid);
  for (const x of [-0.55, 0.55]) {
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.84, 1.0), gold);
    band.position.set(x, 0.4, 0);
    g.add(band);
  }
  const lock = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.28, 0.1), glow);
  lock.position.set(0, 0.78, 0.5);
  g.add(lock);
  return {
    group: g,
    lid,
    setPower(p: number) {
      uPow.value = p;
    },
  };
}

export function makePortalDisc(radius: number, c1: string, c2: string) {
  const uni = { uTime: { value: 0 }, uPower: { value: 1 }, uColor: { value: new THREE.Color(c1) }, uColor2: { value: new THREE.Color(c2) } };
  const m = new THREE.ShaderMaterial({
    vertexShader: "varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} ",
    fragmentShader: portalFrag,
    uniforms: uni,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(radius * 2, radius * 2), m);
  mesh.renderOrder = 8;
  return { mesh, uni };
}

export function makeBeam(color: string, radius: number, height: number, fade = true) {
  const uni = { uColor: { value: new THREE.Color(color) }, uOpacity: { value: 0 }, uTime: { value: 0 }, uFade: { value: fade ? 1 : 0 } };
  const m = new THREE.ShaderMaterial({
    vertexShader: beamVert,
    fragmentShader: beamFrag,
    uniforms: uni,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const geo = new THREE.CylinderGeometry(radius * 0.6, radius, height, 16, 1, true);
  geo.translate(0, height / 2, 0);
  const mesh = new THREE.Mesh(geo, m);
  mesh.frustumCulled = false;
  mesh.renderOrder = 7;
  return { mesh, uni };
}

// shared physics-prop geometry/materials
export const propGeo = {
  crate: new THREE.BoxGeometry(1.1, 1.1, 1.1),
  barrel: new THREE.CylinderGeometry(0.42, 0.46, 1.0, 12),
  pot: new THREE.LatheGeometry(
    [
      new THREE.Vector2(0.01, 0),
      new THREE.Vector2(0.28, 0.02),
      new THREE.Vector2(0.4, 0.3),
      new THREE.Vector2(0.34, 0.6),
      new THREE.Vector2(0.2, 0.75),
      new THREE.Vector2(0.26, 0.85),
    ],
    12
  ),
  boulder: (() => {
    const g = smoothRock(1, 2, 0.12, 4);
    paint(g, "#8c877e", 0.1, 0.3, -1);
    return g;
  })(),
};
export const propMat = {
  crate: new THREE.MeshStandardMaterial({ color: "#8a6642", roughness: 0.8 }),
  barrel: new THREE.MeshStandardMaterial({ color: "#6b4a30", roughness: 0.75 }),
  pot: new THREE.MeshStandardMaterial({ color: "#b0643c", roughness: 0.55 }),
  boulder: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }),
};

export { U };
