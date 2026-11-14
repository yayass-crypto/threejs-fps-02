// util.js — small shared helpers for DUSTFALL: seeded randomness, scalar math,
// axis-aligned box collision and segment tests. No three.js dependency here;
// the 3D code lives in the other modules and calls these for its decisions.

/** Clamp a number into [lo, hi]. */
export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Linear interpolation between a and b by t in [0, 1]. */
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** A deterministic 32-bit PRNG (mulberry32). Same seed, same stream. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pick one element of an array with a random function. */
export function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

/**
 * Resolve a circle (x, z, radius r) against a list of AABBs [{minX, maxX, minZ, maxZ}].
 * Mutates and returns the position object {x, z}. The circle slides along walls.
 */
export function collideCircle(pos, r, boxes) {
  for (const b of boxes) {
    const cx = clamp(pos.x, b.minX, b.maxX);
    const cz = clamp(pos.z, b.minZ, b.maxZ);
    const dx = pos.x - cx;
    const dz = pos.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= r * r) continue;
    if (d2 > 1e-9) {
      const d = Math.sqrt(d2);
      const push = (r - d) / d;
      pos.x += dx * push;
      pos.z += dz * push;
    } else {
      // Centre inside the box: push out along the smallest penetration axis.
      const pl = pos.x - b.minX + r;
      const pr = b.maxX - pos.x + r;
      const pt = pos.z - b.minZ + r;
      const pb = b.maxZ - pos.z + r;
      const m = Math.min(pl, pr, pt, pb);
      if (m === pl) pos.x = b.minX - r;
      else if (m === pr) pos.x = b.maxX + r;
      else if (m === pt) pos.z = b.minZ - r;
      else pos.z = b.maxZ + r;
    }
  }
  return pos;
}

/**
 * Does the segment from (x0,z0) to (x1,z1) cross any AABB in `boxes`?
 * 2D slab test; used for line-of-sight between two fighters at eye height.
 * Boxes may carry minY/maxY; a box only blocks when the segment's height
 * band [y0, y1] overlaps the box's [minY, maxY].
 */
export function segmentBlocked(x0, z0, x1, z1, y0, y1, boxes) {
  const dx = x1 - x0;
  const dz = z1 - z0;
  for (const b of boxes) {
    const minY = b.minY ?? 0;
    const maxY = b.maxY ?? Infinity;
    if (Math.max(y0, y1) < minY || Math.min(y0, y1) > maxY) continue;
    let t0 = 0;
    let t1 = 1;
    if (Math.abs(dx) < 1e-9) {
      if (x0 < b.minX || x0 > b.maxX) continue;
    } else {
      let ta = (b.minX - x0) / dx;
      let tb = (b.maxX - x0) / dx;
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta);
      t1 = Math.min(t1, tb);
      if (t0 > t1) continue;
    }
    if (Math.abs(dz) < 1e-9) {
      if (z0 < b.minZ || z0 > b.maxZ) continue;
    } else {
      let ta = (b.minZ - z0) / dz;
      let tb = (b.maxZ - z0) / dz;
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta);
      t1 = Math.min(t1, tb);
      if (t0 > t1) continue;
    }
    return true;
  }
  return false;
}

/**
 * Ray (origin + t * dir, t >= 0) against an AABB. Returns the smallest t >= 0
 * of entry, or Infinity when there is no hit. `box` is {minX,maxX,minY,maxY,minZ,maxZ}.
 */
export function rayBox(ox, oy, oz, dx, dy, dz, box) {
  let t0 = 0;
  let t1 = Infinity;
  const o = [ox, oy, oz];
  const d = [dx, dy, dz];
  const mn = [box.minX, box.minY, box.minZ];
  const mx = [box.maxX, box.maxY, box.maxZ];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-12) {
      if (o[i] < mn[i] || o[i] > mx[i]) return Infinity;
    } else {
      let ta = (mn[i] - o[i]) / d[i];
      let tb = (mx[i] - o[i]) / d[i];
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta);
      t1 = Math.min(t1, tb);
      if (t0 > t1) return Infinity;
    }
  }
  return t0;
}

/**
 * Ray against a sphere. Returns the smallest t >= 0 of entry, or Infinity.
 */
export function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const lx = ox - cx;
  const ly = oy - cy;
  const lz = oz - cz;
  const b = lx * dx + ly * dy + lz * dz;
  const c = lx * lx + ly * ly + lz * lz - r * r;
  const disc = b * b - c;
  if (disc < 0) return Infinity;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : Infinity;
}

/** Format seconds as M:SS for the round timer. */
export function formatTime(s) {
  const t = Math.max(0, Math.ceil(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}
