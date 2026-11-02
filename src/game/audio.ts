// Fully procedural WebAudio engine: generative music, regional ambience, SFX.

type OscT = OscillatorType;

const MODES: { root: number; scale: number[]; prog: number[]; name: string }[] = [
  { name: "forest", root: 146.83, scale: [0, 2, 4, 6, 7, 9, 11], prog: [0, 4, 5, 3] },
  { name: "city", root: 110, scale: [0, 2, 3, 5, 7, 8, 10], prog: [0, 5, 3, 6] },
  { name: "canyon", root: 123.47, scale: [0, 1, 4, 5, 7, 8, 10], prog: [0, 1, 0, 5] },
  { name: "crystal", root: 185, scale: [0, 2, 4, 6, 8, 10, 11], prog: [0, 3, 1, 4] },
  { name: "snow", root: 98, scale: [0, 2, 3, 5, 7, 8, 10], prog: [0, 2, 5, 4] },
];

const mtof = (root: number, semis: number) => root * Math.pow(2, semis / 12);

export class AudioEngine {
  ctx: AudioContext | null = null;
  master!: GainNode;
  musicBus!: GainNode;
  sfxBus!: GainNode;
  ambBus!: GainNode;
  reverb!: ConvolverNode;
  revSend!: GainNode;
  delay!: DelayNode;
  noiseBuf!: AudioBuffer;
  vols = { master: 0.8, music: 0.6, sfx: 0.8 };
  region = 0;
  combat = false;
  nextChord = 0;
  chordIdx = 0;
  nextArp = 0;
  nextBeat = 0;
  beatN = 0;
  nextChirp = 0;
  timer: any = null;
  amb: Record<string, GainNode> = {};
  windFilter!: BiquadFilterNode;
  state = { night: 0, rain: 0, speed: 0, water: 0, lava: 0, height: 0, wind: 0 };
  stepClock = 0;
  mood = 1;

  init() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.musicBus = ctx.createGain();
    this.sfxBus = ctx.createGain();
    this.ambBus = ctx.createGain();
    this.musicBus.connect(this.master);
    this.sfxBus.connect(this.master);
    this.ambBus.connect(this.master);
    // reverb
    const len = ctx.sampleRate * 3.2;
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = ir;
    this.revSend = ctx.createGain();
    this.revSend.gain.value = 0.55;
    this.revSend.connect(this.reverb);
    const revOut = ctx.createGain();
    revOut.gain.value = 0.8;
    this.reverb.connect(revOut).connect(this.master);
    // delay
    this.delay = ctx.createDelay(2);
    this.delay.delayTime.value = 0.42;
    const fb = ctx.createGain();
    fb.gain.value = 0.38;
    const dlp = ctx.createBiquadFilter();
    dlp.type = "lowpass";
    dlp.frequency.value = 2400;
    this.delay.connect(dlp).connect(fb).connect(this.delay);
    dlp.connect(this.revSend);
    dlp.connect(this.musicBus);
    // noise
    const nl = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, nl, ctx.sampleRate);
    const nd = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < nl; i++) nd[i] = Math.random() * 2 - 1;
    this.setVolumes(this.vols);
    this.buildAmbience();
    this.nextChord = ctx.currentTime + 0.2;
    this.nextArp = ctx.currentTime + 2;
    this.timer = setInterval(() => this.schedule(), 90);
  }

  setVolumes(v: { master: number; music: number; sfx: number }) {
    this.vols = v;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(v.master, t, 0.05);
    this.musicBus.gain.setTargetAtTime(v.music * 0.55, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(v.sfx, t, 0.05);
    this.ambBus.gain.setTargetAtTime(Math.min(1, v.sfx * 0.9), t, 0.05);
  }

  suspend(s: boolean) {
    if (!this.ctx) return;
    if (s) this.ctx.suspend();
    else this.ctx.resume();
  }

  private noiseSrc(loop = true) {
    const s = this.ctx!.createBufferSource();
    s.buffer = this.noiseBuf;
    s.loop = loop;
    if (loop) s.loopStart = Math.random();
    return s;
  }

  private buildAmbience() {
    const ctx = this.ctx!;
    const mk = (name: string, node: AudioNode) => {
      const g = ctx.createGain();
      g.gain.value = 0;
      node.connect(g).connect(this.ambBus);
      this.amb[name] = g;
    };
    // wind
    const w = this.noiseSrc();
    const wf = ctx.createBiquadFilter();
    wf.type = "bandpass";
    wf.frequency.value = 450;
    wf.Q.value = 0.8;
    this.windFilter = wf;
    w.connect(wf);
    w.start();
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.11;
    const lg = ctx.createGain();
    lg.gain.value = 220;
    lfo.connect(lg).connect(wf.frequency);
    lfo.start();
    mk("wind", wf);
    // water
    const wa = this.noiseSrc();
    const waf = ctx.createBiquadFilter();
    waf.type = "lowpass";
    waf.frequency.value = 800;
    wa.connect(waf);
    wa.start();
    mk("water", waf);
    // rain
    const r = this.noiseSrc();
    const rf = ctx.createBiquadFilter();
    rf.type = "highpass";
    rf.frequency.value = 2200;
    r.connect(rf);
    r.start();
    mk("rain", rf);
    // lava
    const l = this.noiseSrc();
    const lf = ctx.createBiquadFilter();
    lf.type = "lowpass";
    lf.frequency.value = 260;
    l.connect(lf);
    l.start();
    mk("lava", lf);
    // drone
    const dg = ctx.createGain();
    for (const f of [55, 55.4, 82.5]) {
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = f;
      o.connect(dg);
      o.start();
    }
    mk("drone", dg);
  }

  schedule() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== "running") return;
    const now = ctx.currentTime;
    const mode = MODES[this.region];
    if (now + 0.3 > this.nextChord) {
      const deg = mode.prog[this.chordIdx++ % mode.prog.length];
      this.playChord(mode, deg, this.nextChord);
      this.nextChord += 9;
    }
    while (now + 0.3 > this.nextArp) {
      const n = mode.scale.length;
      const oct = Math.random() < 0.6 ? 2 : 1;
      const idx = Math.floor(Math.random() * n);
      const semis = mode.scale[idx] + 12 * oct;
      this.pluck(mtof(mode.root, semis), this.nextArp, 0.08 + Math.random() * 0.05);
      const r = Math.random();
      this.nextArp += r < 0.5 ? 0.6 : r < 0.85 ? 1.2 : 2.4 + Math.random() * 2;
    }
    if (this.combat) {
      while (now + 0.3 > this.nextBeat) {
        this.drum(this.nextBeat, this.beatN % 4 === 0 ? 1 : this.beatN % 2 === 0 ? 0.6 : 0.35);
        this.beatN++;
        this.nextBeat += 0.375;
      }
    } else {
      this.nextBeat = Math.max(this.nextBeat, now);
    }
  }

  playChord(mode: (typeof MODES)[0], deg: number, t: number) {
    const ctx = this.ctx!;
    const sc = mode.scale;
    const note = (d: number) => {
      const oct = Math.floor(d / sc.length);
      return mode.root * Math.pow(2, (sc[d % sc.length] + oct * 12) / 12);
    };
    const freqs = [note(deg), note(deg + 2), note(deg + 4), note(deg + 7) * 1.0];
    const out = ctx.createGain();
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(0.16 * this.mood, t + 3.2);
    out.gain.linearRampToValueAtTime(0.1 * this.mood, t + 6.5);
    out.gain.linearRampToValueAtTime(0, t + 10.5);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(380, t);
    lp.frequency.linearRampToValueAtTime(1100, t + 4.5);
    lp.frequency.linearRampToValueAtTime(420, t + 10);
    out.connect(lp);
    lp.connect(this.musicBus);
    lp.connect(this.revSend);
    for (const f of freqs) {
      for (const det of [-7, 6]) {
        const o = ctx.createOscillator();
        o.type = "sawtooth";
        o.frequency.value = f * 2;
        o.detune.value = det;
        const g = ctx.createGain();
        g.gain.value = 0.18;
        o.connect(g).connect(out);
        o.start(t);
        o.stop(t + 11);
      }
    }
    // sub bass
    const b = ctx.createOscillator();
    b.type = "sine";
    b.frequency.value = note(deg) / 2;
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0, t);
    bg.gain.linearRampToValueAtTime(0.28, t + 2);
    bg.gain.linearRampToValueAtTime(0, t + 9.5);
    b.connect(bg).connect(this.musicBus);
    b.start(t);
    b.stop(t + 10);
  }

  pluck(f: number, t: number, vol: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = "triangle";
    o.frequency.value = f;
    const o2 = ctx.createOscillator();
    o2.type = "sine";
    o2.frequency.value = f * 2.001;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 1.8);
    o.connect(g);
    o2.connect(g);
    g.connect(this.musicBus);
    g.connect(this.delay);
    g.connect(this.revSend);
    o.start(t);
    o2.start(t);
    o.stop(t + 2);
    o2.stop(t + 2);
  }

  drum(t: number, v: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(130, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.25);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.55 * v, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.42);
    o.connect(g).connect(this.musicBus);
    o.start(t);
    o.stop(t + 0.5);
  }

  setRegion(i: number) {
    this.region = i;
    // shift chord timing so new mode is felt reasonably soon
    if (this.ctx) this.nextChord = Math.min(this.nextChord, this.ctx.currentTime + 4);
  }
  setCombat(c: boolean) {
    this.combat = c;
  }

  update(_dt: number) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== "running") return;
    const s = this.state;
    const r = this.region;
    const t = ctx.currentTime;
    const set = (n: string, v: number) => this.amb[n]?.gain.setTargetAtTime(v, t, 0.6);
    const windBase = [0.05, 0.07, 0.12, 0.06, 0.26][r];
    set("wind", (windBase + s.speed * 0.012 + s.height * 0.0012 + s.rain * 0.08) * 0.8);
    set("water", s.water * 0.25);
    set("rain", s.rain * 0.2);
    set("lava", s.lava * 0.35);
    set("drone", r === 1 ? 0.05 : r === 3 ? 0.035 : 0.012);
    this.windFilter.Q.value = r === 4 ? 2.2 : 0.8;
    // chirps
    if (t > this.nextChirp) {
      this.nextChirp = t + 0.6 + Math.random() * 3.5;
      this.chirp(r, t);
    }
  }

  chirp(r: number, t: number) {
    const ctx = this.ctx!;
    const night = this.state.night;
    const sp = (f0: number, f1: number, dur: number, vol: number, type: OscT = "sine") => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(f1, t + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol, t + dur * 0.2);
      g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
      o.connect(g);
      g.connect(this.ambBus);
      g.connect(this.revSend);
      o.start(t);
      o.stop(t + dur + 0.05);
    };
    if (r === 0) {
      if (night < 0.5) {
        const f = 2200 + Math.random() * 1800;
        sp(f, f * 1.4, 0.09, 0.05);
        if (Math.random() < 0.6) {
          t += 0.13;
          sp(f * 1.2, f * 0.8, 0.1, 0.04);
        }
      } else {
        for (let i = 0; i < 3; i++) {
          const tt = t + i * 0.07;
          const o = ctx.createOscillator();
          o.frequency.value = 4300;
          const g = ctx.createGain();
          g.gain.setValueAtTime(0.012, tt);
          g.gain.exponentialRampToValueAtTime(0.0005, tt + 0.05);
          o.connect(g).connect(this.ambBus);
          o.start(tt);
          o.stop(tt + 0.06);
        }
      }
    } else if (r === 2) {
      if (Math.random() < 0.4) sp(90, 55, 2.2, 0.06);
    } else if (r === 3) {
      const f = 1200 + Math.random() * 2400;
      sp(f, f * 1.01, 2.4, 0.03);
    } else if (r === 1) {
      if (Math.random() < 0.3) sp(196, 190, 3.5, 0.05, "triangle");
    } else if (r === 4) {
      if (Math.random() < 0.3) sp(300, 240, 2.8, 0.03, "sine");
    }
  }

  // ---------------- SFX ----------------
  tone(f: number, dur: number, type: OscT = "sine", vol = 0.2, slide = 0, rev = 0.3, delay = 0) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, slide), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + Math.min(0.02, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    o.connect(g).connect(this.sfxBus);
    if (rev > 0) {
      const rg = ctx.createGain();
      rg.gain.value = rev;
      g.connect(rg).connect(this.revSend);
    }
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  noise(dur: number, type: BiquadFilterType, f0: number, f1: number, vol: number, q = 1, rev = 0.1, delay = 0) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const s = ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    const flt = ctx.createBiquadFilter();
    flt.type = type;
    flt.Q.value = q;
    flt.frequency.setValueAtTime(f0, t);
    flt.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + Math.min(0.01, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    s.connect(flt).connect(g).connect(this.sfxBus);
    if (rev > 0) {
      const rg = ctx.createGain();
      rg.gain.value = rev;
      g.connect(rg).connect(this.revSend);
    }
    s.start(t, Math.random() * 1.5);
    s.stop(t + dur + 0.05);
  }

  footstep(surface: number, sprint: boolean) {
    // 0 grass 1 stone 2 snow 3 sand 4 water
    const v = (sprint ? 0.16 : 0.1) * (0.8 + Math.random() * 0.4);
    const p = 0.85 + Math.random() * 0.3;
    switch (surface) {
      case 0:
        this.noise(0.09, "bandpass", 1500 * p, 700, v, 1.2, 0.05);
        break;
      case 1:
        this.noise(0.07, "highpass", 1800 * p, 900, v * 0.9, 0.8, 0.12);
        this.tone(170 * p, 0.07, "triangle", v * 0.6, 90, 0.05);
        break;
      case 2:
        this.noise(0.16, "lowpass", 1200 * p, 300, v * 1.4, 0.7, 0.05);
        break;
      case 3:
        this.noise(0.12, "bandpass", 900 * p, 500, v, 0.8, 0.03);
        break;
      default:
        this.noise(0.22, "bandpass", 800 * p, 300, v * 1.5, 1.4, 0.2);
        this.tone(500 * p, 0.1, "sine", 0.03, 900, 0.2);
    }
  }
  jump() {
    this.noise(0.18, "bandpass", 600, 1800, 0.1, 1, 0.1);
    this.tone(320, 0.18, "sine", 0.06, 560, 0.2);
  }
  land(force: number) {
    const v = Math.min(0.4, 0.08 + force * 0.02);
    this.noise(0.2, "lowpass", 900, 150, v, 0.7, 0.1);
    this.tone(90, 0.2, "sine", v * 0.8, 50, 0.05);
  }
  bolt() {
    this.tone(900, 0.3, "sawtooth", 0.06, 220, 0.4);
    this.tone(1800, 0.25, "sine", 0.07, 700, 0.5);
    this.noise(0.22, "bandpass", 3000, 800, 0.09, 2, 0.3);
  }
  boltHit() {
    this.noise(0.25, "bandpass", 2400, 500, 0.16, 1.4, 0.4);
    this.tone(260, 0.25, "sine", 0.14, 90, 0.3);
    this.tone(1400, 0.35, "triangle", 0.05, 2200, 0.5);
  }
  wave() {
    this.tone(160, 0.9, "sine", 0.5, 38, 0.5);
    this.noise(0.8, "lowpass", 2500, 120, 0.35, 0.8, 0.6);
    this.tone(520, 0.8, "triangle", 0.08, 1300, 0.6, 0.04);
  }
  lightningCharge() {
    this.tone(220, 0.38, "sawtooth", 0.07, 1500, 0.4);
    this.noise(0.38, "highpass", 600, 5000, 0.07, 1, 0.3);
  }
  lightning() {
    this.noise(1.4, "lowpass", 7000, 120, 0.8, 0.5, 0.9);
    this.tone(70, 1.2, "sine", 0.7, 28, 0.4);
    this.tone(2400, 0.3, "square", 0.08, 300, 0.4);
  }
  portal() {
    for (let i = 0; i < 5; i++) this.tone(500 + i * 220, 0.5, "sine", 0.05, 900 + i * 380, 0.7, i * 0.04);
    this.noise(0.55, "bandpass", 400, 4200, 0.12, 2, 0.6);
  }
  pickup(i = 0) {
    const base = 660 * Math.pow(1.122, Math.min(i, 8));
    this.tone(base, 0.35, "sine", 0.14, 0, 0.6);
    this.tone(base * 1.5, 0.45, "sine", 0.1, 0, 0.7, 0.07);
    this.tone(base * 2, 0.6, "triangle", 0.06, 0, 0.8, 0.14);
  }
  heal() {
    [523, 659, 784].forEach((f, i) => this.tone(f, 0.5, "sine", 0.1, 0, 0.7, i * 0.07));
  }
  levelUp() {
    [392, 523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.9, "triangle", 0.12, 0, 0.9, i * 0.1));
  }
  rune() {
    [293, 440, 587, 880].forEach((f, i) => this.tone(f, 1.6, "sine", 0.12, 0, 1, i * 0.12));
    this.noise(1.2, "bandpass", 300, 3000, 0.1, 2, 0.8);
  }
  obelisk() {
    this.tone(55, 3, "sine", 0.6, 40, 0.6);
    [220, 330, 440, 660, 880, 1320].forEach((f, i) => this.tone(f, 2.4, "sine", 0.1, 0, 1, i * 0.18));
    this.noise(2.4, "bandpass", 200, 5000, 0.2, 1.5, 1);
  }
  breakObj() {
    this.noise(0.35, "bandpass", 1100, 300, 0.35, 0.7, 0.2);
    this.noise(0.2, "highpass", 3000, 1500, 0.15, 0.7, 0.2, 0.03);
    this.tone(140, 0.2, "square", 0.08, 60, 0.1);
  }
  thud(v: number) {
    this.tone(80, 0.18, "sine", Math.min(0.3, v * 0.03), 45, 0.1);
    this.noise(0.1, "lowpass", 600, 200, Math.min(0.2, v * 0.02), 0.7, 0.05);
  }
  hurt() {
    this.tone(200, 0.3, "sawtooth", 0.22, 70, 0.2);
    this.noise(0.25, "lowpass", 1400, 200, 0.3, 0.8, 0.2);
  }
  enemyHurt() {
    this.tone(420, 0.2, "sawtooth", 0.1, 180, 0.4);
  }
  enemyDie() {
    this.tone(500, 0.9, "sawtooth", 0.14, 40, 0.8);
    this.noise(0.8, "bandpass", 2000, 200, 0.2, 1, 0.8);
  }
  enemyScreech() {
    this.tone(700, 0.5, "sawtooth", 0.05, 1100, 0.6);
    this.tone(713, 0.5, "sawtooth", 0.05, 1120, 0.6);
  }
  golemStep() {
    this.tone(55, 0.4, "sine", 0.35, 30, 0.2);
    this.noise(0.25, "lowpass", 400, 80, 0.3, 0.7, 0.2);
  }
  door() {
    this.noise(1.6, "lowpass", 380, 120, 0.4, 1.2, 0.3);
    this.tone(60, 1.6, "sawtooth", 0.14, 40, 0.2);
  }
  chest() {
    this.noise(0.3, "bandpass", 600, 1500, 0.12, 2, 0.2);
    [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.8, "triangle", 0.1, 0, 0.8, 0.1 + i * 0.07));
  }
  shrine() {
    [196, 294, 392, 587].forEach((f, i) => this.tone(f, 2.4, "sine", 0.14, 0, 1, i * 0.1));
    this.noise(1.4, "bandpass", 500, 2800, 0.1, 2, 0.8);
  }
  discover() {
    [440, 554, 659, 880].forEach((f, i) => this.tone(f, 1.1, "triangle", 0.09, 0, 1, i * 0.12));
  }
  gameOver() {
    this.tone(220, 2.4, "sawtooth", 0.2, 40, 0.8);
    this.tone(110, 3, "sine", 0.4, 30, 0.8);
  }
  victory() {
    [262, 330, 392, 523, 659, 784, 1046].forEach((f, i) => this.tone(f, 2.5, "triangle", 0.12, 0, 1, i * 0.16));
  }
  glideStart() {
    this.noise(0.5, "bandpass", 500, 2200, 0.08, 1.4, 0.3);
    this.tone(660, 0.4, "sine", 0.04, 990, 0.6);
  }
  splash() {
    this.noise(0.45, "bandpass", 1400, 400, 0.25, 0.8, 0.3);
    this.tone(300, 0.2, "sine", 0.06, 600, 0.3);
  }
  uiHover() {
    this.tone(1200, 0.06, "sine", 0.04, 1500, 0.2);
  }
  uiClick() {
    this.tone(520, 0.12, "triangle", 0.12, 780, 0.4);
    this.tone(1040, 0.2, "sine", 0.06, 1300, 0.5, 0.03);
  }
  uiOpen() {
    this.noise(0.4, "bandpass", 300, 2500, 0.07, 1.5, 0.5);
    this.tone(392, 0.5, "sine", 0.07, 0, 0.8);
  }
  uiStart() {
    [196, 294, 392, 587, 784].forEach((f, i) => this.tone(f, 2.4, "sine", 0.13, 0, 1, i * 0.1));
    this.noise(2, "bandpass", 200, 4000, 0.15, 1.5, 1);
    this.tone(60, 2.5, "sine", 0.5, 38, 0.5);
  }
  thunderFar() {
    this.noise(3.2, "lowpass", 600, 60, 0.5, 0.5, 0.8);
  }
  lavaBurn() {
    this.noise(0.4, "bandpass", 800, 200, 0.2, 1, 0.2);
  }
}

export const audio = new AudioEngine();
