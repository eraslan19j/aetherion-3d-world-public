import * as THREE from "three";
import type { World } from "./world";
import { groundH, groundN, siteH, SITES, CAMPS, REGIONS, waterLevelAt, weights, HALF } from "./terrain";
import { Enemy, EnemyEnv } from "./enemies";
import { standHeight, pushOut, pointHits } from "./collide";
import { prep, paint } from "./geo";
import * as S from "./structures";
import { mats, glowMaterial } from "./materials";
import { mulberry32, clamp, damp, smoothstep } from "./noise";

type BodyKind = "crate" | "barrel" | "pot" | "boulder";
interface Body {
  kind: BodyKind;
  mesh: THREE.Mesh;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  r: number;
  mass: number;
  breakable: boolean;
  dead: boolean;
  loot: number;
  sleep: boolean;
  spin: number;
  grounded: boolean;
  home: THREE.Vector3;
  puzzle?: boolean;
}

interface Rune {
  pos: THREE.Vector3;
  r: number;
  kind: "bolt" | "lightning";
  active: boolean;
  group: string;
  p: S.Powered;
  power: number;
  color: string;
  onActivate?: () => void;
}

interface Obelisk {
  i: number;
  name: string;
  region: string;
  hint: string;
  pos: THREE.Vector3;
  color: string;
  state: 0 | 1 | 2;
  pre: S.Powered & { gem: THREE.Mesh };
  power: number;
  beam: ReturnType<typeof S.makeBeam>;
  req: () => boolean;
  light: { x: number; y: number; z: number; color: THREE.Color; intensity: number; range: number; flicker: number };
}

interface Interact {
  id: string;
  pos: THREE.Vector3;
  r: number;
  prompt: () => string | null;
  use: () => void;
}

interface Shrine {
  id: string;
  name: string;
  pos: THREE.Vector3;
  pre: ReturnType<typeof S.makeShrine>;
  active: boolean;
  power: number;
}
interface Chest {
  id: string;
  pos: THREE.Vector3;
  pre: ReturnType<typeof S.makeChest>;
  open: boolean;
  t: number;
  shards: number;
}
interface Pad {
  pos: THREE.Vector3;
  r: number;
  group: string;
  active: boolean;
  p: S.Powered;
  mesh: THREE.Object3D;
  power: number;
}
interface Portal {
  pos: THREE.Vector3;
  dest: THREE.Vector3;
  disc: ReturnType<typeof S.makePortalDisc>;
  group: THREE.Group;
}
interface Pickup {
  active: boolean;
  type: number; // 0 shard 1 health 2 energy
  id: number; // world shard id or -1
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  bob: number;
  ttl: number;
  dyn: boolean;
  restY: number;
  grounded: boolean;
}

const c3 = (c: THREE.Color): [number, number, number] => [c.r, c.g, c.b];
const REGION_TINT = ["#a67bff", "#ffd98a", "#ff6a3a", "#ff7ad9", "#8fe0ff"];
const REGION_NAME = REGIONS.map((r) => r.name);

export class Gameplay {
  w: World;
  bodies: Body[] = [];
  enemies: Enemy[] = [];
  runes: Rune[] = [];
  obelisks: Obelisk[] = [];
  interacts: Interact[] = [];
  shrines: Shrine[] = [];
  chests: Chest[] = [];
  pads: Pad[] = [];
  portals: Portal[] = [];
  pickups: Pickup[] = [];
  pickMesh!: THREE.InstancedMesh;
  discoveries: { id: number; name: string; sub: string; x: number; z: number; r: number; yMin?: number; found: boolean }[] = [];
  collected = new Set<number>();
  shardList: { id: number; x: number; y: number; z: number }[] = [];
  respawn = new THREE.Vector3();
  respawnY = 0;
  door!: { mesh: THREE.Mesh; collider: any; open: boolean; t: number; y0: number; pm: { uPow: { value: number } } };
  gate!: { disc: ReturnType<typeof S.makePortalDisc>; beam: ReturnType<typeof S.makeBeam>; pos: THREE.Vector3; open: boolean; power: number };
  env!: EnemyEnv;
  time = 0;
  tpCooldown = 0;
  kills = 0;
  runeCount = 0;
  guardian?: Enemy;
  plateHintShown = false;
  chestsOpened = 0;
  playerRef = { pos: new THREE.Vector3(), alive: true, grounded: true };
  sparkleT = 0;

  constructor(w: World) {
    this.w = w;
  }

  campSites() {
    return CAMPS;
  }

  get totalShards() {
    return this.shardList.length;
  }
  get totalDiscover() {
    return this.discoveries.length;
  }
  get discovered() {
    return this.discoveries.filter((d) => d.found).length;
  }

  // ---------------- build ----------------
  build() {
    const w = this.w;
    const grp = new THREE.Group();
    w.root.add(grp);
    this.env = {
      player: this.playerRef.pos,
      alive: true,
      grounded: true,
      time: 0,
      colliders: w.colliders,
      hurtPlayer: (d, f, kb) => w.ev.hurtPlayer(d, f, kb),
      shake: (a) => w.ev.shake(a),
      burst: (x, y, z, c, n, sp, size = 1) => w.fx.glow.burst(x, y, z, n, sp, 0.9, 0.9 * size, c.r * 2, c.g * 2, c.b * 2, 3, 1.2),
      ring: (x, y, z, r, c) => w.fx.rings.spawn(x, y, z, r, 0.7, c),
      sfx: (n) => w.ev.sfx(n),
    };
    // pickups mesh
    const pg = prep(new THREE.OctahedronGeometry(0.3, 0));
    paint(pg, "#ffffff", 0);
    const pm = glowMaterial(2.6, { roughness: 0.2 });
    this.pickMesh = new THREE.InstancedMesh(pg, pm, 300);
    this.pickMesh.frustumCulled = false;
    const c0 = new THREE.Color(1, 1, 1);
    const dummy = new THREE.Object3D();
    dummy.scale.setScalar(0);
    dummy.updateMatrix();
    for (let i = 0; i < 300; i++) {
      this.pickMesh.setColorAt(i, c0);
      this.pickMesh.setMatrixAt(i, dummy.matrix);
      this.pickups.push({ active: false, type: 0, id: -1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, bob: Math.random() * 6, ttl: 0, dyn: false, restY: 0, grounded: false });
    }
    w.root.add(this.pickMesh);

    this.buildObelisks();
    this.buildShrines();
    this.buildCaveDoor();
    this.buildGate();
    this.buildPortals();
    this.buildChests();
    this.buildProps();
    this.buildEnemies();
    this.buildShards();
    this.buildDiscoveries();
    const sp = SITES.spawn;
    this.respawn.set(sp.x, groundH(sp.x, sp.z), sp.z + 6);
  }

  addRune(x: number, z: number, kind: "bolt" | "lightning", group: string, color: string, faceX: number, faceZ: number, y?: number) {
    const w = this.w;
    const p = kind === "bolt" ? S.makeRuneStone(color) : S.makeResonanceCrystal(color, Math.floor(x));
    const gy = y ?? groundH(x, z);
    p.group.position.set(x, gy, z);
    p.group.rotation.y = Math.atan2(faceX - x, faceZ - z);
    w.root.add(p.group);
    const r: Rune = { pos: new THREE.Vector3(x, gy + (kind === "bolt" ? 2 : 3), z), r: kind === "bolt" ? 1.4 : 2.2, kind, active: false, group, p, power: 0.1, color };
    p.setPower(0.1);
    this.runes.push(r);
    w.colliders.add({ kind: 0, x, z, r: 0.9, hw: 0, hd: 0, c: 1, s: 0, y0: gy - 1, y1: gy + 4, enabled: true });
    w.fx.lights.statics.push({ x, y: gy + 2.5, z, color: new THREE.Color(color), intensity: 8, range: 12, flicker: 0.1, seed: x });
    return r;
  }

  buildObelisks() {
    const w = this.w;
    const defs = [
      { site: SITES.forestObelisk, key: "forestObelisk", name: "Gümüş Koru Obeliski", region: "Gümüş Koru", color: "#9affc0", hint: "3 Rün Taşını Aether Oku ile uyandır" },
      { site: SITES.canyonObelisk, key: "canyonObelisk", name: "Kızıl Kanyon Obeliski", region: "Kızıl Kanyon", color: "#ff9a5c", hint: "Obeliskin Taş Bekçisi'ni yen" },
      { site: SITES.crystalObelisk, key: "crystalObelisk", name: "Kristal Vadisi Obeliski", region: "Kristal Vadisi", color: "#c59bff", hint: "3 Rezonans Kristalini Yıldırım ile uyandır" },
      { site: SITES.snowObelisk, key: "snowObelisk", name: "Donmuş Zirve Obeliski", region: "Donmuş Zirveler", color: "#9fe8ff", hint: "2 Kadim Kayayı basınç plakalarına it" },
    ];
    defs.forEach((d, i) => {
      const y = siteH[d.key] + 1.1;
      const pre = S.makeObelisk(d.color);
      pre.group.position.set(d.site.x, y, d.site.z);
      w.root.add(pre.group);
      pre.setPower(0.08);
      const beam = S.makeBeam(d.color, 3.2, 420, true);
      beam.mesh.position.set(d.site.x, y + 13, d.site.z);
      w.root.add(beam.mesh);
      w.colliders.add({ kind: 0, x: d.site.x, z: d.site.z, r: 1.9, hw: 0, hd: 0, c: 1, s: 0, y0: y - 1, y1: y + 14, enabled: true });
      const lt = { x: d.site.x, y: y + 6, z: d.site.z, color: new THREE.Color(d.color), intensity: 10, range: 28, flicker: 0.1 };
      w.fx.lights.statics.push({ ...lt, seed: i });
      const ob: Obelisk = {
        i,
        name: d.name,
        region: d.region,
        hint: d.hint,
        pos: new THREE.Vector3(d.site.x, y, d.site.z),
        color: d.color,
        state: 0,
        pre,
        power: 0.08,
        beam,
        req: () => false,
        light: lt,
      };
      this.obelisks.push(ob);
      this.interacts.push({
        id: "ob" + i,
        pos: ob.pos,
        r: 5,
        prompt: () => (ob.state === 1 ? "Obeliski Uyandır" : ob.state === 0 ? null : null),
        use: () => this.activateObelisk(ob),
      });
    });

    // 0 forest: 3 bolt runes
    const o0 = this.obelisks[0];
    for (let k = 0; k < 3; k++) {
      const a = k * 2.094 + 0.4;
      const x = o0.pos.x + Math.cos(a) * 15;
      const z = o0.pos.z + Math.sin(a) * 15;
      this.addRune(x, z, "bolt", "o0", "#9affc0", o0.pos.x, o0.pos.z, siteH.forestObelisk);
    }
    o0.req = () => this.runes.filter((r) => r.group === "o0" && r.active).length >= 3;
    // 2 crystal: 3 lightning runes
    const o2 = this.obelisks[2];
    for (let k = 0; k < 3; k++) {
      const a = k * 2.094 + 1.0;
      const x = o2.pos.x + Math.cos(a) * 17;
      const z = o2.pos.z + Math.sin(a) * 17;
      this.addRune(x, z, "lightning", "o2", "#c59bff", o2.pos.x, o2.pos.z, siteH.crystalObelisk);
    }
    o2.req = () => this.runes.filter((r) => r.group === "o2" && r.active).length >= 3;
    // 3 snow: plates + boulders
    const o3 = this.obelisks[3];
    for (let k = 0; k < 2; k++) {
      const a = k * Math.PI + 0.6;
      const x = o3.pos.x + Math.cos(a) * 12;
      const z = o3.pos.z + Math.sin(a) * 12;
      const y = siteH.snowObelisk;
      const pm = S.powerMat("#9fe8ff", 4);
      const g = new THREE.Group();
      const base = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.3, 0.25, 20), new THREE.MeshStandardMaterial({ color: "#566272", roughness: 0.7 }));
      base.position.y = 0.12;
      g.add(base);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.7, 0.07, 6, 30), pm.m);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.27;
      g.add(ring);
      const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.4, 0), pm.m);
      star.position.y = 0.4;
      star.scale.y = 0.4;
      g.add(star);
      g.position.set(x, y, z);
      w.root.add(g);
      const pad: Pad = { pos: new THREE.Vector3(x, y, z), r: 2.0, group: "o3", active: false, p: { group: g, setPower: (p) => (pm.uPow.value = p) }, mesh: base, power: 0.1 };
      pm.uPow.value = 0.1;
      this.pads.push(pad);
      w.fx.lights.statics.push({ x, y: y + 1, z, color: new THREE.Color("#9fe8ff"), intensity: 6, range: 10, flicker: 0.05, seed: k });
      // boulder
      const ba = a + 0.7 + k * 1.2;
      const b = this.addBody("boulder", o3.pos.x + Math.cos(ba) * 17, o3.pos.z + Math.sin(ba) * 17);
      b.puzzle = true;
    }
    o3.req = () => this.pads.filter((p) => p.group === "o3" && p.active).length >= 2;
  }

  activateObelisk(ob: Obelisk) {
    if (ob.state !== 1) return;
    ob.state = 2;
    this.runeCount = this.obelisks.filter((o) => o.state === 2).length;
    const w = this.w;
    w.ev.sfx("obelisk");
    w.ev.shake(1.0);
    w.fx.rings.spawn(ob.pos.x, ob.pos.y + 0.3, ob.pos.z, 40, 1.6, ob.color, "flat", 0.1);
    w.fx.rings.spawn(ob.pos.x, ob.pos.y + 6, ob.pos.z, 30, 1.2, "#ffffff", "flat", 0.08);
    w.fx.glow.burst(ob.pos.x, ob.pos.y + 6, ob.pos.z, 120, 18, 2, 1.5, ...c3(new THREE.Color(ob.color).multiplyScalar(2)), 0, 0.5);
    w.fx.lights.flash(ob.pos.x, ob.pos.y + 8, ob.pos.z, ob.color, 400, 80, 1.6);
    w.ev.obelisk(ob.i);
    if (this.runeCount === 4) this.openGate();
  }

  openGate() {
    if (this.gate.open) return;
    this.gate.open = true;
    this.w.ev.gateOpen();
    this.w.ev.sfx("rune");
  }

  buildShrines() {
    const w = this.w;
    const defs = [
      { site: SITES.shrineForest, key: "shrineForest", name: "Gümüş Koru Sunağı" },
      { site: SITES.shrineCity, key: "shrineCity", name: "Eterya Sunağı" },
      { site: SITES.shrineCanyon, key: "shrineCanyon", name: "Kızıl Kanyon Sunağı" },
      { site: SITES.shrineCrystal, key: "shrineCrystal", name: "Kristal Sunağı" },
      { site: SITES.shrineSnow, key: "shrineSnow", name: "Zirve Sunağı" },
    ];
    defs.forEach((d, i) => {
      const y = siteH[d.key];
      const pre = S.makeShrine();
      pre.group.position.set(d.site.x, y, d.site.z);
      w.root.add(pre.group);
      pre.setPower(0.15);
      w.colliders.add({ kind: 0, x: d.site.x, z: d.site.z, r: 1.7, hw: 0, hd: 0, c: 1, s: 0, y0: y - 1, y1: y + 0.5, enabled: true });
      w.fx.lights.statics.push({ x: d.site.x, y: y + 2.7, z: d.site.z, color: new THREE.Color("#7fe7ff"), intensity: 10, range: 18, flicker: 0.1, seed: i });
      const sh: Shrine = { id: "sh" + i, name: d.name, pos: new THREE.Vector3(d.site.x, y, d.site.z), pre, active: false, power: 0.15 };
      this.shrines.push(sh);
      this.interacts.push({
        id: sh.id,
        pos: sh.pos,
        r: 3.6,
        prompt: () => (sh.active ? "Sunakta Dinlen" : "Kadim Sunağı Uyandır"),
        use: () => this.useShrine(sh),
      });
    });
  }

  useShrine(sh: Shrine) {
    const w = this.w;
    const first = !sh.active;
    sh.active = true;
    this.respawn.set(sh.pos.x + 2.5, sh.pos.y, sh.pos.z + 2.5);
    w.ev.shrine(sh.pos.x, sh.pos.y, sh.pos.z);
    w.ev.sfx("shrine");
    w.fx.rings.spawn(sh.pos.x, sh.pos.y + 0.3, sh.pos.z, 10, 1.2, "#7fe7ff", "flat", 0.1);
    w.fx.glow.burst(sh.pos.x, sh.pos.y + 2.5, sh.pos.z, 50, 7, 1.4, 1.2, 0.5, 1.8, 2.2, -1, 1);
    w.fx.lights.flash(sh.pos.x, sh.pos.y + 3, sh.pos.z, "#7fe7ff", 120, 30, 1.2);
    if (first) w.ev.toast("Sunak uyandı", "quest", "Dinlenme noktası kaydedildi · Can ve enerji yenilendi");
    else w.ev.toast("Dinlendin", "info", "Can ve enerji yenilendi");
  }

  buildCaveDoor() {
    const w = this.w;
    const S0 = SITES.cave;
    const y = siteH.cave;
    const mat = new THREE.MeshStandardMaterial({ color: "#4e4a5a", roughness: 0.7, metalness: 0.2 });
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.9, 6.6, 9.8), mat);
    door.position.set(S0.x + 1.5, y + 3.3, S0.z);
    door.castShadow = true;
    w.root.add(door);
    const pm = S.powerMat("#c59bff", 3);
    pm.uPow.value = 0.4;
    const glyph = new THREE.Mesh(new THREE.BoxGeometry(0.1, 3.2, 1.4), pm.m);
    glyph.position.set(-0.5, 0, 0);
    door.add(glyph);
    const g2 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.35, 5), pm.m);
    g2.position.set(-0.5, 1.5, 0);
    door.add(g2);
    const col = { kind: 1 as const, x: S0.x + 1.5, z: S0.z, r: 0, hw: 0.45, hd: 4.9, c: 1, s: 0, y0: y, y1: y + 7, enabled: true };
    w.colliders.add(col);
    this.door = { mesh: door, collider: col, open: false, t: 0, y0: y + 3.3, pm };
    const rx = S0.x - 5;
    const rz = S0.z + 8;
    const r = this.addRune(rx, rz, "bolt", "door", "#c59bff", S0.x - 6, S0.z, y);
    const r2 = this.addRune(S0.x - 5, S0.z - 8, "bolt", "door", "#c59bff", S0.x - 6, S0.z, y);
    r.onActivate = () => {
      if (this.runes.filter((q) => q.group === "door" && q.active).length >= 1 && !this.door.open) {
        this.door.open = true;
        w.ev.sfx("door");
        w.ev.shake(0.5);
        w.ev.toast("Kapı açılıyor…", "info", "Mağaranın gizemi seni bekliyor");
        pm.uPow.value = 2;
      }
    };
    r2.onActivate = r.onActivate;
  }

  buildGate() {
    const w = this.w;
    const g = SITES.gate;
    const y = siteH.gate;
    const disc = S.makePortalDisc(7.6, "#9fe8ff", "#c59bff");
    disc.mesh.position.set(g.x, y + 8.4, g.z);
    w.root.add(disc.mesh);
    disc.uni.uPower.value = 0.0;
    const beam = S.makeBeam("#9fe8ff", 4, 500, true);
    beam.mesh.position.set(g.x, y + 18, g.z);
    w.root.add(beam.mesh);
    this.gate = { disc, beam, pos: new THREE.Vector3(g.x, y, g.z), open: false, power: 0 };
    // rune sockets: 4 orbs
    for (let i = 0; i < 4; i++) {
      const a = Math.PI * 0.5 + (i - 1.5) * 0.45;
      void a;
    }
    w.fx.lights.statics.push({ x: g.x, y: y + 8, z: g.z + 3, color: new THREE.Color("#9fe8ff"), intensity: 30, range: 50, flicker: 0.1, seed: 9 });
  }

  buildPortals() {
    const w = this.w;
    const A = SITES.portalA;
    const ay = siteH.portalA;
    const iy = w.islandY + 1.1;
    const mk = (x: number, y: number, z: number, faceX: number, faceZ: number, c1: string, c2: string) => {
      const g = new THREE.Group();
      const pm = S.powerMat("#7fe7ff", 3.5);
      pm.uPow.value = 1;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(2.3, 0.2, 8, 40), pm.m);
      ring.position.y = 2.4;
      g.add(ring);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * 6.28;
        const r = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.35, 0.5), new THREE.MeshStandardMaterial({ color: "#3b3945", roughness: 0.6 }));
        r.position.set(Math.cos(a) * 2.45, 2.4 + Math.sin(a) * 2.45, 0);
        r.rotation.z = a;
        g.add(r);
      }
      const base = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.8, 0.4, 12), new THREE.MeshStandardMaterial({ color: "#6c6a74", roughness: 0.8 }));
      base.position.y = 0.2;
      g.add(base);
      const disc = S.makePortalDisc(2.15, c1, c2);
      disc.mesh.position.y = 2.4;
      g.add(disc.mesh);
      g.position.set(x, y, z);
      g.rotation.y = Math.atan2(faceX - x, faceZ - z);
      w.root.add(g);
      w.fx.lights.statics.push({ x, y: y + 2.4, z, color: new THREE.Color("#7fe7ff"), intensity: 14, range: 20, flicker: 0.2, seed: x });
      return { g, disc };
    };
    const a = mk(A.x, ay, A.z, A.x + 10, A.z + 10, "#7fe7ff", "#6a5cff");
    const bx = w.islandY ? SITES.islandCenter.x + 12 : 0;
    const bz = SITES.islandCenter.z;
    const b = mk(bx, iy, bz, SITES.islandCenter.x, SITES.islandCenter.z, "#7fe7ff", "#6a5cff");
    // beam from A up to the island
    const beam = S.makeBeam("#7fe7ff", 1.6, 80, true);
    beam.mesh.position.set(A.x, ay, A.z);
    beam.uni.uOpacity.value = 0.5;
    w.root.add(beam.mesh);
    // dest points are 3.5m in front of each portal
    const front = (g: THREE.Group, d: number) => new THREE.Vector3(g.position.x + Math.sin(g.rotation.y) * d, g.position.y, g.position.z + Math.cos(g.rotation.y) * d);
    this.portals.push({ pos: new THREE.Vector3(A.x, ay, A.z), dest: front(b.g, 4), disc: a.disc, group: a.g });
    this.portals.push({ pos: new THREE.Vector3(bx, iy, bz), dest: front(a.g, 4), disc: b.disc, group: b.g });
    // island shard cluster & chest
    this.islandChestPos = new THREE.Vector3(SITES.islandCenter.x - 8, iy, SITES.islandCenter.z + 6);
  }
  islandChestPos = new THREE.Vector3();

  buildChests() {
    const w = this.w;
    const cave = SITES.cave;
    const ic = SITES.islandCenter;
    const defs: [string, number, number, number, number, number][] = [
      ["cave", cave.x + 23, cave.z, siteH.cave + 0.25, Math.PI / 2, 6],
      ["island", this.islandChestPos.x, this.islandChestPos.z, this.islandChestPos.y, 0.5, 6],
      ["ice", SITES.iceTemple.x + 2, SITES.iceTemple.z + 3, siteH.iceTemple + 0.65, 0, 5],
      ["tree", SITES.bigTree.x + 6, SITES.bigTree.z - 6, siteH.bigTree, 2, 4],
      ["colossus", SITES.colossus.x + 6, SITES.colossus.z - 22, groundH(SITES.colossus.x + 6, SITES.colossus.z - 22), 1, 4],
      ["pond", -255 + 22, 62 + 12, groundH(-233, 74), 4, 4],
    ];
    void ic;
    defs.forEach(([id, x, z, y, rot, shards], i) => {
      const pre = S.makeChest();
      pre.group.position.set(x, y, z);
      pre.group.rotation.y = rot;
      w.root.add(pre.group);
      pre.setPower(0.4);
      w.fx.lights.statics.push({ x, y: y + 1.2, z, color: new THREE.Color("#ffd98a"), intensity: 5, range: 8, flicker: 0.2, seed: i });
      const ch: Chest = { id: "ch" + id, pos: new THREE.Vector3(x, y, z), pre, open: false, t: 0, shards };
      this.chests.push(ch);
      this.interacts.push({
        id: ch.id,
        pos: ch.pos,
        r: 3,
        prompt: () => (ch.open ? null : "Sandığı Aç"),
        use: () => this.openChest(ch),
      });
      w.colliders.add({ kind: 0, x, z, r: 0.8, hw: 0, hd: 0, c: 1, s: 0, y0: y - 1, y1: y + 0.8, enabled: true });
    });
  }

  openChest(ch: Chest, silent = false) {
    if (ch.open) return;
    ch.open = true;
    this.chestsOpened++;
    ch.pre.setPower(2.5);
    if (silent) {
      ch.t = 1;
      return;
    }
    const w = this.w;
    w.ev.sfx("chest");
    w.fx.glow.burst(ch.pos.x, ch.pos.y + 1, ch.pos.z, 40, 6, 1, 1, 2, 1.7, 0.7, 2, 1);
    w.fx.lights.flash(ch.pos.x, ch.pos.y + 1.5, ch.pos.z, "#ffd98a", 80, 18, 1);
    for (let i = 0; i < ch.shards; i++) {
      const a = (i / ch.shards) * 6.28;
      this.spawnPickup(0, ch.pos.x, ch.pos.y + 1.2, ch.pos.z, Math.cos(a) * 3.5, 7 + Math.random() * 2, Math.sin(a) * 3.5, -1);
    }
    this.spawnPickup(1, ch.pos.x, ch.pos.y + 1.2, ch.pos.z, 1, 8, 1, -1);
    w.ev.toast("Hazine sandığı açıldı!", "shard", `+${ch.shards} Eter Özü`);
  }

  // ---------------- physics props ----------------
  addBody(kind: BodyKind, x: number, z: number, y?: number): Body {
    const w = this.w;
    let mesh: THREE.Mesh;
    let r = 0.6;
    let mass = 1;
    let breakable = true;
    switch (kind) {
      case "crate":
        mesh = new THREE.Mesh(S.propGeo.crate, S.propMat.crate);
        r = 0.62;
        mass = 1.2;
        break;
      case "barrel":
        mesh = new THREE.Mesh(S.propGeo.barrel, S.propMat.barrel);
        r = 0.5;
        mass = 1.4;
        break;
      case "pot":
        mesh = new THREE.Mesh(S.propGeo.pot, S.propMat.pot);
        r = 0.4;
        mass = 0.6;
        break;
      default:
        mesh = new THREE.Mesh(S.propGeo.boulder, S.propMat.boulder);
        r = 1.35;
        mass = 9;
        breakable = false;
        mesh.scale.setScalar(r);
    }
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const gy = y ?? groundH(x, z);
    const b: Body = {
      kind,
      mesh,
      pos: new THREE.Vector3(x, gy + (kind === "pot" ? 0 : r), z),
      vel: new THREE.Vector3(),
      r,
      mass,
      breakable,
      dead: false,
      loot: kind === "boulder" ? 0 : kind === "pot" ? 1 : 2,
      sleep: false,
      spin: 0,
      grounded: false,
      home: new THREE.Vector3(x, gy, z),
    };
    if (kind === "pot") b.pos.y = gy;
    mesh.position.copy(b.pos);
    mesh.rotation.y = Math.random() * 6.28;
    w.root.add(mesh);
    this.bodies.push(b);
    return b;
  }

  buildProps() {
    const rng = mulberry32(1234);
    // camp loot
    for (const c of CAMPS) {
      const n = 4 + Math.floor(rng() * 3);
      for (let i = 0; i < n; i++) {
        const a = rng() * 6.28;
        const r = 3 + rng() * 5;
        const k = rng() < 0.45 ? "crate" : rng() < 0.7 ? "barrel" : "pot";
        this.addBody(k as BodyKind, c.x + Math.cos(a) * r, c.z + Math.sin(a) * r);
      }
    }
    // spawn area intro props (immediate fun)
    const sp = SITES.spawn;
    const intro: [number, number, BodyKind][] = [
      [sp.x + 7, sp.z - 12, "crate"],
      [sp.x + 8.2, sp.z - 12.3, "crate"],
      [sp.x + 7.6, sp.z - 13.4, "barrel"],
      [sp.x - 6, sp.z - 11, "pot"],
      [sp.x - 7.2, sp.z - 11.5, "pot"],
      [sp.x - 5.5, sp.z - 12.8, "crate"],
      [sp.x + 2, sp.z - 15, "barrel"],
      [sp.x - 2, sp.z - 16, "crate"],
    ];
    intro.forEach(([x, z, k]) => this.addBody(k, x, z));
    // rolling boulders on hills
    const hills: [number, number][] = [
      [60, 120],
      [-40, 110],
      [90, 260],
      [-20, 190],
      [170, -20],
      [230, -90],
      [-170, 40],
    ];
    for (const [x, z] of hills) {
      const b = this.addBody("boulder", x, z);
      b.r = 1.1;
      b.mesh.scale.setScalar(1.1);
      b.mass = 6;
      b.pos.y = groundH(x, z) + 1.1;
    }
    // city houses props
    for (let i = 0; i < 14; i++) {
      const a = rng() * 6.28;
      const r = 36 + rng() * 14;
      this.addBody(rng() < 0.5 ? "pot" : "crate", Math.cos(a) * r, Math.sin(a) * r, 12.5);
    }
    // pots near shrines
    for (const s of this.shrines) {
      for (let i = 0; i < 3; i++) {
        const a = i * 2.1 + 0.5;
        this.addBody("pot", s.pos.x + Math.cos(a) * 4, s.pos.z + Math.sin(a) * 4);
      }
    }
    // cave pots
    const cv = SITES.cave;
    for (let i = 0; i < 6; i++) this.addBody("pot", cv.x + 8 + i * 2.8, cv.z + (i % 2 ? 3.2 : -3.2), siteH.cave + 0.25);
  }

  breakBody(b: Body) {
    if (b.dead) return;
    b.dead = true;
    b.mesh.visible = false;
    const w = this.w;
    const col = b.kind === "pot" ? new THREE.Color("#b0643c") : new THREE.Color("#8a6642");
    w.fx.debris.burst(b.pos.x, b.pos.y + 0.2, b.pos.z, b.kind === "pot" ? 9 : 10, 5, b.kind === "pot" ? 0.18 : 0.25, col, 3);
    w.fx.smoke.burst(b.pos.x, b.pos.y + 0.3, b.pos.z, 8, 2.5, 0.9, 1.2, 0.5, 0.42, 0.34, 0, 2, 1);
    w.ev.sfx("breakObj");
    // loot
    for (let i = 0; i < b.loot; i++) {
      const t = Math.random();
      const type = t < 0.34 ? 0 : t < 0.68 ? 1 : 2;
      this.spawnPickup(type, b.pos.x, b.pos.y + 0.4, b.pos.z, (Math.random() - 0.5) * 5, 5 + Math.random() * 3, (Math.random() - 0.5) * 5, -1);
    }
  }

  updateBodies(dt: number, P: { pos: THREE.Vector3 }) {
    const w = this.w;
    const g = 24;
    const list = this.bodies;
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (b.dead) continue;
      const dx = b.pos.x - P.pos.x;
      const dz = b.pos.z - P.pos.z;
      if (dx * dx + dz * dz > 14400 && b.sleep) continue;
      if (b.sleep) {
        // wake check handled by impulses
        continue;
      }
      b.vel.y -= g * dt;
      b.pos.addScaledVector(b.vel, dt);
      // water
      const wl = waterLevelAt(b.pos.x, b.pos.z);
      if (wl > -1e8 && b.pos.y - b.r < wl) {
        const sub = wl - (b.pos.y - b.r);
        if (b.kind === "boulder") {
          b.vel.multiplyScalar(Math.exp(-3 * dt));
        } else {
          b.vel.y += sub * 40 * dt;
          b.vel.multiplyScalar(Math.exp(-2.2 * dt));
          b.vel.x += Math.sin(w.time * 0.7 + b.home.x) * 0.2 * dt;
        }
        if (b.vel.y < -3 && Math.random() < 0.5) w.ev.sfx("splash");
      }
      const wasGrounded = b.grounded;
      const gy = standHeight(w.colliders, b.pos.x, b.pos.z, b.pos.y - b.r, 0.25);
      const bottom = b.kind === "pot" ? b.pos.y : b.pos.y - b.r;
      const off = b.kind === "pot" ? 0 : b.r;
      b.grounded = false;
      if (bottom < gy) {
        b.pos.y = gy + off;
        const n = groundN(b.pos.x, b.pos.z);
        const vn = b.vel.dot(n);
        if (vn < 0) {
          const impact = -vn;
          const e = b.kind === "boulder" ? 0.12 : 0.25;
          b.vel.addScaledVector(n, -vn * (1 + e));
          if (impact > 8 && b.breakable) {
            this.breakBody(b);
            continue;
          }
          if (impact > 4 && !wasGrounded) w.ev.sfx("thud", impact);
        }
        b.grounded = true;
        // slope acceleration
        b.vel.x += n.x * g * 0.0;
        // gravity along slope (since normal removed): apply tangent gravity
        const tx = -n.x * n.y;
        const tz = -n.z * n.y;
        b.vel.x += tx * g * dt * (b.kind === "boulder" ? 1.0 : 0.6);
        b.vel.z += tz * g * dt * (b.kind === "boulder" ? 1.0 : 0.6);
        const fr = b.kind === "boulder" ? 0.35 : b.kind === "barrel" ? 2.0 : 4.5;
        const f = Math.exp(-fr * dt);
        b.vel.x *= f;
        b.vel.z *= f;
        // rolling rotation
        const sp = Math.hypot(b.vel.x, b.vel.z);
        if (b.kind === "boulder" && sp > 0.05) {
          const axis = new THREE.Vector3(b.vel.z, 0, -b.vel.x).normalize();
          b.mesh.rotateOnWorldAxis(axis, (sp / b.r) * dt);
        } else if (sp > 0.3) {
          b.mesh.rotation.y += b.spin * dt;
        }
        b.spin *= Math.exp(-3 * dt);
        if (sp < 0.12 && n.y > 0.9 && Math.abs(b.vel.y) < 0.5) {
          b.vel.set(0, 0, 0);
          b.sleep = true;
        }
      }
      // static collisions
      const hit = pushOut(w.colliders, b.pos, b.r * 0.9, b.r * 2, 0.3, b.vel);
      if (hit && b.kind !== "boulder") b.spin += (Math.random() - 0.5) * 4;
      // body-body
      for (let j = i + 1; j < list.length; j++) {
        const o = list[j];
        if (o.dead) continue;
        const ddx = o.pos.x - b.pos.x;
        const ddz = o.pos.z - b.pos.z;
        const min = (b.r + o.r) * 0.95;
        if (ddx * ddx + ddz * ddz < min * min && Math.abs(o.pos.y - b.pos.y) < min) {
          const d = Math.hypot(ddx, ddz) || 0.001;
          const nx = ddx / d;
          const nz = ddz / d;
          const ov = min - d;
          const tm = b.mass + o.mass;
          b.pos.x -= nx * ov * (o.mass / tm);
          b.pos.z -= nz * ov * (o.mass / tm);
          o.pos.x += nx * ov * (b.mass / tm);
          o.pos.z += nz * ov * (b.mass / tm);
          const rv = (o.vel.x - b.vel.x) * nx + (o.vel.z - b.vel.z) * nz;
          if (rv < 0) {
            const imp = -rv * 1.2;
            b.vel.x -= nx * imp * (o.mass / tm);
            b.vel.z -= nz * imp * (o.mass / tm);
            o.vel.x += nx * imp * (b.mass / tm);
            o.vel.z += nz * imp * (b.mass / tm);
            if (o.sleep) o.sleep = false;
            if (-rv > 6) {
              if (b.breakable && b.kind !== "boulder") this.breakBody(b);
              if (o.breakable) this.breakBody(o);
            }
          }
        }
      }
      b.mesh.position.copy(b.pos);
      if (b.kind === "pot") b.mesh.position.y = b.pos.y;
    }
  }

  pushPlayer(pos: THREE.Vector3, vel: THREE.Vector3, radius: number) {
    for (const b of this.bodies) {
      if (b.dead) continue;
      const dx = b.pos.x - pos.x;
      const dz = b.pos.z - pos.z;
      const min = b.r + radius;
      if (dx * dx + dz * dz > min * min) continue;
      const bottomY = b.kind === "pot" ? b.pos.y : b.pos.y - b.r;
      const topY = b.kind === "pot" ? b.pos.y + 0.85 : b.pos.y + b.r;
      if (pos.y > topY - 0.1 || pos.y + 1.7 < bottomY) continue;
      const d = Math.hypot(dx, dz) || 0.001;
      const nx = dx / d;
      const nz = dz / d;
      const ov = min - d;
      const heavy = b.kind === "boulder";
      const pushed = ov * (heavy ? 0.35 : 0.8);
      b.pos.x += nx * pushed;
      b.pos.z += nz * pushed;
      pos.x -= nx * (ov - pushed);
      pos.z -= nz * (ov - pushed);
      const vp = vel.x * nx + vel.z * nz;
      if (vp > 0) {
        b.vel.x += nx * vp * (heavy ? 0.5 : 1.0) / Math.max(1, b.mass * 0.35);
        b.vel.z += nz * vp * (heavy ? 0.5 : 1.0) / Math.max(1, b.mass * 0.35);
        vel.x -= nx * vp * (heavy ? 0.55 : 0.2);
        vel.z -= nz * vp * (heavy ? 0.55 : 0.2);
        b.sleep = false;
        b.spin += (Math.random() - 0.5) * 2;
      }
    }
  }

  // ---------------- enemies ----------------
  buildEnemies() {
    let id = 0;
    CAMPS.forEach((c, ci) => {
      const tint = REGION_TINT[c.region];
      const n = ci === 0 ? 2 : 3;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * 6.28 + ci;
        const e = new Enemy("wraith", c.x + Math.cos(a) * 4, c.z + Math.sin(a) * 4, tint, id++, c.region);
        this.addEnemy(e);
      }
    });
    // golems
    const g1 = new Enemy("golem", SITES.canyonObelisk.x + 8, SITES.canyonObelisk.z + 8, "#ff7a30", id++, 2);
    g1.guardian = true;
    g1.home.set(SITES.canyonObelisk.x, 0, SITES.canyonObelisk.z + 10);
    this.guardian = g1;
    this.addEnemy(g1);
    this.addEnemy(new Enemy("golem", -26, -34, "#ffd98a", id++, 1));
    this.addEnemy(new Enemy("golem", SITES.iceTemple.x - 14, SITES.iceTemple.z + 6, "#8fe0ff", id++, 4));
    this.addEnemy(new Enemy("golem", -230, -40, "#ff7ad9", id++, 3));
  }

  addEnemy(e: Enemy) {
    this.enemies.push(e);
    this.w.root.add(e.group);
  }

  enemyCenterY(e: Enemy) {
    return e.pos.y + (e.type === "golem" ? 2.8 : 0.9);
  }

  onEnemyKilled(e: Enemy) {
    const w = this.w;
    this.kills++;
    w.ev.killed(e.type);
    const n = e.type === "golem" ? 5 : 0;
    for (let i = 0; i < n; i++) this.spawnPickup(0, e.pos.x, e.pos.y + 2, e.pos.z, (Math.random() - 0.5) * 8, 7 + Math.random() * 3, (Math.random() - 0.5) * 8, -1);
    const drops = e.type === "golem" ? 3 : 1 + (Math.random() < 0.4 ? 1 : 0);
    for (let i = 0; i < drops; i++)
      this.spawnPickup(Math.random() < 0.5 ? 1 : 2, e.pos.x, e.pos.y + 1, e.pos.z, (Math.random() - 0.5) * 4, 5 + Math.random() * 2, (Math.random() - 0.5) * 4, -1);
    if (e.guardian) w.ev.toast("Taş Bekçi yıkıldı!", "quest", "Obelisk artık uyandırılabilir");
  }

  // ---------------- shards ----------------
  buildShards() {
    const w = this.w;
    const rng = mulberry32(4242);
    let id = 0;
    const add = (x: number, y: number, z: number) => {
      this.shardList.push({ id: id++, x, y, z });
    };
    const nrm = new THREE.Vector3();
    const wt = new Float32Array(5);
    const scatter = (region: number, n: number, minDist = 28) => {
      const R = REGIONS[region];
      const mine: [number, number][] = [];
      let tries = 0;
      while (mine.length < n && tries++ < 800) {
        const a = rng() * 6.28;
        const r = Math.sqrt(rng()) * R.r * 0.85;
        const x = R.cx + Math.cos(a) * r;
        const z = R.cz + Math.sin(a) * r;
        if (Math.hypot(x, z) > 300) continue;
        weights(x, z, wt);
        if (wt[region] < 0.5) continue;
        const h = groundH(x, z);
        if (waterLevelAt(x, z) > h - 0.3 || waterLevelAt(x, z, "lava") > h - 2) continue;
        if (groundN(x, z, nrm).y < 0.85) continue;
        if (w.colliders.get(x, z)?.some((c) => c.enabled && Math.hypot(c.x - x, c.z - z) < (c.kind === 0 ? c.r : Math.max(c.hw, c.hd)) + 1.2)) continue;
        if (mine.some(([mx, mz]) => Math.hypot(mx - x, mz - z) < minDist)) continue;
        mine.push([x, z]);
        add(x, h + 1.2, z);
      }
    };
    scatter(0, 9);
    scatter(1, 5, 20);
    scatter(2, 8);
    scatter(3, 8);
    scatter(4, 7);
    // landmark shards
    const sp = SITES.spawn;
    add(sp.x + 4, groundH(sp.x + 4, sp.z - 3) + 1.3, sp.z - 3);
    add(sp.x - 4, groundH(sp.x - 4, sp.z - 3) + 1.3, sp.z - 3);
    add(sp.x, groundH(sp.x, sp.z - 9) + 1.3, sp.z - 9);
    const bt = SITES.bigTree;
    for (let i = 0; i < 3; i++) add(bt.x + Math.cos(i * 2.1) * 9, groundH(bt.x + Math.cos(i * 2.1) * 9, bt.z + Math.sin(i * 2.1) * 9) + 1.3, bt.z + Math.sin(i * 2.1) * 9);
    // lake (water surface)
    for (let i = 0; i < 4; i++) {
      const a = i * 1.6;
      add(-105 + Math.cos(a) * 17, 3.7, 205 + Math.sin(a) * 17);
    }
    // sunken temple island ring
    add(-105, 4.2, 205);
    // city temple
    const cy = siteH.city + 2.8;
    for (let i = 0; i < 6; i++) add(Math.cos(i * 1.047) * 14, cy, Math.sin(i * 1.047) * 14);
    for (let i = 0; i < 3; i++) add(Math.cos(i * 2.1 + 0.4) * 31, siteH.city + 2.6, Math.sin(i * 2.1 + 0.4) * 31);
    // canyon: colossus lap & arch
    const co = SITES.colossus;
    const ca = Math.PI * 0.85;
    // knee top (local (5.5,..,6) => rotate)
    const kx = co.x + Math.sin(ca) * 0 + (5.5 * Math.cos(ca) + 8 * Math.sin(ca));
    const kz = co.z + (-5.5 * Math.sin(ca) + 8 * Math.cos(ca));
    add(kx, siteH.colossus - 1 + 11.8 + 1.2, kz);
    const ar = SITES.arch;
    add(ar.x, siteH.arch + 1.3, ar.z);
    add(ar.x + 5, groundH(ar.x + 5, ar.z + 6) + 1.3, ar.z + 6);
    // crystal pond
    for (let i = 0; i < 3; i++) add(-255 + Math.cos(i * 2.1) * 10, groundH(-255, 62) + 0.8, 62 + Math.sin(i * 2.1) * 10);
    // ice temple
    const it = SITES.iceTemple;
    for (let i = 0; i < 3; i++) add(it.x + Math.cos(i * 2.1) * 6, siteH.iceTemple + 1.9, it.z + Math.sin(i * 2.1) * 6);
    // island
    const ic = SITES.islandCenter;
    const iy = w.islandY + 1.1;
    for (let i = 0; i < 7; i++) add(ic.x + Math.cos(i * 0.9) * 13, iy + 1.4, ic.z + Math.sin(i * 0.9) * 13);
    // cave interior
    const cv = SITES.cave;
    for (let i = 0; i < 6; i++) add(cv.x + 7 + i * 3.2, siteH.cave + 1.4, cv.z + (i % 2 ? 2 : -2));
    // peaks: highest reachable points in snow
    let best: [number, number, number][] = [];
    for (let k = 0; k < 400; k++) {
      const a = rng() * 6.28;
      const r = 40 + rng() * 110;
      const x = REGIONS[4].cx + Math.cos(a) * r;
      const z = REGIONS[4].cz + Math.sin(a) * r;
      if (Math.hypot(x, z) > 290) continue;
      const h = groundH(x, z);
      if (groundN(x, z, nrm).y < 0.8) continue;
      best.push([x, z, h]);
    }
    best.sort((a, b) => b[2] - a[2]);
    const chosen: [number, number, number][] = [];
    for (const b of best) {
      if (chosen.length >= 4) break;
      if (chosen.every((c) => Math.hypot(c[0] - b[0], c[1] - b[1]) > 40)) chosen.push(b);
    }
    chosen.forEach((c) => add(c[0], c[2] + 1.3, c[1]));
  }

  spawnPickup(type: number, x: number, y: number, z: number, vx: number, vy: number, vz: number, id: number) {
    let slot = -1;
    for (let i = 0; i < this.pickups.length; i++) {
      if (!this.pickups[i].active) {
        slot = i;
        break;
      }
    }
    if (slot < 0) slot = Math.floor(Math.random() * this.pickups.length);
    const p = this.pickups[slot];
    p.active = true;
    p.type = type;
    p.id = id;
    p.x = x;
    p.y = y;
    p.z = z;
    p.vx = vx;
    p.vy = vy;
    p.vz = vz;
    p.dyn = id < 0;
    p.ttl = id < 0 ? 60 : 1e9;
    p.grounded = false;
    p.restY = y;
  }

  updatePickups(dt: number, P: { pos: THREE.Vector3; alive: boolean }) {
    const w = this.w;
    const dummy = new THREE.Object3D();
    const col = new THREE.Color();
    const shardCol = [new THREE.Color(0.35, 0.95, 1.0), new THREE.Color(0.3, 1.0, 0.45), new THREE.Color(0.65, 0.5, 1.0)];
    // activate world shards near the player lazily (streaming)
    this.sparkleT -= dt;
    for (let i = 0; i < this.pickups.length; i++) {
      const p = this.pickups[i];
      if (!p.active) continue;
      p.bob += dt;
      if (p.dyn) {
        p.ttl -= dt;
        if (p.ttl <= 0) {
          p.active = false;
        } else if (!p.grounded) {
          p.vy -= 22 * dt;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.z += p.vz * dt;
          const gy = groundH(p.x, p.z) + 0.7;
          if (p.y < gy) {
            p.y = gy;
            p.vy *= -0.4;
            p.vx *= 0.6;
            p.vz *= 0.6;
            if (Math.abs(p.vy) < 1.5) {
              p.grounded = true;
              p.restY = gy;
            }
          }
        }
      }
      const baseY = p.dyn ? (p.grounded ? p.restY : p.y) : p.y;
      const dx = P.pos.x - p.x;
      const dy = P.pos.y + 1 - baseY;
      const dz = P.pos.z - p.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      const magnet = p.dyn ? 36 : 16;
      if (P.alive && d2 < magnet) {
        const d = Math.sqrt(d2);
        const sp = (1 - d / Math.sqrt(magnet)) * 22 + 5;
        p.x += (dx / d) * sp * dt;
        p.z += (dz / d) * sp * dt;
        p.y += (dy / d) * sp * dt;
        p.grounded = false;
        p.vy = 0;
        p.restY = p.y;
        if (!p.dyn) p.dyn = true;
        if (d < 1.3) {
          p.active = false;
          if (p.id >= 0) this.collected.add(p.id);
          w.ev.pickup(p.type);
          w.fx.glow.burst(p.x, p.y, p.z, 14, 4, 0.6, 0.8, ...c3(shardCol[p.type].clone().multiplyScalar(2)), 0, 2);
        }
      }
      const sc = p.type === 0 ? 1.0 : 0.75;
      const y = (p.dyn && !p.grounded ? p.y : p.dyn ? p.restY + Math.sin(p.bob * 3) * 0.12 : p.y + Math.sin(p.bob * 2 + i) * 0.18) ;
      dummy.position.set(p.x, y, p.z);
      dummy.rotation.set(0, p.bob * 2, 0);
      dummy.scale.set(sc, sc * 1.5, sc);
      dummy.updateMatrix();
      this.pickMesh.setMatrixAt(i, dummy.matrix);
      col.copy(shardCol[p.type]);
      this.pickMesh.setColorAt(i, col);
    }
    for (let i = 0; i < this.pickups.length; i++) {
      if (!this.pickups[i].active) {
        dummy.scale.setScalar(0);
        dummy.updateMatrix();
        this.pickMesh.setMatrixAt(i, dummy.matrix);
      }
    }
    this.pickMesh.instanceMatrix.needsUpdate = true;
    if (this.pickMesh.instanceColor) this.pickMesh.instanceColor.needsUpdate = true;
  }

  // world shards are streamed: spawn pickups for those within range, remove beyond
  worldShardActive = new Map<number, number>();
  streamShards(P: { pos: THREE.Vector3 }) {
    for (const s of this.shardList) {
      if (this.collected.has(s.id)) continue;
      const dx = s.x - P.pos.x;
      const dz = s.z - P.pos.z;
      const near = dx * dx + dz * dz < 220 * 220 && Math.abs(s.y - P.pos.y) < 120;
      const slot = this.worldShardActive.get(s.id);
      if (near && slot === undefined) {
        this.spawnPickup(0, s.x, s.y, s.z, 0, 0, 0, s.id);
        // find slot used
        for (let i = 0; i < this.pickups.length; i++) {
          const p = this.pickups[i];
          if (p.active && p.id === s.id) {
            this.worldShardActive.set(s.id, i);
            p.dyn = false;
          }
        }
      } else if (!near && slot !== undefined) {
        const p = this.pickups[slot];
        if (p.id === s.id) p.active = false;
        this.worldShardActive.delete(s.id);
      } else if (slot !== undefined) {
        const p = this.pickups[slot];
        if (!p.active || p.id !== s.id) this.worldShardActive.delete(s.id);
      }
    }
  }

  // ---------------- discoveries ----------------
  buildDiscoveries() {
    const w = this.w;
    const ic = SITES.islandCenter;
    const defs: [string, string, number, number, number, number?][] = [
      ["Kadim Taş Çemberi", "Yolculuğun burada başlıyor", SITES.spawn.x, SITES.spawn.z, 15],
      ["Kadim Meşe", "Bin yıllık dev ağaç", SITES.bigTree.x, SITES.bigTree.z, 28],
      ["Ayna Gölü", "Durgun sular gökyüzünü yansıtır", -105, 205, 34],
      ["Batık Tapınak", "Suyun altında unutulmuş sütunlar", -105, 205, 14],
      ["Fısıldayan Mağara", "Kapısı bir rünle mühürlü", SITES.cave.x - 4, SITES.cave.z, 14],
      ["Terk Edilmiş Kamp", "Gölgeler burada nöbet tutuyor", 62, 208, 14],
      ["Antik Kemer", "Işıkla dolu bir geçit", 40, 175, 10],
      ["Eterya Surları", "Unutulmuş şehrin kapısı", 0, 62, 16],
      ["Gök Kule", "Gökyüzünü delen eski bir işaret", 0, 0, 24],
      ["Eterya Kapısı", "Dört obelisk bu kapıyı açar", SITES.gate.x, SITES.gate.z + 10, 16],
      ["Çöl Devi", "Yarı gömülü taş bir dev", SITES.colossus.x, SITES.colossus.z, 28],
      ["Güneş Kemeri", "Kızıl kayadan doğal bir kemer", SITES.arch.x, SITES.arch.z, 26],
      ["Lav Gölü", "Yerin altındaki ateş yüzeye çıkıyor", 255, 78, 38],
      ["Dev Kristaller", "Vadinin şarkısı buradan yükseliyor", -225, 30, 26],
      ["Parlayan Havuz", "Suyu kendi ışığıyla parlıyor", -255, 62, 24],
      ["Buz Tapınağı", "Donmuş sütunlar arasında bir sır", SITES.iceTemple.x, SITES.iceTemple.z, 22],
      ["Obelisk Çukuru", "Kadim kayalar yerini bekliyor", SITES.snowObelisk.x, SITES.snowObelisk.z, 24],
      ["Gizemli Işık Sütunu", "Gökyüzüne uzanan bir portal", SITES.portalA.x, SITES.portalA.z, 12],
      ["Gökyüzü Adası", "Sadece cesurlar buraya ulaşır", ic.x, ic.z, 30, w.islandY - 6],
      ["Yüzen Kale", "Bulutların üzerinde bir hayal", 150, -150, 80, 0],
    ];
    defs.forEach(([name, sub, x, z, r, yMin], i) => this.discoveries.push({ id: i, name, sub, x, z, r, yMin, found: false }));
  }

  // ---------------- combat hooks ----------------
  boltCollide(p: THREE.Vector3, r: number): string | null {
    for (const e of this.enemies) {
      if (e.dead || e.removed) continue;
      const dx = e.pos.x - p.x;
      const dz = e.pos.z - p.z;
      const dy = this.enemyCenterY(e) - p.y;
      const rr = e.radius + r + (e.type === "golem" ? 0.8 : 0);
      if (dx * dx + dz * dz + dy * dy * (e.type === "golem" ? 0.35 : 1) < rr * rr) return "enemy";
    }
    for (const b of this.bodies) {
      if (b.dead) continue;
      const dx = b.pos.x - p.x;
      const dy = b.pos.y - p.y;
      const dz = b.pos.z - p.z;
      if (dx * dx + dy * dy + dz * dz < (b.r + r) * (b.r + r)) return "body";
    }
    for (const ru of this.runes) {
      if (ru.pos.distanceTo(p) < ru.r + r) return "rune";
    }
    if (p.y < groundH(p.x, p.z)) return "world";
    if (pointHits(this.w.colliders, p.x, p.y, p.z)) return "world";
    return null;
  }

  impact(pos: THREE.Vector3, radius: number, kind: "bolt" | "wave" | "lightning") {
    const w = this.w;
    const dmg = kind === "bolt" ? 1 : kind === "wave" ? 2 : 4;
    const kb = kind === "bolt" ? 3 : kind === "wave" ? 15 : 9;
    let any = false;
    for (const e of this.enemies) {
      if (e.dead || e.removed) continue;
      const dx = e.pos.x - pos.x;
      const dz = e.pos.z - pos.z;
      const dy = this.enemyCenterY(e) - pos.y;
      const rr = radius + e.radius;
      const d2 = dx * dx + dz * dz + dy * dy * (kind === "wave" ? 0.15 : 0.7);
      if (d2 < rr * rr) {
        any = true;
        const mult = e.type === "golem" && kind === "lightning" ? 1.5 : 1;
        const killed = e.damage(dmg * mult, pos, kb, this.env);
        if (kind === "wave") e.stun(1.3);
        if (killed) this.onEnemyKilled(e);
      }
    }
    for (const b of this.bodies) {
      if (b.dead) continue;
      const dx = b.pos.x - pos.x;
      const dz = b.pos.z - pos.z;
      const dy = b.pos.y - pos.y;
      const d = Math.sqrt(dx * dx + dz * dz + dy * dy * 0.3);
      if (d > radius + b.r) continue;
      any = true;
      if (b.breakable && (kind !== "wave" || Math.random() < 0.8 || d < radius * 0.5)) {
        this.breakBody(b);
        continue;
      }
      const f = 1 - d / (radius + b.r);
      const mag = kind === "wave" ? 22 : kind === "lightning" ? 14 : 5;
      const dd = Math.hypot(dx, dz) || 0.001;
      b.vel.x += (dx / dd) * mag * f / Math.pow(b.mass, 0.7);
      b.vel.z += (dz / dd) * mag * f / Math.pow(b.mass, 0.7);
      b.vel.y += (kind === "wave" ? 8 : 4) * f / Math.pow(b.mass, 0.5);
      b.sleep = false;
      b.spin += (Math.random() - 0.5) * 8;
    }
    for (const ru of this.runes) {
      if (ru.active) continue;
      if (ru.pos.distanceTo(pos) > radius + ru.r) continue;
      const ok = ru.kind === "bolt" ? kind === "bolt" || kind === "lightning" : kind === "lightning";
      if (ok) {
        this.activateRune(ru);
        any = true;
      } else if (Math.random() < 0.3) {
        w.ev.toast(ru.kind === "lightning" ? "Bu kristal yalnızca Yıldırım'a tepki veriyor" : "Rün uyanmadı", "info");
      }
    }
    return any;
  }

  activateRune(ru: Rune) {
    const w = this.w;
    ru.active = true;
    w.ev.sfx("rune");
    w.ev.shake(0.3);
    const c = new THREE.Color(ru.color).multiplyScalar(2);
    w.fx.glow.burst(ru.pos.x, ru.pos.y, ru.pos.z, 40, 8, 1.2, 1, c.r, c.g, c.b, -1, 1);
    w.fx.rings.spawn(ru.pos.x, ru.pos.y - 1.8, ru.pos.z, 8, 0.8, ru.color, "flat", 0.1);
    w.fx.lights.flash(ru.pos.x, ru.pos.y, ru.pos.z, ru.color, 80, 22, 0.9);
    const tot = this.runes.filter((r) => r.group === ru.group).length;
    const act = this.runes.filter((r) => r.group === ru.group && r.active).length;
    if (ru.group !== "door") w.ev.toast(`Rün uyandı ${act}/${tot}`, "info");
    ru.onActivate?.();
  }

  // ---------------- interactions ----------------
  nearestInteract(pos: THREE.Vector3): Interact | null {
    let best: Interact | null = null;
    let bd = 1e9;
    for (const it of this.interacts) {
      const dx = it.pos.x - pos.x;
      const dz = it.pos.z - pos.z;
      const dy = it.pos.y - pos.y;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d > it.r || Math.abs(dy) > 6) continue;
      if (!it.prompt()) continue;
      if (d < bd) {
        bd = d;
        best = it;
      }
    }
    return best;
  }

  // ---------------- update ----------------
  update(dt: number, P: { pos: THREE.Vector3; vel: THREE.Vector3; grounded: boolean; cam: THREE.Vector3; alive: boolean; speed: number }) {
    const w = this.w;
    this.time += dt;
    this.playerRef.pos.copy(P.pos);
    this.env.alive = P.alive;
    this.env.grounded = P.grounded;
    this.env.time = this.time;
    this.updateBodies(dt, P);
    for (const e of this.enemies) {
      if (!e.removed) {
        const dx = e.pos.x - P.pos.x;
        const dz = e.pos.z - P.pos.z;
        if (dx * dx + dz * dz > 140 * 140 && e.state === "idle") continue;
      }
      e.update(dt, this.env);
    }
    // separation between wraiths
    for (let i = 0; i < this.enemies.length; i++) {
      const a = this.enemies[i];
      if (a.dead || a.removed) continue;
      const adx = a.pos.x - P.pos.x;
      const adz = a.pos.z - P.pos.z;
      if (adx * adx + adz * adz > 3600) continue;
      for (let j = i + 1; j < this.enemies.length; j++) {
        const b = this.enemies[j];
        if (b.dead || b.removed) continue;
        const dx = b.pos.x - a.pos.x;
        const dz = b.pos.z - a.pos.z;
        const min = a.radius + b.radius;
        const d2 = dx * dx + dz * dz;
        if (d2 < min * min && d2 > 0.0001) {
          const d = Math.sqrt(d2);
          const push = (min - d) * 0.5;
          a.pos.x -= (dx / d) * push;
          a.pos.z -= (dz / d) * push;
          b.pos.x += (dx / d) * push;
          b.pos.z += (dz / d) * push;
        }
      }
    }
    // guardian -> obelisk 1
    if (this.guardian && this.guardian.dead && this.obelisks[1].state === 0) this.obelisks[1].state = 1;
    // requirement checks
    for (const ob of this.obelisks) {
      if (ob.state === 0 && ob.i !== 1 && ob.req()) {
        ob.state = 1;
        w.ev.toast("Obelisk hazır!", "quest", `${ob.name} — [E] ile uyandır`);
        w.ev.sfx("rune");
      } else if (ob.state === 1 && ob.i === 1 && false) {
        /* noop */
      }
      const target = ob.state === 2 ? 1 : ob.state === 1 ? 0.55 + Math.sin(this.time * 3) * 0.15 : 0.08;
      ob.power = damp(ob.power, target, 3, dt);
      ob.pre.setPower(ob.power);
      ob.pre.gem.position.y = 12.5 + Math.sin(this.time * 1.5 + ob.i) * 0.3;
      ob.pre.gem.rotation.y += dt * (0.6 + ob.power * 1.5);
      ob.beam.uni.uOpacity.value = damp(ob.beam.uni.uOpacity.value, ob.state === 2 ? 0.55 : 0, 1.5, dt);
      ob.beam.uni.uTime.value = this.time;
      ob.beam.mesh.visible = ob.beam.uni.uOpacity.value > 0.01;
      ob.light.intensity = 10 + ob.power * 50;
    }
    // runes & pads
    for (const ru of this.runes) {
      ru.power = damp(ru.power, ru.active ? 1 : 0.12 + Math.sin(this.time * 2 + ru.pos.x) * 0.05, 4, dt);
      ru.p.setPower(ru.power);
    }
    for (const pad of this.pads) {
      let on = false;
      for (const b of this.bodies) {
        if (!b.puzzle || b.dead) continue;
        const dx = b.pos.x - pad.pos.x;
        const dz = b.pos.z - pad.pos.z;
        if (dx * dx + dz * dz < pad.r * pad.r && Math.abs(b.pos.y - b.r - pad.pos.y) < 0.9) on = true;
      }
      if (on && !pad.active) {
        pad.active = true;
        w.ev.sfx("rune");
        w.ev.shake(0.3);
        w.fx.glow.burst(pad.pos.x, pad.pos.y + 0.5, pad.pos.z, 30, 6, 1, 1, 0.8, 1.8, 2.2, -1, 1);
        w.fx.rings.spawn(pad.pos.x, pad.pos.y + 0.3, pad.pos.z, 7, 0.8, "#9fe8ff", "flat", 0.1);
        w.ev.toast(`Basınç plakası aktif ${this.pads.filter((p) => p.active).length}/2`, "info");
      }
      pad.power = damp(pad.power, pad.active ? 1.2 : 0.1, 4, dt);
      pad.p.setPower(pad.power);
      pad.mesh.position.y = damp(pad.mesh.position.y, pad.active ? 0.05 : 0.12, 6, dt);
      if (!this.plateHintShown && P.pos.distanceTo(this.obelisks[3].pos) < 30) {
        this.plateHintShown = true;
        w.ev.toast("Kadim Kayalar", "quest", "Kayaları it veya Titan Dalgası ile fırlatıp plakalara yerleştir");
      }
    }
    // door
    const d = this.door;
    if (d.open && d.t < 1) {
      d.t = Math.min(1, d.t + dt / 2.6);
      d.mesh.position.y = d.y0 + d.t * 7.2;
      if (d.t > 0.35) d.collider.enabled = false;
      if (Math.random() < dt * 20) w.fx.smoke.spawn(d.mesh.position.x - 0.6, d.y0 - 3, d.mesh.position.z + (Math.random() - 0.5) * 8, 0, 0.8, 0, 1.5, 1.2, 0.5, 0.45, 0.4, 0.4, 0, 1, 0.8);
    }
    // shrines
    for (const sh of this.shrines) {
      sh.power = damp(sh.power, sh.active ? 1.4 : 0.2 + Math.sin(this.time * 2 + sh.pos.x) * 0.05, 3, dt);
      sh.pre.setPower(sh.power);
      sh.pre.gem.position.y = 2.7 + Math.sin(this.time * 1.4 + sh.pos.x) * 0.15;
      sh.pre.gem.rotation.y += dt * (sh.active ? 1.2 : 0.4);
      sh.pre.halo.rotation.x += dt * 0.7;
      sh.pre.halo.rotation.y += dt * 0.5;
      sh.pre.halo.position.y = sh.pre.gem.position.y;
    }
    // chests
    for (const ch of this.chests) {
      if (ch.open && ch.t < 1) {
        ch.t = Math.min(1, ch.t + dt * 2.2);
        ch.pre.lid.rotation.x = -ch.t * 1.9;
      }
    }
    // gate
    const gt = this.gate;
    gt.power = damp(gt.power, gt.open ? 1 : 0.12 + this.runeCount * 0.12, 2, dt);
    gt.disc.uni.uPower.value = gt.power;
    gt.disc.uni.uTime.value = this.time;
    gt.disc.mesh.visible = gt.power > 0.05;
    gt.beam.uni.uOpacity.value = damp(gt.beam.uni.uOpacity.value, gt.open ? 0.5 : 0, 1.5, dt);
    gt.beam.uni.uTime.value = this.time;
    gt.beam.mesh.visible = gt.beam.uni.uOpacity.value > 0.01;
    if (gt.open && P.alive) {
      const dx = P.pos.x - gt.pos.x;
      const dz = P.pos.z - gt.pos.z;
      const dy = P.pos.y - gt.pos.y;
      if (Math.abs(dx) < 6 && Math.abs(dz) < 2.2 && dy > -0.5 && dy < 14) w.ev.victory();
    }
    if (gt.open && Math.random() < dt * 30) {
      const a = Math.random() * 6.28;
      w.fx.glow.spawn(gt.pos.x + Math.cos(a) * 7.5, gt.pos.y + 8.4 + Math.sin(a) * 7.5, gt.pos.z, 0, 0.5, 0, 1.5, 0.7, 0.6, 1.5, 2, 1, 0, 0.5);
    }
    // portals
    this.tpCooldown -= dt;
    for (const p of this.portals) {
      p.disc.uni.uTime.value = this.time;
      if (this.tpCooldown <= 0 && P.alive) {
        const dx = P.pos.x - p.pos.x;
        const dz = P.pos.z - p.pos.z;
        if (dx * dx + dz * dz < 2.4 * 2.4 && P.pos.y - p.pos.y > -0.5 && P.pos.y - p.pos.y < 4.5) {
          this.tpCooldown = 2.5;
          w.ev.teleport(p.dest.x, p.dest.y, p.dest.z);
        }
      }
    }
    // pickups
    this.streamShards(P);
    this.updatePickups(dt, P);
    // shard sparkles
    if (this.sparkleT <= 0) {
      this.sparkleT = 0.12;
      for (const [id, slot] of this.worldShardActive) {
        void id;
        const p = this.pickups[slot];
        if (!p || !p.active) continue;
        const dx = p.x - P.pos.x;
        const dz = p.z - P.pos.z;
        if (dx * dx + dz * dz > 50 * 50) continue;
        if (Math.random() < 0.35) w.fx.glow.spawn(p.x + (Math.random() - 0.5), p.y + (Math.random() - 0.3), p.z + (Math.random() - 0.5), 0, 0.6, 0, 1.0, 0.35, 0.5, 1.6, 2, 0.9, 0, 0);
      }
    }
    // discoveries
    for (const dsc of this.discoveries) {
      if (dsc.found) continue;
      const dx = P.pos.x - dsc.x;
      const dz = P.pos.z - dsc.z;
      if (dx * dx + dz * dz < dsc.r * dsc.r && (dsc.yMin === undefined || P.pos.y > dsc.yMin)) {
        dsc.found = true;
        w.ev.toast(`Keşfedildi: ${dsc.name}`, "discover", dsc.sub);
        w.ev.sfx("discover");
      }
    }
  }

  reset() {
    const w = this.w;
    this.collected.clear();
    this.worldShardActive.clear();
    for (const p of this.pickups) p.active = false;
    this.kills = 0;
    this.runeCount = 0;
    this.chestsOpened = 0;
    this.plateHintShown = false;
    this.chests.forEach((c) => {
      c.open = false;
      c.t = 0;
      c.pre.lid.rotation.x = 0;
      c.pre.setPower(0.4);
    });
    this.shrines.forEach((s) => (s.active = false));
    this.obelisks.forEach((o) => {
      o.state = 0;
      o.power = 0.08;
    });
    this.runes.forEach((r) => (r.active = false));
    this.pads.forEach((p) => (p.active = false));
    this.discoveries.forEach((d) => (d.found = false));
    this.door.open = false;
    this.door.t = 0;
    this.door.mesh.position.y = this.door.y0;
    this.door.collider.enabled = true;
    this.door.pm.uPow.value = 0.4;
    this.gate.open = false;
    this.gate.power = 0;
    this.bodies.forEach((b) => {
      b.dead = false;
      b.mesh.visible = true;
      b.pos.copy(b.home);
      b.pos.y += b.kind === "pot" ? 0 : b.r;
      b.vel.set(0, 0, 0);
      b.sleep = false;
    });
    this.enemies.forEach((e) => e.respawn());
    const sp = SITES.spawn;
    this.respawn.set(sp.x, groundH(sp.x, sp.z), sp.z + 6);
    void w;
  }

  // ---------------- state/objective ----------------
  objective(): { title: string; sub: string; target: THREE.Vector3 | null; targetName: string } {
    const n = this.obelisks.filter((o) => o.state === 2).length;
    if (this.gate.open) {
      return { title: "Eterya Kapısı'na gir", sub: "Dört obelisk uyandı — kapı seni bekliyor", target: this.gate.pos, targetName: "Eterya Kapısı" };
    }
    const ready = this.obelisks.find((o) => o.state === 1);
    if (ready) return { title: `${ready.name}'ni uyandır`, sub: `[E] ile obeliske dokun · ${n}/4`, target: ready.pos, targetName: ready.region };
    // closest unactivated
    const pl = this.playerRef.pos;
    let best: Obelisk | null = null;
    let bd = 1e9;
    for (const o of this.obelisks) {
      if (o.state !== 0) continue;
      const d = o.pos.distanceTo(pl);
      if (d < bd) {
        bd = d;
        best = o;
      }
    }
    if (!best) return { title: "Kapıya git", sub: "", target: this.gate.pos, targetName: "Eterya Kapısı" };
    return { title: `Kadim obeliskleri uyandır ${n}/4`, sub: `${best.region}: ${best.hint}`, target: best.pos, targetName: best.region };
  }

  getState() {
    return {
      collected: Array.from(this.collected),
      chests: this.chests.filter((c) => c.open).map((c) => c.id),
      shrines: this.shrines.filter((s) => s.active).map((s) => s.id),
      obelisks: this.obelisks.map((o) => o.state),
      discovered: this.discoveries.filter((d) => d.found).map((d) => d.id),
      door: this.door.open,
      runes: this.runes.filter((r) => r.active).map((_r, i) => i),
      kills: this.kills,
      respawn: [this.respawn.x, this.respawn.y, this.respawn.z],
    };
  }

  applyState(s: any) {
    if (!s) return;
    this.collected = new Set(s.collected || []);
    (s.chests || []).forEach((id: string) => {
      const c = this.chests.find((x) => x.id === id);
      if (c) {
        this.openChest(c, true);
        c.pre.lid.rotation.x = -1.9;
      }
    });
    (s.shrines || []).forEach((id: string) => {
      const sh = this.shrines.find((x) => x.id === id);
      if (sh) sh.active = true;
    });
    (s.obelisks || []).forEach((st: number, i: number) => {
      const o = this.obelisks[i];
      if (!o) return;
      o.state = st as 0 | 1 | 2;
      if (st === 2) {
        o.power = 1;
      }
    });
    // runes: re-activate puzzle runes for obelisks already done/ready
    this.obelisks.forEach((o) => {
      if (o.state >= 1) {
        const grp = o.i === 0 ? "o0" : o.i === 2 ? "o2" : "";
        this.runes.filter((r) => r.group === grp).forEach((r) => (r.active = true));
        if (o.i === 3) this.pads.forEach((p) => (p.active = true));
        if (o.i === 1 && this.guardian) {
          this.guardian.dead = true;
          this.guardian.removed = true;
          this.guardian.group.visible = false;
        }
      }
    });
    if (s.door) {
      this.door.open = true;
      this.door.t = 1;
      this.door.mesh.position.y = this.door.y0 + 7.2;
      this.door.collider.enabled = false;
      this.runes.filter((r) => r.group === "door").forEach((r) => (r.active = true));
    }
    (s.discovered || []).forEach((id: number) => {
      const d = this.discoveries.find((x) => x.id === id);
      if (d) d.found = true;
    });
    this.runeCount = this.obelisks.filter((o) => o.state === 2).length;
    if (this.runeCount === 4) {
      this.gate.open = true;
      this.gate.power = 1;
    }
    this.kills = s.kills || 0;
    if (s.respawn) this.respawn.set(s.respawn[0], s.respawn[1], s.respawn[2]);
    for (const [, slot] of this.worldShardActive) this.pickups[slot].active = false;
    this.worldShardActive.clear();
  }

  // ---------------- minimap markers ----------------
  drawMarkers(ctx: CanvasRenderingContext2D, scale: number, mode: "mini" | "full", px: number, pz: number) {
    const dot = (x: number, z: number, r: number, color: string, shape: "c" | "d" | "s" = "c", stroke = "#0a1020") => {
      ctx.save();
      ctx.translate(x * scale, z * scale);
      ctx.fillStyle = color;
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (shape === "c") ctx.arc(0, 0, r, 0, 6.3);
      else if (shape === "d") {
        ctx.moveTo(0, -r);
        ctx.lineTo(r, 0);
        ctx.lineTo(0, r);
        ctx.lineTo(-r, 0);
        ctx.closePath();
      } else ctx.rect(-r * 0.8, -r * 0.8, r * 1.6, r * 1.6);
      ctx.stroke();
      ctx.fill();
      ctx.restore();
    };
    const R = mode === "mini" ? 1 : 1.4;
    const pulse = 0.75 + Math.sin(this.time * 4) * 0.25;
    for (const sh of this.shrines) dot(sh.pos.x, sh.pos.z, 3.5 * R, sh.active ? "#7fe7ff" : "#4a6a7a", "s");
    for (const o of this.obelisks) dot(o.pos.x, o.pos.z, (5 + (o.state === 1 ? pulse * 2 : 0)) * R, o.state === 2 ? "#ffffff" : o.color, "d");
    dot(this.gate.pos.x, this.gate.pos.z, 5.5 * R, this.gate.open ? "#ffffff" : "#8a7a60", "d", this.gate.open ? "#7fe7ff" : "#0a1020");
    const ic = SITES.islandCenter;
    dot(ic.x, ic.z, 3 * R, "#7fe7ff", "c");
    dot(SITES.portalA.x, SITES.portalA.z, 3 * R, "#7fe7ff", "c");
    for (const c of this.chests) if (!c.open && this.discoveredNear(c.pos.x, c.pos.z, mode, px, pz)) dot(c.pos.x, c.pos.z, 3 * R, "#ffd98a", "s");
    if (mode === "mini" || true) {
      for (const [id] of this.worldShardActive) {
        const s = this.shardList[id];
        if (!s || this.collected.has(id)) continue;
        if (mode === "mini" && Math.hypot(s.x - px, s.z - pz) > 70) continue;
        dot(s.x, s.z, 2 * R, "#8ff3ff", "d", "rgba(0,0,0,0.3)");
      }
    }
    for (const e of this.enemies) {
      if (e.dead || e.removed) continue;
      if (Math.hypot(e.pos.x - px, e.pos.z - pz) > (mode === "mini" ? 70 : 60)) continue;
      dot(e.pos.x, e.pos.z, 2.6 * R, "#ff5a5a", "c", "rgba(0,0,0,0.5)");
    }
    // objective marker
    const ob = this.objective();
    if (ob.target) {
      ctx.save();
      let x = ob.target.x * scale;
      let z = ob.target.z * scale;
      if (mode === "mini") {
        const dx = ob.target.x - px;
        const dz = ob.target.z - pz;
        const d = Math.hypot(dx, dz);
        const lim = 78;
        if (d > lim) {
          x = (px + (dx / d) * lim) * scale;
          z = (pz + (dz / d) * lim) * scale;
        }
      }
      ctx.translate(x, z);
      ctx.strokeStyle = "#ffe9a8";
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.5 + pulse * 0.5;
      ctx.beginPath();
      ctx.arc(0, 0, 8 * R, 0, 6.3);
      ctx.stroke();
      ctx.restore();
    }
  }

  discoveredNear(x: number, z: number, mode: string, px: number, pz: number) {
    return mode === "full" ? Math.hypot(x - px, z - pz) < 400 : Math.hypot(x - px, z - pz) < 95;
  }
}

export { REGION_NAME, clamp, smoothstep, mats, HALF };
