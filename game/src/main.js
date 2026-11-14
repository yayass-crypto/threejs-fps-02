// main.js — Kestrel Yard: a round-based tactical FPS in three.js.
// Vanguard (you + 4 bots) attacks; Jackals (4 bots) defend two sites.
// Win a round by elimination or by planting the charge; lose it to a
// defuse or the clock. First to 5 rounds takes the yard.
//
// Runs from static files with no build step: index.html loads this module,
// three.js comes from the vendored files under game/, and everything else
// (map, bots, audio, HUD) is written in this folder.
//
// Screenshots: open index.html with ?shot=menu|buy|action|plant|end and the
// game stages itself, then sets window.__ready when the frame is settled.

import * as THREE from 'three';
import { buildMap } from './map.js';
import { Bot } from './bots.js';
import { Player } from './player.js';
import { Rounds, SHOP } from './rounds.js';
import { Hud } from './hud.js';
import { AudioSys } from './audio.js';
import { clamp, mulberry32, segmentBlocked } from './util.js';
import { handleGrenades, WEAPONS } from './weapons.js';

const STEP = 1 / 60;

export class Game {
  constructor(seed) {
    this.seed = seed ?? ((Math.random() * 1e9) | 0);
    this.rng = mulberry32(this.seed);
    this.time = 0;
    this.grenades = [];
    this.tracers = [];
    this.seen = {}; // bot id -> last time the player spotted them
    this.shake = 0;

    // --- Renderer, scene, camera.
    this.renderer = new THREE.WebGLRenderer({ antialias: true, canvas: document.getElementById('c') });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0e1418);
    this.scene.fog = new THREE.Fog(0x0e1418, 30, 95);
    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.08, 200);
    this.scene.add(this.camera);

    // --- Lights: low sun + sky fill, shadows on the yard.
    const hemi = new THREE.HemisphereLight(0xbfd4e6, 0x3a2f26, 0.75);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffe0b3, 1.6);
    sun.position.set(28, 42, 18);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -40;
    sun.shadow.camera.right = 40;
    sun.shadow.camera.top = 40;
    sun.shadow.camera.bottom = -40;
    sun.shadow.camera.far = 120;
    this.scene.add(sun);
    this.muzzle = new THREE.PointLight(0xffc36b, 0, 9);
    this.scene.add(this.muzzle);

    // --- Map, fighters, rounds, HUD, audio.
    const built = buildMap(this.scene);
    this.map = built;
    this.colliders = built.colliders;
    this.player = new Player(this);
    this.bots = [];
    for (let i = 0; i < 4; i++) {
      this.bots.push(new Bot(this, 'vanguard', i, i < 2 ? 'vk47' : 'hornet'));
      this.bots.push(new Bot(this, 'jackals', i, i < 2 ? 'vk47' : 'hornet'));
    }
    for (const b of this.bots) this.scene.add(b.mesh);
    this.rounds = new Rounds(this);
    this.hud = new Hud();
    this.audio = new AudioSys();
    this.input = {
      forward: false, back: false, left: false, right: false,
      sprint: false, crouch: false, ads: false, plant: false,
    };
    this.viewmodel = this.buildViewmodel();
    this.camera.add(this.viewmodel);

    this.bindInput();
    window.addEventListener('resize', () => this.onResize());
    this.resetPositions();
    this.hud.setScore(0, 0, 1);
    this.hud.setAlive(5, 4);
    this.hud.setHealth(100, 0);
    this.hud.setMoney(800);
    this.hud.setAmmo(13, 52, 'P9 Sidearm', false, 0, 0);
  }

  get fighters() {
    return [this.player, ...this.bots];
  }

  get bomb() {
    return this.rounds.bomb;
  }

  /** A simple first-person gun: dark receiver, barrel and sight, held low-right. */
  buildViewmodel() {
    const g = new THREE.Group();
    const dark = new THREE.MeshStandardMaterial({ color: 0x1d1c1a, roughness: 0.55, metalness: 0.5 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.14, 0.5), dark);
    body.position.set(0, 0, 0);
    g.add(body);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.3, 8), dark);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.02, -0.36);
    g.add(barrel);
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.08), dark);
    sight.position.set(0, 0.1, -0.05);
    g.add(sight);
    g.position.set(0.28, -0.26, -0.45);
    return g;
  }

  // ------------------------------------------------------------------ setup

  /** Place everyone at their spawn for a fresh round. */
  resetPositions() {
    const sp = this.map.spawns.vanguard;
    this.player.reset(sp.x, sp.z, sp.yaw);
    this.bots.forEach((b, i) => {
      if (b.team === 'vanguard') {
        const s = this.map.spawns.vanguard;
        b.reset(s.x - 4 + (b.index % 4) * 2.6, s.z + (b.index < 2 ? 1.5 : -1), s.yaw);
      } else {
        const site = b.index % 2 === 0 ? this.map.sites.A : this.map.sites.B;
        b.reset(site.x + (this.rng() - 0.5) * 6, site.z + (this.rng() - 0.5) * 6, this.rng() * Math.PI * 2);
        b.state = 'hold';
      }
    });
    for (const b of this.bots) b.syncMesh();
  }

  /** Which site (if any) contains the point (x, z)? */
  siteAt(x, z) {
    for (const [name, s] of Object.entries(this.map.sites)) {
      if (Math.hypot(x - s.x, z - s.z) <= s.r) return { name, ...s };
    }
    return null;
  }

  // ------------------------------------------------------------------ events

  onKill(attacker, victim, opts = {}) {
    const wname = attacker?.current?.def?.name || attacker?.weapon?.def?.name || '—';
    this.hud.killfeed(attacker?.name || '—', victim.name, wname, !!opts.headshot);
    if (attacker === this.player) {
      this.player.money += 300;
      this.audio.kill();
      this.hud.hitmarker(true);
    } else if (victim === this.player) {
      this.audio.hurt();
    }
    this.refreshAlive();
  }

  onPlayerHurt(amount, attacker) {
    this.hud.damageFlash(amount);
    this.audio.hurt();
  }

  onPlayerShot(shooter, hit) {
    this.audio.shot(shooter.current.def.id);
    this.muzzle.position.copy(shooter.eye);
    this.muzzle.intensity = 14;
    this.addTracer(shooter.eye, hit.point, 0xffe08a);
    if (hit.hit) {
      this.hud.hitmarker(hit.killed);
      this.audio.hit();
      if (hit.target) {
        // Spotting: the player now knows where this enemy is for a few seconds.
        this.seen[hit.target.id] = this.time;
      }
    } else if (shooter.current.mag === 0) {
      this.audio.dryFire();
    }
  }

  onBotShot(bot, hit) {
    // Distant shots are quieter; a shot you can hear betrays the bot's lane.
    const d = Math.hypot(bot.pos.x - this.player.pos.x, bot.pos.z - this.player.pos.z);
    if (d < 40) {
      this.audio.shot(bot.weapon.def.id);
      this.seen[bot.id] = this.time;
    }
    this.addTracer(bot.eye, hit.point, 0xff9a5a);
  }

  onReload() {
    this.audio.reload();
  }

  onRoundStart() {
    this.hud.hideBuy();
    this.hud.hideBanner();
    this.hud.showToast(`Round ${this.rounds.round} — plant the charge or wipe them out.`);
    // Allies push a site together; defenders already hold theirs.
    const site = this.rng() < 0.5 ? this.map.sites.A : this.map.sites.B;
    for (const b of this.bots) {
      if (b.team === 'vanguard' && b.alive) {
        b.state = 'push';
        b.goto(site.x + (this.rng() - 0.5) * 4, site.z + (this.rng() - 0.5) * 4);
      }
    }
  }

  onRoundEnd(winner, reason) {
    const won = winner === 'vanguard';
    this.hud.showBanner(won ? 'ROUND WON' : 'ROUND LOST', reason, won);
    if (won) this.audio.roundWin();
    else this.audio.roundLose();
    this.hud.setScore(this.rounds.score.vanguard, this.rounds.score.jackals, this.rounds.round);
    this.hud.setMoney(this.player.money);
    this.refreshAlive();
  }

  onMatchEnd() {
    const v = this.rounds.score.vanguard;
    const j = this.rounds.score.jackals;
    const won = v > j;
    this.hud.showBanner(
      won ? 'MATCH WON — THE YARD IS YOURS' : 'MATCH LOST',
      `Final score Vanguard ${v} — ${j} Jackals. Refresh to play again.`,
      won
    );
  }

  onPlant(site) {
    this.rounds.plant(site);
  }

  onPlantDone(site) {
    this.hud.showToast(`Charge planted at site ${site.name} — defend it!`);
    this.audio.plantBeep(true);
  }

  onDefuse(bot) {
    this.rounds.defuse(bot);
  }

  refreshAlive() {
    const v = this.fighters.filter((f) => f.alive && f.team === 'vanguard').length;
    const j = this.fighters.filter((f) => f.alive && f.team === 'jackals').length;
    this.hud.setAlive(v, j);
  }

  // ------------------------------------------------------------------ tracers

  addTracer(from, to, color) {
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(from.x, from.y, from.z),
      new THREE.Vector3(to.x, to.y, to.z),
    ]);
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 });
    const line = new THREE.Line(geo, mat);
    this.scene.add(line);
    this.tracers.push({ line, life: 0.09 });
  }

  // ------------------------------------------------------------------- input

  bindInput() {
    const canvas = this.renderer.domElement;
    const keymap = {
      KeyW: 'forward', ArrowUp: 'forward',
      KeyS: 'back', ArrowDown: 'back',
      KeyA: 'left', ArrowLeft: 'left',
      KeyD: 'right', ArrowRight: 'right',
      ShiftLeft: 'sprint', ShiftRight: 'sprint',
      ControlLeft: 'crouch', ControlRight: 'crouch',
      KeyE: 'plant',
    };
    window.addEventListener('keydown', (e) => {
      if (e.code in keymap) {
        this.input[keymap[e.code]] = true;
        e.preventDefault();
      }
      if (e.code === 'KeyR') this.player.startReload();
      if (e.code === 'Digit1' || e.code === 'Digit2') this.player.switchWeapon();
      if (e.code === 'KeyG') this.player.throwGrenade('frag');
      if (e.code === 'KeyQ') this.player.throwGrenade('flash');
      if (e.code === 'KeyB') this.toggleBuy();
      if (e.code.startsWith('Digit')) {
        const idx = Number(e.code.slice(5)) - 1;
        if (this.rounds.phase === 'buy' && SHOP[idx]) {
          const msg = this.rounds.buy(SHOP[idx]);
          this.hud.showToast(msg);
          msg.includes('bought') ? this.audio.buy() : this.audio.denied();
          this.hud.setMoney(this.player.money);
        }
      }
    });
    window.addEventListener('keyup', (e) => {
      if (e.code in keymap) this.input[keymap[e.code]] = false;
    });
    canvas.addEventListener('mousedown', (e) => {
      this.audio.ensure();
      if (document.pointerLockElement !== canvas) {
        canvas.requestPointerLock();
        return;
      }
      if (e.button === 0) {
        this.player.firing = true;
        this.player.triggerEdge = true;
      }
      if (e.button === 2) this.input.ads = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.player.firing = false;
      if (e.button === 2) this.input.ads = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== canvas || !this.player.alive) return;
      this.player.yaw -= e.movementX * 0.0021;
      this.player.pitch = clamp(this.player.pitch - e.movementY * 0.0021, -1.45, 1.45);
    });
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement !== canvas && this.rounds.phase === 'playing' && this.player.alive) {
        this.hud.showToast('Click the game to aim again.');
      }
    });
    this.hud.startBtn.addEventListener('click', () => {
      this.audio.ensure();
      this.hud.hideStart();
      canvas.requestPointerLock();
      if (this.rounds.phase === 'menu') {
        this.rounds.startMatch();
        this.hud.showBuy(SHOP);
      }
    });
  }

  toggleBuy() {
    if (this.rounds.phase !== 'buy') return;
    if (this.hud.buy.classList.contains('show')) this.hud.hideBuy();
    else this.hud.showBuy(SHOP);
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  // -------------------------------------------------------------------- loop

  update(dt) {
    this.time += dt;
    const r = this.rounds;
    if (r.phase === 'roundEnd') {
      r.phaseT -= dt;
      if (r.phaseT <= 0) r.advance();
      if (r.phase === 'buy') this.hud.showBuy(SHOP);
    }
    r.update(dt);

    const playing = r.phase === 'playing';
    if (playing && this.player.alive) this.player.update(dt, this.input, this.time);
    for (const b of this.bots) {
      if (playing) b.update(dt, this.time);
      b.syncMesh();
    }

    // Grenades.
    handleGrenades(this.grenades, this.fighters, this.colliders, dt, this.rng, (ev) => {
      if (ev.type === 'frag') {
        this.audio.explosion();
        this.shake = 0.5;
      } else if (ev.type === 'flash') {
        for (const f of this.fighters) {
          if (f === this.player) {
            const d = Math.hypot(ev.pos.x - this.player.pos.x, ev.pos.z - this.player.pos.z);
            if (d < 26) {
              const dir = { x: ev.pos.x - this.player.eye.x, z: ev.pos.z - this.player.eye.z };
              const dl = Math.hypot(dir.x, dir.z) || 1;
              const facing = (-Math.sin(this.player.yaw) * dir.x) / dl + (-Math.cos(this.player.yaw) * dir.z) / dl;
              const blocked = segmentBlocked(this.player.eye.x, this.player.eye.z, ev.pos.x, ev.pos.z, this.player.eye.y, ev.pos.y, this.colliders);
              if (!blocked && facing > -0.2) this.hud.flashbang(1 - d / 30);
            }
          } else if (f.alive && f.team !== 'vanguard') {
            const d = Math.hypot(ev.pos.x - f.pos.x, ev.pos.z - f.pos.z);
            if (d < 25) f.flash = 1;
          }
        }
      }
    });

    // Bomb beep: one a second while the fuse runs.
    if (r.bomb.state === 'planted') {
      const sec = Math.ceil(r.bomb.t);
      if (sec !== this.lastBeepSec) {
        this.lastBeepSec = sec;
        this.audio.plantBeep(sec <= 5);
      }
    }

    // Tracers fade fast; muzzle light decays.
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.life -= dt;
      t.line.material.opacity = Math.max(0, t.life / 0.09) * 0.9;
      if (t.life <= 0) {
        this.scene.remove(t.line);
        t.line.geometry.dispose();
        t.line.material.dispose();
        this.tracers.splice(i, 1);
      }
    }
    this.muzzle.intensity = Math.max(0, this.muzzle.intensity - dt * 220);
    this.shake = Math.max(0, this.shake - dt * 1.4);

    // Camera follows the player's eyes; dead players watch from where they fell.
    const p = this.player;
    const shakeX = this.shake > 0 ? (this.rng() - 0.5) * this.shake * 0.06 : 0;
    const shakeY = this.shake > 0 ? (this.rng() - 0.5) * this.shake * 0.06 : 0;
    this.camera.position.set(p.pos.x + shakeX, p.pos.y + p.eyeY + shakeY, p.pos.z);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = p.yaw;
    this.camera.rotation.x = p.pitch + p.recoil;
    this.camera.rotation.z = 0;
    const targetFov = p.ads ? 55 : 75;
    if (Math.abs(this.camera.fov - targetFov) > 0.1) {
      this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 10);
      this.camera.updateProjectionMatrix();
    }
    // Viewmodel bob and recoil.
    const bob = p.moving ? Math.sin(this.time * 9) * 0.008 : 0;
    this.viewmodel.position.set(0.28, -0.26 + bob, -0.45 + p.recoil * 2.2);
    this.viewmodel.visible = p.alive;

    // HUD.
    const w = p.current;
    this.hud.setHealth(p.hp, p.armor);
    this.hud.setAmmo(w.mag, w.reserve, w.def.name, w.reloading > 0, p.frags, p.flashes);
    this.hud.setMoney(p.money);
    // While the charge is planted the fuse is the timer that matters.
    const clock = r.bomb.state === 'planted' ? r.bomb.t : r.phase === 'buy' ? r.phaseT : r.timer;
    this.hud.setTimer(clock, r.phase);
    this.hud.timer.classList.toggle('bomb', r.bomb.state === 'planted');
    this.hud.setCrosshair(w.bloom + (p.moving ? 0.012 : 0) + (p.ads ? -0.004 : 0.006), p.ads);
    this.hud.setPlant(p.planting > 0 ? p.planting / 3 : null);
    this.hud.drawMinimap(this, this.seen);
  }

  run() {
    let last = performance.now();
    let acc = 0;
    const frame = (now) => {
      requestAnimationFrame(frame);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      acc += dt;
      let steps = 0;
      while (acc >= STEP && steps < 5) {
        this.update(STEP);
        acc -= STEP;
        steps++;
      }
      if (steps === 5) acc = 0;
      this.renderer.render(this.scene, this.camera);
    };
    requestAnimationFrame(frame);
  }

  // ------------------------------------------------------------ screenshots
  // Stage a deterministic scene for ?shot=<mode>, then flag window.__ready.

  stageShot(mode) {
    const placeEnemyInView = (dx, dz) => {
      const b = this.bots.find((x) => x.team === 'jackals' && x.alive);
      if (!b) return;
      b.pos.x = this.player.pos.x + dx;
      b.pos.z = this.player.pos.z + dz;
      b.yaw = Math.atan2(-(this.player.pos.x - b.pos.x), -(this.player.pos.z - b.pos.z));
      b.syncMesh();
    };
    this.hud.hideStart();
    if (mode === 'menu') {
      this.hud.showStart();
      this.player.pos.x = 0; this.player.pos.z = 14;
      this.player.yaw = 0;
    } else if (mode === 'buy') {
      this.rounds.startMatch();
      this.hud.showBuy(SHOP);
      this.player.pos.x = 0; this.player.pos.z = 18;
      this.player.yaw = 0;
    } else if (mode === 'action') {
      this.rounds.startMatch();
      this.rounds.startRound();
      // East lane (A-long): a clear sightline past the containers to a Jackal.
      this.player.pos.x = 14; this.player.pos.z = 10;
      this.player.yaw = -0.358;
      placeEnemyInView(5, -12);
      const ally = this.bots.find((x) => x.team === 'vanguard');
      if (ally) {
        ally.pos.x = 12;
        ally.pos.z = 12;
        ally.yaw = -0.36;
        ally.syncMesh();
      }
      this.player.buyPrimary(WEAPONS.vk47);
      this.player.current.mag = 24;
    } else if (mode === 'plant') {
      this.rounds.startMatch();
      this.rounds.startRound();
      this.rounds.plant({ name: 'A', x: 22, y: 0, z: -16, r: 4.2 });
      this.player.pos.x = 17; this.player.pos.z = -11;
      this.player.yaw = -0.79;
      placeEnemyInView(4, -8);
    } else if (mode === 'end') {
      this.rounds.startMatch();
      this.rounds.score.vanguard = 3;
      this.rounds.score.jackals = 1;
      this.rounds.round = 4;
      this.rounds.endRound('vanguard', 'Jackals wiped out.');
      this.player.pos.x = 2; this.player.pos.z = 10;
      this.player.yaw = 0;
    }
    this.update(STEP);
    this.renderer.render(this.scene, this.camera);
    window.__ready = true;
  }
}

const params = new URLSearchParams(location.search);
const seedParam = Number(params.get('seed'));
const game = new Game(Number.isFinite(seedParam) && params.get('seed') !== null ? seedParam : undefined);
window.__game = game;
game.run();
if (params.get('shot')) {
  setTimeout(() => game.stageShot(params.get('shot')), 400);
} else {
  game.hud.showStart();
}
