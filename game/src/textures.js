// textures.js — every texture in DUSTFALL is painted at load time on a 2D
// canvas: no image files ship with the game, so nothing is fetched over the
// network and the whole look is the game's own art. Each painter takes a
// seeded random function so the map looks the same on every machine.

import * as THREE from 'three';

/** Paint speckle noise over a canvas context. */
function speckle(ctx, w, h, rng, colors, n, size) {
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = colors[Math.floor(rng() * colors.length)];
    ctx.globalAlpha = 0.05 + rng() * 0.16;
    const s = 1 + rng() * size;
    ctx.fillRect(rng() * w, rng() * h, s, s);
  }
  ctx.globalAlpha = 1;
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

/** Fine desert sand with a faint raked pattern. */
export function sandTexture(rng) {
  const [c, ctx] = canvas(256, 256);
  ctx.fillStyle = '#c9a06b';
  ctx.fillRect(0, 0, 256, 256);
  speckle(ctx, 256, 256, rng, ['#b98f57', '#d9b47e', '#a87f4e', '#e0bd85'], 2600, 2.5);
  ctx.strokeStyle = 'rgba(120, 90, 50, 0.10)';
  ctx.lineWidth = 2;
  for (let y = 8; y < 256; y += 22) {
    ctx.beginPath();
    ctx.moveTo(0, y + rng() * 4);
    for (let x = 0; x <= 256; x += 32) ctx.lineTo(x, y + Math.sin(x * 0.05 + y) * 3);
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Weathered concrete with panel seams and stains. */
export function concreteTexture(rng, base = '#8d8578') {
  const [c, ctx] = canvas(256, 256);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 256, 256);
  speckle(ctx, 256, 256, rng, ['#7a7264', '#9a9184', '#6e675c', '#a8a091'], 2200, 2.5);
  ctx.strokeStyle = 'rgba(40, 36, 30, 0.35)';
  ctx.lineWidth = 3;
  ctx.strokeRect(1, 1, 254, 254);
  ctx.beginPath();
  ctx.moveTo(128, 0);
  ctx.lineTo(128, 256);
  ctx.moveTo(0, 128);
  ctx.lineTo(256, 128);
  ctx.stroke();
  ctx.fillStyle = 'rgba(50, 45, 38, 0.16)';
  for (let i = 0; i < 7; i++) {
    const x = rng() * 256;
    const y = rng() * 256;
    ctx.beginPath();
    ctx.ellipse(x, y, 12 + rng() * 30, 8 + rng() * 18, rng() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Painted metal container side with ribs and a stencilled mark. */
export function containerTexture(rng, base, mark) {
  const [c, ctx] = canvas(256, 256);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 256, 256);
  for (let x = 0; x < 256; x += 32) {
    const g = ctx.createLinearGradient(x, 0, x + 32, 0);
    g.addColorStop(0, 'rgba(0,0,0,0.28)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.07)');
    g.addColorStop(1, 'rgba(0,0,0,0.28)');
    ctx.fillStyle = g;
    ctx.fillRect(x, 0, 32, 256);
  }
  speckle(ctx, 256, 256, rng, ['rgba(0,0,0,0.25)', 'rgba(255,255,255,0.10)'], 500, 3);
  ctx.fillStyle = 'rgba(240, 235, 220, 0.85)';
  ctx.font = 'bold 44px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(mark, 128, 140);
  ctx.strokeStyle = 'rgba(240, 235, 220, 0.5)';
  ctx.lineWidth = 3;
  ctx.strokeRect(10, 10, 236, 236);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Yellow/black hazard chevrons for site markers and door frames. */
export function hazardTexture() {
  const [c, ctx] = canvas(128, 128);
  ctx.fillStyle = '#d8a419';
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = '#1c1a17';
  for (let i = -128; i < 256; i += 32) {
    ctx.beginPath();
    ctx.moveTo(i, 128);
    ctx.lineTo(i + 64, 0);
    ctx.lineTo(i + 80, 0);
    ctx.lineTo(i + 16, 128);
    ctx.closePath();
    ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Dark metal plate with rivets, for doors and the reactor housing. */
export function plateTexture(rng) {
  const [c, ctx] = canvas(256, 256);
  ctx.fillStyle = '#4a4d4f';
  ctx.fillRect(0, 0, 256, 256);
  speckle(ctx, 256, 256, rng, ['#3a3d3f', '#5a5e60', '#2e3133'], 1400, 2);
  ctx.fillStyle = '#222425';
  for (const [x, y] of [[16, 16], [240, 16], [16, 240], [240, 240], [128, 16], [128, 240], [16, 128], [240, 128]]) {
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Build the whole texture set once, from one seed, and hand it to the map. */
export function makeTextures(seed = 1337) {
  const rng = mulberry32Local(seed);
  return {
    sand: sandTexture(rng),
    concrete: concreteTexture(rng),
    concreteDark: concreteTexture(rng, '#6f6a60'),
    containerTeal: containerTexture(rng, '#2e6f6a', 'KESTREL'),
    containerAmber: containerTexture(rng, '#a86a1f', 'DUSTFALL'),
    containerRust: containerTexture(rng, '#7d4a2c', 'YARD-7'),
    hazard: hazardTexture(),
    plate: plateTexture(rng),
  };
}

// Local copy of the seeded PRNG so this module stays self-contained.
function mulberry32Local(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
