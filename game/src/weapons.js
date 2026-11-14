// weapons.js — the DUSTFALL armoury. Every weapon is a plain data row plus
// one fire function: hitscan against bot hitboxes and map boxes, with
// damage falloff, headshots, recoil, spread bloom and movement penalties,
// so stopping to aim genuinely pays. No hitscan ever touches the network.

import { clamp, rayBox, raySphere, collideCircle } from './util.js';

/** The buy menu's catalogue. Prices in round dollars. */
export const WEAPONS = {
  p9: {
    id: 'p9', name: 'P9 Sidearm', price: 0, slot: 'sidearm',
    damage: 34, headMult: 4, rpm: 360, mag: 12, reserve: 48,
    reload: 1.4, spread: 0.011, moveSpread: 0.02, range: 42,
    auto: false, kick: 0.011, zoom: 1.0,
  },
  hornet: {
    id: 'hornet', name: 'Hornet-9 SMG', price: 1500, slot: 'primary',
    damage: 26, headMult: 4, rpm: 750, mag: 28, reserve: 112,
    reload: 2.1, spread: 0.016, moveSpread: 0.026, range: 34,
    auto: true, kick: 0.009, zoom: 1.0,
  },
  vk47: {
    id: 'vk47', name: 'VK-47 Rifle', price: 2700, slot: 'primary',
    damage: 40, headMult: 4, rpm: 600, mag: 25, reserve: 100,
    reload: 2.5, spread: 0.008, moveSpread: 0.02, range: 60,
    auto: true, kick: 0.016, zoom: 1.15,
  },
  longbow: {
    id: 'longbow', name: 'Longbow-50', price: 4750, slot: 'primary',
    damage: 115, headMult: 2, rpm: 48, mag: 5, reserve: 15,
    reload: 3.4, spread: 0.001, moveSpread: 0.05, range: 90,
    auto: false, kick: 0.05, zoom: 2.4,
  },
};

export const ARMOR_PRICE = 650;
export const FRAG_PRICE = 300;
export const FLASH_PRICE = 200;

/** A live weapon instance: ammo counts and bloom state. */
export function makeWeaponInstance(def) {
  return {
    def,
    mag: def.mag,
    reserve: def.reserve,
    reloading: 0, // seconds left, 0 = ready
    bloom: 0, // accumulated spread from recent shots, decays over time
    lastShot: -10,
  };
}

/**
 * Fire one hitscan shot.
 * `shooter` is {pos:{x,y,z}, yaw, pitch, moving, crouching, ads, self}.
 * `targets` are fighters with {pos, alive, team, radius, height, headY, headR}.
 * `colliders` are the map AABBs. Applies damage and returns
 * {hit, killed, headshot, point:{x,y,z}, target} — hit false on a miss,
 * with point at the end of the bullet's flight (wall hit or max range).
 */
export function fireHitscan(shooter, weapon, targets, colliders, rng) {
  const def = weapon.def;
  // Spread: base + bloom + movement, halved while aiming down sights.
  let spread = def.spread + weapon.bloom + (shooter.moving ? def.moveSpread : 0);
  if (shooter.crouching) spread *= 0.75;
  if (shooter.ads) spread *= 0.45;
  const ay = shooter.yaw + (rng() - 0.5) * 2 * spread;
  const ap = shooter.pitch + (rng() - 0.5) * 2 * spread;
  const dx = -Math.sin(ay) * Math.cos(ap);
  const dy = Math.sin(ap);
  const dz = -Math.cos(ay) * Math.cos(ap);
  const o = shooter.pos;

  // Nearest map hit caps the shot's range.
  let bestT = def.range;
  for (const b of colliders) {
    const t = rayBox(o.x, o.y, o.z, dx, dy, dz, b);
    if (t < bestT) bestT = t;
  }
  // Nearest fighter hit wins; a head sphere beats its body box.
  // No friendly fire: a shot can only hit the other team.
  let hit = null;
  for (const t of targets) {
    if (!t.alive || t === shooter.self) continue;
    if (shooter.self && t.team === shooter.self.team) continue;
    const th = raySphere(o.x, o.y, o.z, dx, dy, dz, t.pos.x, t.pos.y + t.headY, t.pos.z, t.headR);
    if (th < bestT) {
      bestT = th;
      hit = { target: t, part: 'head', dist: th };
      continue;
    }
    const tb = rayBox(
      o.x, o.y, o.z, dx, dy, dz,
      {
        minX: t.pos.x - t.radius, maxX: t.pos.x + t.radius,
        minY: t.pos.y, maxY: t.pos.y + t.height,
        minZ: t.pos.z - t.radius, maxZ: t.pos.z + t.radius,
      }
    );
    if (tb < bestT) {
      bestT = tb;
      hit = { target: t, part: 'body', dist: tb };
    }
  }
  const endPoint = {
    x: o.x + dx * bestT,
    y: o.y + dy * bestT,
    z: o.z + dz * bestT,
  };
  if (!hit) return { hit: false, killed: false, headshot: false, point: endPoint, target: null };
  // Damage falls off past half range; headshots multiply.
  const fall = hit.dist > def.range / 2 ? 1 - 0.35 * ((hit.dist - def.range / 2) / (def.range / 2)) : 1;
  let damage = def.damage * (hit.part === 'head' ? def.headMult : 1) * fall;
  if (hit.target.armor > 0) damage *= 0.6; // armour soaks 40% of a hit
  const wasAlive = hit.target.alive;
  hit.target.takeDamage(Math.round(damage), shooter.self, { headshot: hit.part === 'head' });
  return {
    hit: true,
    killed: wasAlive && !hit.target.alive,
    headshot: hit.part === 'head',
    point: endPoint,
    target: hit.target,
    damage: Math.round(damage),
  };
}

/** A thrown frag grenade: simple ballistic arc, then a timed blast. */
export class Grenade {
  constructor(pos, vel) {
    this.pos = { ...pos };
    this.vel = { ...vel };
    this.kind = 'frag';
    this.team = null; // thrower's team: a blast never hurts its own side
    this.fuse = 1.6;
    this.exploded = false;
  }

  /** Step the grenade; returns 'bounce' when it touches the ground or a wall. */
  step(dt, colliders) {
    if (this.exploded) return null;
    this.vel.y -= 12 * dt;
    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;
    this.pos.z += this.vel.z * dt;
    // Walls: the circle solver pushes us out; kill the into-wall velocity.
    const bx = this.pos.x;
    const bz = this.pos.z;
    collideCircle(this.pos, 0.12, colliders);
    if (this.pos.x !== bx) this.vel.x *= -0.35;
    if (this.pos.z !== bz) this.vel.z *= -0.35;
    let bounced = false;
    if (this.pos.y <= 0.12) {
      this.pos.y = 0.12;
      this.vel.y = Math.abs(this.vel.y) * 0.3;
      this.vel.x *= 0.6;
      this.vel.z *= 0.6;
      this.fuse = Math.min(this.fuse, 0.6);
      bounced = true;
    }
    this.fuse -= dt;
    if (this.fuse <= 0) this.exploded = true;
    return bounced ? 'bounce' : null;
  }

  /** Damage every fighter within radius, falling off with distance. */
  blast(fighters) {
    const out = [];
    for (const f of fighters) {
      if (!f.alive) continue;
      if (this.team && f.team === this.team) continue;
      const dx = f.pos.x - this.pos.x;
      const dy = f.pos.y + 0.9 - this.pos.y;
      const dz = f.pos.z - this.pos.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > 9) continue;
      const dmg = Math.round(120 * (1 - (d / 9) * 0.7));
      out.push({ target: f, damage: dmg, dist: d });
    }
    return out;
  }
}

/** A thrown flashbang: blinds fighters looking toward it within range. */
export function flashEffect(pos, fighters, team = null) {
  const out = [];
  for (const f of fighters) {
    if (!f.alive) continue;
    if (team && f.team === team) continue;
    const dx = f.pos.x - pos.x;
    const dy = f.pos.y + 1.5 - pos.y;
    const dz = f.pos.z - pos.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d > 26) continue;
    out.push({ target: f, strength: clamp(1 - d / 30, 0.25, 1) });
  }
  return out;
}

export { clamp };

/**
 * Step every live grenade and fire `onEvent` when one goes off:
 * {type:'frag', pos} after the blast damages fighters in radius, or
 * {type:'flash', pos, victims} after victims are blinded.
 */
export function handleGrenades(grenades, fighters, colliders, dt, rng, onEvent) {
  for (let i = grenades.length - 1; i >= 0; i--) {
    const g = grenades[i];
    g.step(dt, colliders);
    if (!g.exploded) continue;
    if (g.kind === 'frag') {
      for (const { target, damage } of g.blast(fighters)) {
        target.takeDamage(damage, null);
      }
      onEvent({ type: 'frag', pos: { ...g.pos } });
    } else {
      const victims = flashEffect(g.pos, fighters, g.team);
      for (const { target, strength } of victims) {
        if (target.flash !== undefined) target.flash = Math.max(target.flash, strength);
      }
      onEvent({ type: 'flash', pos: { ...g.pos }, victims });
    }
    grenades.splice(i, 1);
  }
}
