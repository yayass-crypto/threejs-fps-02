// map.js — "Kestrel Yard", the original DUSTFALL map: a desert-industrial
// compound, 64 by 48 metres, with two bombsites, three lanes and a mid
// connector. Every solid is both a mesh and an AABB collider, so what the
// player sees is exactly what blocks movement, bullets and sightlines.

import * as THREE from 'three';
import { makeTextures } from './textures.js';

// The yard runs x in [-32, 32] (west to east) and z in [-24, 24]
// (north, the defenders' side, to south, the attackers' side).
export const MAP = {
  halfX: 32,
  halfZ: 24,
  wallH: 4,
  siteA: { name: 'A', label: 'REACTOR', x: 22, z: -16, r: 4.2 },
  siteB: { name: 'B', label: 'DEPOT', x: -22, z: 16, r: 4.2 },
  attackSpawn: [[-6, 20], [0, 21], [6, 20], [-2, 18]],
  defendSpawn: [[-6, -20], [0, -21], [6, -20], [2, -18]],
};

// Waypoint graph the bots walk: nodes are open ground, edges are straight
// runs with no wall between them. Bots pathfind with BFS over this graph.
export const WAYPOINTS = {
  nodes: [
    [-6, 20], [0, 21], [6, 20], // 0-2 attack spawn
    [-14, 14], [0, 12], [14, 14], // 3-5 south yard
    [-26, 6], [-14, 4], [0, 4], [14, 4], [26, 6], // 6-10 mid-south
    [-26, -6], [-14, -4], [0, -4], [14, -4], [26, -6], // 11-15 mid-north
    [-14, -14], [0, -12], [14, -14], // 16-18 north yard
    [-6, -20], [0, -21], [6, -20], // 19-21 defend spawn
    [22, -16], // 22 site A
    [-22, 16], // 23 site B
    [26, -12], // 24 A-long elbow
    [-26, 12], // 25 B-tunnel elbow
  ],
  edges: [
    [0, 3], [0, 4], [1, 4], [2, 4], [2, 5],
    [3, 6], [3, 7], [4, 7], [4, 8], [4, 9], [5, 9], [5, 10],
    [6, 11], [6, 25], [7, 11], [7, 12], [8, 12], [8, 13], [9, 13], [9, 14], [10, 14], [10, 24],
    [11, 16], [12, 16], [12, 17], [13, 17], [13, 18], [14, 18],
    [16, 19], [17, 19], [17, 20], [18, 20], [18, 21],
    [15, 24], [24, 22], [18, 22],
    [25, 23], [7, 23], [3, 23],
    [11, 25], [16, 25],
  ],
};

/** Letter sprite for a bombsite marker, drawn on canvas. */
function siteSprite(letter, color) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(64, 64, 58, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#141210';
  ctx.font = 'bold 84px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(letter, 64, 68);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: true }));
  sp.scale.set(2.2, 2.2, 1);
  return sp;
}

/**
 * Build the yard into `scene`. Returns the colliders (AABBs with heights),
 * the bombsites, the spawns and the waypoint graph. The same function runs
 * for the real game and for the screenshot poses, so the pictures match play.
 */
export function buildMap(scene) {
  const tex = makeTextures(20261115);
  const colliders = [];
  const group = new THREE.Group();
  group.name = 'kestrel-yard';

  const concrete = new THREE.MeshStandardMaterial({ map: tex.concrete, roughness: 0.95 });
  const concreteDark = new THREE.MeshStandardMaterial({ map: tex.concreteDark, roughness: 0.95 });
  const sand = new THREE.MeshStandardMaterial({ map: tex.sand, roughness: 1 });
  sand.map.repeat.set(8, 6);
  const teal = new THREE.MeshStandardMaterial({ map: tex.containerTeal, roughness: 0.7, metalness: 0.25 });
  const amber = new THREE.MeshStandardMaterial({ map: tex.containerAmber, roughness: 0.7, metalness: 0.25 });
  const rust = new THREE.MeshStandardMaterial({ map: tex.containerRust, roughness: 0.75, metalness: 0.25 });
  const plate = new THREE.MeshStandardMaterial({ map: tex.plate, roughness: 0.55, metalness: 0.6 });
  const hazard = new THREE.MeshStandardMaterial({ map: tex.hazard, roughness: 0.8 });

  // Ground.
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(64, 48), sand);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  // Perimeter walls.
  const wall = (x, z, w, d) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, MAP.wallH, d), concrete);
    m.position.set(x, MAP.wallH / 2, z);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
    colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, minY: 0, maxY: MAP.wallH });
  };
  wall(0, -24.5, 66, 1);
  wall(0, 24.5, 66, 1);
  wall(-32.5, 0, 1, 50);
  wall(32.5, 0, 1, 50);

  /** A solid box: mesh + collider. y is its base height (0 = on the ground). */
  const box = (x, z, w, h, d, mat, y = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y + h / 2, z);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
    colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, minY: y, maxY: y + h });
    return m;
  };

  // --- Mid: the pump house, the map's centrepiece. Two walls with a gap
  // between them make the mid connector a real decision, not a hallway.
  box(-6, 0, 8, 3.2, 1.2, concreteDark);
  box(6, 0, 8, 3.2, 1.2, concreteDark);
  box(0, -3.4, 4, 2.2, 1.2, plate); // low block you can shoot over
  box(0, 3.4, 4, 2.2, 1.2, plate);

  // --- A-long (east): a container chicane, then the reactor housing.
  box(24, 8, 6, 2.6, 2.4, teal);
  box(27, -2, 2.4, 2.6, 6, amber);
  box(22, -11, 5, 2.2, 2.2, rust);
  box(17, -19, 4, 3.4, 1.4, plate); // reactor wall, A site behind it
  box(27, -19, 4, 2.4, 2.4, teal);

  // --- B-tunnel (west): stacked crates force close fights.
  box(-24, 8, 6, 2.6, 2.4, amber);
  box(-27, -2, 2.4, 2.6, 6, teal);
  box(-22, -11, 5, 2.2, 2.2, rust);
  box(-16, 12, 4, 2.6, 2.4, teal);
  box(-27, 19, 4, 2.4, 2.4, rust);

  // --- South yard (attacker side): two crates and a low wall for cover.
  box(-10, 12, 4, 1.4, 2, concreteDark);
  box(10, 12, 4, 1.4, 2, concreteDark);
  box(0, 16, 8, 1.1, 1, concrete);

  // --- North yard (defender side): mirror cover, plus the depot crane base.
  box(-10, -12, 4, 1.4, 2, concreteDark);
  box(10, -12, 4, 1.4, 2, concreteDark);
  box(-28, -16, 2, 4.5, 2, plate);

  // Barrels: cylinders that read as cover at a glance.
  const barrelMat = new THREE.MeshStandardMaterial({ color: 0x8a5a22, roughness: 0.6, metalness: 0.4 });
  const barrelGeo = new THREE.CylinderGeometry(0.55, 0.55, 1.5, 12);
  for (const [x, z] of [[14, -6], [15.2, -6], [-14, 6], [-15.2, 6], [20, 2], [-20, -2]]) {
    const b = new THREE.Mesh(barrelGeo, barrelMat);
    b.position.set(x, 0.75, z);
    b.castShadow = true;
    group.add(b);
    colliders.push({ minX: x - 0.55, maxX: x + 0.55, minZ: z - 0.55, maxZ: z + 0.55, minY: 0, maxY: 1.5 });
  }

  // Bombsite rings: hazard strips on the ground + a floating letter.
  for (const site of [MAP.siteA, MAP.siteB]) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(site.r - 0.35, site.r, 40), hazard);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(site.x, 0.02, site.z);
    group.add(ring);
    const sp = siteSprite(site.name, site.name === 'A' ? '#d8a419' : '#2e8f86');
    sp.position.set(site.x, 3.6, site.z);
    group.add(sp);
  }

  // Watchtower in the south-east corner: legs + platform, a landmark for
  // callouts. Kept off every waypoint lane so bots never path through it.
  const towerMat = new THREE.MeshStandardMaterial({ color: 0x3d3a35, roughness: 0.8, metalness: 0.3 });
  for (const [dx, dz] of [[-1.4, -1.4], [1.4, -1.4], [-1.4, 1.4], [1.4, 1.4]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.35, 5, 0.35), towerMat);
    leg.position.set(30 + dx, 2.5, 20 + dz);
    leg.castShadow = true;
    group.add(leg);
  }
  const platform = new THREE.Mesh(new THREE.BoxGeometry(4, 0.3, 4), towerMat);
  platform.position.set(30, 5.1, 20);
  platform.castShadow = true;
  group.add(platform);
  colliders.push({ minX: 28.4, maxX: 31.6, minZ: 18.4, maxZ: 21.6, minY: 0, maxY: 5.3 });

  // Dusk sky: a big gradient dome, warm horizon to deep blue top.
  const skyGeo = new THREE.SphereGeometry(180, 24, 12);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color(0x1d2f4d) },
      mid: { value: new THREE.Color(0xc96f3f) },
      bot: { value: new THREE.Color(0xe8a55c) },
    },
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `varying vec3 vP;
      uniform vec3 top; uniform vec3 mid; uniform vec3 bot;
      void main(){
        float h = normalize(vP).y;
        vec3 c = h > 0.12 ? mix(mid, top, smoothstep(0.12, 0.65, h)) : mix(bot, mid, smoothstep(-0.08, 0.12, h));
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  group.add(sky);

  // A low amber sun disc, purely visual.
  const sun = new THREE.Mesh(
    new THREE.CircleGeometry(9, 32),
    new THREE.MeshBasicMaterial({ color: 0xffc46b, fog: false })
  );
  sun.position.set(-70, 26, -120);
  sun.lookAt(0, 0, 0);
  group.add(sun);

  scene.add(group);
  return {
    colliders,
    sites: { A: MAP.siteA, B: MAP.siteB },
    spawns: {
      // Vanguard starts south facing north (yaw 0); Jackals start north facing south.
      vanguard: { x: 0, y: 0, z: 21, yaw: 0 },
      jackals: { x: 0, y: 0, z: -21, yaw: Math.PI },
    },
    waypoints: WAYPOINTS,
  };
}
