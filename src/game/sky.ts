import * as THREE from "three";
import { clamp, damp, lerp, smoothstep } from "./noise";

const skyVert = /* glsl */ `
varying vec3 vDir;
void main(){
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const skyFrag = /* glsl */ `
precision highp float;
varying vec3 vDir;
uniform vec3 uSunDir, uMoonDir, uMoon2Dir, uZenith, uHorizon, uSunCol, uPlanetDir;
uniform float uTime, uNight, uStorm, uFlash, uCloudQ;
float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(h21(i),h21(i+vec2(1,0)),f.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x), f.y); }
float fbm(vec2 p){ float v=0., a=.5; for(int i=0;i<5;i++){ if(i>=int(uCloudQ)) break; v+=a*vn(p); p=p*2.03+vec2(1.7,9.2); a*=.5;} return v; }
void main(){
  vec3 d = normalize(vDir);
  float y = d.y;
  float hz = pow(1.0 - clamp(y,0.,1.), 3.2);
  vec3 col = mix(uZenith, uHorizon, hz);
  if (y < 0.0) col = mix(uHorizon, uHorizon*0.55, clamp(-y*3.0,0.,1.));
  float sd = max(dot(d,uSunDir),0.0);
  float stormK = 1.0 - uStorm*0.85;
  col += uSunCol * (pow(sd, 6.0)*0.16 + pow(sd, 48.0)*0.35 + pow(sd,600.0)*1.2) * stormK;
  col += uSunCol * smoothstep(0.99935, 0.9998, sd) * 7.0 * stormK;
  // stars
  if (uNight > 0.01 && y > 0.0) {
    vec2 su = vec2(atan(d.z,d.x), asin(clamp(y,-1.,1.))) * vec2(90.0, 90.0);
    vec2 ci = floor(su); vec2 cf = fract(su)-0.5;
    float r = h21(ci);
    float star = smoothstep(0.985, 1.0, r) * smoothstep(0.35, 0.0, length(cf));
    star *= 0.6 + 0.4*sin(uTime*(2.0+r*4.0)+r*60.0);
    vec2 su2 = su*0.35; vec2 c2 = floor(su2); float r2 = h21(c2+7.3);
    star += smoothstep(0.97,1.0,r2) * smoothstep(0.4,0.0,length(fract(su2)-0.5)) * 0.8;
    float milky = fbm(vec2(atan(d.z,d.x)*2.0, y*5.0) + 3.0);
    vec3 mw = vec3(0.35,0.4,0.7) * smoothstep(0.5,0.9,milky) * 0.18 * smoothstep(0.0,0.3,y);
    col += (vec3(star)*vec3(0.9,0.95,1.1)*1.6 + mw) * uNight * (1.0-uStorm);
    // aurora
    float band = exp(-pow((y - (0.42 + 0.08*sin(d.x*3.0+uTime*0.07)))*7.0, 2.0));
    float ap = fbm(vec2(atan(d.z,d.x)*5.0 + uTime*0.05, uTime*0.04));
    vec3 ac = mix(vec3(0.1,1.0,0.55), vec3(0.6,0.25,1.0), smoothstep(0.35,0.75,y + ap*0.2));
    col += ac * band * ap * 0.55 * uNight * (1.0-uStorm);
  }
  // moons
  float m1 = dot(d,uMoonDir);
  float m1d = smoothstep(0.9988, 0.9992, m1);
  col += vec3(0.8,0.85,1.0) * m1d * 1.4 * (0.3+uNight) + vec3(0.5,0.6,1.0)*pow(max(m1,0.),90.)*0.2*uNight;
  float m2 = dot(d,uMoon2Dir);
  col += vec3(0.85,0.5,1.0) * smoothstep(0.9994,0.9997,m2) * 1.1 * (0.3+uNight) + vec3(0.6,0.3,0.9)*pow(max(m2,0.),120.)*0.14*uNight;
  // ringed planet
  {
    vec3 pd = normalize(uPlanetDir);
    vec3 rt = normalize(cross(pd, vec3(0.,1.,0.)));
    vec3 up = cross(rt, pd);
    float dp = dot(d,pd);
    if (dp > 0.9) {
      vec2 q = vec2(dot(d,rt), dot(d,up)) / max(dp, 0.001);
      float ang = 0.42; mat2 R = mat2(cos(ang),-sin(ang),sin(ang),cos(ang));
      vec2 qr = R * q;
      float pr = 0.115;
      float dist = length(q);
      float disc = smoothstep(pr, pr-0.003, dist);
      vec2 rq = vec2(qr.x, qr.y/0.26);
      float rr = length(rq);
      float ringA = smoothstep(0.14,0.15,rr)*smoothstep(0.30,0.285,rr) * (0.55+0.45*sin(rr*220.0)) * (1.0-smoothstep(0.205,0.21,rr)*(1.0-smoothstep(0.225,0.23,rr))*0.85);
      float front = step(qr.y, 0.0);
      float ringVis = ringA * (disc < 0.5 ? 1.0 : front);
      float lat = q.y / pr;
      vec3 pc = mix(vec3(0.85,0.55,0.35), vec3(0.95,0.8,0.6), 0.5+0.5*sin(lat*9.0+sin(lat*3.0)*2.0));
      float shade = clamp(0.35 + 0.8*dot(normalize(vec3(q/pr, sqrt(max(0.0,1.0-dot(q/pr,q/pr))))), normalize(vec3(-0.6,0.4,0.7))), 0.1, 1.2);
      float vis = (0.28 + 0.72*uNight) * (1.0 - uStorm);
      col = mix(col, pc*shade*1.3, disc * vis);
      col = mix(col, vec3(0.9,0.8,0.65) * 0.9, ringVis * 0.7 * vis);
      col += vec3(1.0,0.7,0.4) * exp(-dist*9.0) * 0.05 * uNight;
    }
  }
  // clouds
  if (y > -0.02) {
    vec2 p = d.xz / (y + 0.18) * 0.55 + vec2(uTime*0.012, uTime*0.004);
    float c = fbm(p*1.4);
    float cover = mix(0.5, 0.28, uStorm);
    float dens = smoothstep(cover, cover+0.3, c);
    float c2 = fbm(p*1.4 + uSunDir.xz*0.07);
    float lit = clamp(0.55 + (c - c2)*3.2, 0.0, 1.0);
    vec3 shadow = mix(uHorizon*0.55, vec3(0.28,0.3,0.36), uStorm);
    vec3 bright = mix(uSunCol*1.15 + uHorizon*0.4, vec3(0.5,0.52,0.58), uStorm);
    vec3 cc = mix(shadow, bright, lit);
    cc += uHorizon * 0.2;
    float dayish = 1.0 - uNight*0.82;
    cc *= dayish + 0.15;
    float fade = smoothstep(-0.02, 0.2, y);
    col = mix(col, cc, dens * fade * 0.92);
  }
  col += vec3(0.8,0.85,1.0) * uFlash * 1.2;
  gl_FragColor = vec4(col, 1.0);
}`;

const rainVert = /* glsl */ `
attribute float aEnd;
uniform float uTime;
uniform vec3 uCam;
varying float vA;
void main(){
  vec3 p = position;
  float speed = 26.0;
  float y = mod(p.y - uTime*speed, 36.0);
  vec3 w = vec3(mod(p.x - uCam.x + 20.0, 40.0) - 20.0, y - 6.0, mod(p.z - uCam.z + 20.0, 40.0) - 20.0);
  w += vec3(aEnd * 0.12, aEnd * 1.4, 0.0);
  vec4 mv = viewMatrix * vec4(w + vec3(uCam.x, uCam.y, uCam.z), 1.0);
  vA = (1.0 - aEnd*0.7) * (1.0 - smoothstep(10.0, 22.0, length(w)));
  gl_Position = projectionMatrix * mv;
}`;
const rainFrag = /* glsl */ `
uniform float uOpacity;
varying float vA;
void main(){ gl_FragColor = vec4(0.7,0.8,0.95, vA * uOpacity * 0.5); }`;

const motesVert = /* glsl */ `
attribute vec4 aRand;
uniform float uTime, uSize, uScale;
uniform vec3 uCam, uDrift;
varying float vAlpha;
varying float vSeed;
void main(){
  vec3 p = position;
  p += uDrift * uTime;
  p.x += sin(uTime*0.5 + aRand.x*20.0) * 1.2;
  p.z += cos(uTime*0.4 + aRand.y*20.0) * 1.2;
  vec3 w = mod(p - uCam + 30.0, 60.0) - 30.0;
  vec3 world = uCam + w;
  vec4 mv = viewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * mv;
  float dist = length(w);
  float fl = 0.55 + 0.45*sin(uTime*(1.5+aRand.z*3.0) + aRand.w*40.0);
  vAlpha = (1.0 - smoothstep(18.0, 30.0, dist)) * mix(1.0, fl, 0.7);
  vSeed = aRand.w;
  gl_PointSize = uSize * (0.5 + aRand.z) * uScale / max(0.5, -mv.z);
}`;
const motesFrag = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying float vAlpha;
varying float vSeed;
void main(){
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  float a = smoothstep(0.5, 0.0, d);
  a = a*a;
  vec3 col = uColor * (0.8 + 0.4*vSeed);
  gl_FragColor = vec4(col, a * vAlpha * uOpacity);
}`;

export class SkySystem {
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
  dome: THREE.Mesh;
  uni: Record<string, { value: any }>;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  fog: THREE.FogExp2;
  t = 0.3; // 0 midnight 0.25 sunrise 0.5 noon
  dayLen = 780;
  storm = 0;
  stormTarget = 0;
  stormTimer = 240 + Math.random() * 200;
  stormLeft = 0;
  flash = 0;
  nextBolt = 0;
  thunderQueue: number[] = [];
  onThunder: (() => void) | null = null;
  sunDir = new THREE.Vector3();
  moonDir = new THREE.Vector3();
  elev = 0.5;
  night = 0;
  envScene: THREE.Scene;
  pmrem: THREE.PMREMGenerator;
  envRT: THREE.WebGLRenderTarget | null = null;
  envTimer = 0;
  rain: THREE.LineSegments;
  motes: THREE.Points;
  moteUni: Record<string, { value: any }>;
  shadowRes = 2048;
  shadowExt = 70;
  shadowsOn = true;
  horizon = new THREE.Color();
  zenith = new THREE.Color();
  sunCol = new THREE.Color();
  moteCol = new THREE.Color(1, 1, 1);
  moteDrift = new THREE.Vector3();
  moteSize = 40;
  moteOp = 0.8;

  constructor(scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.uni = {
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
      uMoon2Dir: { value: new THREE.Vector3(0.5, -0.3, 0.8).normalize() },
      uPlanetDir: { value: new THREE.Vector3(0.12, 0.34, -1).normalize() },
      uZenith: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uSunCol: { value: new THREE.Color() },
      uTime: { value: 0 },
      uNight: { value: 0 },
      uStorm: { value: 0 },
      uFlash: { value: 0 },
      uCloudQ: { value: 5 },
    };
    const mat = new THREE.ShaderMaterial({
      vertexShader: skyVert,
      fragmentShader: skyFrag,
      uniforms: this.uni,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 20), mat);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -100;
    scene.add(this.dome);

    this.fog = new THREE.FogExp2(0xaabbcc, 0.0032);
    scene.fog = this.fog;

    this.sun = new THREE.DirectionalLight(0xfff0d0, 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.near = 1;
    sc.far = 400;
    sc.left = sc.bottom = -70;
    sc.right = sc.top = 70;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.5;
    scene.add(this.sun);
    scene.add(this.sun.target);
    this.hemi = new THREE.HemisphereLight(0x88aaff, 0x445533, 0.8);
    scene.add(this.hemi);

    this.envScene = new THREE.Scene();
    const envDome = new THREE.Mesh(new THREE.SphereGeometry(500, 24, 16), mat);
    envDome.frustumCulled = false;
    this.envScene.add(envDome);
    this.pmrem = new THREE.PMREMGenerator(renderer);

    // rain
    const N = 2200;
    const pos = new Float32Array(N * 2 * 3);
    const end = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) {
      const x = Math.random() * 40;
      const y = Math.random() * 36;
      const z = Math.random() * 40;
      for (let k = 0; k < 2; k++) {
        pos.set([x, y, z], (i * 2 + k) * 3);
        end[i * 2 + k] = k;
      }
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    rg.setAttribute("aEnd", new THREE.BufferAttribute(end, 1));
    this.rain = new THREE.LineSegments(
      rg,
      new THREE.ShaderMaterial({
        vertexShader: rainVert,
        fragmentShader: rainFrag,
        transparent: true,
        depthWrite: false,
        uniforms: { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uOpacity: { value: 0 } },
      })
    );
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    this.rain.renderOrder = 10;
    scene.add(this.rain);

    // ambient motes
    const M = 900;
    const mp = new Float32Array(M * 3);
    const mr = new Float32Array(M * 4);
    for (let i = 0; i < M; i++) {
      mp.set([Math.random() * 60, Math.random() * 60, Math.random() * 60], i * 3);
      mr.set([Math.random(), Math.random(), Math.random(), Math.random()], i * 4);
    }
    const mg = new THREE.BufferGeometry();
    mg.setAttribute("position", new THREE.BufferAttribute(mp, 3));
    mg.setAttribute("aRand", new THREE.BufferAttribute(mr, 4));
    this.moteUni = {
      uTime: { value: 0 },
      uSize: { value: 40 },
      uScale: { value: 600 },
      uCam: { value: new THREE.Vector3() },
      uDrift: { value: new THREE.Vector3() },
      uColor: { value: new THREE.Color(1, 1, 1) },
      uOpacity: { value: 0.8 },
    };
    this.motes = new THREE.Points(
      mg,
      new THREE.ShaderMaterial({
        vertexShader: motesVert,
        fragmentShader: motesFrag,
        uniforms: this.moteUni,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    this.motes.frustumCulled = false;
    this.motes.renderOrder = 11;
    scene.add(this.motes);
  }

  setQuality(q: { shadows: boolean; shadowRes: number; shadowExt: number; cloudQ: number; motes: number }) {
    this.shadowsOn = q.shadows;
    this.sun.castShadow = q.shadows;
    if (q.shadows && this.shadowRes !== q.shadowRes) {
      this.shadowRes = q.shadowRes;
      this.sun.shadow.mapSize.set(q.shadowRes, q.shadowRes);
      this.sun.shadow.map?.dispose();
      (this.sun.shadow as any).map = null;
    }
    this.shadowExt = q.shadowExt;
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -q.shadowExt;
    sc.right = sc.top = q.shadowExt;
    sc.updateProjectionMatrix();
    this.uni.uCloudQ.value = q.cloudQ;
    this.motes.geometry.setDrawRange(0, q.motes);
  }

  timeLabel() {
    const h = ((this.t * 24 + 0) % 24 + 24) % 24;
    const hh = Math.floor(h);
    const mm = Math.floor((h - hh) * 60);
    return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  }

  weatherLabel() {
    if (this.storm > 0.5) return "Eter Fırtınası";
    if (this.storm > 0.15) return "Bulutlu";
    return "";
  }

  forceStorm(duration = 60) {
    this.stormLeft = duration;
    this.stormTarget = 1;
  }

  private tmp = new THREE.Color();

  update(dt: number, cam: THREE.Camera, focus: THREE.Vector3, region: number, simDt = dt) {
    this.t = (this.t + simDt / this.dayLen) % 1;
    const ang = (this.t - 0.25) * Math.PI * 2;
    const e = Math.sin(ang);
    this.elev = e;
    this.sunDir.set(Math.cos(ang) * 0.9, e, 0.42).normalize();
    this.moonDir.copy(this.sunDir).multiplyScalar(-1);
    this.moonDir.x += 0.15;
    this.moonDir.normalize();
    // weather scheduler
    if (this.stormLeft > 0) {
      this.stormLeft -= simDt;
      if (this.stormLeft <= 0) this.stormTarget = 0;
    } else {
      this.stormTimer -= simDt;
      if (this.stormTimer <= 0) {
        this.stormTimer = 360 + Math.random() * 300;
        this.stormLeft = 70 + Math.random() * 50;
        this.stormTarget = 1;
      }
    }
    this.storm = damp(this.storm, this.stormTarget, 0.25, dt);
    if (this.storm < 0.002) this.storm = 0;
    const st = this.storm;
    // lightning
    if (st > 0.6) {
      this.nextBolt -= dt;
      if (this.nextBolt < 0) {
        this.nextBolt = 3 + Math.random() * 8;
        this.flash = 1;
        this.thunderQueue.push(0.5 + Math.random() * 2.2);
      }
    }
    this.flash = Math.max(0, this.flash - dt * (this.flash > 0.5 ? 5 : 2.2));
    for (let i = this.thunderQueue.length - 1; i >= 0; i--) {
      this.thunderQueue[i] -= dt;
      if (this.thunderQueue[i] <= 0) {
        this.thunderQueue.splice(i, 1);
        this.onThunder?.();
      }
    }

    const day = smoothstep(-0.08, 0.32, e);
    this.night = 1 - smoothstep(-0.18, 0.06, e);
    const twi = Math.exp(-Math.pow(e / 0.2, 2));
    // zenith
    this.zenith.setRGB(0.012, 0.02, 0.07);
    this.tmp.set("#2a6fd6");
    this.zenith.lerp(this.tmp, day);
    this.tmp.set("#5a3a8a");
    this.zenith.lerp(this.tmp, twi * 0.5);
    // horizon
    this.horizon.set("#10162e");
    this.tmp.set("#b9d2ea");
    this.horizon.lerp(this.tmp, day);
    this.tmp.set("#ff8f4a");
    this.horizon.lerp(this.tmp, twi * 0.85);
    // storm
    this.tmp.set("#3c424d").multiplyScalar(0.25 + day * 0.9);
    this.zenith.lerp(this.tmp, st * 0.85);
    this.tmp.set("#555c68").multiplyScalar(0.2 + day * 0.9);
    this.horizon.lerp(this.tmp, st * 0.85);
    // sun colour
    this.sunCol.set("#fff3dc");
    this.tmp.set("#ff7a2a");
    this.sunCol.lerp(this.tmp, 1 - smoothstep(0.0, 0.4, e));
    const u = this.uni;
    u.uSunDir.value.copy(this.sunDir);
    u.uMoonDir.value.copy(this.moonDir);
    u.uZenith.value.copy(this.zenith);
    u.uHorizon.value.copy(this.horizon);
    u.uSunCol.value.copy(this.sunCol);
    u.uTime.value += dt;
    u.uNight.value = this.night;
    u.uStorm.value = st;
    u.uFlash.value = this.flash;
    this.dome.position.copy(cam.position);

    // lights
    const sunI = smoothstep(-0.03, 0.25, e) * 3.6 * (1 - st * 0.7);
    const moonI = (1 - smoothstep(-0.25, 0.0, e)) * 0.55 * (1 - st * 0.6);
    const useSun = sunI >= moonI;
    const L = useSun ? this.sunDir : this.moonDir;
    this.sun.intensity = Math.max(sunI, moonI) + this.flash * 2;
    if (useSun) this.sun.color.copy(this.sunCol).lerp(this.tmp.set("#ffffff"), 0.15);
    else this.sun.color.set("#9db8ff");
    // snap shadow target
    const tex = (this.shadowExt * 2) / this.shadowRes;
    const fx = Math.round(focus.x / (tex * 4)) * tex * 4;
    const fz = Math.round(focus.z / (tex * 4)) * tex * 4;
    const fy = Math.round(focus.y / (tex * 4)) * tex * 4;
    this.sun.target.position.set(fx, fy, fz);
    this.sun.position.set(fx + L.x * 150, fy + L.y * 150 + 10, fz + L.z * 150);
    this.sun.target.updateMatrixWorld();

    this.hemi.color.copy(this.zenith).lerp(this.tmp.set("#ffffff"), 0.35);
    this.hemi.groundColor.set("#3a4a33").lerp(this.tmp.set("#0a0c14"), this.night * 0.8);
    this.hemi.intensity = lerp(0.28, 0.85, day) * (1 - st * 0.2) + this.flash * 0.6;
    this.renderer.toneMappingExposure = lerp(1.15, 0.95, day) + (1 - st) * 0.0;

    // fog
    this.fog.color.copy(this.horizon).multiplyScalar(0.92);
    const fogBase = 0.0031 + st * 0.0042 + (region === 4 ? 0.0009 : 0) + (region === 3 ? 0.0004 : 0) + this.night * 0.0004;
    this.fog.density = damp(this.fog.density, fogBase, 0.6, dt);
    (this.scene as any).backgroundIntensity = 1;
    // env map refresh
    this.envTimer -= dt;
    if (this.envTimer <= 0) {
      this.envTimer = 25;
      this.refreshEnv();
    }
    const envI = lerp(0.16, 0.55, day) * (1 - st * 0.3);
    (this.scene as any).environmentIntensity = envI;

    // rain
    const ru = (this.rain.material as THREE.ShaderMaterial).uniforms;
    this.rain.visible = st > 0.12;
    ru.uTime.value += dt;
    ru.uCam.value.copy(cam.position);
    ru.uOpacity.value = clamp(st * 1.3 - 0.1, 0, 1);

    // motes by region
    this.updateMotes(dt, cam, region, day);
  }

  refreshEnv() {
    const prev = this.envRT;
    this.envRT = this.pmrem.fromScene(this.envScene, 0, 0.1, 1000);
    this.scene.environment = this.envRT.texture;
    if (prev) prev.dispose();
  }

  private updateMotes(dt: number, cam: THREE.Camera, region: number, day: number) {
    const night = this.night;
    const u = this.moteUni;
    let col: THREE.Color;
    let drift: [number, number, number];
    let size: number;
    let op: number;
    switch (region) {
      case 0:
        col = night > 0.5 ? this.tmp.set("#b6ff6a") : this.tmp.set("#fff3c0");
        drift = [0.1, night > 0.5 ? 0.05 : 0.15, 0.08];
        size = night > 0.5 ? 70 : 28;
        op = night > 0.5 ? 1.2 : 0.55;
        break;
      case 1:
        col = this.tmp.set("#ffd98a");
        drift = [0.2, 0.25, 0.1];
        size = 32;
        op = 0.65;
        break;
      case 2:
        col = this.tmp.set("#ff7a32");
        drift = [0.5, 1.4, 0.2];
        size = 36;
        op = 1.1;
        break;
      case 3:
        col = this.tmp.set("#7ae8ff");
        drift = [0.05, 0.3, 0.05];
        size = 55;
        op = 1.2;
        break;
      default:
        col = this.tmp.set("#ffffff");
        drift = [0.8, -1.6, 0.4];
        size = 44;
        op = 1.1;
    }
    this.moteCol.lerp(col, 1 - Math.exp(-dt * 1.5));
    this.moteDrift.x = damp(this.moteDrift.x, drift[0], 1.2, dt);
    this.moteDrift.y = damp(this.moteDrift.y, drift[1], 1.2, dt);
    this.moteDrift.z = damp(this.moteDrift.z, drift[2], 1.2, dt);
    this.moteSize = damp(this.moteSize, size, 1.5, dt);
    this.moteOp = damp(this.moteOp, op * (this.storm > 0.5 ? 0.3 : 1) * (0.5 + 0.5 * (region === 0 ? 1 - day * 0.4 : 1)), 1.5, dt);
    u.uTime.value += dt;
    u.uCam.value.copy(cam.position);
    u.uColor.value.copy(this.moteCol);
    u.uDrift.value.copy(this.moteDrift);
    u.uSize.value = this.moteSize;
    u.uOpacity.value = this.moteOp;
    u.uScale.value = this.renderer.domElement.height * 0.5;
  }
}
