// player.js — the human fighter. Pointer-lock mouse look, acceleration
// movement with crouching and sprinting, AABB collision, weapons, armour,
// grenades and the bomb. The player is the bomb carrier: rounds are won by
// elimination, by the bomb going off, or lost on a defuse or the clock.

import { clamp, collideCircle } from './util.js';
import { WEAPONS, makeWeaponInstance, fireHitscan, Grenade } from './weapons.js';

const EYE_STAND = 1.62;
const EYE_CROUCH = 1.05;
const RADIUS = 0.35;

export class Player {
  constructor(game) {
    this.game = game;
    this.id = 'player';
    this.name = 'You';
    this.team = 'vanguard';
    this.alive = true;
    this.hp = 100;
    this.armor = 0;
    this.pos = { x: 0, y: 0, z: 0 };
    this.yaw = 0;
    this.pitch = 0;
    this.vel = { x: 0, z: 0 };
    this.radius = RADIUS;
    this.height = 1.7;
    this.headY = 1.55;
    this.headR = 0.18;
    this.money = 800;
    this.primary = makeWeaponInstance(WEAPONS.vk47); // starts owned? no — see reset
    this.sidearm = makeWeaponInstance(WEAPONS.p9);
    this.current = this.sidearm;
    this.hasPrimary = false;
    this.frags = 0;
    this.flashes = 0;
    this.moving = false;
    this.crouching = false;
    this.ads = false;
    this.sprinting = false;
    this.planting = 0; // seconds of plant channel banked
    this.recoil = 0; // pitch kick waiting to recover
    this.nextShot = 0;
    this.firing = false;
    this.triggerEdge = false; // set on mousedown: semi-auto fires once per click
    this.eyeY = EYE_STAND;
  }

  get eye() {
    return { x: this.pos.x, y: this.pos.y + this.eyeY, z: this.pos.z };
  }

  reset(x, z, yaw) {
    this.pos.x = x;
    this.pos.z = z;
    this.pos.y = 0;
    this.yaw = yaw;
    this.pitch = 0;
    this.vel.x = 0;
    this.vel.z = 0;
    this.hp = 100;
    this.alive = true;
    this.planting = 0;
    this.recoil = 0;
    this.firing = false;
    this.sidearm = makeWeaponInstance(WEAPONS.p9);
    this.current = this.sidearm;
    this.hasPrimary = false;
    this.primary = null;
    this.frags = 0;
    this.flashes = 0;
  }

  /** Buy a primary weapon (replaces the one carried). */
  buyPrimary(def) {
    this.primary = makeWeaponInstance(def);
    this.current = this.primary;
    this.hasPrimary = true;
  }

  switchWeapon() {
    if (!this.hasPrimary) return;
    this.current = this.current === this.primary ? this.sidearm : this.primary;
    this.current.reloading = 0;
  }

  takeDamage(amount, attacker, opts = {}) {
    if (!this.alive) return;
    let rest = amount;
    if (this.armor > 0) {
      const soaked = Math.min(this.armor, rest * 0.5);
      this.armor -= soaked;
      rest -= soaked;
    }
    this.hp -= rest;
    this.game.onPlayerHurt(amount, attacker);
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      this.game.onKill(attacker, this, opts);
    }
  }

  /** One fixed-step tick: movement, firing, reload, plant channel. */
  update(dt, input, time) {
    const game = this.game;
    if (!this.alive) return;
    if (this.current.reloading > 0) {
      this.current.reloading -= dt;
      if (this.current.reloading <= 0) {
        this.current.mag = this.current.def.mag;
        this.current.reserve = Math.max(0, this.current.reserve - this.current.def.mag);
      }
    }
    // Recoil recovers toward zero; the camera kick is applied on fire.
    this.recoil = Math.max(0, this.recoil - dt * 0.09);
    this.current.bloom = Math.max(0, this.current.bloom - dt * 0.05);

    // --- Movement: acceleration toward the wish direction, friction when idle.
    this.crouching = input.crouch;
    this.sprinting = input.sprint && !this.crouching && !this.ads;
    this.ads = input.ads && !this.sprinting;
    const speed = this.crouching ? 2.1 : this.sprinting ? 6.2 : this.ads ? 2.6 : 4.3;
    const fwd = (input.forward ? 1 : 0) - (input.back ? 1 : 0);
    const str = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    let wx = -sin * fwd + cos * str;
    let wz = -cos * fwd - sin * str;
    const wl = Math.hypot(wx, wz);
    if (wl > 0) {
      wx /= wl;
      wz /= wl;
    }
    const accel = 42;
    this.vel.x += wx * accel * dt;
    this.vel.z += wz * accel * dt;
    // Friction: exponential decay of velocity.
    const fr = Math.exp(-9 * dt);
    this.vel.x *= fr;
    this.vel.z *= fr;
    const vl = Math.hypot(this.vel.x, this.vel.z);
    if (vl > speed) {
      this.vel.x = (this.vel.x / vl) * speed;
      this.vel.z = (this.vel.z / vl) * speed;
    }
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    collideCircle(this.pos, this.radius, game.colliders);
    this.pos.x = clamp(this.pos.x, -31.4, 31.4);
    this.pos.z = clamp(this.pos.z, -23.4, 23.4);
    this.moving = vl > 0.6;
    this.eyeY = this.crouching ? EYE_CROUCH : EYE_STAND;

    // --- Firing.
    const w = this.current;
    if (this.firing && w.reloading <= 0 && time >= this.nextShot) {
      if (w.mag > 0) {
        // Automatics fire while held; semi-autos fire once per click.
        if (w.def.auto || this.triggerEdge) {
          this.shoot(time);
          this.triggerEdge = false;
        }
      } else if (!w.def.auto) {
        this.firing = false;
      }
    }
    if (w.mag === 0 && this.firing && w.reloading <= 0) {
      this.startReload();
    }

    // --- Bomb plant: hold E inside a site ring.
    if (input.plant && game.bomb.state === 'carry') {
      const site = game.siteAt(this.pos.x, this.pos.z);
      if (site) {
        this.planting += dt;
        if (this.planting >= 3) {
          this.planting = 0;
          game.onPlant(site);
        }
      } else {
        this.planting = 0;
      }
    } else {
      this.planting = 0;
    }
  }

  shoot(time) {
    const game = this.game;
    const w = this.current;
    const interval = 60 / w.def.rpm;
    this.nextShot = time + interval;
    w.mag--;
    w.bloom = Math.min(0.05, w.bloom + w.def.kick * 0.55);
    // The kick moves the camera (this.recoil, decayed in update) and grows
    // the spread bloom — it never moves the aim pitch itself, because a
    // pitch kick with no recovery would climb the crosshair off every
    // target during a burst. Stopping fire lets the bloom settle.
    this.recoil = Math.min(0.06, this.recoil + w.def.kick);
    const hit = fireHitscan(
      {
        pos: this.eye,
        yaw: this.yaw,
        pitch: this.pitch,
        moving: this.moving,
        crouching: this.crouching,
        ads: this.ads,
        self: this,
      },
      w,
      game.fighters,
      game.colliders,
      game.rng
    );
    game.onPlayerShot(this, hit);
    if (w.mag === 0) this.startReload();
  }

  startReload() {
    const w = this.current;
    if (w.reloading > 0 || w.reserve <= 0 || w.mag === w.def.mag) return;
    w.reloading = w.def.reload;
    this.game.onReload(this);
  }

  throwGrenade(kind) {
    const game = this.game;
    if (kind === 'frag' && this.frags <= 0) return null;
    if (kind === 'flash' && this.flashes <= 0) return null;
    if (kind === 'frag') this.frags--;
    else this.flashes--;
    const dir = {
      x: -Math.sin(this.yaw) * Math.cos(this.pitch),
      y: Math.sin(this.pitch) + 0.35,
      z: -Math.cos(this.yaw) * Math.cos(this.pitch),
    };
    const g = new Grenade(
      { x: this.eye.x, y: this.eye.y - 0.2, z: this.eye.z },
      { x: dir.x * 13, y: dir.y * 13, z: dir.z * 13 }
    );
    g.kind = kind;
    g.team = this.team;
    game.grenades.push(g);
    return g;
  }
}
