// Fully synthesized sound design: a deep wind bed, an ambient pad with a slow soft
// arpeggio in the low mids, granular glitches for cuts and high ticks for the UI.
const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

const CHORDS = [
  [45, 52, 57, 60, 64, 71],
  [41, 48, 53, 57, 64, 69],
  [48, 55, 59, 64, 67, 74],
  [40, 47, 52, 55, 62, 67],
];
// arpeggio voices per chord, kept around 300-500 Hz
const ARPS = [
  [64, 69, 71, 72, 69, 67],
  [65, 69, 72, 64, 67, 69],
  [67, 71, 72, 74, 71, 67],
  [64, 67, 71, 62, 64, 67],
];
const BELLS = [81, 83, 84, 88, 91, 93, 95, 96];

class SoundEngine {
  constructor() {
    this.ctx = null;
    this.enabled = false;
    this.windLevel = 0;
    this._lastBeep = 0;
  }

  init() {
    if (this.ctx) return;
    const ctx = (this.ctx = new (window.AudioContext || window.webkitAudioContext)());
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this._impulse(4.5, 2.4);
    this.reverbIn = ctx.createGain();
    this.reverbIn.gain.value = 0.9;
    this.reverbIn.connect(this.reverb).connect(this.master);

    this.delay = ctx.createDelay(2);
    this.delay.delayTime.value = 0.42;
    const fb = ctx.createGain();
    fb.gain.value = 0.38;
    const dlp = ctx.createBiquadFilter();
    dlp.type = 'lowpass';
    dlp.frequency.value = 2600;
    this.delay.connect(dlp).connect(fb).connect(this.delay);
    this.delay.connect(this.reverbIn);
    this.delay.connect(this.master);

    this.sfx = ctx.createGain();
    this.sfx.gain.value = 0.8;
    this.sfx.connect(this.master);
    this.music = ctx.createGain();
    this.music.gain.value = 0.55;
    this.music.connect(this.master);
    this.music.connect(this.reverbIn);

    this.noise = this._noiseBuffer(4);
  }

  start() {
    this.init();
    this.ctx.resume();
    this.setEnabled(true);
    this._startWind();
    this._startMusic();
  }

  setEnabled(on) {
    this.enabled = on;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(on ? 0.9 : 0, t, 0.4);
  }

  setWind(v) {
    if (!this.windGain) return;
    this.windLevel += (v - this.windLevel) * 0.05;
    const t = this.ctx.currentTime;
    this.windGain.gain.setTargetAtTime(0.16 + this.windLevel * 0.22, t, 0.2);
    this.windFilter.frequency.setTargetAtTime(260 + this.windLevel * 700, t, 0.3);
  }

  /* ---------------- beds ---------------- */
  // A heavy low roar, most of its weight below 300 Hz, swelling in slow gusts.
  _startWind() {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windFilter.frequency.value = 260;
    this.windFilter.Q.value = 0.7;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoAmt = ctx.createGain();
    lfoAmt.gain.value = 120;
    lfo.connect(lfoAmt).connect(this.windFilter.frequency);
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    const pan = ctx.createStereoPanner();
    const panLfo = ctx.createOscillator();
    panLfo.frequency.value = 0.05;
    const panAmt = ctx.createGain();
    panAmt.gain.value = 0.6;
    panLfo.connect(panAmt).connect(pan.pan);
    src.connect(this.windFilter).connect(this.windGain).connect(pan).connect(this.master);
    src.start();
    lfo.start();
    panLfo.start();

    const sub = ctx.createOscillator();
    sub.frequency.value = midi(33);
    const subG = ctx.createGain();
    subG.gain.value = 0.05;
    sub.connect(subG).connect(this.music);
    sub.start();
  }

  _startMusic() {
    let chord = 0;
    let step = 0;
    let nextChord = this.ctx.currentTime + 0.2;
    let nextNote = this.ctx.currentTime + 1.5;
    let nextBell = this.ctx.currentTime + 6;
    const schedule = () => {
      const now = this.ctx.currentTime;
      while (nextChord < now + 1) {
        this._pad(CHORDS[chord % CHORDS.length], nextChord, 9);
        chord++;
        nextChord += 8;
      }
      // soft plucked arpeggio following the chord, with the odd rest
      while (nextNote < now + 1) {
        const arp = ARPS[(chord + ARPS.length - 1) % ARPS.length];
        if (Math.random() > 0.18) this._pluck(midi(arp[step % arp.length]), nextNote, 0.035 + Math.random() * 0.015);
        step++;
        nextNote += step % 6 === 0 ? 0.9 : 0.42;
      }
      // a distant bell now and then
      while (nextBell < now + 1) {
        this._bell(midi(BELLS[Math.floor(Math.random() * BELLS.length)] - 12), nextBell, 0.025);
        nextBell += 6 + Math.random() * 8;
      }
    };
    schedule();
    this._musicTimer = setInterval(schedule, 250);
  }

  _pad(notes, t, dur) {
    const ctx = this.ctx;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(500, t);
    lp.frequency.linearRampToValueAtTime(1300, t + dur * 0.5);
    lp.frequency.linearRampToValueAtTime(600, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.045, t + 3);
    g.gain.setValueAtTime(0.045, t + dur - 4);
    g.gain.linearRampToValueAtTime(0, t + dur);
    lp.connect(g).connect(this.music);
    for (const n of notes) {
      for (const det of [-8, 8]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = midi(n);
        o.detune.value = det + (Math.random() - 0.5) * 4;
        o.connect(lp);
        o.start(t);
        o.stop(t + dur + 0.1);
      }
    }
  }

  _pluck(freq, t, vol) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = freq;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(2200, t);
    lp.frequency.exponentialRampToValueAtTime(600, t + 0.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    o.connect(lp).connect(g).connect(this.music);
    g.connect(this.delay);
    o.start(t);
    o.stop(t + 1);
  }

  _bell(freq, t, vol) {
    const ctx = this.ctx;
    const car = ctx.createOscillator();
    const mod = ctx.createOscillator();
    const modG = ctx.createGain();
    const g = ctx.createGain();
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 1.4 - 0.7;
    car.frequency.value = freq;
    mod.frequency.value = freq * 3.51;
    modG.gain.setValueAtTime(freq * 1.6, t);
    modG.gain.exponentialRampToValueAtTime(1, t + 1.6);
    mod.connect(modG).connect(car.frequency);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 3.2);
    car.connect(g).connect(pan);
    pan.connect(this.music);
    pan.connect(this.delay);
    car.start(t);
    mod.start(t);
    car.stop(t + 3.3);
    mod.stop(t + 3.3);
  }

  /* ---------------- one-shots ---------------- */
  _ok() {
    return this.ctx && this.enabled;
  }

  _tone({ type = 'sine', f0, f1 = f0, dur, vol, at = 0, dest = this.sfx, send = 0 }) {
    const ctx = this.ctx;
    const t = ctx.currentTime + at;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    if (send) {
      const s = ctx.createGain();
      s.gain.value = send;
      g.connect(s).connect(this.reverbIn);
    }
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  _noiseBurst({ dur, vol, f0, f1, q = 1, at = 0, type = 'bandpass', send = 0.3 }) {
    const ctx = this.ctx;
    const t = ctx.currentTime + at;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + dur * 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.sfx);
    const s = ctx.createGain();
    s.gain.value = send;
    g.connect(s).connect(this.reverbIn);
    src.start(t, Math.random() * 3);
    src.stop(t + dur + 0.05);
  }

  // Data chatter while text decodes: a fast stutter of very high blips.
  beeps(count = 6) {
    if (!this._ok()) return;
    const now = performance.now();
    if (now - this._lastBeep < 120) return;
    this._lastBeep = now;
    for (let i = 0; i < count * 3; i++) {
      const f = 6000 + Math.floor(Math.random() * 6) * 900;
      this._tone({ f0: f, dur: 0.018, vol: 0.012, at: i * 0.026 });
    }
  }

  click() {
    if (!this._ok()) return;
    this._tone({ type: 'triangle', f0: 1100, f1: 320, dur: 0.07, vol: 0.1 });
    this._tone({ f0: 5200, dur: 0.02, vol: 0.03, at: 0.01 });
  }

  // UI hover: a tiny glassy tick, the same partials stacked high up.
  hover() {
    if (!this._ok()) return;
    [2700, 5000, 7000, 10000].forEach((f, i) => this._tone({ f0: f, dur: 0.035, vol: 0.016 / (1 + i * 0.4) }));
  }

  // Lighter tick for words lighting up under the cursor; rate-limited.
  tick() {
    if (!this._ok()) return;
    const now = performance.now();
    if (now - (this._lastTick || 0) < 60) return;
    this._lastTick = now;
    this._tone({ f0: 7000 + Math.random() * 3000, dur: 0.012, vol: 0.008 });
  }

  // Crystalline ping for touching ice.
  shard() {
    if (!this._ok()) return;
    const base = midi(BELLS[Math.floor(Math.random() * BELLS.length)]);
    this._tone({ f0: base, dur: 0.9, vol: 0.035, send: 0.8 });
    this._tone({ f0: base * 2.76, dur: 0.4, vol: 0.018, send: 0.8 });
    this._noiseBurst({ dur: 0.1, vol: 0.04, f0: 7000, f1: 9000, q: 4, type: 'highpass', send: 0.5 });
  }

  whoosh() {
    if (!this._ok()) return;
    this._noiseBurst({ dur: 1.4, vol: 0.14, f0: 200, f1: 1800, q: 1.2 });
  }

  // Granular digital crackle: short noise grains scattered across the spectrum.
  _grains(count, span, at = 0) {
    for (let i = 0; i < count; i++) {
      const f = 800 * Math.pow(15, Math.random());
      this._noiseBurst({ dur: 0.015 + Math.random() * 0.03, vol: 0.05 + Math.random() * 0.06, f0: f, f1: f * 1.2, q: 3, at: at + Math.random() * span, send: 0.15 });
    }
  }

  // Opening a project: the ice crackles apart, a low-mid tone swells as the dark comes in.
  enter() {
    if (!this._ok()) return;
    this._grains(34, 0.9, 0.25);
    this._noiseBurst({ dur: 0.9, vol: 0.12, f0: 600, f1: 9000, q: 0.8, at: 0.3 });
    this._swell(midi(71), 0.5, 1.6, 0.06);
    this._swell(midi(59), 0.55, 1.8, 0.05);
  }

  leave() {
    if (!this._ok()) return;
    this._grains(26, 0.7);
    this._noiseBurst({ dur: 0.8, vol: 0.11, f0: 8000, f1: 500, q: 0.8 });
    this._swell(midi(71), 0.1, 1.2, 0.05);
  }

  _swell(f, at, dur, vol) {
    const ctx = this.ctx;
    const t = ctx.currentTime + at;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = f;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + dur * 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.sfx);
    const s = ctx.createGain();
    s.gain.value = 0.7;
    g.connect(s).connect(this.reverbIn);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  // A portal membrane lighting up: two soft tones swelling together.
  glow() {
    if (!this._ok()) return;
    this._swell(midi(59), 0, 2.4, 0.045);
    this._swell(midi(66), 0.12, 2.4, 0.03);
  }

  // Passing through a portal ring: a deep, soft swell of air.
  pass() {
    if (!this._ok()) return;
    this._tone({ f0: 55, f1: 110, dur: 1.4, vol: 0.18, send: 0.4 });
    this._noiseBurst({ dur: 1.3, vol: 0.2, f0: 90, f1: 260, q: 0.8, type: 'lowpass', send: 0.3 });
  }

  // Back across the loop: a stuttering data tone while the bricks rain down and thud home.
  rebuild() {
    if (!this._ok()) return;
    for (let i = 0; i < 48; i++) this._tone({ f0: i % 2 ? 11000 : 10400, dur: 0.014, vol: 0.01, at: 0.2 + i * 0.026 });
    for (let i = 0; i < 9; i++) {
      this._noiseBurst({ dur: 0.12, vol: 0.12, f0: 260, f1: 120, q: 0.7, type: 'lowpass', at: 0.35 + i * 0.11 + Math.random() * 0.06, send: 0.2 });
    }
  }

  /* ---------------- buffers ---------------- */
  _noiseBuffer(sec) {
    const ctx = this.ctx;
    const buf = ctx.createBuffer(2, ctx.sampleRate * sec, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      let b = 0;
      for (let i = 0; i < d.length; i++) {
        b = 0.97 * b + 0.03 * (Math.random() * 2 - 1);
        d[i] = (Math.random() * 2 - 1) * 0.5 + b * 4;
      }
    }
    return buf;
  }

  _impulse(sec, decay) {
    const ctx = this.ctx;
    const len = ctx.sampleRate * sec;
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }
}

export const sound = new SoundEngine();
