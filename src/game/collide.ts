import * as THREE from "three";
import { Collider, ColliderGrid } from "./geo";
import { groundH } from "./terrain";

function inside(c: Collider, x: number, z: number, m: number) {
  const dx = x - c.x;
  const dz = z - c.z;
  if (c.kind === 0) return dx * dx + dz * dz < (c.r + m) * (c.r + m);
  const lx = dx * c.c - dz * c.s;
  const lz = dx * c.s + dz * c.c;
  return Math.abs(lx) <= c.hw + m && Math.abs(lz) <= c.hd + m;
}

// highest standable surface at (x,z) not above feet+stepUp
export function standHeight(grid: ColliderGrid, x: number, z: number, feetY: number, stepUp: number): number {
  let g = groundH(x, z);
  const list = grid.get(x, z);
  if (list)
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (!c.enabled || c.y1 > feetY + stepUp || c.y1 <= g) continue;
      if (inside(c, x, z, 0.02)) g = c.y1;
    }
  return g;
}

const out = { x: 0, z: 0 };
function pushVec(c: Collider, x: number, z: number, r: number) {
  const dx = x - c.x;
  const dz = z - c.z;
  if (c.kind === 0) {
    const d = Math.sqrt(dx * dx + dz * dz);
    const m = c.r + r;
    if (d >= m) return false;
    if (d < 1e-4) {
      out.x = m;
      out.z = 0;
      return true;
    }
    out.x = (dx / d) * (m - d);
    out.z = (dz / d) * (m - d);
    return true;
  }
  const lx = dx * c.c - dz * c.s;
  const lz = dx * c.s + dz * c.c;
  const cx = Math.max(-c.hw, Math.min(c.hw, lx));
  const cz = Math.max(-c.hd, Math.min(c.hd, lz));
  let px = lx - cx;
  let pz = lz - cz;
  const d = Math.sqrt(px * px + pz * pz);
  if (d >= r && !(d === 0)) return false;
  if (d === 0) {
    // inside: push out along min penetration
    const ox = c.hw - Math.abs(lx);
    const oz = c.hd - Math.abs(lz);
    if (ox < oz) {
      px = (lx >= 0 ? 1 : -1) * (ox + r);
      pz = 0;
    } else {
      pz = (lz >= 0 ? 1 : -1) * (oz + r);
      px = 0;
    }
  } else {
    px = (px / d) * (r - d);
    pz = (pz / d) * (r - d);
  }
  out.x = px * c.c + pz * c.s;
  out.z = -px * c.s + pz * c.c;
  return true;
}

// push position out of colliders horizontally. returns true if pushed.
export function pushOut(grid: ColliderGrid, pos: THREE.Vector3, r: number, height: number, stepUp: number, vel?: THREE.Vector3): boolean {
  const list = grid.get(pos.x, pos.z);
  let hit = false;
  if (!list) return false;
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (!c.enabled) continue;
    if (c.y1 <= pos.y + stepUp) continue; // can step on top
    if (c.y0 >= pos.y + height) continue; // overhead
    if (pushVec(c, pos.x, pos.z, r)) {
      pos.x += out.x;
      pos.z += out.z;
      hit = true;
      if (vel) {
        const l = Math.hypot(out.x, out.z) || 1;
        const nx = out.x / l;
        const nz = out.z / l;
        const vn = vel.x * nx + vel.z * nz;
        if (vn < 0) {
          vel.x -= nx * vn;
          vel.z -= nz * vn;
        }
      }
    }
  }
  return hit;
}

// is point inside any collider volume (for projectiles)
export function pointHits(grid: ColliderGrid, x: number, y: number, z: number): Collider | null {
  const list = grid.get(x, z);
  if (!list) return null;
  for (const c of list) {
    if (!c.enabled || y < c.y0 || y > c.y1) continue;
    if (inside(c, x, z, 0)) return c;
  }
  return null;
}
