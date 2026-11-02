import * as THREE from "three";

// Shared uniforms driven by the engine
export const U = {
  uTime: { value: 0 },
  uPlayer: { value: new THREE.Vector3() },
  uWave: { value: new THREE.Vector4(0, 0, 0, 0) },
  uGlowPulse: { value: 1 },
};

export type SwayMode = "grass" | "tree" | "none";

export function applySway(mat: THREE.Material, mode: SwayMode, amp = 1) {
  const m = mat as any;
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (s: any, r: any) => {
    prev?.(s, r);
    s.uniforms.uTime = U.uTime;
    s.uniforms.uPlayer = U.uPlayer;
    s.uniforms.uWave = U.uWave;
    s.vertexShader = s.vertexShader
      .replace("#include <common>", `#include <common>\nuniform float uTime; uniform vec3 uPlayer; uniform vec4 uWave;`)
      .replace(
        "#include <project_vertex>",
        `
        vec4 mvPosition = vec4(transformed, 1.0);
        #ifdef USE_BATCHING
          mvPosition = batchingMatrix * mvPosition;
        #endif
        #ifdef USE_INSTANCING
          mvPosition = instanceMatrix * mvPosition;
          float hh = max(0.0, mvPosition.y - instanceMatrix[3].y);
        #else
          float hh = max(0.0, mvPosition.y);
        #endif
        ${
          mode === "grass"
            ? `
          vec2 off = vec2(sin(uTime*1.7 + mvPosition.x*0.7 + mvPosition.z*0.3), cos(uTime*1.3 + mvPosition.z*0.6))*${(0.07 * amp).toFixed(3)}*hh;
          vec2 dp = mvPosition.xz - uPlayer.xz; float dl = length(dp);
          off += (dp/(dl+0.001)) * exp(-dl*dl*0.45) * min(hh,1.0) * 0.8;
          vec2 dw = mvPosition.xz - uWave.xy; float wl = length(dw);
          off += (dw/(wl+0.001)) * exp(-pow((wl-uWave.z)*0.4,2.0)) * uWave.w * min(hh,1.0) * 1.4;
          mvPosition.xz += off;
          mvPosition.y -= length(off)*0.3;`
            : mode === "tree"
            ? `
          float sw = hh * hh * ${(0.0016 * amp).toFixed(5)};
          mvPosition.x += sin(uTime*1.1 + mvPosition.x*0.13 + mvPosition.z*0.09) * sw;
          mvPosition.z += cos(uTime*0.9 + mvPosition.z*0.11) * sw * 0.7;`
            : ""
        }
        mvPosition = modelViewMatrix * mvPosition;
        gl_Position = projectionMatrix * mvPosition;
        `
      );
  };
  m.customProgramCacheKey = () => "sway-" + mode + amp;
  return mat;
}

export function glowMaterial(intensity = 2.5, opts: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.25, metalness: 0.1, ...opts });
  m.onBeforeCompile = (s) => {
    s.uniforms.uGlowPulse = U.uGlowPulse;
    s.fragmentShader = s.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uGlowPulse;")
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>\n totalEmissiveRadiance += vColor.rgb * ${intensity.toFixed(2)} * uGlowPulse;`);
  };
  m.customProgramCacheKey = () => "glow" + intensity;
  return m;
}

export const mats = {
  stone: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0.0 }),
  gold: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.28, metalness: 0.9 }),
  wood: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.0 }),
  ice: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.88 }),
  glow: glowMaterial(2.4),
  glowSoft: glowMaterial(1.2),
  glowBright: glowMaterial(4.5),
  treeBark: applySway(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }), "tree", 1),
  foliage: applySway(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, side: THREE.DoubleSide }), "tree", 1.4),
  grass: applySway(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide }), "grass"),
  grassGlow: applySway(glowMaterial(0.9, { side: THREE.DoubleSide, roughness: 0.7 }), "grass"),
  rock: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, flatShading: false }),
  crystal: glowMaterial(1.6, { roughness: 0.12, metalness: 0.2 }),
};

// ---- water + lava shaders ----
export const waterVert = /* glsl */ `
attribute float aDepth;
varying vec3 vW;
varying float vDepth;
void main(){
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz; vDepth = aDepth;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
export const waterFrag = /* glsl */ `
precision highp float;
varying vec3 vW; varying float vDepth;
uniform float uTime, uSunI, uFogDensity, uGlow;
uniform vec3 uSunDir, uSunCol, uHorizon, uZenith, uCam, uShallow, uDeep, uFogColor;
void main(){
  if (vDepth < 0.0) discard;
  float t = uTime; vec2 p = vW.xz;
  vec2 g = vec2(0.0);
  vec2 d1 = vec2(0.8,0.6), d2 = vec2(-0.5,0.85), d3 = vec2(0.95,-0.3), d4 = vec2(-0.7,-0.7);
  g += d1*0.9*cos(dot(d1,p)*0.9 + t*1.3)*0.05;
  g += d2*1.7*cos(dot(d2,p)*1.7 + t*1.9)*0.03;
  g += d3*3.1*cos(dot(d3,p)*3.1 + t*2.6)*0.016;
  g += d4*5.3*cos(dot(d4,p)*5.3 + t*3.4)*0.009;
  vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
  vec3 V = normalize(uCam - vW);
  float fres = pow(1.0 - max(dot(n,V), 0.0), 4.0);
  vec3 R = reflect(-V, n);
  vec3 sky = mix(uHorizon, uZenith, pow(clamp(R.y,0.0,1.0), 0.5));
  float spec = pow(max(dot(R, uSunDir), 0.0), 300.0) * uSunI;
  vec3 body = mix(uShallow, uDeep, smoothstep(0.0, 4.5, vDepth));
  vec3 col = mix(body, sky, clamp(fres*0.85 + 0.06, 0.0, 1.0));
  col += uSunCol * spec * 2.5;
  col += uGlow * body * 1.6 * (0.7 + 0.3*sin(t + p.x*0.5));
  float foam = smoothstep(0.5, 0.0, vDepth + sin(p.x*3.0 + t*1.5)*0.08 + sin(p.y*2.3 - t*1.1)*0.08);
  col = mix(col, vec3(0.9,0.97,1.0)*(0.5+uSunI*0.2), foam*0.55);
  float alpha = clamp(smoothstep(0.0, 0.6, vDepth)*0.8 + 0.12 + fres*0.35, 0.0, 0.95);
  float fd = length(uCam - vW);
  float ff = 1.0 - exp(-pow(uFogDensity*fd, 2.0));
  col = mix(col, uFogColor, ff);
  gl_FragColor = vec4(col, alpha);
}`;
export const lavaFrag = /* glsl */ `
precision highp float;
varying vec3 vW; varying float vDepth;
uniform float uTime, uFogDensity;
uniform vec3 uCam, uFogColor;
float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
void main(){
  if (vDepth < 0.0) discard;
  vec2 p = vW.xz * 0.18;
  float n = vn(p + vec2(uTime*0.05, 0.0)) * 0.5 + vn(p*2.3 - vec2(0.0, uTime*0.08)) * 0.3 + vn(p*5.0 + uTime*0.1) * 0.2;
  float crust = smoothstep(0.42, 0.62, n);
  vec3 hot = mix(vec3(1.0,0.25,0.02), vec3(1.0,0.8,0.2), smoothstep(0.2,0.45,n));
  vec3 col = mix(hot*2.4, vec3(0.06,0.02,0.015), crust);
  float edge = smoothstep(0.0, 0.7, vDepth);
  col = mix(vec3(0.05,0.02,0.01), col, edge);
  float fd = length(uCam - vW);
  float ff = 1.0 - exp(-pow(uFogDensity*fd, 2.0));
  col = mix(col, uFogColor, ff);
  gl_FragColor = vec4(col, 1.0);
}`;

export const beamVert = /* glsl */ `
varying vec2 vUv; varying vec3 vN; varying vec3 vV;
void main(){ vUv = uv; vec4 mv = modelViewMatrix*vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`;
export const beamFrag = /* glsl */ `
varying vec2 vUv; varying vec3 vN; varying vec3 vV;
uniform vec3 uColor; uniform float uOpacity; uniform float uTime; uniform float uFade;
void main(){
  float edge = pow(abs(dot(normalize(vN), normalize(vV))), 1.6);
  float v = uFade > 0.5 ? (1.0 - vUv.y) : sin(vUv.y*3.14159);
  float flick = 0.85 + 0.15*sin(uTime*1.3 + vUv.y*6.0);
  gl_FragColor = vec4(uColor, edge * v * uOpacity * flick);
}`;

export const portalFrag = /* glsl */ `
varying vec2 vUv; uniform float uTime; uniform float uPower; uniform vec3 uColor; uniform vec3 uColor2;
float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
void main(){
  vec2 c = vUv*2.0-1.0;
  float r = length(c);
  float a = atan(c.y, c.x);
  float swirl = vn(vec2(a*2.0 + uTime*0.8 - r*5.0, r*3.0 - uTime*0.6)) + 0.5*vn(vec2(a*4.0 - uTime*1.2 + r*9.0, r*7.0 + uTime));
  float core = smoothstep(1.0, 0.0, r);
  vec3 col = mix(uColor2, uColor, clamp(swirl,0.0,1.0)) * (0.6 + swirl) * 1.4;
  col += uColor * pow(core, 3.0) * 1.5;
  float alpha = smoothstep(1.0, 0.85, r) * (0.25 + 0.75*uPower) * (0.55 + swirl*0.5);
  gl_FragColor = vec4(col * (0.35 + uPower*1.3), alpha);
}`;
