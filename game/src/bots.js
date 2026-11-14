// bots.js — the fighters on both sides. Each bot is a small state machine
// walking the map's waypoint graph: patrol and hold, investigate noises,
// engage what it can see, and (as a defender) run to defuse a planted bomb.
// Bots miss on purpose: accuracy falls with distance, target speed and
// their own movement, and every first sight costs a reaction delay, so a
// player who stops, aims and uses cover wins the duel.

import * as THREE from 'three';
import { clamp, collideCircle, mulberry32, pick, segmentBlocked } from './util.js';
import { fireHitscan, makeWeaponInstance, WEAPONS } from './weapons.js';

const EYE = 1.5;
const BODY_R = 0.35;

/** Shortest path (list of node indices) between two waypoints, by BFS. */
export function findPath(graph, from, to) {
  if (from === to) return [from];
  const prev = new Map([[from, -1]]);
  const queue = [from];
  while (queue.length) {
    const n = queue.shift();
    for (const [a, b] of graph.edges) {
      const m = a === n ? b : b === n ? a : -1;
      if (m === -1 || prev.has(m)) continue;
      prev.set(m, n);
      if (m === to) {
        const path = [to];
        let cur = to;
        while (prev.get(cur) !== -1) {
          cur = prev.get(cur);
          path.unshift(cur);
        }
        return path;
      }
      queue.push(m);
    }
  }
  return [from];
}

/** Nearest waypoint node to a position. */
export function nearestNode(graph, x, z) {
  let best = 0;
  let bestD = Infinity;
  graph.nodes.forEach(([nx, nz], i) => {
    const d = (nx - x) ** 2 + (nz - z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

const BOT_NAMES = {
  vanguard: ['Ash', 'Bram', 'Cleo', 'Dario'],
  jackals: ['Vex', 'Rook', 'Mara', 'Kip'],
};

/** Build a bot's visible body: torso, head, legs and gun, team-coloured. */
function buildBody(team) {
  const group = new THREE.Group();
  const suit = new THREE.MeshStandardMaterial({
    color: team === 'vanguard' ? 0x2e6f8f : 0x8f5a2e,
    roughness: 0.85,
  });
  const skin = new THREE.MeshStandardMaterial({ color: 0xc9a586, roughness: 0.9 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x232120, roughness: 0.6, metalness: 0.3 });

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.72, 0.3), suit);
  torso.position.y = 1.06;
  torso.castShadow = true;
  group.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 10), skin);
  head.position.y = 1.55;
  head.castShadow = true;
  group.add(head);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.185, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), dark);
  helmet.position.y = 1.58;
  group.add(helmet);
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.7, 0.26), dark);
  legs.position.y = 0.35;
  legs.castShadow = true;
  group.add(legs);
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.12, 0.62), dark);
  gun.position.set(0.22, 1.18, 0.3);
  group.add(gun);
  // A thin team ring on the ground so the player reads friend from foe.
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.42, 0.5, 24),
    new THREE.MeshBasicMaterial({ color: team === 'vanguard' ? 0x3fa7c9 : 0xe08a2e, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.03;
  group.add(ring);
  return group;
}

export class Bot {
  constructor(game, team, index, weaponId) {
    this.game = game;
    this.team = team;
    this.index = index;
    this.name = BOT_NAMES[team][index % 4];
    this.id = `${team}-${index}`;
    this.alive = true;
    this.hp = 100;
    this.armor = 0;
    this.pos = { x: 0, y: 0, z: 0 };
    this.yaw = 0;
    this.pitch = 0;
    this.radius = BODY_R;
    this.height = 1.7;
    this.headY = 1.55;
    this.headR = 0.18;
    this.weapon = makeWeaponInstance(WEAPONS[weaponId]);
    this.state = 'patrol';
    this.path = [];
    this.pathI = 0;
    this.target = null;
    this.reaction = 0;
    this.burstLeft = 0;
    this.burstPause = 0;
    this.nextShot = 0;
    this.speed = 3.4;
    this.flash = 0; // blinded 0..1
    this.defuse = 0; // seconds of defuse channel banked
    this.heardAt = null;
    this.holdUntil = 0;
    this.rng = mulberry32(game.seed + index * 7919 + (team === 'jackals' ? 13 : 0));
    this.mesh = buildBody(team);
    this.deadAt = 0;
  }

  get eye() {
    return { x: this.pos.x, y: this.pos.y + EYE, z: this.pos.z };
  }

  /** Can this bot see the fighter at `pos` (eye height given)? */
  canSee(pos, eyeY) {
    if (!this.alive) return false;
    const dx = pos.x - this.pos.x;
    const dz = pos.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 55) return false;
    const ang = Math.atan2(-dx, -dz);
    let da = ang - this.yaw;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    if (Math.abs(da) > 1.1) return false; // ~126 degree field of view
    const blocked = segmentBlocked(this.pos.x, this.pos.z, pos.x, pos.z, EYE, eyeY, this.game.colliders);
    return !blocked;
  }

  /** Set a destination: BFS over the waypoint graph from the nearest node. */
  goto(x, z) {
    const g = this.game.map.waypoints;
    const from = nearestNode(g, this.pos.x, this.pos.z);
    const to = nearestNode(g, x, z);
    this.path = findPath(g, from, to);
    this.pathI = 0;
    // The destination itself is the last step.
    this.dest = { x, z };
  }

  /** Walk toward the current path node; returns true when arrived. */
  stepAlong(dt) {
    let goal = null;
    if (this.pathI < this.path.length) {
      const n = this.game.map.waypoints.nodes[this.path[this.pathI]];
      goal = { x: n[0], z: n[1] };
    } else if (this.dest) {
      goal = this.dest;
    }
    if (!goal) return true;
    const dx = goal.x - this.pos.x;
    const dz = goal.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.4) {
      this.pathI++;
      if (this.pathI >= this.path.length && this.dest) {
        this.dest = null;
        return true;
      }
      return this.pathI >= this.path.length;
    }
    const sp = this.speed * dt;
    this.pos.x += (dx / d) * sp;
    this.pos.z += (dz / d) * sp;
    this.yaw = Math.atan2(-dx, -dz);
    collideCircle(this.pos, this.radius, this.game.colliders);
    return false;
  }

  /** A noise at (x, z): close bots turn to investigate. */
  hear(x, z) {
    const d = Math.hypot(x - this.pos.x, z - this.pos.z);
    if (d > 32 || this.state === 'engage') return;
    this.heardAt = { x, z };
    if (this.state === 'patrol' || this.state === 'hold') this.state = 'investigate';
  }

  takeDamage(amount, attacker, opts = {}) {
    if (!this.alive) return;
    this.hp -= amount;
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      this.deadAt = this.game.time;
      this.mesh.rotation.x = -Math.PI / 2; // fall over
      this.mesh.position.y = 0.25;
      this.game.onKill(attacker, this, opts);
    }
  }

  /** One fixed-step tick of the bot's brain. */
  update(dt, time) {
    if (!this.alive) return;
    const game = this.game;
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt / 3);
    if (this.weapon.reloading > 0) {
      this.weapon.reloading -= dt;
      if (this.weapon.reloading <= 0) {
        this.weapon.mag = this.weapon.def.mag;
        this.weapon.reserve = Math.max(0, this.weapon.reserve - this.weapon.def.mag);
      }
    }

    // Perception: the nearest living enemy this bot can see.
    const foes = game.fighters.filter((f) => f.alive && f.team !== this.team);
    let seen = null;
    let seenD = Infinity;
    for (const f of foes) {
      const eyeY = f === game.player ? game.player.eyeY : EYE;
      if (!this.canSee(f.pos, eyeY)) continue;
      const d = Math.hypot(f.pos.x - this.pos.x, f.pos.z - this.pos.z);
      if (d < seenD) {
        seenD = d;
        seen = f;
      }
    }
    if (seen) {
      if (this.state !== 'engage') {
        this.state = 'engage';
        this.reaction = 0.5 + this.rng() * 0.7;
      }
      this.target = seen;
    } else if (this.state === 'engage') {
      this.state = this.team === 'jackals' && game.bomb.state === 'planted' ? 'retake' : 'patrol';
      this.target = null;
      this.burstLeft = 0;
    }

    // Defenders retake a planted site; attackers converge to guard it.
    if (game.bomb.state === 'planted' && this.state !== 'engage') {
      const site = game.bomb.site;
      const d = Math.hypot(site.x - this.pos.x, site.z - this.pos.z);
      if (this.team === 'jackals') {
        if (this.state !== 'retake' && this.state !== 'defusing') {
          this.state = 'retake';
          this.goto(site.x, site.z);
        }
        if (this.state === 'retake' && d < 2.5) {
          this.state = 'defusing';
        }
      } else if (this.state !== 'guard') {
        this.state = 'guard';
        this.goto(site.x + (this.rng() - 0.5) * 5, site.z + (this.rng() - 0.5) * 5);
      }
    }
    if (this.state === 'defusing') {
      this.defuse += dt;
      if (this.defuse >= 5) {
        game.onDefuse(this);
      }
      return;
    }

    if (this.state === 'engage' && this.target?.alive) {
      this.engage(dt, time, seenD);
      return;
    }

    // Movement states.
    if (this.state === 'patrol' || this.state === 'investigate' || this.state === 'push' || this.state === 'retake' || this.state === 'guard') {
      const arrived = this.stepAlong(dt);
      if (arrived) {
        // A push that reaches its site turns into a sweep: attackers hunt
        // the remaining defenders across the whole yard instead of
        // standing on an empty site while the round stalls.
        if (this.state === 'push' || this.state === 'investigate') this.state = 'patrol';
        else if (this.state === 'guard') this.state = 'hold';
      }
      if (this.state === 'patrol' && this.pathI >= this.path.length && !this.dest) {
        if (time > this.holdUntil) {
          // Pick a fresh patrol node. Defenders stay on their half; attackers
          // sweep the whole yard, so a round cannot stall on a hidden last bot.
          const nodes = game.map.waypoints.nodes;
          const pool = this.team === 'jackals'
            ? nodes.map((n, i) => [n, i]).filter(([n]) => n[1] < 0)
            : nodes.map((n, i) => [n, i]);
          const [, ni] = pick(this.rng, pool);
          this.goto(nodes[ni][0], nodes[ni][1]);
          this.holdUntil = time + 1 + this.rng() * 2;
        }
      }
      if (this.state === 'investigate' && this.heardAt) {
        if (this.pathI >= this.path.length && !this.dest) {
          this.goto(this.heardAt.x, this.heardAt.z);
          this.heardAt = null;
        }
      }
    }
  }

  /** Aim at the target and fire in bursts, with human-like error. */
  engage(dt, time, dist) {
    const t = this.target;
    const dx = t.pos.x - this.pos.x;
    const dz = t.pos.z - this.pos.z;
    const wantYaw = Math.atan2(-dx, -dz);
    // Turn toward the target, faster the closer it is.
    let da = wantYaw - this.yaw;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    this.yaw += clamp(da, -3.2 * dt, 3.2 * dt);
    const aimErr = 0.032 + dist * 0.0022 + (t.moving ? 0.03 : 0) + this.flash * 0.25;

    if (this.reaction > 0) {
      this.reaction -= dt;
      return;
    }
    // Strafe a little while fighting so duels are not static.
    const strafe = Math.sin(time * 1.3 + this.index * 2.1) * 0.8;
    this.pos.x += Math.cos(this.yaw) * strafe * dt;
    this.pos.z += -Math.sin(this.yaw) * strafe * dt;
    collideCircle(this.pos, this.radius, this.game.colliders);

    if (this.burstLeft <= 0) {
      if (this.burstPause > 0) {
        this.burstPause -= dt;
        return;
      }
      this.burstLeft = 3 + Math.floor(this.rng() * 2);
      this.burstPause = 0.6 + this.rng() * 0.7;
    }
    const interval = 60 / this.weapon.def.rpm;
    if (time < this.nextShot || this.weapon.mag <= 0) {
      if (this.weapon.mag <= 0 && this.weapon.reloading <= 0 && this.weapon.reserve > 0) {
        this.weapon.reloading = this.weapon.def.reload;
      }
      return;
    }
    this.nextShot = time + interval;
    this.weapon.mag--;
    this.burstLeft--;
    // The bot's own spread model: error grows with distance and blindness.
    const err = aimErr * (0.5 + this.rng());
    const hit = fireHitscan(
      {
        pos: this.eye,
        yaw: this.yaw + (this.rng() - 0.5) * 2 * err,
        pitch: Math.atan2(t.pos.y + 1.2 - this.eye.y, dist) + (this.rng() - 0.5) * 2 * err,
        moving: true, crouching: false, ads: false, self: this,
      },
      this.weapon,
      this.game.fighters,
      this.game.colliders,
      this.rng
    );
    this.game.onBotShot(this, hit);
  }

  /** Place the bot at a spawn and reset its round state. */
  reset(x, z, yaw) {
    this.pos.x = x;
    this.pos.z = z;
    this.pos.y = 0;
    this.yaw = yaw;
    this.hp = 100;
    this.alive = true;
    this.flash = 0;
    this.defuse = 0;
    this.state = this.team === 'jackals' ? 'hold' : 'patrol';
    this.path = [];
    this.pathI = 0;
    this.dest = null;
    this.target = null;
    this.burstLeft = 0;
    this.weapon.mag = this.weapon.def.mag;
    this.weapon.reserve = this.weapon.def.reserve;
    this.weapon.reloading = 0;
    this.mesh.rotation.set(0, 0, 0);
    this.mesh.position.set(x, 0, z);
    this.mesh.visible = true;
  }

  /** Sync the visible body to the simulated position. */
  syncMesh() {
    if (!this.alive) return;
    this.mesh.position.set(this.pos.x, 0, this.pos.z);
    this.mesh.rotation.y = this.yaw;
  }
}
