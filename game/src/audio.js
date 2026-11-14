// audio.js — every sound is synthesized with WebAudio: no audio files,
// no network, no licences to worry about. A shared noise buffer feeds the
// gunshots, and short oscillator envelopes cover the UI and game cues.

export class AudioSys {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noiseBuf = null;
  }

  /** Create the context on the first user gesture; browsers block it earlier. */
  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.4;
    this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  /** One burst of filtered noise, the building block of every gunshot. */
  noise(dur, freq, q, gain, when = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + when;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  /** One oscillator note with a quick decay envelope. */
  tone(freq, dur, type, gain, slideTo = 0, when = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /** Gunshot by weapon class: rifle crack, SMG chatter, sniper boom, pistol pop. */
  shot(weaponId) {
    if (weaponId === 'longbow') {
      this.noise(0.28, 700, 0.8, 0.9);
      this.tone(95, 0.2, 'sine', 0.5, 45);
    } else if (weaponId === 'hornet') {
      this.noise(0.09, 1700, 1.2, 0.55);
      this.tone(170, 0.06, 'square', 0.12, 90);
    } else if (weaponId === 'p9') {
      this.noise(0.11, 1300, 1, 0.5);
    } else {
      this.noise(0.14, 950, 1, 0.75);
      this.tone(130, 0.08, 'square', 0.16, 70);
    }
  }

  dryFire() {
    this.tone(1400, 0.03, 'square', 0.08);
  }

  reload() {
    this.tone(500, 0.05, 'square', 0.12);
    this.tone(700, 0.05, 'square', 0.12, 0, 0.18);
  }

  hit() {
    this.tone(1100, 0.06, 'sine', 0.22);
  }

  kill() {
    this.tone(880, 0.08, 'sine', 0.25);
    this.tone(1320, 0.12, 'sine', 0.25, 0, 0.08);
  }

  hurt() {
    this.tone(180, 0.15, 'sawtooth', 0.2, 90);
  }

  plantBeep(final = false) {
    this.tone(final ? 1500 : 950, 0.09, 'sine', 0.25);
  }

  explosion() {
    this.noise(1.4, 120, 0.6, 1.0);
    this.tone(60, 1.1, 'sine', 0.6, 28);
  }

  roundWin() {
    [523, 659, 784].forEach((f, i) => this.tone(f, 0.22, 'triangle', 0.25, 0, i * 0.12));
  }

  roundLose() {
    [392, 330, 262].forEach((f, i) => this.tone(f, 0.25, 'triangle', 0.22, 0, i * 0.14));
  }

  buy() {
    this.tone(980, 0.07, 'sine', 0.2);
    this.tone(1240, 0.1, 'sine', 0.2, 0, 0.07);
  }

  denied() {
    this.tone(220, 0.12, 'square', 0.15, 160);
  }
}
