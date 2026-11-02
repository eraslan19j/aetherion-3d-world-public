import * as THREE from "three";
import { groundH as terrainHeight } from "./terrain";
import { hash2 } from "./noise";

const pVert = /* glsl */ `
attribute vec4 aColor;
attribute float aSize;
uniform float uScale;
varying vec4 vColor;
void main(){
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * uScale / max(0.3, -mv.z);
}`;
const pFrag = /* glsl */ `
varying vec4 vColor;
uniform float uSoft;
void main(){
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c) * 2.0;
  float a = smoothstep(1.0, uSoft, d);
  a *= a;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vColor.rgb, vColor.a * a);
}`;

export class Particles {
  N: number;
  pos: Float32Array;
  vel: Float32Array;
  col: Float32Array;
  size: Float32Array;
  age: Float32Array;
  life: Float32Array;
  grav: Float32Array;
  drag: Float32Array;
  base: Float32Array;
  grow: Float32Array;
  points: THREE.Points;
  head = 0;
  mat: THREE.ShaderMaterial;
  geo: THREE.BufferGeometry;
  aColor: THREE.BufferAttribute;
  aSize: THREE.BufferAttribute;
  aPos: THREE.BufferAttribute;
  limit: number;
  constructor(N: number, additive: boolean) {
    this.N = N;
    this.limit = N;
    this.pos = new Float32Array(N * 3);
    this.vel = new Float32Array(N * 3);
    this.col = new Float32Array(N * 4);
    this.size = new Float32Array(N);
    this.base = new Float32Array(N);
    this.age = new Float32Array(N).fill(999);
    this.life = new Float32Array(N).fill(1);
    this.grav = new Float32Array(N);
    this.drag = new Float32Array(N);
    this.grow = new Float32Array(N);
    this.geo = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aColor = new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute("position", this.aPos);
    this.geo.setAttribute("aColor", this.aColor);
    this.geo.setAttribute("aSize", this.aSize);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: pVert,
      fragmentShader: pFrag,
      uniforms: { uScale: { value: 600 }, uSoft: { value: additive ? 0.0 : 0.15 } },
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 12 : 9;
  }
  setLimit(n: number) {
    this.limit = Math.min(this.N, n);
  }
  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, r: number, g: number, b: number, a = 1, grav = 0, drag = 0, grow = 0) {
    const i = this.head;
    this.head = (this.head + 1) % this.limit;
    const k = i * 3;
    this.pos[k] = x;
    this.pos[k + 1] = y;
    this.pos[k + 2] = z;
    this.vel[k] = vx;
    this.vel[k + 1] = vy;
    this.vel[k + 2] = vz;
    this.col[i * 4] = r;
    this.col[i * 4 + 1] = g;
    this.col[i * 4 + 2] = b;
    this.col[i * 4 + 3] = a;
    this.base[i] = a;
    this.size[i] = size;
    this.life[i] = life;
    this.age[i] = 0;
    this.grav[i] = grav;
    this.drag[i] = drag;
    this.grow[i] = grow;
  }
  burst(x: number, y: number, z: number, n: number, speed: number, life: number, size: number, r: number, g: number, b: number, grav = 0, drag = 1, up = 0) {
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1;
      const t = Math.random() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      const sp = speed * (0.3 + Math.random() * 0.7);
      this.spawn(x, y, z, s * Math.cos(t) * sp, u * sp + up, s * Math.sin(t) * sp, life * (0.6 + Math.random() * 0.6), size * (0.6 + Math.random() * 0.8), r, g, b, 1, grav, drag);
    }
  }
  update(dt: number) {
    const N = this.limit;
    for (let i = 0; i < N; i++) {
      const a = this.age[i];
      if (a >= this.life[i]) {
        if (this.col[i * 4 + 3] !== 0) {
          this.col[i * 4 + 3] = 0;
          this.size[i] = 0;
        }
        continue;
      }
      this.age[i] = a + dt;
      const k = i * 3;
      const d = Math.exp(-this.drag[i] * dt);
      this.vel[k] *= d;
      this.vel[k + 1] = this.vel[k + 1] * d - this.grav[i] * dt;
      this.vel[k + 2] *= d;
      this.pos[k] += this.vel[k] * dt;
      this.pos[k + 1] += this.vel[k + 1] * dt;
      this.pos[k + 2] += this.vel[k + 2] * dt;
      const f = (a + dt) / this.life[i];
      const fadeIn = Math.min(1, f * 12);
      const fadeOut = 1 - f * f;
      this.col[i * 4 + 3] = this.base[i] * fadeIn * fadeOut;
      if (this.grow[i] !== 0) this.size[i] += this.grow[i] * dt;
    }
    this.aPos.needsUpdate = true;
    this.aColor.needsUpdate = true;
    this.aSize.needsUpdate = true;
  }
}

// ---- Debris (instanced lit chunks) ----
export class Debris {
  mesh: THREE.InstancedMesh;
  N: number;
  px: Float32Array;
  vx: Float32Array;
  rot: Float32Array;
  av: Float32Array;
  life: Float32Array;
  sc: Float32Array;
  head = 0;
  dummy = new THREE.Object3D();
  constructor(N = 260) {
    this.N = N;
    const g = new THREE.BoxGeometry(1, 1, 1);
    const m = new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0.0 });
    this.mesh = new THREE.InstancedMesh(g, m, N);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.px = new Float32Array(N * 3);
    this.vx = new Float32Array(N * 3);
    this.rot = new Float32Array(N * 3);
    this.av = new Float32Array(N * 3);
    this.life = new Float32Array(N);
    this.sc = new Float32Array(N);
    const c = new THREE.Color(1, 1, 1);
    for (let i = 0; i < N; i++) {
      this.mesh.setColorAt(i, c);
      this.dummy.scale.setScalar(0);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
  }
  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, scale: number, color: THREE.Color, life = 3) {
    const i = this.head;
    this.head = (this.head + 1) % this.N;
    this.px.set([x, y, z], i * 3);
    this.vx.set([vx, vy, vz], i * 3);
    this.rot.set([Math.random() * 6, Math.random() * 6, Math.random() * 6], i * 3);
    this.av.set([(Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14], i * 3);
    this.life[i] = life;
    this.sc[i] = scale;
    this.mesh.setColorAt(i, color);
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
  burst(x: number, y: number, z: number, n: number, speed: number, scale: number, color: THREE.Color, life = 3) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.3 + Math.random());
      this.spawn(x, y, z, Math.cos(a) * s, speed * (0.4 + Math.random() * 0.8), Math.sin(a) * s, scale * (0.5 + Math.random()), color, life * (0.7 + Math.random() * 0.6));
    }
  }
  update(dt: number) {
    const d = this.dummy;
    for (let i = 0; i < this.N; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const k = i * 3;
      this.vx[k + 1] -= 22 * dt;
      this.px[k] += this.vx[k] * dt;
      this.px[k + 1] += this.vx[k + 1] * dt;
      this.px[k + 2] += this.vx[k + 2] * dt;
      const sc = this.sc[i];
      const gh = terrainHeight(this.px[k], this.px[k + 2]);
      if (this.px[k + 1] < gh + sc * 0.4) {
        this.px[k + 1] = gh + sc * 0.4;
        this.vx[k + 1] *= -0.35;
        this.vx[k] *= 0.6;
        this.vx[k + 2] *= 0.6;
        this.av[k] *= 0.5;
        this.av[k + 1] *= 0.5;
        this.av[k + 2] *= 0.5;
      }
      this.rot[k] += this.av[k] * dt;
      this.rot[k + 1] += this.av[k + 1] * dt;
      this.rot[k + 2] += this.av[k + 2] * dt;
      d.position.set(this.px[k], this.px[k + 1], this.px[k + 2]);
      d.rotation.set(this.rot[k], this.rot[k + 1], this.rot[k + 2]);
      const s = this.life[i] > 0 ? sc * Math.min(1, this.life[i] * 1.5) : 0;
      d.scale.set(s, s * 0.7, s * 1.3);
      d.updateMatrix();
      this.mesh.setMatrixAt(i, d.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// ---- Shockwave rings ----
const ringVert = `varying vec2 vUv; void main(){ vUv = uv*2.0-1.0; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`;
const ringFrag = `
varying vec2 vUv; uniform float uP; uniform vec3 uColor; uniform float uWidth;
void main(){
  float r = length(vUv);
  float ring = smoothstep(uWidth, 0.0, abs(r - uP));
  float inner = smoothstep(uP, 0.0, r) * 0.18 * (1.0 - uP);
  float a = (ring + inner) * (1.0 - uP*uP) * step(r, 1.0);
  gl_FragColor = vec4(uColor * (1.0 + ring*1.5), a);
}`;

export class Rings {
  group = new THREE.Group();
  items: { mesh: THREE.Mesh; t: number; dur: number; r: number; active: boolean }[] = [];
  plane = new THREE.PlaneGeometry(2, 2);
  constructor(n = 8) {
    for (let i = 0; i < n; i++) {
      const mat = new THREE.ShaderMaterial({
        vertexShader: ringVert,
        fragmentShader: ringFrag,
        uniforms: { uP: { value: 0 }, uColor: { value: new THREE.Color() }, uWidth: { value: 0.12 } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(this.plane, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 13;
      this.group.add(mesh);
      this.items.push({ mesh, t: 0, dur: 1, r: 1, active: false });
    }
  }
  spawn(x: number, y: number, z: number, radius: number, dur: number, color: THREE.ColorRepresentation, orient: "flat" | THREE.Quaternion = "flat", width = 0.12) {
    const it = this.items.find((i) => !i.active) ?? this.items[0];
    it.active = true;
    it.t = 0;
    it.dur = dur;
    it.r = radius;
    it.mesh.visible = true;
    it.mesh.position.set(x, y, z);
    if (orient === "flat") {
      it.mesh.rotation.set(-Math.PI / 2, 0, 0);
    } else {
      it.mesh.quaternion.copy(orient);
    }
    (it.mesh.material as THREE.ShaderMaterial).uniforms.uColor.value.set(color);
    (it.mesh.material as THREE.ShaderMaterial).uniforms.uWidth.value = width;
  }
  update(dt: number) {
    for (const it of this.items) {
      if (!it.active) continue;
      it.t += dt;
      const p = it.t / it.dur;
      if (p >= 1) {
        it.active = false;
        it.mesh.visible = false;
        continue;
      }
      const e = 1 - Math.pow(1 - p, 2.2);
      it.mesh.scale.setScalar(it.r);
      (it.mesh.material as THREE.ShaderMaterial).uniforms.uP.value = e;
    }
  }
}

// ---- Lightning ----
export class Lightning {
  mesh: THREE.Mesh;
  geo: THREE.BufferGeometry;
  mat: THREE.ShaderMaterial;
  t = 0;
  dur = 0.5;
  maxV = 4096;
  pos: Float32Array;
  alpha: Float32Array;
  constructor() {
    this.pos = new Float32Array(this.maxV * 3);
    this.alpha = new Float32Array(this.maxV);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute("aA", new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: `attribute float aA; varying float vA; void main(){ vA=aA; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
      fragmentShader: `varying float vA; uniform float uF; void main(){ gl_FragColor = vec4(vec3(0.75,0.85,1.0)*(1.0+vA*2.0), vA*uF); }`,
      uniforms: { uF: { value: 0 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 14;
  }
  private vi = 0;
  private ribbon(pts: THREE.Vector3[], w: number, a: number) {
    // two crossed ribbons (x and z oriented)
    for (let axis = 0; axis < 2; axis++) {
      for (let i = 0; i < pts.length - 1; i++) {
        if (this.vi + 6 > this.maxV) return;
        const p = pts[i];
        const q = pts[i + 1];
        const ox = axis === 0 ? w : 0;
        const oz = axis === 1 ? w : 0;
        const verts: [number, number, number, number][] = [
          [p.x - ox, p.y, p.z - oz, a],
          [p.x + ox, p.y, p.z + oz, a],
          [q.x - ox, q.y, q.z - oz, a],
          [p.x + ox, p.y, p.z + oz, a],
          [q.x + ox, q.y, q.z + oz, a],
          [q.x - ox, q.y, q.z - oz, a],
        ];
        for (const v of verts) {
          this.pos[this.vi * 3] = v[0];
          this.pos[this.vi * 3 + 1] = v[1];
          this.pos[this.vi * 3 + 2] = v[2];
          this.alpha[this.vi] = v[3];
          this.vi++;
        }
      }
    }
  }
  private jag(a: THREE.Vector3, b: THREE.Vector3, n: number, amp: number) {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const p = a.clone().lerp(b, t);
      if (i > 0 && i < n) {
        p.x += (Math.random() - 0.5) * amp;
        p.z += (Math.random() - 0.5) * amp;
        p.y += (Math.random() - 0.5) * amp * 0.3;
      }
      pts.push(p);
    }
    return pts;
  }
  strike(target: THREE.Vector3, height = 110, dur = 0.55) {
    this.vi = 0;
    const top = new THREE.Vector3(target.x + (Math.random() - 0.5) * 10, target.y + height, target.z + (Math.random() - 0.5) * 10);
    const main = this.jag(top, target, 28, 9);
    this.ribbon(main, 0.28, 1);
    this.ribbon(main, 0.9, 0.22);
    for (let i = 0; i < 5; i++) {
      const s = main[4 + Math.floor(Math.random() * 20)];
      const e = s.clone().add(new THREE.Vector3((Math.random() - 0.5) * 30, -10 - Math.random() * 25, (Math.random() - 0.5) * 30));
      const br = this.jag(s, e, 8, 4);
      this.ribbon(br, 0.12, 0.8);
    }
    this.geo.setDrawRange(0, this.vi);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aA.needsUpdate = true;
    this.t = 0;
    this.dur = dur;
    this.mesh.visible = true;
  }
  update(dt: number) {
    if (!this.mesh.visible) return;
    this.t += dt;
    const p = this.t / this.dur;
    if (p >= 1) {
      this.mesh.visible = false;
      return;
    }
    const flick = 0.7 + 0.3 * Math.sin(this.t * 90);
    this.mat.uniforms.uF.value = (1 - p) * (1 - p) * flick;
  }
}

// ---- Dynamic light manager ----
export interface LightSource {
  x: number;
  y: number;
  z: number;
  color: THREE.Color;
  intensity: number;
  range: number;
  flicker?: number;
  seed?: number;
}
export class LightManager {
  pool: THREE.PointLight[] = [];
  statics: LightSource[] = [];
  dyn: (LightSource & { t: number; dur: number })[] = [];
  timer = 0;
  active: LightSource[] = [];
  time = 0;
  constructor(scene: THREE.Scene, n = 6) {
    for (let i = 0; i < n; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 20, 2);
      l.castShadow = false;
      scene.add(l);
      this.pool.push(l);
    }
  }
  flash(x: number, y: number, z: number, color: THREE.ColorRepresentation, intensity: number, range: number, dur: number) {
    this.dyn.push({ x, y, z, color: new THREE.Color(color), intensity, range, t: 0, dur });
    if (this.dyn.length > 8) this.dyn.shift();
  }
  update(dt: number, focus: THREE.Vector3) {
    this.time += dt;
    for (let i = this.dyn.length - 1; i >= 0; i--) {
      this.dyn[i].t += dt;
      if (this.dyn[i].t > this.dyn[i].dur) this.dyn.splice(i, 1);
    }
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = 0.3;
      const cands: { s: LightSource; score: number }[] = [];
      for (const s of this.statics) {
        const dx = s.x - focus.x;
        const dy = s.y - focus.y;
        const dz = s.z - focus.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d < s.range * 3.2 + 20) cands.push({ s, score: (s.intensity * s.range) / (d + 8) });
      }
      cands.sort((a, b) => b.score - a.score);
      this.active = cands.slice(0, this.pool.length).map((c) => c.s);
    }
    let i = 0;
    const used: (LightSource & { k?: number })[] = [];
    for (const d of this.dyn) used.push(Object.assign(d, { k: 1 - d.t / d.dur }));
    const room = this.pool.length - used.length;
    const list = [...used.slice(-this.pool.length), ...this.active.slice(0, Math.max(0, room))];
    for (const s of list) {
      if (i >= this.pool.length) break;
      const l = this.pool[i++];
      l.position.set(s.x, s.y, s.z);
      l.color.copy(s.color);
      const k = (s as any).k;
      let inten = s.intensity;
      if (k !== undefined) inten *= k * k;
      else if (s.flicker) inten *= 1 + Math.sin(this.time * 7 + (s.seed ?? 0)) * s.flicker * 0.5 + Math.sin(this.time * 13.7 + (s.seed ?? 0) * 2) * s.flicker * 0.3;
      l.intensity = inten;
      l.distance = s.range;
    }
    for (; i < this.pool.length; i++) this.pool[i].intensity = 0;
  }
}

// ---- Scorch decals ----
export class Decals {
  group = new THREE.Group();
  items: THREE.Mesh[] = [];
  ages: number[] = [];
  idx = 0;
  constructor(n = 10) {
    const g = new THREE.CircleGeometry(1, 20);
    g.rotateX(-Math.PI / 2);
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(
        g,
        new THREE.MeshBasicMaterial({ color: 0x050404, transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 })
      );
      m.visible = false;
      this.group.add(m);
      this.items.push(m);
      this.ages.push(99);
    }
  }
  add(x: number, z: number, r: number) {
    const i = this.idx++ % this.items.length;
    const m = this.items[i];
    m.visible = true;
    m.position.set(x, terrainHeight(x, z) + 0.06, z);
    m.scale.set(r * (0.9 + hash2(x, z) * 0.3), 1, r);
    m.rotation.y = Math.random() * 6;
    this.ages[i] = 0;
  }
  update(dt: number) {
    for (let i = 0; i < this.items.length; i++) {
      if (!this.items[i].visible) continue;
      this.ages[i] += dt;
      const o = Math.max(0, 0.65 * (1 - this.ages[i] / 25));
      (this.items[i].material as THREE.MeshBasicMaterial).opacity = o;
      if (o <= 0) this.items[i].visible = false;
    }
  }
}
