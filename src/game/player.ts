import * as THREE from "three";
import { damp, clamp, smoothstep } from "./noise";

export interface AnimInput {
  speed: number;
  vy: number;
  grounded: boolean;
  sprint: boolean;
  gliding: boolean;
  swimming: boolean;
  turn: number; // rad/s
  accel: number; // forward accel m/s2 (local)
  velLX: number; // local right velocity
  velLZ: number; // local forward velocity
  castType: number; // -1 none, 0 bolt 1 wave 2 lightning 3 portal
  castT: number; // 0..1
  interactT: number; // -1 none, 0..1
  dead: boolean;
  landImpact: number;
}

function limb(len: number, r0: number, r1: number, mat: THREE.Material, seg = 8) {
  const g = new THREE.CylinderGeometry(r0, r1, len, seg, 1);
  g.translate(0, -len / 2, 0);
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true;
  return m;
}

export class Character {
  root = new THREE.Group();
  body = new THREE.Group();
  hips = new THREE.Group();
  torso = new THREE.Group();
  head = new THREE.Group();
  armL = new THREE.Group();
  armR = new THREE.Group();
  foreL = new THREE.Group();
  foreR = new THREE.Group();
  legL = new THREE.Group();
  legR = new THREE.Group();
  shinL = new THREE.Group();
  shinR = new THREE.Group();
  skirt!: THREE.Mesh;
  cape!: THREE.Mesh;
  capeBase!: Float32Array;
  staff = new THREE.Group();
  orb!: THREE.Mesh;
  orbMat!: THREE.MeshStandardMaterial;
  tip = new THREE.Object3D();
  wings = new THREE.Group();
  aura!: THREE.Mesh;
  phase = 0;
  time = 0;
  drag = new THREE.Vector3();
  squash = 0;
  airT = 0;
  glideT = 0;
  stepSign = 0;
  onStep: ((foot: number) => void) | null = null;
  orbColor = new THREE.Color("#7fe7ff");
  orbPulse = 0;
  runeMat: THREE.MeshStandardMaterial;
  deadT = 0;

  constructor() {
    const robe = new THREE.MeshStandardMaterial({ color: "#1d2a5c", roughness: 0.78, metalness: 0.0, side: THREE.DoubleSide });
    const robeDark = new THREE.MeshStandardMaterial({ color: "#121a3a", roughness: 0.85, side: THREE.DoubleSide });
    const gold = new THREE.MeshStandardMaterial({ color: "#e0b45c", roughness: 0.3, metalness: 0.9 });
    const leather = new THREE.MeshStandardMaterial({ color: "#3b2a22", roughness: 0.7 });
    const skin = new THREE.MeshStandardMaterial({ color: "#120e18", roughness: 0.6 });
    this.runeMat = new THREE.MeshStandardMaterial({ color: "#0a2a33", emissive: "#6ff0ff", emissiveIntensity: 2.2, roughness: 0.4 });
    const capeMat = new THREE.MeshStandardMaterial({ color: "#8a1f45", roughness: 0.65, side: THREE.DoubleSide });

    const add = (parent: THREE.Object3D, m: THREE.Object3D, x = 0, y = 0, z = 0) => {
      m.position.set(x, y, z);
      parent.add(m);
      m.traverse((o: any) => {
        if (o.isMesh) o.castShadow = true;
      });
      return m;
    };

    this.root.add(this.body);
    this.body.add(this.hips);
    this.hips.position.y = 0.92;
    this.hips.add(this.torso);

    // chest
    const chest = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.2, 0.52, 12), robe);
    add(this.torso, chest, 0, 0.27, 0);
    const belt = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.025, 6, 16), gold);
    belt.rotation.x = Math.PI / 2;
    add(this.torso, belt, 0, 0.02, 0);
    const buckle = new THREE.Mesh(new THREE.OctahedronGeometry(0.045), this.runeMat);
    add(this.torso, buckle, 0, 0.02, 0.21);
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.04, 6, 14), gold);
    collar.rotation.x = Math.PI / 2;
    add(this.torso, collar, 0, 0.53, 0);
    // front panel with rune
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(0.09, 0.4), robeDark);
    add(this.torso, panel, 0, 0.26, 0.19);
    const rune = new THREE.Mesh(new THREE.PlaneGeometry(0.03, 0.22), this.runeMat);
    add(this.torso, rune, 0, 0.27, 0.195);

    // skirt (robe lower)
    this.skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.37, 0.62, 16, 1, true), robe);
    add(this.hips, this.skirt, 0, -0.3, 0);
    const hem = new THREE.Mesh(new THREE.TorusGeometry(0.37, 0.018, 6, 24), gold);
    hem.rotation.x = Math.PI / 2;
    add(this.skirt, hem, 0, -0.31, 0);

    // head
    this.torso.add(this.head);
    this.head.position.y = 0.7;
    const face = new THREE.Mesh(new THREE.SphereGeometry(0.115, 16, 12), skin);
    face.scale.set(0.95, 1.1, 1);
    add(this.head, face, 0, 0, 0.01);
    const eyeMat = new THREE.MeshStandardMaterial({ color: "#001018", emissive: "#8ff6ff", emissiveIntensity: 4 });
    for (const sx of [-1, 1]) {
      const e = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.016, 0.01), eyeMat);
      add(this.head, e, sx * 0.045, 0.01, 0.105);
    }
    const hood = new THREE.Mesh(new THREE.SphereGeometry(0.17, 22, 14, Math.PI / 2 + 0.75, Math.PI * 2 - 1.5), robe);
    hood.scale.set(1.0, 1.12, 1.15);
    add(this.head, hood, 0, 0.02, -0.03);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.34, 10), robe);
    tip.rotation.x = -1.15;
    add(this.head, tip, 0, 0.16, -0.24);
    const hoodTrim = new THREE.Mesh(new THREE.TorusGeometry(0.135, 0.012, 6, 20, Math.PI * 1.45), gold);
    hoodTrim.rotation.set(0, 0, Math.PI * 0.78);
    hoodTrim.position.set(0, 0.0, 0.07);
    this.head.add(hoodTrim);

    // arms
    const buildArm = (side: number, shoulder: THREE.Group, fore: THREE.Group) => {
      this.torso.add(shoulder);
      shoulder.position.set(side * 0.235, 0.5, 0);
      const sh = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), robe);
      shoulder.add(sh);
      const ring = new THREE.Mesh(new THREE.SphereGeometry(0.082, 10, 6, 0, Math.PI * 2, 0, 0.9), gold);
      shoulder.add(ring);
      const up = limb(0.3, 0.06, 0.05, robe);
      shoulder.add(up);
      shoulder.add(fore);
      fore.position.y = -0.3;
      const lo = limb(0.28, 0.05, 0.04, leather);
      fore.add(lo);
      const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.115, 0.2, 10, 1, true), robe);
      sleeve.position.y = -0.1;
      fore.add(sleeve);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), leather);
      hand.position.y = -0.3;
      fore.add(hand);
    };
    buildArm(-1, this.armL, this.foreL);
    buildArm(1, this.armR, this.foreR);

    // legs
    const buildLeg = (side: number, hip: THREE.Group, shin: THREE.Group) => {
      this.hips.add(hip);
      hip.position.set(side * 0.1, -0.02, 0);
      const th = limb(0.44, 0.08, 0.06, leather);
      hip.add(th);
      hip.add(shin);
      shin.position.y = -0.44;
      const sh = limb(0.4, 0.06, 0.05, leather);
      shin.add(sh);
      const boot = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.09, 0.22), leather);
      boot.position.set(0, -0.4, 0.04);
      boot.castShadow = true;
      shin.add(boot);
      const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.065, 0.1, 8), gold);
      cuff.position.y = -0.3;
      shin.add(cuff);
    };
    buildLeg(-1, this.legL, this.shinL);
    buildLeg(1, this.legR, this.shinR);

    // cape
    const cg = new THREE.PlaneGeometry(0.46, 0.95, 5, 8);
    cg.translate(0, -0.475, 0);
    this.cape = new THREE.Mesh(cg, capeMat);
    this.cape.castShadow = true;
    this.cape.frustumCulled = false;
    this.capeBase = (cg.attributes.position.array as Float32Array).slice();
    add(this.torso, this.cape, 0, 0.53, -0.17);
    // cape trim: use colors
    const colors = new Float32Array(cg.attributes.position.count * 3);
    for (let i = 0; i < cg.attributes.position.count; i++) {
      const y = -cg.attributes.position.getY(i) / 0.95;
      const k = 0.55 + 0.45 * (1 - y);
      const trim = y > 0.95 ? 2.2 : 1;
      colors[i * 3] = k * trim;
      colors[i * 3 + 1] = k * (y > 0.95 ? 1.8 : 1);
      colors[i * 3 + 2] = k * (y > 0.95 ? 0.8 : 1);
    }
    cg.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    capeMat.vertexColors = true;

    // staff
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.024, 1.75, 8), new THREE.MeshStandardMaterial({ color: "#4a3426", roughness: 0.6 }));
    rod.castShadow = true;
    add(this.staff, rod, 0, 0.3, 0);
    for (const y of [0.45, 1.12]) {
      const r = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.01, 6, 12), gold);
      r.rotation.x = Math.PI / 2;
      add(this.staff, r, 0, y, 0);
    }
    for (let i = 0; i < 4; i++) {
      const prong = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.22, 5), gold);
      const a = (i / 4) * Math.PI * 2;
      prong.position.set(Math.cos(a) * 0.055, 1.28, Math.sin(a) * 0.055);
      prong.rotation.set(Math.sin(a) * 0.3, 0, -Math.cos(a) * 0.3);
      this.staff.add(prong);
    }
    this.orbMat = new THREE.MeshStandardMaterial({ color: "#10303a", emissive: "#7fe7ff", emissiveIntensity: 3.5, roughness: 0.2 });
    this.orb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.075, 2), this.orbMat);
    add(this.staff, this.orb, 0, 1.3, 0);
    this.tip.position.set(0, 1.3, 0);
    this.staff.add(this.tip);
    this.foreR.add(this.staff);
    this.staff.position.set(0, -0.3, 0.02);
    this.staff.rotation.set(-0.15, 0, 0);

    // wings of light
    const wingShape = new THREE.Shape();
    wingShape.moveTo(0, 0);
    wingShape.lineTo(0.5, 0.35);
    wingShape.lineTo(1.0, 0.75);
    wingShape.lineTo(1.5, 1.0);
    wingShape.lineTo(1.3, 0.55);
    wingShape.lineTo(1.75, 0.5);
    wingShape.lineTo(1.35, 0.1);
    wingShape.lineTo(1.7, -0.15);
    wingShape.lineTo(1.1, -0.2);
    wingShape.lineTo(1.35, -0.55);
    wingShape.lineTo(0.7, -0.35);
    wingShape.lineTo(0, -0.2);
    const wg = new THREE.ShapeGeometry(wingShape);
    const wc = new Float32Array(wg.attributes.position.count * 3);
    for (let i = 0; i < wg.attributes.position.count; i++) {
      const x = wg.attributes.position.getX(i);
      const k = Math.max(0, 1 - x / 1.8);
      wc[i * 3] = 0.25 * k + 0.05;
      wc[i * 3 + 1] = 0.8 * k + 0.05;
      wc[i * 3 + 2] = 1.0 * k + 0.1;
    }
    wg.setAttribute("color", new THREE.BufferAttribute(wc, 3));
    const wm = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false, opacity: 0.9 });
    const wl = new THREE.Mesh(wg, wm);
    wl.scale.x = -1;
    const wr = new THREE.Mesh(wg, wm);
    this.wings.add(wl, wr);
    wl.position.x = -0.05;
    wr.position.x = 0.05;
    this.wings.position.set(0, 0.45, -0.2);
    this.wings.scale.setScalar(0.001);
    this.torso.add(this.wings);

    // ground aura
    const ag = new THREE.RingGeometry(0.45, 0.62, 32);
    ag.rotateX(-Math.PI / 2);
    this.aura = new THREE.Mesh(ag, new THREE.MeshBasicMaterial({ color: "#7fe7ff", transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.aura.position.y = 0.04;
    this.root.add(this.aura);

    this.root.traverse((o: any) => {
      if (o.isMesh) o.frustumCulled = o === this.cape ? false : true;
    });
  }

  setOrbColor(c: THREE.ColorRepresentation, pulse = 1) {
    this.orbColor.set(c);
    this.orbPulse = pulse;
  }

  tipWorld(out: THREE.Vector3) {
    this.tip.getWorldPosition(out);
    return out;
  }

  private _q = new THREE.Quaternion();
  private _v = new THREE.Vector3();

  update(dt: number, a: AnimInput) {
    this.time += dt;
    const spd = a.speed;
    const moving = spd > 0.4 && a.grounded;
    const amp = a.grounded ? smoothstep(0.2, 6.5, spd) * (a.sprint ? 1.12 : 0.92) : 0;
    const wasPhase = this.phase;
    if (moving) this.phase += dt * (2.2 + spd * 1.05);
    else this.phase += dt * 0.0;
    // footsteps at zero crossings
    if (moving) {
      const s0 = Math.sin(wasPhase);
      const s1 = Math.sin(this.phase);
      if (s0 < 0 !== s1 < 0) this.onStep?.(s1 > 0 ? 1 : 0);
    }
    const sp = Math.sin(this.phase);
    const cp = Math.cos(this.phase);
    const air = !a.grounded && !a.swimming ? 1 : 0;
    this.airT = damp(this.airT, air, 12, dt);
    this.glideT = damp(this.glideT, a.gliding ? 1 : 0, 6, dt);
    const swim = a.swimming ? 1 : 0;
    const idleBreath = Math.sin(this.time * 1.7) * 0.5 + 0.5;
    this.squash = damp(this.squash, 0, 7, dt);
    if (a.landImpact > 0) this.squash = Math.max(this.squash, clamp(a.landImpact * 0.03, 0.05, 0.28));

    // targets
    const T = {
      legL: -sp * amp * 0.85,
      legR: sp * amp * 0.85,
      shinL: Math.max(0, cp * amp * 1.0 + amp * 0.15),
      shinR: Math.max(0, -cp * amp * 1.0 + amp * 0.15),
      armLx: sp * amp * 0.7 + 0.04,
      armRx: -sp * amp * 0.35 - 0.2,
      armLz: -0.08 - idleBreath * 0.02,
      armRz: 0.1,
      foreLx: -(0.2 + amp * 0.7),
      foreRx: -(0.45 + amp * 0.5),
      torsoX: clamp(spd * 0.026 + a.accel * 0.012, -0.2, 0.42),
      torsoY: cp * amp * 0.14,
      torsoZ: clamp(-a.turn * 0.05, -0.25, 0.25) + sp * amp * 0.03,
      headX: -clamp(spd * 0.018, 0, 0.3) + Math.sin(this.time * 0.8) * 0.02,
      headY: -cp * amp * 0.1,
      hipsY: 0.92 + Math.abs(sp) * amp * 0.05 - this.squash * 0.5 - idleBreath * 0.006,
      hipsX: 0,
      hipsZ: clamp(-a.turn * 0.04, -0.2, 0.2),
      bodyY: 0,
    };
    if (amp < 0.05 && a.grounded && !a.swimming) {
      // idle: subtle weight shift
      T.legL = Math.sin(this.time * 0.6) * 0.02;
      T.legR = -T.legL;
      T.armRx = -0.22 + Math.sin(this.time * 1.7) * 0.02;
      T.armLx = Math.sin(this.time * 1.7 + 1) * 0.04;
      T.torsoZ += Math.sin(this.time * 0.6) * 0.015;
    }
    if (air > 0.01) {
      const rising = clamp(a.vy / 8, -1, 1);
      const up = rising > 0 ? rising : 0;
      const dn = rising < 0 ? -rising : 0;
      const k = this.airT;
      T.legL = T.legL * (1 - k) + (-0.7 * up - 0.2 * dn + 0.1) * k;
      T.legR = T.legR * (1 - k) + (0.2 * up + 0.15 * dn - 0.1) * k;
      T.shinL = T.shinL * (1 - k) + (1.2 * up + 0.3) * k;
      T.shinR = T.shinR * (1 - k) + (0.4 * up + 0.5) * k;
      T.armLx = T.armLx * (1 - k) + (-0.5 - dn * 0.5) * k;
      T.armRx = T.armRx * (1 - k) + (-0.9 - dn * 0.4) * k;
      T.armLz = T.armLz * (1 - k) + (-0.9 - dn * 0.5) * k;
      T.armRz = T.armRz * (1 - k) + (0.9 + dn * 0.5) * k;
      T.foreLx = -0.3;
      T.foreRx = -0.3;
      T.hipsY += 0.0;
    }
    if (swim > 0) {
      const sw = Math.sin(this.time * 4);
      T.legL = sw * 0.35;
      T.legR = -sw * 0.35;
      T.shinL = 0.3 + Math.max(0, sw) * 0.3;
      T.shinR = 0.3 + Math.max(0, -sw) * 0.3;
      T.armLx = -1.2 + Math.cos(this.time * 3) * 0.7;
      T.armRx = -1.2 - Math.cos(this.time * 3) * 0.7;
      T.foreLx = -0.5;
      T.foreRx = -0.5;
      T.hipsX = clamp(spd * 0.12, 0.1, 0.8);
      T.hipsY = 0.75;
      T.bodyY = -0.35;
    }
    if (this.glideT > 0.01) {
      const g = this.glideT;
      T.hipsX = T.hipsX * (1 - g) + 1.15 * g;
      T.legL = T.legL * (1 - g) + 0.35 * g;
      T.legR = T.legR * (1 - g) + 0.25 * g;
      T.shinL = T.shinL * (1 - g) + 0.2 * g;
      T.shinR = T.shinR * (1 - g) + 0.3 * g;
      T.armLx = T.armLx * (1 - g) + -2.7 * g;
      T.armRx = T.armRx * (1 - g) + -2.7 * g;
      T.armLz = T.armLz * (1 - g) + -0.5 * g;
      T.armRz = T.armRz * (1 - g) + 0.5 * g;
      T.foreLx = -0.1;
      T.foreRx = -0.1;
      T.torsoX = T.torsoX * (1 - g) - 0.35 * g;
      T.headX = -0.6 * g;
      T.hipsY = 0.9;
      T.torsoZ += Math.sin(this.time * 1.4) * 0.06 * g;
    }
    // casting overlays
    let castTorsoY = 0;
    let orbBoost = 0;
    if (a.castType >= 0 && a.castT >= 0) {
      const p = clamp(a.castT, 0, 1);
      const pulse = Math.sin(p * Math.PI);
      const ease = 1 - Math.pow(1 - clamp(p * 3, 0, 1), 3);
      orbBoost = pulse;
      switch (a.castType) {
        case 0:
          T.armRx = -0.5 - 1.15 * ease + (p > 0.4 ? (p - 0.4) * 0.8 : 0);
          T.armRz = 0.15;
          T.foreRx = -0.1;
          T.armLx = 0.5;
          T.armLz = -0.7;
          castTorsoY = -0.4 * ease;
          T.torsoX += 0.15 * ease;
          break;
        case 1:
          T.armRx = p < 0.45 ? -2.9 * smoothstep(0, 0.4, p) : -2.9 + 3.3 * smoothstep(0.45, 0.6, p);
          T.armLx = T.armRx;
          T.armLz = -0.25;
          T.armRz = 0.25;
          T.foreRx = -0.2;
          T.foreLx = -0.2;
          T.torsoX += p > 0.45 ? 0.55 * smoothstep(0.45, 0.6, p) * (1 - smoothstep(0.7, 1, p)) : -0.2 * p;
          T.hipsY -= p > 0.45 ? 0.2 * smoothstep(0.45, 0.6, p) * (1 - smoothstep(0.6, 1, p)) : 0;
          T.legL = -0.3;
          T.legR = 0.4;
          T.shinL = 0.5;
          T.shinR = 0.5;
          break;
        case 2:
          T.armRx = -3.0;
          T.armLx = -2.6;
          T.armRz = 0.2;
          T.armLz = -0.3;
          T.foreRx = -0.1;
          T.foreLx = -0.15;
          T.torsoX = -0.3 * ease;
          T.headX = -0.5;
          break;
        case 3:
          T.armRx = -1.1;
          T.armLx = -1.1;
          T.armRz = 1.3;
          T.armLz = -1.3;
          T.foreRx = -0.2;
          T.foreLx = -0.2;
          castTorsoY = p * Math.PI * 2;
          break;
      }
    }
    if (a.interactT >= 0) {
      const p = a.interactT;
      const e = Math.sin(p * Math.PI);
      T.armRx = -0.4 - 1.0 * e;
      T.foreRx = -0.3 - 0.6 * e;
      T.torsoX += 0.2 * e;
    }
    if (a.dead) {
      this.deadT = Math.min(1, this.deadT + dt * 1.6);
    } else this.deadT = Math.max(0, this.deadT - dt * 3);
    const dd = this.deadT;

    const L = 16;
    const h = this.hips;
    const dmp = (obj: THREE.Object3D, axis: "x" | "y" | "z", t: number, l = L) => {
      obj.rotation[axis] = damp(obj.rotation[axis], t, l, dt);
    };
    dmp(this.legL, "x", T.legL);
    dmp(this.legR, "x", T.legR);
    dmp(this.shinL, "x", T.shinL);
    dmp(this.shinR, "x", T.shinR);
    dmp(this.armL, "x", T.armLx);
    dmp(this.armR, "x", T.armRx, 22);
    dmp(this.armL, "z", T.armLz);
    dmp(this.armR, "z", T.armRz);
    dmp(this.foreL, "x", T.foreLx);
    dmp(this.foreR, "x", T.foreRx);
    dmp(this.torso, "x", T.torsoX, 10);
    this.torso.rotation.y = damp(this.torso.rotation.y, T.torsoY + castTorsoY, castTorsoY ? 24 : 12, dt);
    if (a.castType === 3 && a.castT >= 0) this.torso.rotation.y = castTorsoY;
    dmp(this.torso, "z", T.torsoZ, 8);
    dmp(this.head, "x", T.headX, 8);
    dmp(this.head, "y", T.headY, 8);
    dmp(h, "x", T.hipsX * (1 - dd) + -1.5 * dd, 9);
    dmp(h, "z", T.hipsZ, 8);
    h.position.y = damp(h.position.y, T.hipsY * (1 - dd) + 0.25 * dd, 14, dt);
    this.body.position.y = damp(this.body.position.y, T.bodyY, 6, dt);
    this.skirt.rotation.x = damp(this.skirt.rotation.x, clamp((T.legL - T.legR) * 0.08 + spd * 0.015 + this.airT * 0.1, -0.3, 0.4), 10, dt);
    this.skirt.scale.set(1 + this.airT * 0.12, 1, 1 + this.airT * 0.12);

    // orb
    this.orbMat.emissive.lerp(this.orbColor, 1 - Math.exp(-dt * 10));
    this.orbMat.emissiveIntensity = 3.2 + Math.sin(this.time * 3) * 0.6 + orbBoost * 6 + this.orbPulse * 2;
    this.orbPulse = damp(this.orbPulse, 0, 4, dt);
    this.orb.scale.setScalar(1 + orbBoost * 0.7 + Math.sin(this.time * 3) * 0.05);
    this.orb.rotation.y += dt * 2;

    // wings
    const ws = this.glideT;
    this.wings.scale.setScalar(Math.max(0.001, ws));
    const flap = Math.sin(this.time * 5) * 0.12 * ws;
    (this.wings.children[0] as THREE.Mesh).rotation.set(0, -(0.35 + flap), 0);
    (this.wings.children[1] as THREE.Mesh).rotation.set(0, 0.35 + flap, 0);

    // aura
    const am = this.aura.material as THREE.MeshBasicMaterial;
    am.opacity = damp(am.opacity, orbBoost * 0.7, 8, dt);
    am.color.copy(this.orbColor);
    this.aura.scale.setScalar(1 + orbBoost * 1.5);
    this.aura.rotation.y += dt;

    // cape physics-ish
    this._v.set(a.velLX, 0, a.velLZ);
    // drag: local-space opposite of velocity, smoothed (lag)
    this.drag.x = damp(this.drag.x, -a.velLX, 5, dt);
    this.drag.z = damp(this.drag.z, -a.velLZ, 5, dt);
    this.drag.y = damp(this.drag.y, -clamp(a.vy, -20, 12), 6, dt);
    const pos = this.cape.geometry.attributes.position as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    const base = this.capeBase;
    const windK = clamp(spd / 8, 0, 1.2);
    for (let i = 0; i < pos.count; i++) {
      const bx = base[i * 3];
      const by = base[i * 3 + 1];
      const j = -by / 0.95; // 0..1
      const j2 = j * j;
      let x = bx * (1 + j * 0.25 + windK * 0.15 * j);
      let y = by;
      let z = -0.02 * j;
      // inertia
      x += this.drag.x * 0.08 * j2;
      z += this.drag.z * 0.1 * j2 - j2 * 0.05;
      y += clamp(this.drag.y * 0.015, -0.2, 0.25) * j2;
      // flutter
      const fl = Math.sin(this.time * (5 + windK * 5) + bx * 7 + j * 4) * (0.015 + windK * 0.05) * j;
      z -= Math.abs(fl) * 0.5 + fl * 0.5 - windK * j2 * 0.25;
      // clamp length
      arr[i * 3] = x;
      arr[i * 3 + 1] = y;
      arr[i * 3 + 2] = z;
    }
    pos.needsUpdate = true;
    this.cape.geometry.computeVertexNormals();
    this._q.identity();
  }
}
