import * as THREE from "three";
import { groundH, waterLevelAt } from "./terrain";
import { ColliderGrid } from "./geo";
import { U } from "./materials";
import { powerMat } from "./structures";
import { damp, clamp } from "./noise";

export interface EnemyEnv {
  player: THREE.Vector3;
  alive: boolean;
  grounded: boolean;
  time: number;
  colliders: ColliderGrid;
  hurtPlayer(dmg: number, from: THREE.Vector3, kb: number): void;
  shake(a: number): void;
  burst(x: number, y: number, z: number, color: THREE.Color, n: number, speed: number, size?: number): void;
  ring(x: number, y: number, z: number, r: number, color: THREE.ColorRepresentation): void;
  sfx(name: string): void;
}

const wraithMats = new Map<string, THREE.MeshStandardMaterial>();
function wraithMat(tint: string) {
  let m = wraithMats.get(tint);
  if (m) return m;
  m = new THREE.MeshStandardMaterial({
    color: new THREE.Color(tint).multiplyScalar(0.18),
    emissive: new THREE.Color(tint).multiplyScalar(0.35),
    roughness: 0.6,
    transparent: true,
    opacity: 0.88,
    side: THREE.DoubleSide,
  });
  m.onBeforeCompile = (s) => {
    s.uniforms.uTime = U.uTime;
    s.vertexShader = s.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uTime;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
         float tailK = clamp(1.0 - (position.y + 0.85)/1.7, 0.0, 1.0);
         transformed.x += sin(uTime*3.0 + position.y*5.0 + position.z*4.0) * 0.11 * tailK;
         transformed.z += cos(uTime*2.6 + position.y*4.0 + position.x*3.0) * 0.11 * tailK;`
      );
  };
  m.customProgramCacheKey = () => "wraith";
  wraithMats.set(tint, m);
  return m;
}

const eyeGeo = new THREE.SphereGeometry(0.06, 6, 5);
const bodyGeo = (() => {
  const g = new THREE.CylinderGeometry(0.2, 0.62, 1.7, 12, 6, true);
  g.translate(0, 0, 0);
  return g;
})();
const headGeo = new THREE.SphereGeometry(0.29, 12, 10);
const clawGeo = (() => {
  const g = new THREE.ConeGeometry(0.07, 0.85, 5);
  g.translate(0, -0.42, 0);
  return g;
})();

const wr_ = (e: Enemy) => e.type === "wraith";
export type EnemyType = "wraith" | "golem";

export class Enemy {
  type: EnemyType;
  group = new THREE.Group();
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  home = new THREE.Vector3();
  hp: number;
  maxHp: number;
  state = "idle";
  stateT = 0;
  cd = 0;
  yaw = 0;
  dead = false;
  removed = false;
  respawnT = 0;
  stunT = 0;
  hitFlash = 0;
  bob = Math.random() * 6;
  lungeDir = new THREE.Vector3();
  tint: THREE.Color;
  eyes: THREE.Mesh[] = [];
  arms: THREE.Object3D[] = [];
  legs: THREE.Object3D[] = [];
  powU?: { value: number };
  guardian = false;
  id: number;
  region: number;
  wanderT = 0;
  wander = new THREE.Vector3();
  stepT = 0;
  fadeIn = 0;
  radius: number;
  mats: THREE.MeshStandardMaterial[] = [];
  slamHit = false;
  dieT = 1;

  constructor(type: EnemyType, x: number, z: number, tint: string, id: number, region: number) {
    this.type = type;
    this.id = id;
    this.region = region;
    this.tint = new THREE.Color(tint);
    this.maxHp = type === "wraith" ? 3 : 16;
    this.hp = this.maxHp;
    this.radius = type === "wraith" ? 0.7 : 2.0;
    this.home.set(x, 0, z);
    this.pos.set(x, groundH(x, z), z);
    if (type === "wraith") this.buildWraith(tint);
    else this.buildGolem(tint);
    this.group.position.copy(this.pos);
  }

  private buildWraith(tint: string) {
    const m = wraithMat(tint);
    const body = new THREE.Mesh(bodyGeo, m);
    body.castShadow = false;
    this.group.add(body);
    const head = new THREE.Mesh(headGeo, m);
    head.position.y = 0.95;
    head.scale.set(1, 1.2, 1);
    this.group.add(head);
    const eyeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(tint).multiplyScalar(6) });
    for (const sx of [-1, 1]) {
      const e = new THREE.Mesh(eyeGeo, eyeMat);
      e.position.set(sx * 0.1, 0.98, 0.23);
      e.scale.set(1.4, 0.8, 1);
      this.group.add(e);
      this.eyes.push(e);
    }
    for (const sx of [-1, 1]) {
      const arm = new THREE.Group();
      arm.position.set(sx * 0.38, 0.55, 0.1);
      const c = new THREE.Mesh(clawGeo, m);
      arm.add(c);
      this.group.add(arm);
      this.arms.push(arm);
    }
    this.group.scale.setScalar(1.25);
    this.mats.push(m);
  }

  private buildGolem(tint: string) {
    const stone = new THREE.MeshStandardMaterial({ color: "#4a4540", roughness: 0.85, metalness: 0.1 });
    const pm = powerMat(tint, 5);
    pm.uPow.value = 1;
    this.powU = pm.uPow;
    const mk = (g: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => {
      const o = new THREE.Mesh(g, m);
      o.position.set(x, y, z);
      o.castShadow = true;
      return o;
    };
    const torso = mk(new THREE.BoxGeometry(2.4, 2.4, 1.6), stone, 0, 3.4, 0);
    this.group.add(torso);
    this.group.add(mk(new THREE.BoxGeometry(1.2, 1.0, 1.0), stone, 0, 5.2, 0.1));
    for (const sx of [-1, 1]) {
      const e = mk(new THREE.BoxGeometry(0.35, 0.12, 0.1), pm.m, sx * 0.3, 5.3, 0.62);
      this.group.add(e);
    }
    this.group.add(mk(new THREE.OctahedronGeometry(0.45, 0), pm.m, 0, 3.6, 0.85));
    for (let i = 0; i < 3; i++) this.group.add(mk(new THREE.BoxGeometry(2.0 - i * 0.3, 0.07, 0.07), pm.m, 0, 2.6 + i * 0.5, 0.82));
    for (const sx of [-1, 1]) {
      const arm = new THREE.Group();
      arm.position.set(sx * 1.6, 4.4, 0);
      arm.add(mk(new THREE.BoxGeometry(0.9, 2.6, 0.9), stone, 0, -1.3, 0));
      arm.add(mk(new THREE.BoxGeometry(1.3, 1.3, 1.3), stone, 0, -2.9, 0.1));
      arm.add(mk(new THREE.BoxGeometry(0.12, 1.6, 0.1), pm.m, 0.46 * sx, -1.4, 0.2));
      this.group.add(arm);
      this.arms.push(arm);
      const leg = new THREE.Group();
      leg.position.set(sx * 0.7, 2.3, 0);
      leg.add(mk(new THREE.BoxGeometry(1.0, 2.3, 1.0), stone, 0, -1.15, 0));
      leg.add(mk(new THREE.BoxGeometry(1.3, 0.4, 1.6), stone, 0, -2.3, 0.2));
      this.group.add(leg);
      this.legs.push(leg);
    }
    this.mats.push(stone);
  }

  damage(n: number, from: THREE.Vector3, kb: number, env: EnemyEnv): boolean {
    if (this.dead) return false;
    this.hp -= n;
    this.hitFlash = 0.18;
    env.sfx("enemyHurt");
    const dx = this.pos.x - from.x;
    const dz = this.pos.z - from.z;
    const l = Math.hypot(dx, dz) || 1;
    const k = this.type === "golem" ? kb * 0.12 : kb;
    this.vel.x += (dx / l) * k;
    this.vel.z += (dz / l) * k;
    env.burst(this.pos.x, this.pos.y + (this.type === "golem" ? 3 : 1), this.pos.z, this.tint, 10, 5);
    if (this.hp <= 0) {
      this.die(env);
      return true;
    }
    if (this.type === "wraith") {
      this.state = "stun";
      this.stateT = 0.45;
    }
    return false;
  }

  stun(t: number) {
    if (this.dead || this.type === "golem") return;
    this.state = "stun";
    this.stateT = Math.max(this.stateT, t);
  }

  die(env: EnemyEnv) {
    this.dead = true;
    this.state = "dying";
    this.dieT = 1;
    env.sfx("enemyDie");
    env.burst(this.pos.x, this.pos.y + 1.2, this.pos.z, this.tint, this.type === "golem" ? 70 : 30, this.type === "golem" ? 14 : 8, 1.4);
    if (this.type === "golem") {
      env.shake(0.8);
      env.ring(this.pos.x, this.pos.y + 0.2, this.pos.z, 12, this.tint);
    }
    this.respawnT = this.guardian ? 1e9 : 70;
  }

  respawn() {
    this.dead = false;
    this.removed = false;
    this.hp = this.maxHp;
    this.state = "idle";
    this.pos.copy(this.home);
    this.pos.y = groundH(this.home.x, this.home.z);
    this.group.visible = true;
    this.group.scale.setScalar(this.type === "wraith" ? 1.25 : 1);
    this.fadeIn = 0;
  }

  update(dt: number, env: EnemyEnv) {
    if (this.removed) {
      this.respawnT -= dt;
      const d = Math.hypot(env.player.x - this.home.x, env.player.z - this.home.z);
      if (this.respawnT <= 0 && d > 70) this.respawn();
      return;
    }
    this.stateT -= dt;
    this.cd -= dt;
    this.hitFlash = Math.max(0, this.hitFlash - dt);
    const px = env.player.x;
    const pz = env.player.z;
    const dx = px - this.pos.x;
    const dz = pz - this.pos.z;
    const dist = Math.hypot(dx, dz);
    const dyp = env.player.y - this.pos.y;
    const homeD = Math.hypot(this.home.x - this.pos.x, this.home.z - this.pos.z);
    const wr = this.type === "wraith";
    const speed = wr ? 6.2 : 3.4;
    const aggro = wr ? 26 : 32;
    this.fadeIn = Math.min(1, this.fadeIn + dt * 1.5);

    if (this.state === "dying") {
      this.dieT -= dt;
      if (wr_(this)) this.pos.y += dt * 2;
      const s = Math.max(0.001, this.dieT) * (wr_(this) ? 1.25 : 1);
      this.group.scale.setScalar(s);
      if (this.dieT <= 0) {
        this.removed = true;
        this.group.visible = false;
      }
      this.group.position.copy(this.pos);
      return;
    }

    const alive = env.alive;
    const target = alive && dist < aggro && Math.abs(dyp) < 30 && homeD < 70;

    switch (this.state) {
      case "idle": {
        this.wanderT -= dt;
        if (this.wanderT <= 0) {
          this.wanderT = 2 + Math.random() * 3;
          const a = Math.random() * 6.28;
          this.wander.set(this.home.x + Math.cos(a) * 7, 0, this.home.z + Math.sin(a) * 7);
        }
        const wx = this.wander.x - this.pos.x;
        const wz = this.wander.z - this.pos.z;
        const wl = Math.hypot(wx, wz);
        if (wl > 1) {
          this.vel.x = damp(this.vel.x, (wx / wl) * speed * 0.3, 3, dt);
          this.vel.z = damp(this.vel.z, (wz / wl) * speed * 0.3, 3, dt);
        }
        if (target) {
          this.state = "chase";
          if (wr) env.sfx("enemyScreech");
        }
        break;
      }
      case "chase": {
        if (!target) {
          this.state = "idle";
          break;
        }
        const keep = wr ? 3.0 : 4.5;
        if (dist > keep) {
          this.vel.x = damp(this.vel.x, (dx / dist) * speed, 4, dt);
          this.vel.z = damp(this.vel.z, (dz / dist) * speed, 4, dt);
        } else {
          this.vel.x = damp(this.vel.x, 0, 5, dt);
          this.vel.z = damp(this.vel.z, 0, 5, dt);
        }
        if (this.cd <= 0 && dist < (wr ? 6.5 : 6.2)) {
          this.state = "windup";
          this.stateT = wr ? 0.6 : 1.1;
          this.slamHit = false;
          this.lungeDir.set(dx / dist, 0, dz / dist);
        }
        break;
      }
      case "windup": {
        this.vel.x = damp(this.vel.x, wr ? -this.lungeDir.x * 2 : 0, 6, dt);
        this.vel.z = damp(this.vel.z, wr ? -this.lungeDir.z * 2 : 0, 6, dt);
        if (this.stateT <= 0) {
          if (wr) {
            this.state = "lunge";
            this.stateT = 0.38;
            this.lungeDir.set(dx / dist, 0, dz / dist);
          } else {
            this.state = "slam";
            this.stateT = 0.5;
          }
        }
        break;
      }
      case "lunge": {
        this.vel.x = this.lungeDir.x * 17;
        this.vel.z = this.lungeDir.z * 17;
        if (!this.slamHit && alive && dist < 1.9 && Math.abs(dyp) < 2.2) {
          this.slamHit = true;
          env.hurtPlayer(12, this.pos, 9);
        }
        if (this.stateT <= 0) {
          this.state = "recover";
          this.stateT = 0.9;
          this.cd = 1.2 + Math.random();
        }
        break;
      }
      case "slam": {
        this.vel.x = damp(this.vel.x, 0, 8, dt);
        this.vel.z = damp(this.vel.z, 0, 8, dt);
        if (!this.slamHit && this.stateT <= 0.22) {
          this.slamHit = true;
          env.ring(this.pos.x + this.lungeDir.x * 3, this.pos.y + 0.2, this.pos.z + this.lungeDir.z * 3, 9, this.tint);
          env.shake(0.6);
          env.sfx("golemStep");
          env.burst(this.pos.x + this.lungeDir.x * 3, this.pos.y + 0.5, this.pos.z + this.lungeDir.z * 3, this.tint, 24, 8);
          const sx = this.pos.x + this.lungeDir.x * 3;
          const sz = this.pos.z + this.lungeDir.z * 3;
          const d = Math.hypot(env.player.x - sx, env.player.z - sz);
          if (alive && d < 8 && env.player.y - this.pos.y < 1.3) env.hurtPlayer(22, new THREE.Vector3(sx, this.pos.y, sz), 12);
        }
        if (this.stateT <= 0) {
          this.state = "recover";
          this.stateT = 1.4;
          this.cd = 2.0;
        }
        break;
      }
      case "recover": {
        this.vel.x = damp(this.vel.x, 0, 4, dt);
        this.vel.z = damp(this.vel.z, 0, 4, dt);
        if (this.stateT <= 0) this.state = target ? "chase" : "idle";
        break;
      }
      case "stun": {
        this.vel.x = damp(this.vel.x, 0, 4, dt);
        this.vel.z = damp(this.vel.z, 0, 4, dt);
        if (this.stateT <= 0) this.state = "chase";
        break;
      }
    }
    if (this.state === "idle" && homeD > 12) {
      this.vel.x = damp(this.vel.x, ((this.home.x - this.pos.x) / homeD) * speed * 0.6, 3, dt);
      this.vel.z = damp(this.vel.z, ((this.home.z - this.pos.z) / homeD) * speed * 0.6, 3, dt);
    }
    // integrate
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    // collisions for golem vs static circles
    if (!wr) {
      const list = env.colliders.get(this.pos.x, this.pos.z);
      if (list)
        for (const c of list) {
          if (!c.enabled || c.kind !== 0) continue;
          if (c.y1 < this.pos.y + 0.5) continue;
          const ddx = this.pos.x - c.x;
          const ddz = this.pos.z - c.z;
          const d = Math.hypot(ddx, ddz);
          const minD = c.r + this.radius;
          if (d < minD && d > 0.001) {
            this.pos.x = c.x + (ddx / d) * minD;
            this.pos.z = c.z + (ddz / d) * minD;
          }
        }
    }
    const gh = groundH(this.pos.x, this.pos.z);
    if (wr) {
      const wl = waterLevelAt(this.pos.x, this.pos.z);
      const base = Math.max(gh, wl > -1e8 ? wl : gh) + 1.35;
      const bobY = Math.sin(env.time * 2 + this.bob) * 0.25;
      const target = base + bobY + (this.state === "windup" ? 0.6 : 0);
      this.pos.y = damp(this.pos.y, target, 6, dt);
    } else {
      this.pos.y = gh;
    }
    // facing
    if (alive && this.state !== "idle") {
      const want = Math.atan2(dx, dz);
      let d = want - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * (1 - Math.exp(-(wr ? 10 : 3) * dt));
    } else if (Math.hypot(this.vel.x, this.vel.z) > 0.3) {
      this.yaw = Math.atan2(this.vel.x, this.vel.z);
    }
    this.group.position.copy(this.pos);
    this.group.rotation.y = this.yaw;
    // animation
    if (wr) {
      this.group.rotation.x = this.state === "lunge" ? 0.6 : this.state === "windup" ? -0.3 : Math.hypot(this.vel.x, this.vel.z) * 0.03;
      const glow = this.state === "windup" ? 14 : this.state === "stun" ? 0.3 : 5;
      for (const e of this.eyes) ((e.material as THREE.MeshBasicMaterial).color as THREE.Color).copy(this.tint).multiplyScalar(glow);
      this.arms.forEach((a, i) => {
        a.rotation.x = this.state === "lunge" ? -1.8 : this.state === "windup" ? -2.4 : -0.5 + Math.sin(env.time * 4 + i) * 0.2;
        a.rotation.z = (i ? 1 : -1) * (0.5 + Math.sin(env.time * 3) * 0.1);
      });
      const m = this.mats[0];
      m.emissive.copy(this.tint).multiplyScalar(this.hitFlash > 0 ? 2.2 : this.state === "windup" ? 1.2 : 0.35);
      m.opacity = 0.88 * this.fadeIn;
    } else {
      const moving = Math.hypot(this.vel.x, this.vel.z) > 0.5;
      this.stepT += dt * (moving ? 2.2 : 0);
      this.legs.forEach((l, i) => (l.rotation.x = Math.sin(this.stepT * 3 + i * Math.PI) * 0.5 * (moving ? 1 : 0)));
      if (moving) {
        const s = Math.sin(this.stepT * 3);
        if (Math.abs(s) < 0.1 && this.stateT < 0 && Math.random() < 0.5 && dist < 40) {
          env.sfx("golemStep");
          env.shake(clamp(1 - dist / 40, 0, 1) * 0.25);
        }
      }
      const up = this.state === "windup" ? 1 - this.stateT / 1.1 : this.state === "slam" ? 1 - (0.5 - this.stateT) * 3 : 0;
      this.arms.forEach((a, i) => {
        if (i < 2) a.rotation.x = -clamp(up, -0.5, 1) * 2.8 + Math.sin(this.stepT * 3 + i) * 0.2 * (moving ? 1 : 0);
      });
      if (this.powU) this.powU.value = this.hitFlash > 0 ? 2.5 : this.state === "windup" ? 2 : 0.9 + Math.sin(env.time * 2) * 0.2;
    }
  }
}
