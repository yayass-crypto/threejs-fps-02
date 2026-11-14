// hud.js — everything drawn on top of the 3D view: crosshair, health and
// ammo, timer and score, killfeed, the buy menu, the start screen, the
// minimap and the round banners. All DOM nodes are created once and
// reused; the loop only mutates text, widths and opacity.

const $ = (tag, cls, parent) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (parent) parent.appendChild(el);
  return el;
};

export class Hud {
  constructor() {
    this.root = document.getElementById('hud');
    this.build();
  }

  build() {
    // Damage vignette and flashbang whiteout, both full-screen overlays.
    this.dmg = $('div', 'dmg', this.root);
    this.white = $('div', 'white', this.root);

    // Crosshair: four lines that widen with spread, plus a centre dot.
    this.xh = $('div', 'xh', this.root);
    this.xhN = $('div', 'xh-l n', this.xh);
    this.xhS = $('div', 'xh-l s', this.xh);
    this.xhW = $('div', 'xh-l w', this.xh);
    this.xhE = $('div', 'xh-l e', this.xh);
    this.xhDot = $('div', 'xh-dot', this.xh);
    this.hit = $('div', 'hit', this.root);

    // Top bar: score, timer, round.
    this.top = $('div', 'top', this.root);
    this.scoreV = $('div', 'score v', this.top);
    this.timer = $('div', 'timer', this.top);
    this.scoreJ = $('div', 'score j', this.top);
    this.round = $('div', 'round', this.top);

    // Alive pips under the top bar.
    this.pips = $('div', 'pips', this.root);
    this.pipsV = $('div', 'pips-v', this.pips);
    this.pipsJ = $('div', 'pips-j', this.pips);

    // Killfeed, top right.
    this.feed = $('div', 'feed', this.root);

    // Minimap, bottom right.
    this.mapWrap = $('div', 'mapwrap', this.root);
    this.map = $('canvas', 'map', this.mapWrap);
    this.map.width = 176;
    this.map.height = 140;
    this.mapLabel = $('div', 'maplabel', this.mapWrap);
    this.mapLabel.textContent = 'KESTREL YARD — A reactor · B depot';

    // Bottom-left status: health, armour, money.
    this.status = $('div', 'status', this.root);
    this.hpNum = $('div', 'hpnum', this.status);
    this.hpBar = $('div', 'hpbar', this.status);
    this.hpFill = $('div', 'hpfill', this.hpBar);
    this.arNum = $('div', 'arnum', this.status);
    this.money = $('div', 'money', this.status);

    // Bottom-right ammo.
    this.ammo = $('div', 'ammo', this.root);
    this.ammoMag = $('div', 'ammomag', this.ammo);
    this.ammoRes = $('div', 'ammores', this.ammo);
    this.wname = $('div', 'wname', this.ammo);
    this.gren = $('div', 'gren', this.ammo);

    // Plant progress, centre.
    this.plantWrap = $('div', 'plantwrap', this.root);
    this.plantLabel = $('div', 'plantlabel', this.plantWrap);
    this.plantLabel.textContent = 'PLANTING CHARGE';
    this.plantBar = $('div', 'plantbar', this.plantWrap);
    this.plantFill = $('div', 'plantfill', this.plantBar);

    // Toast messages, centre-low.
    this.toast = $('div', 'toast', this.root);

    // Big centre banner for round and match ends.
    this.banner = $('div', 'banner', this.root);
    this.bannerTitle = $('div', 'banner-title', this.banner);
    this.bannerSub = $('div', 'banner-sub', this.banner);

    // Buy menu, centre panel.
    this.buy = $('div', 'buy', this.root);
    this.buyTitle = $('div', 'buy-title', this.buy);
    this.buyTitle.textContent = 'BUY PHASE — press a number key, B to close';
    this.buyGrid = $('div', 'buy-grid', this.buy);
    this.buyMoney = $('div', 'buy-money', this.buy);

    // Start screen.
    this.start = $('div', 'start', this.root);
    this.start.innerHTML = `
      <div class="start-title">KESTREL YARD</div>
      <div class="start-sub">A tactical three.js FPS — Vanguard vs Jackals</div>
      <div class="start-body">
        <p>Five rounds decide the yard. Plant the charge at <b>site A</b> (reactor) or
        <b>site B</b> (depot) — or wipe out the Jackals. First to 5 rounds wins.</p>
        <p><b>WASD</b> move · <b>Mouse</b> aim · <b>Click</b> fire · <b>R</b> reload ·
        <b>1 / 2</b> weapons · <b>Q</b> flashbang · <b>G</b> frag · <b>E</b> hold to plant ·
        <b>B</b> buy · <b>Shift</b> sprint · <b>Ctrl</b> crouch · <b>Right mouse</b> aim down sights</p>
        <p>Accuracy beats speed: stop, aim, and let the crosshair settle. Headshots deal
        up to four times the damage. Your four Vanguard teammates push the sites with you; the four Jackals
        hold them and will defuse a planted charge if you let them.</p>
      </div>
      <button class="start-btn">CLICK TO PLAY</button>
      <div class="start-note">Best in desktop Chrome. Sound starts on your first click.</div>`;
    this.startBtn = this.start.querySelector('.start-btn');

    // Help line, bottom centre.
    this.help = $('div', 'help', this.root);
    this.help.textContent = 'WASD move · Click fire · R reload · B buy · E plant · Q flash · G frag';
  }

  setHealth(hp, armor) {
    this.hpNum.textContent = `${Math.max(0, Math.ceil(hp))}`;
    this.hpFill.style.width = `${Math.max(0, hp)}%`;
    this.hpFill.style.background = hp > 50 ? '#7fd069' : hp > 25 ? '#e0a53a' : '#d0533a';
    this.arNum.textContent = armor > 0 ? `ARMOUR ${Math.ceil(armor)}` : 'NO ARMOUR';
  }

  setMoney(m) {
    this.money.textContent = `$${m}`;
    this.buyMoney.textContent = `Wallet: $${m}`;
  }

  setAmmo(mag, reserve, name, reloading, frags, flashes) {
    this.ammoMag.textContent = reloading ? 'RELOADING' : `${mag}`;
    this.ammoRes.textContent = `/ ${reserve}`;
    this.wname.textContent = name;
    this.gren.textContent = `FRAG ${frags} · FLASH ${flashes}`;
  }

  setTimer(t, phase) {
    const s = Math.max(0, Math.ceil(t));
    this.timer.textContent = phase === 'buy' ? `BUY ${s}` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    this.timer.classList.toggle('buyphase', phase === 'buy');
  }

  setScore(v, j, round) {
    this.scoreV.textContent = `VANGUARD ${v}`;
    this.scoreJ.textContent = `${j} JACKALS`;
    this.round.textContent = `ROUND ${round} / 9`;
  }

  setAlive(v, j) {
    this.pipsV.innerHTML = '●'.repeat(v) + '○'.repeat(Math.max(0, 5 - v));
    this.pipsJ.innerHTML = '●'.repeat(j) + '○'.repeat(Math.max(0, 5 - j));
  }

  setCrosshair(spread, ads) {
    const gap = 5 + spread * 260 + (ads ? -2 : 0);
    this.xhN.style.transform = `translate(-50%, calc(-50% - ${gap}px))`;
    this.xhS.style.transform = `translate(-50%, calc(-50% + ${gap}px))`;
    this.xhW.style.transform = `translate(calc(-50% - ${gap}px), -50%)`;
    this.xhE.style.transform = `translate(calc(-50% + ${gap}px), -50%)`;
    this.xh.style.opacity = ads ? '0.9' : '0.85';
  }

  hitmarker(kill) {
    this.hit.classList.remove('show', 'kill');
    void this.hit.offsetWidth; // restart the CSS animation
    this.hit.classList.add('show');
    if (kill) this.hit.classList.add('kill');
  }

  killfeed(killer, victim, weaponName, headshot) {
    const line = $('div', 'feed-line', this.feed);
    line.innerHTML = `<span class="fk">${killer}</span> <span class="fw">${headshot ? '◉ ' : ''}${weaponName}</span> <span class="fv">${victim}</span>`;
    while (this.feed.children.length > 5) this.feed.removeChild(this.feed.firstChild);
    setTimeout(() => line.classList.add('fade'), 4000);
    setTimeout(() => line.remove(), 5200);
  }

  damageFlash(amount) {
    this.dmg.style.opacity = Math.min(0.85, 0.25 + amount / 120);
    setTimeout(() => { this.dmg.style.opacity = '0'; }, 120);
  }

  flashbang(strength) {
    this.white.style.opacity = String(Math.min(1, strength));
    setTimeout(() => { this.white.style.opacity = '0'; }, 2600);
  }

  showBanner(title, sub, good) {
    this.bannerTitle.textContent = title;
    this.bannerSub.textContent = sub;
    this.banner.className = `banner show ${good ? 'good' : 'bad'}`;
  }

  hideBanner() {
    this.banner.className = 'banner';
  }

  showBuy(shop) {
    this.buyGrid.innerHTML = '';
    for (const item of shop) {
      const row = $('div', 'buy-row', this.buyGrid);
      row.innerHTML = `<span class="buy-key">[${item.key}]</span> <span class="buy-name">${item.label}</span> <span class="buy-price">$${item.price}</span>`;
    }
    this.buy.classList.add('show');
  }

  hideBuy() {
    this.buy.classList.remove('show');
  }

  showToast(msg) {
    this.toast.textContent = msg;
    this.toast.classList.add('show');
    clearTimeout(this.toastT);
    this.toastT = setTimeout(() => this.toast.classList.remove('show'), 2600);
  }

  setPlant(p) {
    if (p === null) {
      this.plantWrap.classList.remove('show');
      return;
    }
    this.plantWrap.classList.add('show');
    this.plantFill.style.width = `${Math.min(100, p * 100)}%`;
  }

  showStart() {
    this.start.classList.add('show');
  }

  hideStart() {
    this.start.classList.remove('show');
  }

  /** Draw the tactical minimap: walls, sites, bomb, friendlies and enemies
   *  the player has spotted recently. */
  drawMinimap(game, seen) {
    const ctx = this.map.getContext('2d');
    const W = this.map.width;
    const H = this.map.height;
    const sx = (x) => ((x + 32) / 64) * W;
    const sz = (z) => ((z + 24) / 48) * H;
    ctx.fillStyle = '#10181d';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#2c3a42';
    for (const c of game.colliders) {
      ctx.fillRect(sx(c.x - c.hw), sz(c.z - c.hd), c.hw * 2 * (W / 64), c.hd * 2 * (H / 48));
    }
    // Sites.
    for (const [name, s] of Object.entries(game.map.sites)) {
      ctx.beginPath();
      ctx.arc(sx(s.x), sz(s.z), 7, 0, Math.PI * 2);
      ctx.fillStyle = game.bomb.state === 'planted' && game.bomb.site.name === name ? '#ff4444' : '#e0a53a';
      ctx.fill();
      ctx.fillStyle = '#0c1114';
      ctx.font = 'bold 8px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(name, sx(s.x), sz(s.z) + 3);
    }
    // Friendlies (blue) and the player (white triangle).
    for (const f of game.fighters) {
      if (!f.alive || f.team !== 'vanguard' || f === game.player) continue;
      ctx.beginPath();
      ctx.arc(sx(f.pos.x), sz(f.pos.z), 3, 0, Math.PI * 2);
      ctx.fillStyle = '#3fa7c9';
      ctx.fill();
    }
    // Spotted enemies, fading with age.
    const now = game.time;
    for (const [id, t] of Object.entries(seen)) {
      const b = game.fighters.find((f) => f.id === id);
      if (!b || !b.alive || now - t > 3) continue;
      ctx.beginPath();
      ctx.arc(sx(b.pos.x), sz(b.pos.z), 3, 0, Math.PI * 2);
      ctx.fillStyle = '#e05a2e';
      ctx.fill();
    }
    const p = game.player;
    ctx.save();
    ctx.translate(sx(p.pos.x), sz(p.pos.z));
    ctx.rotate(-p.yaw);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(0, -5);
    ctx.lineTo(4, 4);
    ctx.lineTo(-4, 4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}
