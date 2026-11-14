# Kestrel Yard — a tactical three.js FPS

A round-based tactical shooter in the style Counter-Strike made famous,
built on three.js 0.187.0, running from static files with no build step and
no network request. You are Vanguard, attacking with four AI teammates
against four Jackal defenders across a desert-industrial compound.

## How a match plays

- **Rounds**: first to 5 rounds wins (at most 9). A round is won by
  eliminating the other team, or by planting the charge at site A
  (reactor) or site B (depot) and letting its 35-second fuse run out.
  Defenders win a round by defusing the charge or surviving the clock.
- **Money**: kills, plants and round wins pay. Between rounds, the buy
  menu (keys 1–6, or B to open) spends it on rifles, an SMG, a sniper,
  Kevlar, frag grenades and flashbangs.
- **Gunplay**: hitscan against body boxes and head spheres, headshots
  deal up to four times the damage, damage falls off with range, and spread blooms with fire
  while movement, crouching and aiming down sights change it. Stopping
  to aim pays; spraying on the move does not.
- **Bots**: the eight AI fighters walk a waypoint graph, hold sites,
  investigate gunfire they hear, engage what they can see (with a
  reaction delay and human-like miss), and run to defuse a planted
  charge. Allies push a site with you each round.
- **HUD**: health, armour, money, ammunition, round timer, score, alive
  pips, killfeed, hitmarkers and a live minimap that marks enemies you
  have spotted recently.

## Controls

| Key | Action |
| --- | --- |
| WASD / mouse | Move / look (click the game to capture the mouse) |
| Click / right mouse | Fire / aim down sights |
| R | Reload |
| 1 / 2 | Switch weapon |
| B, then 1–6 | Buy menu (buy phase only) |
| E (hold) | Plant the charge inside a site ring |
| G / Q | Throw frag grenade / flashbang |
| Shift / Ctrl | Sprint / crouch |

## Run it

```sh
node serve.ts
# open http://localhost:8080 in desktop Chrome
```

Or open `game/index.html` directly from the files (the game needs no
server, but module scripts load most reliably over HTTP).

## Layout

- `game/index.html` — the page: canvas, HUD root, one import map for `three`.
- `game/three.module.min.js`, `game/three.core.min.js` — three.js 0.187.0,
  vendored byte for byte from the kit.
- `game/src/main.js` — boot, fixed-step loop, camera, tracers, screenshot poses.
- `game/src/map.js` — "Kestrel Yard": 64×48 m, two sites, three lanes, mid.
- `game/src/textures.js` — procedural canvas textures (concrete, sand,
  containers, hazard stripes).
- `game/src/weapons.js` — the armoury: hitscan, falloff, headshots, grenades.
- `game/src/bots.js` — bot brains: patrol, hold, investigate, engage, defuse.
- `game/src/player.js` — movement, recoil, weapons, the bomb carrier.
- `game/src/rounds.js` — rounds, the bomb, the economy, the buy menu.
- `game/src/hud.js` — crosshair, health, ammo, timer, score, minimap, menus.
- `game/src/audio.js` — every sound synthesized with WebAudio; no audio files.
- `main.ts` — hands the entry in: copies `game/` and `screenshots/` to
  the output directory and writes `dossier.json` with the kit's library.
- `serve.ts` — the static server above.
- `shots.json` — how each screenshot was staged (`?shot=…&seed=1`).
- `screenshots/` — four real renders of the game's own code.

## Licence

MIT — see `LICENSE`.
