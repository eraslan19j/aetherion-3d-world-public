import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { World } from "./world";
import { SkySystem } from "./sky";
import { Particles, Debris, Rings, Lightning, LightManager, Decals } from "./fx";
import { Character } from "./player";
import { Input } from "./input";
import { audio } from "./audio";
import { hudStore, uiStore, settingsStore, pushToast, showBanner } from "./store";
import { groundH, groundN, regionAt, REGIONS, SITES, siteH, surfaceAt, waterLevelAt, WORLD_R, pools } from "./terrain";
import { standHeight, pushOut, pointHits } from "./collide";
import { U } from "./materials";
import { clamp, damp, dampAngle, lerp, smoothstep } from "./noise";

const gradeShader = {
  uniforms: {
    tDiffuse: { value: null as any },
    uTime: { value: 0 },
    uFlash: { value: 0 },
    uHurt: { value: 0 },
    uChroma: { value: 0 },
    uSat: { value: 1.12 },
    uVig: { value: 0.55 },
    uUnder: { value: 0 },
    uTint: { value: new THREE.Color(1, 1, 1) },
    uRes: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: `
  uniform sampler2D tDiffuse; uniform float uTime, uFlash, uHurt, uChroma, uSat, uVig, uUnder; uniform vec3 uTint; uniform vec2 uRes;
  varying vec2 vUv;
  float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }
  void main(){
    vec2 uv = vUv;
    uv += uUnder * 0.004 * vec2(sin(uv.y*40.0 + uTime*3.0), cos(uv.x*40.0 + uTime*2.5));
    vec2 c = uv - 0.5;
    float r2 = dot(c,c);
    vec2 off = c * uChroma * (0.4 + r2*4.0);
    vec3 col;
    col.r = texture2D(tDiffuse, uv + off).r;
    col.g = texture2D(tDiffuse, uv).g;
    col.b = texture2D(tDiffuse, uv - off).b;
    float l = dot(col, vec3(0.2126,0.7152,0.0722));
    col = mix(vec3(l), col, uSat);
    col *= uTint;
    // gentle filmic contrast in linear HDR
    col = col * (1.0 + 0.06*(1.0 - exp(-l*2.0)));
    col *= 1.0 - smoothstep(0.18, 0.85, r2*1.7) * uVig;
    col = mix(col, vec3(0.7,0.03,0.04) * (0.4 + l), smoothstep(0.05, 0.75, r2*2.2) * uHurt);
    col += uFlash * vec3(0.9,0.95,1.0);
    col += (hash(uv*uRes + fract(uTime)*37.0) - 0.5) * 0.012;
    gl_FragColor = vec4(col, 1.0);
  }`,
};

interface Quality {
  name: "low" | "medium" | "high";
  pr: number;
  shadows: boolean;
  shadowRes: number;
  shadowExt: number;
  bloom: boolean;
  bloomScale: number;
  msaa: number;
  veg: number;
  grass: number;
  particles: number;
  motes: number;
  cloudQ: number;
}

const QUALITIES: Record<string, Quality> = {
  low: { name: "low", pr: 1, shadows: false, shadowRes: 1024, shadowExt: 40, bloom: false, bloomScale: 0.5, msaa: 0, veg: 0.55, grass: 0.3, particles: 900, motes: 250, cloudQ: 3 },
  medium: { name: "medium", pr: 1.25, shadows: true, shadowRes: 1024, shadowExt: 52, bloom: true, bloomScale: 0.5, msaa: 2, veg: 0.8, grass: 0.62, particles: 2000, motes: 550, cloudQ: 4 },
  high: { name: "high", pr: 1.75, shadows: true, shadowRes: 2048, shadowExt: 72, bloom: true, bloomScale: 0.75, msaa: 4, veg: 1, grass: 1, particles: 3600, motes: 900, cloudQ: 5 },
};

interface Bolt {
  active: boolean;
  pos: THREE.Vector3;
  dir: THREE.Vector3;
  life: number;
}

const SPELLS = [
  { name: "Aether Oku", cd: 0.3, cost: 6, color: "#7fe7ff", dur: 0.38 },
  { name: "Titan Dalgası", cd: 3.2, cost: 25, color: "#ffd98a", dur: 0.8 },
  { name: "Yıldırım", cd: 6, cost: 35, color: "#b8a8ff", dur: 0.95 },
  { name: "Portal Adımı", cd: 3.5, cost: 20, color: "#c59bff", dur: 0.6 },
];

export class Game {
  container!: HTMLElement;
  renderer!: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(62, 1, 0.15, 1800);
  composer!: EffectComposer;
  bloom!: UnrealBloomPass;
  grade!: ShaderPass;
  sky!: SkySystem;
  fx!: { glow: Particles; smoke: Particles; debris: Debris; rings: Rings; lights: LightManager; lightning: Lightning; decals: Decals };
  world!: World;
  char = new Character();
  input = new Input();
  quality: Quality = QUALITIES.high;
  resScale = 1;
  basePR = 1;
  mode: "loading" | "menu" | "playing" | "paused" | "journal" | "dead" | "won" = "loading";
  running = false;
  ready = false;
  clock = new THREE.Clock();
  simTime = 0;
  frameMs = 16;
  fpsAcc = 0;
  fpsN = 0;
  resTimer = 0;
  hudTimer = 0;
  saveTimer = 0;

  // player
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  faceYaw = 0;
  yaw = 0; // camera yaw
  pitch = 0.25;
  camDist = 5.6;
  grounded = true;
  wasGrounded = true;
  coyote = 0;
  jumpBuffer = 0;
  airJumps = 1;
  gliding = false;
  swimming = false;
  hp = 100;
  maxHp = 100;
  energy = 100;
  maxEnergy = 100;
  shards = 0;
  level = 1;
  invuln = 0;
  alive = true;
  deadT = 0;
  castT = -1;
  castType = -1;
  castDur = 1;
  cdLeft = [0, 0, 0, 0];
  energyDelay = 0;
  interactT = -1;
  lastSpeed = 0;
  accel = 0;
  lastFace = 0;
  turn = 0;
  landImpact = 0;
  stepAcc = 0;
  pickupChain = 0;
  pickupChainT = 0;
  lastRegion = -1;
  regionCooldown = 0;
  burnT = 0;
  fallPeak = 0;
  surface = 0;
  trauma = 0;
  fovPulse = 0;
  flash = 0;
  hurtFx = 0;
  chroma = 0;
  focus = new THREE.Vector3();
  camPos = new THREE.Vector3();
  menuT = 0;
  camBlend = 0;
  bolts: Bolt[] = [];
  pendingLightning: { t: number; pos: THREE.Vector3 } | null = null;
  pendingPortal: { t: number; dest: THREE.Vector3; done: boolean } | null = null;
  aimPoint = new THREE.Vector3();
  aimHit = false;
  muzzle = new THREE.Vector3();
  combat = false;
  dayTimeScale = 1;
  autostart = false;
  boltFlash = 0;
  noiseT = 0;

  async init(container: HTMLElement, onProgress: (p: number, t: string) => void) {
    this.container = container;
    const canvas = document.createElement("canvas");
    canvas.style.cssText = "width:100%;height:100%;display:block;touch-action:none;outline:none";
    container.appendChild(canvas);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance", stencil: false, alpha: false });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor(0x000000, 1);
    this.scene.background = null;

    this.sky = new SkySystem(this.scene, this.renderer);
    this.sky.onThunder = () => audio.thunderFar();
    this.fx = {
      glow: new Particles(4200, true),
      smoke: new Particles(900, false),
      debris: new Debris(260),
      rings: new Rings(8),
      lights: new LightManager(this.scene, 6),
      lightning: new Lightning(),
      decals: new Decals(10),
    };
    this.scene.add(this.fx.glow.points, this.fx.smoke.points, this.fx.debris.mesh, this.fx.rings.group, this.fx.lightning.mesh, this.fx.decals.group);
    this.world = new World(this.scene, this.fx, this.sky);
    this.setupEvents();
    this.scene.add(this.char.root);
    this.char.root.visible = false;
    this.char.onStep = (foot) => this.onFootstep(foot);

    // composer
    this.setupComposer();
    this.applyQuality();
    window.addEventListener("resize", this.onResize);
    window.addEventListener("orientationchange", () => setTimeout(this.onResize, 250));
    this.setupInputEvents(canvas);
    document.addEventListener("pointerlockchange", this.onLockChange);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && this.mode === "playing") this.pause();
    });
    window.addEventListener("blur", () => {
      if (this.mode === "playing" && !uiStore.get().isTouch) this.pause();
    });
    settingsStore.subscribe(() => this.onSettings());

    // start rendering menu backdrop immediately
    this.camera.position.set(0, 60, 220);
    this.running = true;
    this.clock.start();
    requestAnimationFrame(this.loop);

    this.world.root.visible = false;
    await this.world.build(onProgress);
    this.ready = true;
    this.fx.lights.update(0, new THREE.Vector3(0, 30, 150));
    this.sky.refreshEnv();
    this.sky.t = 0.3;
    // tweak for menu
    const save = this.readSave();
    uiStore.set({ hasSave: !!save });
    this.mode = "menu";
    uiStore.set({ screen: "menu", ready: true });
    onProgress(1, "Hazır");
    this.world.root.visible = true;
  }

  setupComposer() {
    const size = new THREE.Vector2();
    this.renderer.getSize(size);
    const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: this.quality.msaa });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.55, 0.65, 0.92);
    this.composer.addPass(this.bloom);
    this.grade = new ShaderPass(gradeShader as any);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
  }

  effectiveQuality(): Quality {
    const s = settingsStore.get().quality;
    if (s !== "auto") return QUALITIES[s];
    const touch = uiStore.get().isTouch;
    if (touch) return { ...QUALITIES.medium, pr: 1, msaa: 0, shadowRes: 1024, shadowExt: 42, veg: 0.65, grass: 0.45, particles: 1400, motes: 350, bloomScale: 0.4, cloudQ: 3 };
    const cores = navigator.hardwareConcurrency || 4;
    return cores >= 6 ? QUALITIES.high : QUALITIES.medium;
  }

  applyQuality() {
    this.quality = this.effectiveQuality();
    const q = this.quality;
    const dpr = window.devicePixelRatio || 1;
    this.basePR = Math.min(dpr, q.pr);
    this.sky.setQuality({ shadows: q.shadows, shadowRes: q.shadowRes, shadowExt: q.shadowExt, cloudQ: q.cloudQ, motes: q.motes });
    this.renderer.shadowMap.enabled = q.shadows;
    this.world.vegScale = q.veg;
    this.world.grassDensity = q.grass;
    this.fx.glow.setLimit(q.particles);
    this.fx.smoke.setLimit(Math.floor(q.particles * 0.25));
    this.bloom.enabled = q.bloom;
    (this.composer.renderTarget1 as any).samples = q.msaa;
    (this.composer.renderTarget2 as any).samples = q.msaa;
    this.composer.renderTarget1.dispose();
    this.composer.renderTarget2.dispose();
    this.resScale = 1;
    this.onResize();
    // force material recompile for shadow toggles
    this.scene.traverse((o: any) => {
      if (o.material) {
        const ms = Array.isArray(o.material) ? o.material : [o.material];
        ms.forEach((m: any) => (m.needsUpdate = true));
      }
    });
    hudStore.set({ quality: q.name });
  }

  onSettings() {
    const s = settingsStore.get();
    audio.setVolumes({ master: s.master, music: s.music, sfx: s.sfx });
    if (this.lastQuality !== s.quality) {
      this.lastQuality = s.quality;
      this.applyQuality();
    }
  }
  lastQuality = settingsStore.get().quality;

  onResize = () => {
    if (!this.renderer) return;
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    const pr = this.basePR * this.resScale;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w * pr * this.quality.bloomScale, h * pr * this.quality.bloomScale);
    this.bloom.setSize(w * pr * this.quality.bloomScale, h * pr * this.quality.bloomScale);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.grade.uniforms.uRes.value.set(w * pr, h * pr);
    uiStore.set({ portrait: h > w * 1.05 && uiStore.get().isTouch });
    const dh = this.renderer.domElement.height;
    this.fx.glow.mat.uniforms.uScale.value = dh * 0.5 * 1.0;
    this.fx.smoke.mat.uniforms.uScale.value = dh * 0.5 * 1.0;
  };

  // --------------- events from world ---------------
  setupEvents() {
    const self = this;
    this.world.ev = {
      toast: (t, k, s) => pushToast(t, k as any, s),
      banner: (t, s) => showBanner(t, s),
      sfx: (n: string, ...a: any[]) => {
        const f = (audio as any)[n];
        if (typeof f === "function") f.apply(audio, a);
      },
      pickup: (type) => self.onPickup(type),
      obelisk: (i) => self.onObelisk(i),
      gateOpen: () => {
        pushToast("Eterya Kapısı açıldı!", "quest", "Kapıdan geçerek yolculuğunu tamamla");
        showBanner("Kapı Açıldı", "Eterya Kapısı'na ilerle");
        self.addTrauma(0.8);
        self.flash = Math.max(self.flash, 0.5);
        audio.victory();
        self.saveGame();
      },
      victory: () => self.win(),
      shrine: (x, y, z) => {
        void x;
        void y;
        void z;
        self.hp = self.maxHp;
        self.energy = self.maxEnergy;
        self.saveGame();
      },
      teleport: (x, y, z) => self.teleportTo(x, y, z),
      shake: (a) => self.addTrauma(a),
      hurtPlayer: (d, f, kb) => self.hurt(d, f, kb),
      killed: () => hudStore.set({ kills: self.world.gp.kills }),
      levelProgress: () => {},
    };
    this.sky.onThunder = () => audio.thunderFar();
  }

  onPickup(type: number) {
    if (type === 0) {
      this.shards++;
      this.pickupChain = this.pickupChainT > 0 ? this.pickupChain + 1 : 0;
      this.pickupChainT = 1.2;
      audio.pickup(this.pickupChain);
      const lvl = 1 + Math.floor(this.shards / 6);
      if (lvl > this.level) {
        this.level = lvl;
        this.updateStats(true);
        audio.levelUp();
        pushToast(`Seviye ${lvl}!`, "shard", "Azami can ve enerji arttı");
        this.flash = Math.max(this.flash, 0.25);
        this.fovPulse = 6;
        this.fx.rings.spawn(this.pos.x, this.pos.y + 0.2, this.pos.z, 8, 1, "#ffd98a", "flat", 0.1);
      }
    } else if (type === 1) {
      this.hp = Math.min(this.maxHp, this.hp + 14);
      audio.heal();
    } else {
      this.energy = Math.min(this.maxEnergy, this.energy + 28);
      audio.pickup(3);
    }
  }

  updateStats(heal = false) {
    this.maxHp = 100 + (this.level - 1) * 12;
    this.maxEnergy = 100 + (this.level - 1) * 10;
    if (heal) {
      this.hp = this.maxHp;
      this.energy = this.maxEnergy;
    }
  }

  onObelisk(i: number) {
    const gp = this.world.gp;
    const n = gp.runeCount;
    pushToast("Obelisk uyandı!", "quest", `${gp.obelisks[i].name} · ${n}/4`);
    showBanner(`Obelisk ${n}/4`, gp.obelisks[i].name);
    this.addTrauma(1);
    this.flash = Math.max(this.flash, 0.35);
    this.chroma = 0.012;
    this.sky.flash = Math.max(this.sky.flash, 0.4);
    this.saveGame();
  }

  win() {
    if (this.mode !== "playing") return;
    this.mode = "won";
    audio.victory();
    this.flash = 1;
    this.releaseLock();
    uiStore.set({ screen: "won" });
    try {
      localStorage.removeItem("aetherion.save");
      uiStore.set({ hasSave: false });
    } catch {
      /* ignore */
    }
  }

  // --------------- input ---------------
  setupInputEvents(canvas: HTMLCanvasElement) {
    window.addEventListener("keydown", (e) => {
      if (this.mode === "playing" || this.mode === "journal") {
        if (["Space", "Tab", "ArrowUp", "ArrowDown"].includes(e.code)) e.preventDefault();
      }
      this.input.keyDown(e);
      if (e.code === "KeyF" && e.altKey) return;
    });
    window.addEventListener("keyup", (e) => this.input.keyUp(e));
    canvas.addEventListener("mousedown", (e) => {
      if (this.mode !== "playing") return;
      if (!uiStore.get().isTouch && document.pointerLockElement !== canvas) {
        this.requestLock();
        return;
      }
      if (e.button === 0) this.input.firing = true;
      if (e.button === 2) this.input.spellQueue.push(1);
    });
    window.addEventListener("mouseup", (e) => {
      if (e.button === 0) this.input.firing = false;
    });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    window.addEventListener("mousemove", (e) => {
      if (this.mode !== "playing") return;
      if (document.pointerLockElement === canvas) {
        this.input.lookDX += e.movementX;
        this.input.lookDY += e.movementY;
      }
    });
    canvas.addEventListener(
      "wheel",
      (e) => {
        this.camDist = clamp(this.camDist + e.deltaY * 0.004, 3, 9);
      },
      { passive: true }
    );
  }

  requestLock() {
    if (uiStore.get().isTouch) return;
    const c = this.renderer.domElement as any;
    try {
      const p = c.requestPointerLock?.({ unadjustedMovement: true });
      if (p && p.catch) p.catch(() => c.requestPointerLock?.());
    } catch {
      /* ignore */
    }
  }
  releaseLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }
  onLockChange = () => {
    const locked = document.pointerLockElement === this.renderer.domElement;
    uiStore.set({ locked });
    if (!locked && this.mode === "playing" && !uiStore.get().isTouch) this.pause();
  };

  // --------------- game flow ---------------
  readSave(): any | null {
    try {
      const raw = localStorage.getItem("aetherion.save");
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  saveGame() {
    if (!this.ready || !this.alive) return;
    try {
      const data = {
        v: 1,
        pos: [this.pos.x, this.pos.y, this.pos.z],
        hp: this.hp,
        energy: this.energy,
        shards: this.shards,
        level: this.level,
        t: this.sky.t,
        world: this.world.gp.getState(),
      };
      localStorage.setItem("aetherion.save", JSON.stringify(data));
      uiStore.set({ hasSave: true });
    } catch {
      /* ignore */
    }
  }

  startNew() {
    try {
      localStorage.removeItem("aetherion.save");
    } catch {
      /* ignore */
    }
    this.world.gp.reset();
    this.shards = 0;
    this.beginPlay(null);
  }

  continueGame() {
    const s = this.readSave();
    if (!s) return this.startNew();
    this.beginPlay(s);
  }

  beginPlay(save: any | null) {
    audio.init();
    audio.uiStart();
    const gp = this.world.gp;
    if (save) {
      this.level = save.level || 1;
      this.shards = save.shards || 0;
      this.updateStats();
      this.hp = clamp(save.hp ?? this.maxHp, 20, this.maxHp);
      this.energy = save.energy ?? this.maxEnergy;
      gp.applyState(save.world);
      this.pos.set(save.pos[0], save.pos[1], save.pos[2]);
      this.sky.t = save.t ?? 0.3;
    } else {
      this.level = 1;
      this.shards = 0;
      this.updateStats(true);
      const sp = SITES.spawn;
      this.pos.set(sp.x, groundH(sp.x, sp.z + 8) + 0.1, sp.z + 8);
      this.sky.t = 0.28;
    }
    this.pos.y = Math.max(this.pos.y, groundH(this.pos.x, this.pos.z));
    this.vel.set(0, 0, 0);
    this.faceYaw = Math.PI; // facing -z (towards the city)
    this.yaw = Math.PI;
    this.pitch = 0.22;
    this.alive = true;
    this.deadT = 0;
    this.grounded = true;
    this.char.root.visible = true;
    this.camBlend = 0;
    this.mode = "playing";
    this.input.reset();
    uiStore.set({ screen: "playing" });
    this.focus.set(this.pos.x, this.pos.y + 1.5, this.pos.z);
    this.lastRegion = -1;
    this.requestLock();
    this.fovPulse = 10;
    this.flash = 0.6;
    this.trauma = 0;
    if (!save) {
      setTimeout(() => {
        showBanner("AETHERION", "Eter yeniden uyanıyor…");
        pushToast("Hoş geldin, Eter Gezgini", "quest", "Dört obeliski uyandır · Fare/WASD ile keşfet · Sol tık: Aether Oku");
      }, 900);
    } else {
      pushToast("Yolculuk devam ediyor", "info");
    }
    this.world.update(0.016, this.playerState());
  }

  pause() {
    if (this.mode !== "playing") return;
    this.mode = "paused";
    this.input.reset();
    this.releaseLock();
    this.saveGame();
    uiStore.set({ screen: "paused" });
    audio.uiOpen();
  }
  resume() {
    if (this.mode !== "paused" && this.mode !== "journal") return;
    this.mode = "playing";
    this.input.reset();
    uiStore.set({ screen: "playing" });
    this.requestLock();
  }
  journalFrom: "playing" | "paused" = "playing";
  closeJournal() {
    if (this.mode !== "journal") return;
    if (this.journalFrom === "paused") {
      this.mode = "paused";
      uiStore.set({ screen: "paused" });
    } else this.resume();
  }
  openJournal() {
    if (this.mode !== "playing" && this.mode !== "paused") return;
    this.journalFrom = this.mode as "playing" | "paused";
    this.mode = "journal";
    this.input.reset();
    uiStore.set({ screen: "journal" });
    this.releaseLock();
    audio.uiOpen();
  }
  toMenu() {
    this.saveGame();
    location.reload();
  }
  respawn() {
    const gp = this.world.gp;
    this.pos.copy(gp.respawn);
    this.pos.y = Math.max(this.pos.y, groundH(this.pos.x, this.pos.z)) + 0.1;
    this.vel.set(0, 0, 0);
    this.alive = true;
    this.deadT = 0;
    this.hp = this.maxHp;
    this.energy = this.maxEnergy;
    this.mode = "playing";
    this.input.reset();
    uiStore.set({ screen: "playing" });
    this.requestLock();
    this.flash = 0.8;
    this.invuln = 2;
    this.focus.set(this.pos.x, this.pos.y + 1.5, this.pos.z);
    pushToast("Sunakta yeniden doğdun", "info");
    audio.heal();
  }

  die() {
    if (!this.alive) return;
    this.alive = false;
    this.deadT = 0;
    audio.gameOver();
    this.addTrauma(1);
    this.input.reset();
  }

  hurt(d: number, from: THREE.Vector3, kb: number) {
    if (!this.alive || this.invuln > 0 || this.mode !== "playing") return;
    this.hp -= d;
    this.invuln = 0.7;
    this.hurtFx = 1;
    this.chroma = 0.01;
    this.addTrauma(0.5);
    audio.hurt();
    const dx = this.pos.x - from.x;
    const dz = this.pos.z - from.z;
    const l = Math.hypot(dx, dz) || 1;
    this.vel.x += (dx / l) * kb;
    this.vel.z += (dz / l) * kb;
    this.vel.y = Math.max(this.vel.y, 4);
    this.grounded = false;
    this.fx.glow.burst(this.pos.x, this.pos.y + 1.2, this.pos.z, 14, 5, 0.5, 0.8, 2, 0.2, 0.2, 4, 1);
    if (this.hp <= 0) {
      this.hp = 0;
      this.die();
    }
  }

  addTrauma(a: number) {
    this.trauma = Math.min(1, this.trauma + a * settingsStore.get().shake);
  }

  teleportTo(x: number, y: number, z: number) {
    this.fx.rings.spawn(this.pos.x, this.pos.y + 1, this.pos.z, 4, 0.7, "#7fe7ff", new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.faceYaw));
    this.fx.glow.burst(this.pos.x, this.pos.y + 1, this.pos.z, 50, 6, 1, 1, 0.5, 1.8, 2.4, -1, 1);
    audio.portal();
    this.pos.set(x, y + 0.1, z);
    this.vel.set(0, 0, 0);
    this.fx.glow.burst(x, y + 1, z, 60, 7, 1, 1, 0.5, 1.8, 2.4, -1, 1);
    this.fx.lights.flash(x, y + 1.5, z, "#7fe7ff", 120, 24, 0.9);
    this.fovPulse = 14;
    this.flash = Math.max(this.flash, 0.6);
    this.chroma = 0.018;
    this.focus.set(x, y + 1.5, z);
    this.camBlend = 1;
  }

  // --------------- footsteps ---------------
  onFootstep(foot: number) {
    void foot;
    if (!this.grounded || this.swimming) return;
    const sprint = this.input.sprintHeld;
    audio.footstep(this.surface, sprint);
    const y = this.pos.y;
    if (this.surface === 2 || this.surface === 3 || this.surface === 0) {
      const c = this.surface === 2 ? [0.9, 0.95, 1] : this.surface === 3 ? [0.6, 0.45, 0.3] : [0.3, 0.35, 0.2];
      for (let i = 0; i < 3; i++)
        this.fx.smoke.spawn(this.pos.x + (Math.random() - 0.5) * 0.3, y + 0.1, this.pos.z + (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.8, 0.5 + Math.random() * 0.6, (Math.random() - 0.5) * 0.8, 0.6, 0.35, c[0], c[1], c[2], 0.35, 0, 2, 0.5);
    }
    this.addTrauma(0.01);
  }

  // --------------- main loop ---------------
  loop = () => {
    if (!this.running) return;
    requestAnimationFrame(this.loop);
    let dt = this.clock.getDelta();
    if (dt > 0.1) dt = 0.1;
    const raw = dt;
    try {
      this.frame(dt, raw);
    } catch (e) {
      console.error("frame error", e);
    }
  };

  playerState() {
    return {
      pos: this.pos,
      vel: this.vel,
      grounded: this.grounded,
      cam: this.camera.position,
      alive: this.alive,
      speed: Math.hypot(this.vel.x, this.vel.z),
    };
  }

  frame(dt: number, raw: number) {
    this.simTime += dt;
    // fps/adaptive resolution
    this.frameMs = lerp(this.frameMs, raw * 1000, 0.05);
    this.fpsAcc += raw;
    this.fpsN++;
    this.resTimer += raw;
    if (this.resTimer > 1.4 && this.ready) {
      this.resTimer = 0;
      let ns = this.resScale;
      if (this.frameMs > 24 && ns > 0.55) ns -= 0.08;
      else if (this.frameMs < 14.5 && ns < 1) ns += 0.05;
      ns = clamp(ns, 0.55, 1);
      if (Math.abs(ns - this.resScale) > 0.01) {
        this.resScale = ns;
        this.onResize();
      }
    }

    const playing = this.mode === "playing";
    const simDt = playing ? dt : 0;
    if (!this.ready) {
      this.updateMenuCamera(dt);
      this.sky.update(dt, this.camera, this.camera.position, 0, dt);
      this.render(dt);
      return;
    }

    // inputs
    if (this.input.pausePressed) {
      this.input.pausePressed = false;
      if (this.mode === "playing") this.pause();
      else if (this.mode === "paused") this.resume();
      else if (this.mode === "journal") this.closeJournal();
    }
    if (this.input.journalPressed) {
      this.input.journalPressed = false;
      if (this.mode === "playing") this.openJournal();
      else if (this.mode === "journal") this.closeJournal();
    }

    if (playing) this.updatePlayer(simDt);
    else if (this.mode === "menu") this.updateMenuCamera(dt);
    else if (this.mode === "dead" || this.mode === "won") this.updateDeadCamera(dt);

    if (this.mode === "playing" && !this.alive) {
      this.deadT += dt;
      if (this.deadT > 1.8) {
        this.mode = "dead";
        this.releaseLock();
        uiStore.set({ screen: "dead" });
      }
    }

    // world & fx update
    const ps = this.playerState();
    const worldDt = this.mode === "paused" || this.mode === "journal" ? 0 : dt;
    if (worldDt > 0) this.world.update(worldDt, ps);
    else this.world.update(0.0001, ps);
    this.sky.update(dt, this.camera, this.pos.lengthSq() ? this.pos : this.camera.position, this.currentRegion(), worldDt);
    this.fx.glow.update(worldDt);
    this.fx.smoke.update(worldDt);
    this.fx.debris.update(worldDt);
    this.fx.rings.update(worldDt);
    this.fx.lightning.update(worldDt);
    this.fx.decals.update(worldDt);
    this.fx.lights.update(dt, this.camera.position);
    this.updateBolts(worldDt);
    this.updateCamera(dt);
    this.updateAudio(dt);
    this.updateHud(raw);
    if (playing) {
      this.saveTimer += dt;
      if (this.saveTimer > 20) {
        this.saveTimer = 0;
        this.saveGame();
      }
    }
    this.render(dt);
  }

  currentRegion() {
    if (this.lastRegion >= 0) return this.lastRegion;
    return 0;
  }

  render(dt: number) {
    const g = this.grade.uniforms;
    g.uTime.value += dt;
    this.flash = Math.max(0, this.flash - dt * 1.6);
    this.hurtFx = Math.max(0, this.hurtFx - dt * 1.4);
    this.chroma = Math.max(0, this.chroma - dt * 0.03);
    g.uFlash.value = this.flash * 0.6 + this.sky.flash * 0.35;
    g.uHurt.value = this.hurtFx * 0.6 + (this.alive ? clamp(1 - this.hp / this.maxHp - 0.55, 0, 1) * 0.7 * (0.6 + 0.4 * Math.sin(g.uTime.value * 4)) : 0.8);
    g.uChroma.value = this.chroma + this.trauma * 0.004;
    const water = this.swimming && this.camera.position.y < this.waterLevel() ? 1 : 0;
    g.uUnder.value = damp(g.uUnder.value, water, 8, dt);
    const day = clamp(this.sky.elev * 2, 0, 1);
    const reg = this.lastRegion;
    // regional grading tint
    const tint = g.uTint.value as THREE.Color;
    const target = new THREE.Color(1, 1, 1);
    if (reg === 2) target.set(1.06, 0.98, 0.9);
    else if (reg === 3) target.set(0.96, 0.96, 1.08);
    else if (reg === 4) target.set(0.96, 1.0, 1.08);
    else if (reg === 0) target.set(0.98, 1.04, 0.99);
    if (water) target.multiply(new THREE.Color(0.55, 0.85, 1.1));
    tint.lerp(target, 1 - Math.exp(-dt * 1.2));
    g.uSat.value = 1.1 + (1 - day) * 0.05;
    this.bloom.strength = 0.5 + this.flash * 0.8 + this.sky.flash * 0.5 + (1 - day) * 0.12;
    this.bloom.threshold = 0.9;
    this.composer.render(dt);
  }

  waterLevel() {
    return waterLevelAt(this.camera.position.x, this.camera.position.z);
  }

  // --------------- camera ---------------
  updateMenuCamera(dt: number) {
    this.menuT += dt;
    const a = this.menuT * 0.04 + 0.6;
    const R = 175;
    const cx = 0;
    const cz = 40;
    const tx = cx + Math.cos(a) * R;
    const tz = cz + Math.sin(a) * R;
    const th = ready_h(tx, tz, this.ready);
    this.camera.position.set(tx, Math.max(th + 18, 50) + Math.sin(this.menuT * 0.1) * 6, tz);
    this.camera.lookAt(0, 70, 0);
    this.camera.fov = 58;
    this.camera.updateProjectionMatrix();
  }

  updateDeadCamera(dt: number) {
    this.updateCamera(dt);
  }

  updateCamera(dt: number) {
    const cam = this.camera;
    if (this.mode === "menu" || !this.ready) return;
    const set = settingsStore.get();
    // look
    if (this.mode === "playing" && this.alive) {
      const sens = 0.0022 * set.sens;
      this.yaw -= this.input.lookDX * sens;
      this.pitch += this.input.lookDY * sens * (set.invertY ? -1 : 1);
      this.pitch = clamp(this.pitch, -0.9, 1.25);
    }
    this.input.lookDX = 0;
    this.input.lookDY = 0;
    // focus follows player
    const tx = this.pos.x;
    const ty = this.pos.y + 1.55 - (this.swimming ? 0.6 : 0);
    const tz = this.pos.z;
    this.focus.x = damp(this.focus.x, tx, 22, dt);
    this.focus.z = damp(this.focus.z, tz, 22, dt);
    this.focus.y = damp(this.focus.y, ty, this.grounded ? 9 : 5, dt);
    if (this.camBlend >= 1) {
      this.focus.x = tx;
      this.focus.z = tz;
    }
    const sp = Math.hypot(this.vel.x, this.vel.z);
    const dist = this.camDist + sp * 0.04 + (this.gliding ? 1.2 : 0);
    const cp = Math.cos(this.pitch);
    const dir = new THREE.Vector3(Math.sin(this.yaw) * cp, -Math.sin(this.pitch), Math.cos(this.yaw) * cp);
    const right = new THREE.Vector3(-Math.cos(this.yaw), 0, Math.sin(this.yaw));
    const f = this.focus.clone().addScaledVector(right, 0.55);
    // spring arm with collision
    let t = 1;
    const desired = f.clone().addScaledVector(dir, -dist);
    for (let i = 1; i <= 14; i++) {
      const k = i / 14;
      const p = f.clone().lerp(desired, k);
      if (p.y < groundH(p.x, p.z) + 0.35 || pointHits(this.world.colliders, p.x, p.y, p.z)) {
        t = Math.max(0.12, (i - 1.8) / 14);
        break;
      }
    }
    const wanted = f.clone().lerp(desired, t);
    wanted.y = Math.max(wanted.y, groundH(wanted.x, wanted.z) + 0.45);
    if (this.camBlend < 1) {
      this.camBlend = Math.min(1, this.camBlend + dt * 0.7);
      const e = smoothstep(0, 1, this.camBlend);
      this.camPos.lerp(wanted, 1 - Math.exp(-dt * (1 + e * 6)));
      if (this.camBlend > 0.98) this.camPos.copy(wanted);
    } else {
      // pull-in is immediate, push-out is smoothed
      const cur = this.camPos.distanceTo(f);
      const want = wanted.distanceTo(f);
      if (want < cur) this.camPos.copy(wanted);
      else this.camPos.lerp(wanted, 1 - Math.exp(-dt * 10));
      this.camPos.x = lerp(this.camPos.x, wanted.x, 1 - Math.exp(-dt * 30));
      this.camPos.z = lerp(this.camPos.z, wanted.z, 1 - Math.exp(-dt * 30));
    }
    cam.position.copy(this.camPos);
    // shake
    this.trauma = Math.max(0, this.trauma - dt * 0.9);
    this.noiseT += dt * 30;
    const sh = this.trauma * this.trauma;
    if (sh > 0.0001) {
      cam.position.x += Math.sin(this.noiseT * 1.3) * sh * 0.35;
      cam.position.y += Math.sin(this.noiseT * 1.7 + 2) * sh * 0.3;
      cam.position.z += Math.sin(this.noiseT * 1.1 + 4) * sh * 0.35;
    }
    cam.lookAt(f.x + dir.x * 6, f.y + dir.y * 6, f.z + dir.z * 6);
    if (sh > 0.0001) cam.rotateZ(Math.sin(this.noiseT * 0.9) * sh * 0.04);
    // fov
    this.fovPulse = damp(this.fovPulse, 0, 3.5, dt);
    const fovT = 62 + clamp(sp - 5, 0, 5) * 1.3 + (this.gliding ? 7 : 0) + this.fovPulse;
    cam.fov = damp(cam.fov, fovT, 6, dt);
    cam.updateProjectionMatrix();
  }

  // --------------- aim ---------------
  computeAim() {
    const cam = this.camera;
    const dir = new THREE.Vector3();
    cam.getWorldDirection(dir);
    const origin = cam.position.clone();
    // start a bit in front of character to avoid self-hits
    const start = origin.clone().addScaledVector(dir, this.camDist * 0.9);
    const gp = this.world.gp;
    const p = new THREE.Vector3();
    this.aimHit = false;
    // auto-assist: nearest enemy near the aim ray
    let bestE: THREE.Vector3 | null = null;
    let bestScore = 0.07;
    for (const e of gp.enemies) {
      if (e.dead || e.removed) continue;
      const c = new THREE.Vector3(e.pos.x, gp.enemyCenterY(e), e.pos.z);
      const to = c.clone().sub(start);
      const d = to.length();
      if (d > 45 || d < 3) continue;
      to.divideScalar(d);
      const dot = to.dot(dir);
      const ang = 1 - dot;
      if (ang < bestScore) {
        bestScore = ang;
        bestE = c;
      }
    }
    for (let d = 2; d < 80; d += 1.5) {
      p.copy(start).addScaledVector(dir, d);
      const hit = gp.boltCollide(p, 0.2);
      if (hit) {
        this.aimPoint.copy(p);
        this.aimHit = true;
        break;
      }
      this.aimPoint.copy(p);
    }
    if (bestE) {
      this.aimPoint.copy(bestE);
      this.aimHit = true;
    }
    return dir;
  }

  // --------------- player update ---------------
  updatePlayer(dt: number) {
    const inp = this.input;
    inp.poll();
    this.invuln = Math.max(0, this.invuln - dt);
    this.pickupChainT -= dt;
    const w = this.world;
    const gp = w.gp;

    if (!this.alive) {
      // ragdoll-ish: slide to stop
      this.vel.x = damp(this.vel.x, 0, 3, dt);
      this.vel.z = damp(this.vel.z, 0, 3, dt);
      this.moveAndCollide(dt, 0, 0, false);
      this.animate(dt);
      return;
    }

    // intents
    const wantJump = inp.jumpPressed;
    inp.jumpPressed = false;
    if (wantJump) this.jumpBuffer = 0.14;
    this.jumpBuffer -= dt;

    // movement vector relative to camera yaw
    const fx = Math.sin(this.yaw);
    const fz = Math.cos(this.yaw);
    const rx = -Math.cos(this.yaw);
    const rz = Math.sin(this.yaw);
    let mx = fx * inp.moveY + rx * inp.moveX;
    let mz = fz * inp.moveY + rz * inp.moveX;
    const mlen = Math.hypot(mx, mz);
    const moving = mlen > 0.05;
    const sprint = inp.sprintHeld && moving;
    const castSlow = this.castT >= 0 && this.castType !== 3 ? 0.55 : 1;
    let maxSpeed = (sprint ? 9.2 : 5.4) * castSlow * Math.min(1, mlen);
    if (this.swimming) maxSpeed = 3.6 * Math.min(1, mlen);
    if (moving) {
      mx /= mlen;
      mz /= mlen;
    }
    const tvx = mx * maxSpeed;
    const tvz = mz * maxSpeed;
    let accel = this.grounded ? (moving ? 34 : 26) : 11;
    if (this.swimming) accel = 10;
    if (this.gliding) accel = 6;
    // acceleration towards target (limit)
    const dvx = tvx - this.vel.x;
    const dvz = tvz - this.vel.z;
    const dl = Math.hypot(dvx, dvz);
    const maxD = accel * dt;
    if (dl > maxD) {
      this.vel.x += (dvx / dl) * maxD;
      this.vel.z += (dvz / dl) * maxD;
    } else {
      this.vel.x = tvx;
      this.vel.z = tvz;
    }

    // water
    const wl = waterLevelAt(this.pos.x, this.pos.z);
    const wasSwim = this.swimming;
    this.swimming = wl > -1e8 && this.pos.y < wl - 0.55;
    if (this.swimming && !wasSwim) {
      audio.splash();
      this.fx.smoke.burst(this.pos.x, wl + 0.1, this.pos.z, 14, 4, 0.7, 0.8, 0.8, 0.9, 1, 4, 1.5, 2);
      this.fx.rings.spawn(this.pos.x, wl + 0.05, this.pos.z, 3.5, 0.9, "#bfeaff", "flat", 0.15);
      this.addTrauma(0.1);
    }
    // lava
    const lv = waterLevelAt(this.pos.x, this.pos.z, "lava");
    if (lv > -1e8 && this.pos.y < lv + 0.4) {
      this.burnT -= dt;
      if (this.burnT <= 0) {
        this.burnT = 0.6;
        this.hurt(14, new THREE.Vector3(this.pos.x, this.pos.y, this.pos.z), 0);
        audio.lavaBurn();
        this.vel.y = 12;
        this.grounded = false;
        this.fx.glow.burst(this.pos.x, this.pos.y + 0.5, this.pos.z, 30, 6, 0.8, 1, 2, 0.6, 0.1, 6, 1);
      }
    }

    // jump / airjump / glide
    this.coyote = this.grounded ? 0.12 : this.coyote - dt;
    if (this.jumpBuffer > 0) {
      if (this.swimming) {
        this.vel.y = 6.5;
        this.jumpBuffer = 0;
        this.grounded = false;
      } else if (this.coyote > 0 && this.grounded !== undefined && (this.grounded || this.coyote > 0)) {
        this.vel.y = 8.4;
        this.grounded = false;
        this.coyote = 0;
        this.jumpBuffer = 0;
        audio.jump();
        this.char.squash = -0.1;
        this.fx.smoke.burst(this.pos.x, this.pos.y + 0.1, this.pos.z, 5, 1.8, 0.5, 0.6, 0.55, 0.5, 0.4, 0, 2, 0.4);
      } else if (this.airJumps > 0 && this.energy >= 8 && !this.gliding) {
        this.airJumps--;
        this.energy -= 8;
        this.energyDelay = 0.8;
        this.vel.y = 8.2;
        this.jumpBuffer = 0;
        audio.tone(500, 0.3, "triangle", 0.12, 1000, 0.5);
        audio.noise(0.2, "bandpass", 1500, 4000, 0.07, 1.5, 0.4);
        this.fx.rings.spawn(this.pos.x, this.pos.y + 0.1, this.pos.z, 3, 0.5, "#9fe8ff", "flat", 0.14);
        this.fx.glow.burst(this.pos.x, this.pos.y + 0.2, this.pos.z, 24, 4, 0.5, 0.6, 0.5, 1.6, 2.2, 0, 2, -1);
        this.fovPulse = 3;
      }
    }
    const glideWant = inp.jumpHeld && !this.grounded && !this.swimming && this.vel.y < -1 && this.energy > 1 && this.coyote < 0;
    if (glideWant && !this.gliding) {
      audio.glideStart();
      this.fx.glow.burst(this.pos.x, this.pos.y + 1.3, this.pos.z, 30, 5, 0.6, 0.7, 0.4, 1.6, 2.3, 0, 2);
    }
    this.gliding = glideWant;
    // gravity
    let g = 24;
    if (this.swimming) {
      g = 0;
      const surface = wl - 0.9;
      this.vel.y += (surface - this.pos.y) * 14 * dt;
      this.vel.y *= Math.exp(-3 * dt);
      this.airJumps = 1;
    } else if (this.gliding) {
      this.vel.y = Math.max(this.vel.y - 6 * dt, -3.0);
      g = 0;
      this.energy -= 4.5 * dt;
      // gentle forward drive
      const fv = Math.max(0, 9 - Math.hypot(this.vel.x, this.vel.z));
      this.vel.x += Math.sin(this.faceYaw) * fv * dt * 1.2;
      this.vel.z += Math.cos(this.faceYaw) * fv * dt * 1.2;
      this.energyDelay = 0.6;
      if (Math.random() < 0.5) this.fx.glow.spawn(this.pos.x + (Math.random() - 0.5) * 1.6, this.pos.y + 1.2, this.pos.z + (Math.random() - 0.5) * 1.6, 0, -0.5, 0, 0.6, 0.3, 0.4, 1.5, 2.2, 0.8, 0, 0);
    }
    this.vel.y -= g * dt;
    if (!this.grounded && !this.swimming) this.fallPeak = Math.min(this.fallPeak, this.vel.y);

    this.moveAndCollide(dt, mx, mz, moving);

    // facing
    const aiming = this.castT >= 0 || inp.firing || inp.touchFire;
    const sp = Math.hypot(this.vel.x, this.vel.z);
    const prevFace = this.faceYaw;
    if (aiming) {
      this.faceYaw = dampAngle(this.faceYaw, this.yaw, 22, dt);
    } else if (sp > 0.6 || (this.gliding && sp > 0.2)) {
      const want = Math.atan2(this.vel.x, this.vel.z);
      this.faceYaw = dampAngle(this.faceYaw, want, this.grounded ? 12 : 6, dt);
    }
    let dy = this.faceYaw - prevFace;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.turn = damp(this.turn, dy / Math.max(dt, 0.001), 10, dt);
    this.accel = damp(this.accel, (sp - this.lastSpeed) / Math.max(dt, 0.001), 8, dt);
    this.lastSpeed = sp;

    // energy regen
    this.energyDelay -= dt;
    if (this.energyDelay <= 0 && this.energy < this.maxEnergy) this.energy = Math.min(this.maxEnergy, this.energy + (this.grounded && sp < 1 ? 18 : 11) * dt);
    this.energy = Math.max(0, this.energy);
    // slow hp regen out of combat
    if (!this.combat && this.hp < this.maxHp) this.hp = Math.min(this.maxHp, this.hp + 1.2 * dt);

    // spells
    for (let i = 0; i < 4; i++) this.cdLeft[i] = Math.max(0, this.cdLeft[i] - dt);
    if (inp.firing || inp.touchFire) this.tryCast(0);
    while (inp.spellQueue.length) this.tryCast(inp.spellQueue.shift()!);
    this.updateCast(dt);

    // interactions
    const it = gp.nearestInteract(this.pos);
    const prompt = it ? it.prompt() : null;
    this.curPrompt = prompt || "";
    if (inp.interactPressed) {
      inp.interactPressed = false;
      if (it) {
        it.use();
        this.interactT = 0;
        this.faceTowards(it.pos);
      }
    }
    if (this.interactT >= 0) {
      this.interactT += dt / 0.55;
      if (this.interactT >= 1) this.interactT = -1;
    }
    // pushing props
    gp.pushPlayer(this.pos, this.vel, 0.4);
    // region
    this.regionCooldown -= dt;
    const rg = regionAt(this.pos.x, this.pos.z);
    if (rg !== this.lastRegion && this.regionCooldown <= 0) {
      const first = this.lastRegion < 0;
      this.lastRegion = rg;
      this.regionCooldown = 4;
      audio.setRegion(rg);
      const R = REGIONS[rg];
      hudStore.set({ region: R.name, regionSub: R.sub, regionColor: R.color });
      if (!first || true) showBanner(R.name, R.sub);
    }
    // surface
    this.surface = this.groundTop > groundH(this.pos.x, this.pos.z) + 0.1 ? 1 : surfaceAt(this.pos.x, this.pos.z, this.pos.y);
    this.animate(dt);
  }
  curPrompt = "";
  groundTop = 0;

  faceTowards(p: THREE.Vector3) {
    this.faceYaw = Math.atan2(p.x - this.pos.x, p.z - this.pos.z);
  }

  moveAndCollide(dt: number, mx: number, mz: number, moving: boolean) {
    const w = this.world;
    const pos = this.pos;
    const steps = Math.max(1, Math.ceil((Math.hypot(this.vel.x, this.vel.z) * dt) / 0.3));
    const sdt = dt / steps;
    const stepUp = this.grounded ? 0.62 : 0.3;
    for (let s = 0; s < steps; s++) {
      const ox = pos.x;
      const oz = pos.z;
      pos.x += this.vel.x * sdt;
      pos.z += this.vel.z * sdt;
      // steep slope blocking
      if (this.grounded && !this.swimming) {
        const gh0 = groundH(ox, oz);
        const gh1 = groundH(pos.x, pos.z);
        const dist = Math.hypot(pos.x - ox, pos.z - oz) || 0.001;
        if ((gh1 - gh0) / dist > 1.2) {
          // try axis-separated
          const gx = groundH(pos.x, oz);
          const gz = groundH(ox, pos.z);
          if ((gx - gh0) / (Math.abs(pos.x - ox) || 0.001) <= 1.2) pos.z = oz;
          else if ((gz - gh0) / (Math.abs(pos.z - oz) || 0.001) <= 1.2) pos.x = ox;
          else {
            pos.x = ox;
            pos.z = oz;
          }
          this.vel.x *= 0.6;
          this.vel.z *= 0.6;
        }
      }
      pushOut(w.colliders, pos, 0.38, 1.75, stepUp, this.vel);
    }
    // world boundary
    const r = Math.hypot(pos.x, pos.z);
    if (r > WORLD_R) {
      pos.x *= WORLD_R / r;
      pos.z *= WORLD_R / r;
      this.vel.x *= 0.5;
      this.vel.z *= 0.5;
    }
    // vertical
    pos.y += this.vel.y * dt;
    const gh = standHeight(w.colliders, pos.x, pos.z, pos.y, this.grounded ? 0.62 : 0.3);
    this.groundTop = gh;
    this.wasGrounded = this.grounded;
    const stepOffset = pos.y - gh;
    if (this.vel.y <= 0 && stepOffset <= (this.grounded ? 0.25 : 0.05)) {
      if (!this.grounded || stepOffset < -0.001) {
        // landing
        if (!this.swimming && !this.wasGrounded) {
          const impact = -this.fallPeak;
          if (impact > 6) {
            this.landImpact = impact;
            audio.land(impact);
            this.addTrauma(clamp((impact - 8) * 0.03, 0, 0.5));
            const col = this.surface === 2 ? [0.9, 0.95, 1] : [0.55, 0.5, 0.4];
            this.fx.smoke.burst(pos.x, gh + 0.1, pos.z, Math.min(16, 4 + impact), 2.5 + impact * 0.1, 0.8, 0.8, col[0], col[1], col[2], 0, 2.5, 0.5);
            if (impact > 22) {
              const dmg = Math.floor((impact - 22) * 2.4);
              this.hurt(dmg, new THREE.Vector3(pos.x, pos.y - 1, pos.z), 0);
            }
          }
        }
      }
      pos.y = gh;
      this.vel.y = 0;
      this.grounded = true;
      this.airJumps = 1;
      this.fallPeak = 0;
      this.gliding = false;
    } else {
      this.grounded = false;
      if (this.swimming) this.fallPeak = 0;
    }
    // slide on very steep ground
    if (this.grounded && !this.swimming) {
      const n = groundN(pos.x, pos.z);
      if (n.y < 0.55 && gh === groundH(pos.x, pos.z)) {
        this.vel.x += n.x * 22 * dt;
        this.vel.z += n.z * 22 * dt;
      }
    }
    void mx;
    void mz;
    void moving;
    // head bump
    // character root
    this.char.root.position.copy(pos);
  }

  animate(dt: number) {
    const sp = Math.hypot(this.vel.x, this.vel.z);
    const fx = Math.sin(this.faceYaw);
    const fz = Math.cos(this.faceYaw);
    const lz = this.vel.x * fx + this.vel.z * fz;
    const lx = this.vel.x * -Math.cos(this.faceYaw) + this.vel.z * Math.sin(this.faceYaw);
    const castP = this.castT >= 0 ? clamp(this.castT / this.castDur, 0, 1) : -1;
    this.char.root.rotation.y = this.faceYaw;
    this.char.update(dt, {
      speed: sp,
      vy: this.vel.y,
      grounded: this.grounded,
      sprint: this.input.sprintHeld && sp > 6,
      gliding: this.gliding,
      swimming: this.swimming,
      turn: this.turn,
      accel: this.accel,
      velLX: lx,
      velLZ: lz,
      castType: this.castType,
      castT: castP,
      interactT: this.interactT,
      dead: !this.alive,
      landImpact: this.landImpact,
    });
    this.landImpact = 0;
    // invulnerability blink
    this.char.root.visible = this.mode !== "menu" && (this.invuln <= 0 || Math.floor(this.simTime * 20) % 2 === 0 || !this.alive);
    // sprint dust / trail
    if (this.grounded && sp > 7 && Math.random() < dt * 20) {
      this.fx.smoke.spawn(this.pos.x, this.pos.y + 0.1, this.pos.z, (Math.random() - 0.5) * 0.5, 0.4, (Math.random() - 0.5) * 0.5, 0.7, 0.45, 0.6, 0.55, 0.45, 0.2, 0, 2, 0.4);
    }
    // orb light-trail
    if (Math.random() < dt * 25) {
      this.char.tipWorld(this.muzzle);
      this.fx.glow.spawn(this.muzzle.x, this.muzzle.y, this.muzzle.z, (Math.random() - 0.5) * 0.4, 0.4, (Math.random() - 0.5) * 0.4, 0.8, 0.22, 0.3, 1.1, 1.5, 0.7, 0, 0.5);
    }
    // swim ripples
    if (this.swimming && sp > 0.8 && Math.random() < dt * 6) {
      const wl = waterLevelAt(this.pos.x, this.pos.z);
      this.fx.rings.spawn(this.pos.x, wl + 0.05, this.pos.z, 2.4, 0.9, "#cfeeff", "flat", 0.12);
    }
  }

  // --------------- spells ---------------
  tryCast(i: number) {
    if (!this.alive || this.mode !== "playing") return;
    if (this.cdLeft[i] > 0) return;
    const sp = SPELLS[i];
    if (this.castT >= 0) {
      const same = i === 0 && this.castType === 0;
      if (!same && this.castT < this.castDur * 0.6) return;
    }
    if (this.energy < sp.cost) {
      if (this.noEnergyT <= 0) {
        this.noEnergyT = 0.8;
        pushToast("Yetersiz enerji", "warn");
        audio.tone(160, 0.2, "square", 0.06, 100, 0.1);
      }
      return;
    }
    this.computeAim();
    this.energy -= sp.cost;
    this.energyDelay = 1.0;
    this.cdLeft[i] = sp.cd;
    this.castType = i;
    this.castT = 0;
    this.castDur = sp.dur;
    this.char.setOrbColor(sp.color, 1);
    switch (i) {
      case 0:
        this.fireBolt();
        break;
      case 1:
        this.castWave();
        break;
      case 2:
        this.castLightning();
        break;
      case 3:
        this.castPortal();
        break;
    }
  }
  noEnergyT = 0;

  updateCast(dt: number) {
    this.noEnergyT -= dt;
    if (this.castT >= 0) {
      this.castT += dt;
      if (this.castT >= this.castDur) {
        this.castT = -1;
        this.castType = -1;
        this.char.setOrbColor("#7fe7ff", 0);
      }
    }
    const pl = this.pendingLightning;
    if (pl) {
      pl.t -= dt;
      this.fx.glow.spawn(pl.pos.x + (Math.random() - 0.5) * 5, pl.pos.y + 0.3, pl.pos.z + (Math.random() - 0.5) * 5, 0, 5 + Math.random() * 4, 0, 0.5, 0.35, 0.7, 0.8, 2.2, 1, 0, 0);
      if (pl.t <= 0) {
        this.strikeLightning(pl.pos);
        this.pendingLightning = null;
      }
    }
    const pp = this.pendingPortal;
    if (pp) {
      pp.t -= dt;
      if (pp.t <= 0 && !pp.done) {
        pp.done = true;
        const from = this.pos.clone();
        this.pos.copy(pp.dest);
        this.vel.x *= 0.6;
        this.vel.z *= 0.6;
        this.vel.y = Math.max(this.vel.y, 2);
        this.grounded = false;
        this.focus.copy(this.pos).setY(this.pos.y + 1.5);
        this.camPos.add(this.pos.clone().sub(from));
        this.fovPulse = 12;
        this.chroma = 0.016;
        this.flash = Math.max(this.flash, 0.4);
        this.fx.glow.burst(this.pos.x, this.pos.y + 1, this.pos.z, 60, 8, 0.9, 1, 0.9, 0.5, 2.4, -1, 1);
        this.fx.lights.flash(this.pos.x, this.pos.y + 1.2, this.pos.z, "#c59bff", 200, 25, 0.8);
        this.pendingPortal = null;
      }
    }
  }

  fireBolt() {
    const dir = new THREE.Vector3();
    this.char.tipWorld(this.muzzle);
    dir.copy(this.aimPoint).sub(this.muzzle);
    if (dir.lengthSq() < 4) this.camera.getWorldDirection(dir);
    dir.normalize();
    let b = this.bolts.find((x) => !x.active);
    if (!b) {
      b = { active: false, pos: new THREE.Vector3(), dir: new THREE.Vector3(), life: 0 };
      this.bolts.push(b);
      if (this.bolts.length > 24) this.bolts.shift();
    }
    b.active = true;
    b.pos.copy(this.muzzle);
    b.dir.copy(dir);
    b.life = 1.6;
    audio.bolt();
    this.addTrauma(0.03);
    this.fx.glow.burst(this.muzzle.x, this.muzzle.y, this.muzzle.z, 8, 3, 0.3, 0.6, 0.5, 1.8, 2.4, 0, 3);
    this.fx.lights.flash(this.muzzle.x, this.muzzle.y, this.muzzle.z, "#7fe7ff", 20, 10, 0.18);
  }

  updateBolts(dt: number) {
    if (dt <= 0) return;
    const gp = this.world.gp;
    for (const b of this.bolts) {
      if (!b.active) continue;
      b.life -= dt;
      const step = 62 * dt;
      const n = Math.max(1, Math.ceil(step / 0.9));
      let hit: string | null = null;
      for (let i = 0; i < n; i++) {
        b.pos.addScaledVector(b.dir, step / n);
        const h = gp.boltCollide(b.pos, 0.28);
        // trail
        this.fx.glow.spawn(b.pos.x, b.pos.y, b.pos.z, (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.6, 0.45, 0.42, 0.4, 1.5, 2.2, 0.8, 0, 1, -0.4);
        if (h) {
          hit = h;
          break;
        }
      }
      this.fx.glow.spawn(b.pos.x, b.pos.y, b.pos.z, 0, 0, 0, 0.08, 1.5, 1.2, 2.6, 3.2, 1, 0, 0);
      if (hit || b.life <= 0) {
        b.active = false;
        if (hit) {
          gp.impact(b.pos, 1.7, "bolt");
          audio.boltHit();
          this.fx.glow.burst(b.pos.x, b.pos.y, b.pos.z, 24, 7, 0.5, 0.7, 0.6, 1.8, 2.4, 6, 1.5);
          this.fx.lights.flash(b.pos.x, b.pos.y, b.pos.z, "#7fe7ff", 40, 14, 0.25);
          if (hit === "world") this.fx.smoke.burst(b.pos.x, b.pos.y, b.pos.z, 4, 1.5, 0.5, 0.6, 0.5, 0.45, 0.4, 0, 2, 0.5);
          this.addTrauma(0.06);
        }
      }
    }
  }

  castWave() {
    const p = this.pos;
    audio.wave();
    this.addTrauma(0.75);
    this.fovPulse = 8;
    this.chroma = 0.014;
    this.flash = Math.max(this.flash, 0.18);
    this.fx.rings.spawn(p.x, p.y + 0.25, p.z, 15, 0.7, "#ffd98a", "flat", 0.13);
    this.fx.rings.spawn(p.x, p.y + 0.3, p.z, 10, 0.5, "#ffffff", "flat", 0.08);
    this.fx.lights.flash(p.x, p.y + 1, p.z, "#ffd98a", 160, 24, 0.6);
    // dust ring
    for (let i = 0; i < 70; i++) {
      const a = (i / 70) * Math.PI * 2;
      const s = 10 + Math.random() * 6;
      this.fx.smoke.spawn(p.x, p.y + 0.3, p.z, Math.cos(a) * s, 1 + Math.random() * 2, Math.sin(a) * s, 0.9, 1.1, 0.7, 0.6, 0.45, 0.45, 0, 2.2, 1.5);
    }
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 6 + Math.random() * 10;
      this.fx.glow.spawn(p.x, p.y + 0.4, p.z, Math.cos(a) * s, 2 + Math.random() * 4, Math.sin(a) * s, 0.7, 0.4, 2.2, 1.6, 0.6, 1, 8, 1.2);
    }
    const w = U.uWave.value as THREE.Vector4;
    w.set(p.x, p.z, 1, 1.0);
    this.world.gp.impact(new THREE.Vector3(p.x, p.y + 1, p.z), 14, "wave");
    // ground crack decal
    this.fx.decals.add(p.x, p.z, 2.4);
  }

  castLightning() {
    // target: aim point clamped to 50m, snapped to ground when no hit
    const t = this.aimPoint.clone();
    const d = t.distanceTo(this.pos);
    if (d > 52) {
      t.sub(this.pos).setLength(52).add(this.pos);
    }
    if (!this.aimHit || t.y > groundH(t.x, t.z) + 4) {
      t.y = groundH(t.x, t.z);
    }
    this.pendingLightning = { t: 0.45, pos: t };
    audio.lightningCharge();
    this.fx.rings.spawn(t.x, t.y + 0.15, t.z, 7.5, 0.55, "#b8a8ff", "flat", 0.1);
    this.fx.lights.flash(t.x, t.y + 2, t.z, "#b8a8ff", 40, 16, 0.5);
    this.fovPulse = 2;
  }

  strikeLightning(pos: THREE.Vector3) {
    this.fx.lightning.strike(pos, 120, 0.6);
    audio.lightning();
    this.addTrauma(1);
    this.flash = Math.max(this.flash, 0.55);
    this.sky.flash = Math.max(this.sky.flash, 0.5);
    this.chroma = 0.02;
    this.fx.lights.flash(pos.x, pos.y + 6, pos.z, "#cfd8ff", 900, 90, 0.7);
    this.fx.rings.spawn(pos.x, pos.y + 0.2, pos.z, 16, 0.6, "#ffffff", "flat", 0.1);
    this.fx.glow.burst(pos.x, pos.y + 0.8, pos.z, 90, 16, 0.8, 1.2, 1.8, 2, 2.6, 8, 1.2, 4);
    this.fx.smoke.burst(pos.x, pos.y + 0.5, pos.z, 14, 5, 1.4, 1.5, 0.35, 0.33, 0.32, 0, 2, 2);
    this.fx.debris.burst(pos.x, pos.y + 0.5, pos.z, 14, 9, 0.3, new THREE.Color("#6b665f"), 3);
    this.fx.decals.add(pos.x, pos.z, 3.4);
    this.world.gp.impact(new THREE.Vector3(pos.x, pos.y + 1.2, pos.z), 6.8, "lightning");
    const w = U.uWave.value as THREE.Vector4;
    w.set(pos.x, pos.z, 1, 0.8);
  }

  castPortal() {
    const dir = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    // aim horizontally; if joystick is moving prefer movement direction
    const start = this.pos.clone();
    let dist = 0;
    const p = new THREE.Vector3();
    let lastGood = start.clone();
    for (let d = 1; d <= 20; d += 1) {
      p.copy(start).addScaledVector(dir, d);
      const gh = standHeight(this.world.colliders, p.x, p.z, start.y + 2, 1.5);
      if (pointHits(this.world.colliders, p.x, Math.max(start.y, gh) + 1, p.z) && gh < start.y + 1.5) break;
      if (gh > start.y + 6) break;
      if (Math.hypot(p.x, p.z) > WORLD_R - 2) break;
      lastGood.set(p.x, Math.max(gh, Math.min(start.y + 0.0, gh + 30)), p.z);
      if (this.swimmingAt(p)) lastGood.y = waterLevelAt(p.x, p.z) - 0.3;
      dist = d;
    }
    if (dist < 3) {
      pushToast("Önünde yer yok", "warn");
      this.energy += SPELLS[3].cost;
      this.cdLeft[3] = 0.4;
      this.castT = -1;
      this.castType = -1;
      return;
    }
    // if falling/airborne keep altitude over lower ground
    const dest = lastGood.clone();
    if (!this.grounded) dest.y = Math.max(dest.y, Math.min(start.y, dest.y + 8));
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
    this.fx.rings.spawn(start.x, start.y + 1.1, start.z, 2.4, 0.7, "#c59bff", q, 0.14);
    this.fx.rings.spawn(dest.x, dest.y + 1.1, dest.z, 2.4, 0.7, "#c59bff", q, 0.14);
    this.fx.glow.burst(start.x, start.y + 1, start.z, 50, 5, 0.8, 0.9, 1.4, 0.7, 2.2, -1, 1.5);
    this.fx.lights.flash(start.x, start.y + 1.2, start.z, "#c59bff", 120, 18, 0.6);
    audio.portal();
    this.fovPulse = 6;
    this.pendingPortal = { t: 0.28, dest, done: false };
  }
  swimmingAt(p: THREE.Vector3) {
    const wl = waterLevelAt(p.x, p.z);
    return wl > -1e8 && groundH(p.x, p.z) < wl - 0.5;
  }

  // --------------- audio & hud ---------------
  audioT = 0;
  updateAudio(dt: number) {
    this.audioT -= dt;
    if (this.audioT > 0) return;
    this.audioT = 0.2;
    const s = audio.state;
    s.night = this.sky.night;
    s.rain = this.sky.storm > 0.2 ? this.sky.storm : 0;
    s.speed = Math.hypot(this.vel.x, this.vel.z);
    s.height = clamp(this.pos.y - groundH(this.pos.x, this.pos.z), 0, 60);
    let wd = 0;
    let ld = 0;
    for (const p of pools) {
      const d = Math.hypot(this.pos.x - p.x, this.pos.z - p.z) - p.r;
      const v = clamp(1 - d / 30, 0, 1);
      if (p.type === "water") wd = Math.max(wd, v);
      else ld = Math.max(ld, v);
    }
    s.water = wd;
    s.lava = ld;
    const gp = this.world.gp;
    let near = false;
    for (const e of gp.enemies) {
      if (e.dead || e.removed) continue;
      if ((e.state === "chase" || e.state === "windup" || e.state === "lunge" || e.state === "slam") && e.pos.distanceTo(this.pos) < 32) {
        near = true;
        break;
      }
    }
    if (near !== this.combat) {
      this.combat = near;
      audio.setCombat(near);
    }
  }

  updateHud(raw: number) {
    this.hudTimer -= raw;
    if (this.hudTimer > 0) return;
    this.hudTimer = 0.1;
    const gp = this.world.gp;
    const ob = gp.objective();
    const cam = this.camera;
    const dir = new THREE.Vector3();
    cam.getWorldDirection(dir);
    const heading = (Math.atan2(dir.x, dir.z) * 180) / Math.PI;
    let objHeading = 0;
    let objDist = 0;
    if (ob.target) {
      const dx = ob.target.x - this.pos.x;
      const dz = ob.target.z - this.pos.z;
      objDist = Math.hypot(dx, dz);
      objHeading = (Math.atan2(dx, dz) * 180) / Math.PI;
    }
    this.fpsSmooth = lerp(this.fpsSmooth, this.fpsN / Math.max(0.001, this.fpsAcc), 0.4);
    this.fpsAcc = 0;
    this.fpsN = 0;
    const key = uiStore.get().isTouch ? "DOKUN" : "E";
    hudStore.set({
      hp: this.hp,
      maxHp: this.maxHp,
      energy: this.energy,
      maxEnergy: this.maxEnergy,
      shards: this.shards,
      totalShards: gp.totalShards,
      runes: gp.obelisks.map((o) => o.state === 2),
      objective: ob.title,
      objectiveSub: ob.sub + (ob.target ? ` · ${Math.round(objDist)} m` : ""),
      prompt: this.curPrompt,
      promptKey: key,
      cds: this.cdLeft.map((c, i) => c / SPELLS[i].cd),
      discovered: gp.discovered,
      totalDiscover: gp.totalDiscover,
      level: this.level,
      nextLevel: this.level * 6 - this.shards,
      fps: Math.round(this.fpsSmooth),
      clock: this.sky.timeLabel(),
      heading: heading,
      combat: this.combat,
      gliding: this.gliding,
      swimming: this.swimming,
      weather: this.sky.weatherLabel(),
      kills: gp.kills,
      resScale: this.resScale,
      objHeading: objHeading,
    } as any);
  }
  fpsSmooth = 60;

  // minimap
  drawMinimap(ctx: CanvasRenderingContext2D, size: number, mode: "mini" | "full") {
    if (!this.world.mapCanvas) return;
    this.world.drawMap(ctx, size, this.pos.x, this.pos.z, this.yaw, mode);
  }

  journal() {
    const gp = this.world.gp;
    return {
      discoveries: gp.discoveries.map((d) => ({ name: d.name, sub: d.sub, found: d.found })),
      obelisks: gp.obelisks.map((o) => ({ name: o.name, state: o.state, hint: o.hint, color: o.color })),
      shrines: gp.shrines.map((s) => ({ name: s.name, active: s.active })),
      chests: gp.chests.length,
      chestsOpened: gp.chestsOpened,
      spells: SPELLS,
      shards: this.shards,
      totalShards: gp.totalShards,
      level: this.level,
      kills: gp.kills,
    };
  }

  dispose() {
    this.running = false;
  }
}

function ready_h(x: number, z: number, ready: boolean) {
  return ready ? groundH(x, z) : 20;
}

export const game = new Game();
export { SPELLS, siteH };
