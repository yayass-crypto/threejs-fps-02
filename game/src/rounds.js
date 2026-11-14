// rounds.js — the match: buy phase, round timer, the bomb, the economy
// and the score. Vanguard attacks; Jackals defend. First to 5 rounds wins,
// at most 9 rounds. A round ends by elimination, by the bomb, by a defuse,
// or on the clock — and the buy menu between rounds is where the money
// earned in the last one turns into the next one's guns.

import { WEAPONS, ARMOR_PRICE, FRAG_PRICE, FLASH_PRICE } from './weapons.js';

export const ROUND_TIME = 100;
export const BUY_TIME = 18;
export const FUSE_TIME = 35;
export const WIN_ROUNDS = 5;
export const MAX_ROUNDS = 9;

/** Buy catalogue entries: key, label, price and what buying does. */
export const SHOP = [
  { key: '1', label: 'VK-47 Rifle', price: WEAPONS.vk47.price, kind: 'primary', def: WEAPONS.vk47 },
  { key: '2', label: 'Hornet-9 SMG', price: WEAPONS.hornet.price, kind: 'primary', def: WEAPONS.hornet },
  { key: '3', label: 'Longbow-50', price: WEAPONS.longbow.price, kind: 'primary', def: WEAPONS.longbow },
  { key: '4', label: 'Kevlar Vest', price: ARMOR_PRICE, kind: 'armor' },
  { key: '5', label: 'Frag Grenade', price: FRAG_PRICE, kind: 'frag' },
  { key: '6', label: 'Flashbang', price: FLASH_PRICE, kind: 'flash' },
];

export class Rounds {
  constructor(game) {
    this.game = game;
    this.round = 0;
    this.score = { vanguard: 0, jackals: 0 };
    this.phase = 'menu'; // menu | buy | playing | roundEnd | matchEnd
    this.phaseT = 0;
    this.timer = ROUND_TIME;
    this.bomb = { state: 'carry', site: null, t: 0 }; // carry | planted | gone
    this.lastWinner = null;
    this.lastReason = '';
  }

  startMatch() {
    this.round = 0;
    this.score = { vanguard: 0, jackals: 0 };
    this.startBuyPhase();
  }

  startBuyPhase() {
    this.round++;
    this.phase = 'buy';
    this.phaseT = BUY_TIME;
    this.bomb = { state: 'carry', site: null, t: 0 };
    this.game.resetPositions();
  }

  startRound() {
    this.phase = 'playing';
    this.timer = ROUND_TIME;
    this.game.onRoundStart();
  }

  /** Called every fixed step while a round is live. */
  update(dt) {
    const game = this.game;
    if (this.phase === 'buy') {
      this.phaseT -= dt;
      if (this.phaseT <= 0) this.startRound();
      return;
    }
    if (this.phase !== 'playing') return;

    // Bomb fuse.
    if (this.bomb.state === 'planted') {
      this.bomb.t -= dt;
      if (this.bomb.t <= 0) {
        this.endRound('vanguard', 'The reactor charge detonated — site A lost.');
        return;
      }
    } else {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.endRound('jackals', 'Time expired — the defenders held the yard.');
        return;
      }
    }

    // Elimination check.
    const vAlive = game.fighters.some((f) => f.alive && f.team === 'vanguard');
    const jAlive = game.fighters.some((f) => f.alive && f.team === 'jackals');
    if (!vAlive) {
      this.endRound('jackals', 'Vanguard wiped out.');
    } else if (!jAlive) {
      this.endRound('vanguard', 'Jackals wiped out.');
    }
  }

  endRound(winner, reason) {
    const game = this.game;
    this.score[winner]++;
    this.lastWinner = winner;
    this.lastReason = reason;
    this.phase = 'roundEnd';
    this.phaseT = 4.5;
    // Economy: winners take the big bonus, losers the consolation.
    for (const f of game.fighters) {
      if (f !== game.player) continue;
      f.money += winner === 'vanguard' ? 3250 : 1900;
    }
    this.bomb.state = 'gone';
    game.onRoundEnd(winner, reason);
  }

  /** Advance from the round-end banner into the next buy phase or the match end. */
  advance() {
    if (this.score.vanguard >= WIN_ROUNDS || this.score.jackals >= WIN_ROUNDS || this.round >= MAX_ROUNDS) {
      this.phase = 'matchEnd';
      this.game.onMatchEnd();
      return;
    }
    this.startBuyPhase();
  }

  /** The player plants the charge at a site. */
  plant(site) {
    const game = this.game;
    this.bomb = { state: 'planted', site, t: FUSE_TIME };
    game.player.money += 300;
    game.onPlantDone(site);
  }

  /** A defender finished the defuse channel. */
  defuse(bot) {
    this.endRound('jackals', `${bot.name} defused the charge.`);
  }

  /** Try to buy a shop item; returns a message for the HUD. */
  buy(item) {
    const p = this.game.player;
    if (this.phase !== 'buy') return 'The buy menu is closed — the round is live.';
    if (p.money < item.price) return `Need $${item.price} — you have $${p.money}.`;
    if (item.kind === 'primary') {
      p.buyPrimary(item.def);
    } else if (item.kind === 'armor') {
      if (p.armor >= 100) return 'Kevlar already at full.';
      p.armor = 100;
    } else if (item.kind === 'frag') {
      if (p.frags >= 2) return 'Carrying the maximum of 2 frags.';
      p.frags++;
    } else if (item.kind === 'flash') {
      if (p.flashes >= 2) return 'Carrying the maximum of 2 flashes.';
      p.flashes++;
    }
    p.money -= item.price;
    return `${item.label} bought — $${p.money} left.`;
  }
}
