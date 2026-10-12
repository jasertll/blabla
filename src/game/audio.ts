// Synthesised soundscape: everything except user tapes is generated with WebAudio,
// so the prototype has full sound with zero audio assets.

type Surface = "tile" | "asphalt" | "grate";

class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private music!: GainNode;
  private reverb!: ConvolverNode;
  private noiseBuf!: AudioBuffer;
  private staticGain!: GainNode;
  private droneGain!: GainNode;
  private nightmareGain!: GainNode;
  private heartbeatTimer: number | null = null;
  private screechTimer: number | null = null;
  private tapeEl: HTMLAudioElement | null = null;
  private tapeSrc: MediaElementAudioSourceNode | null = null;
  private genTape: { stop: () => void } | null = null;
  private tapeHiss: GainNode | null = null;
  private staticLevel = 0;

  start() {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(ctx.destination);

    // Long, dark hall reverb shared by sfx.
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(3.2, 2.6);
    const wet = ctx.createGain();
    wet.gain.value = 0.35;
    this.reverb.connect(wet).connect(this.master);

    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);
    this.sfx.connect(this.reverb);
    this.music = ctx.createGain();
    this.music.gain.value = 0.8;
    this.music.connect(this.master);

    this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    this.startDrone();
    this.startStatic();
    this.startNightmareBed();
  }

  setMuted(m: boolean) {
    if (!this.ctx) return;
    this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.1);
  }

  private impulse(seconds: number, decay: number) {
    const ctx = this.ctx!;
    const len = ctx.sampleRate * seconds;
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const ch = buf.getChannelData(c);
      for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  private noise(loop = true) {
    const s = this.ctx!.createBufferSource();
    s.buffer = this.noiseBuf;
    s.loop = loop;
    return s;
  }

  private startDrone() {
    const ctx = this.ctx!;
    this.droneGain = ctx.createGain();
    this.droneGain.gain.value = 0.0;
    this.droneGain.gain.setTargetAtTime(1, ctx.currentTime, 3);
    this.droneGain.connect(this.master);

    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 160;
    lp.connect(this.droneGain);
    [41.2, 41.7, 61.8].forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = i === 2 ? "triangle" : "sawtooth";
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = i === 2 ? 0.025 : 0.045;
      o.connect(g).connect(lp);
      o.start();
    });
    // slowly breathing wind
    const wind = this.noise();
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 380;
    bp.Q.value = 0.8;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 220;
    lfo.connect(lfoGain).connect(bp.frequency);
    lfo.start();
    const wg = ctx.createGain();
    wg.gain.value = 0.05;
    wind.connect(bp).connect(wg).connect(this.droneGain);
    wind.start();
  }

  private startStatic() {
    const ctx = this.ctx!;
    const n = this.noise();
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 2400;
    bp.Q.value = 0.6;
    this.staticGain = ctx.createGain();
    this.staticGain.gain.value = 0;
    n.connect(bp).connect(this.staticGain).connect(this.master);
    n.start();
  }

  /** 0..1 — the pocket radio. Crackles irregularly, like the real thing. */
  setStatic(level: number) {
    if (!this.ctx) return;
    this.staticLevel = level;
    const crackle = level > 0.02 ? (Math.random() < 0.3 ? 1.6 : 0.6 + Math.random() * 0.6) : 0;
    this.staticGain.gain.setTargetAtTime(level * 0.22 * crackle, this.ctx.currentTime, 0.03);
  }

  getStatic() {
    return this.staticLevel;
  }

  private startNightmareBed() {
    const ctx = this.ctx!;
    this.nightmareGain = ctx.createGain();
    this.nightmareGain.gain.value = 0;
    this.nightmareGain.connect(this.master);
    this.nightmareGain.connect(this.reverb);
    // industrial grind: noise through a resonant, wandering filter
    const n = this.noise();
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.Q.value = 8;
    f.frequency.value = 120;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.13;
    const lg = ctx.createGain();
    lg.gain.value = 90;
    lfo.connect(lg).connect(f.frequency);
    lfo.start();
    const g = ctx.createGain();
    g.gain.value = 0.7;
    n.connect(f).connect(g).connect(this.nightmareGain);
    n.start();
    // sub rumble
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.value = 31;
    const og = ctx.createGain();
    og.gain.value = 0.25;
    o.connect(og).connect(this.nightmareGain);
    o.start();
  }

  /** Otherworld / nightmare intensity 0..1. */
  setDread(level: number) {
    if (!this.ctx) return;
    this.nightmareGain.gain.setTargetAtTime(level * 0.5, this.ctx.currentTime, 1.2);
    this.droneGain.gain.setTargetAtTime(1 - level * 0.4, this.ctx.currentTime, 1.2);
    if (level > 0.5) {
      if (this.heartbeatTimer == null) this.startHeartbeat();
      if (this.screechTimer == null) this.startScreeches();
    } else {
      if (this.heartbeatTimer != null) window.clearInterval(this.heartbeatTimer);
      if (this.screechTimer != null) window.clearTimeout(this.screechTimer);
      this.heartbeatTimer = null;
      this.screechTimer = null;
    }
  }

  private thump(at: number, vol: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(70, at);
    o.frequency.exponentialRampToValueAtTime(38, at + 0.15);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(vol, at + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, at + 0.22);
    o.connect(g).connect(this.master);
    o.start(at);
    o.stop(at + 0.25);
  }

  private startHeartbeat() {
    const beat = () => {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      this.thump(t, 0.55);
      this.thump(t + 0.24, 0.35);
    };
    beat();
    this.heartbeatTimer = window.setInterval(beat, 860);
  }

  private startScreeches() {
    const next = () => {
      this.metalScrape();
      this.screechTimer = window.setTimeout(next, 6000 + Math.random() * 9000);
    };
    this.screechTimer = window.setTimeout(next, 3000);
  }

  metalScrape() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const n = this.noise(false);
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.Q.value = 30;
    f.frequency.setValueAtTime(900 + Math.random() * 1200, t);
    f.frequency.linearRampToValueAtTime(400 + Math.random() * 600, t + 1.8);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.9, t + 0.2);
    g.gain.linearRampToValueAtTime(0, t + 1.9);
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 2 - 1;
    n.connect(f).connect(g).connect(pan).connect(this.sfx);
    n.start(t);
    n.stop(t + 2);
  }

  footstep(surface: Surface, run: boolean) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const n = this.noise(false);
    const f = ctx.createBiquadFilter();
    const g = ctx.createGain();
    const vol = (run ? 0.5 : 0.32) * (0.8 + Math.random() * 0.4);
    if (surface === "grate") {
      f.type = "bandpass";
      f.frequency.value = 1400 + Math.random() * 400;
      f.Q.value = 12;
      g.gain.setValueAtTime(vol * 1.4, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    } else {
      f.type = "lowpass";
      f.frequency.value = surface === "tile" ? 1600 : 700;
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + (surface === "tile" ? 0.09 : 0.12));
    }
    n.connect(f).connect(g).connect(this.sfx);
    n.start(t, Math.random());
    n.stop(t + 0.3);
  }

  /** The air-raid siren that heralds the Otherworld. */
  siren(seconds = 9) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(0.32, t + 2.5);
    out.gain.setValueAtTime(0.32, t + seconds - 2.5);
    out.gain.linearRampToValueAtTime(0, t + seconds);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 2200;
    out.connect(lp).connect(this.sfx);
    [1, 1.5].forEach((ratio) => {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.setValueAtTime(110 * ratio, t);
      o.frequency.exponentialRampToValueAtTime(420 * ratio, t + 3.5);
      o.frequency.setValueAtTime(420 * ratio, t + seconds - 3);
      o.frequency.exponentialRampToValueAtTime(90 * ratio, t + seconds);
      const vib = ctx.createOscillator();
      vib.frequency.value = 5.5;
      const vg = ctx.createGain();
      vg.gain.value = 6 * ratio;
      vib.connect(vg).connect(o.frequency);
      vib.start(t);
      vib.stop(t + seconds);
      o.connect(out);
      o.start(t);
      o.stop(t + seconds);
    });
  }

  /** Low boom + rising noise for the world tearing. */
  stinger() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const n = this.noise(false);
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.setValueAtTime(200, t);
    f.frequency.exponentialRampToValueAtTime(6000, t + 1.4);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.6, t + 1.3);
    g.gain.linearRampToValueAtTime(0, t + 1.6);
    n.connect(f).connect(g).connect(this.sfx);
    n.start(t);
    n.stop(t + 1.7);
    this.thump(t + 1.35, 1);
    this.thump(t + 1.4, 0.8);
  }

  locked() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    for (let i = 0; i < 4; i++) {
      const t = ctx.currentTime + i * 0.11;
      const n = this.noise(false);
      const f = ctx.createBiquadFilter();
      f.type = "bandpass";
      f.frequency.value = 900 + i * 60;
      f.Q.value = 6;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.7, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
      n.connect(f).connect(g).connect(this.sfx);
      n.start(t, Math.random());
      n.stop(t + 0.1);
    }
  }

  creak() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(140, t);
    o.frequency.linearRampToValueAtTime(95, t + 1.1);
    const wob = ctx.createOscillator();
    wob.frequency.value = 23;
    const wg = ctx.createGain();
    wg.gain.value = 18;
    wob.connect(wg).connect(o.frequency);
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = 700;
    f.Q.value = 4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.18, t + 0.15);
    g.gain.linearRampToValueAtTime(0, t + 1.15);
    o.connect(f).connect(g).connect(this.sfx);
    wob.start(t);
    o.start(t);
    o.stop(t + 1.2);
    wob.stop(t + 1.2);
  }

  elevator(seconds: number) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    this.locked();
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.value = 58;
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 240;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.25, t + 0.6);
    g.gain.setValueAtTime(0.25, t + seconds - 0.6);
    g.gain.linearRampToValueAtTime(0, t + seconds);
    o.connect(f).connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + seconds);
    // ding
    const d = ctx.createOscillator();
    d.type = "sine";
    d.frequency.value = 1320;
    const dg = ctx.createGain();
    dg.gain.setValueAtTime(0, t + seconds);
    dg.gain.linearRampToValueAtTime(0.18, t + seconds + 0.01);
    dg.gain.exponentialRampToValueAtTime(0.001, t + seconds + 1.6);
    d.connect(dg).connect(this.sfx);
    d.start(t + seconds);
    d.stop(t + seconds + 1.7);
  }

  private ringTimer: number | null = null;

  /** An old bell telephone, ringing somewhere down the corridor. */
  phoneRing(on: boolean, pan = 0) {
    if (this.ringTimer) {
      window.clearTimeout(this.ringTimer);
      this.ringTimer = null;
    }
    if (!on || !this.ctx) return;
    const ring = () => {
      const ctx = this.ctx!;
      const t = ctx.currentTime;
      const out = ctx.createGain();
      out.gain.value = 0.16;
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      out.connect(p).connect(this.sfx);
      for (const burst of [0, 0.45]) {
        [1180, 1420].forEach((f) => {
          const o = ctx.createOscillator();
          o.type = "square";
          o.frequency.value = f;
          const am = ctx.createGain();
          am.gain.value = 0;
          // the hammer striking the bells, 20 times a second
          for (let k = 0; k < 8; k++) {
            am.gain.setValueAtTime(0.5, t + burst + k * 0.05);
            am.gain.exponentialRampToValueAtTime(0.02, t + burst + k * 0.05 + 0.045);
          }
          const bp = ctx.createBiquadFilter();
          bp.type = "bandpass";
          bp.frequency.value = f;
          bp.Q.value = 8;
          o.connect(bp).connect(am).connect(out);
          o.start(t + burst);
          o.stop(t + burst + 0.42);
        });
      }
      this.ringTimer = window.setTimeout(ring, 3000);
    };
    ring();
  }

  /** A voice that isn't quite there: syllables of filtered noise and a buzzing
   *  glottal tone, chopped and smeared through the radio. */
  voice(seconds: number, pitch = 190) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.value = 0;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 350;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 2800;
    out.connect(hp).connect(lp).connect(this.sfx);
    const src = ctx.createOscillator();
    src.type = "sawtooth";
    src.frequency.value = pitch;
    const n = this.noise();
    const ng = ctx.createGain();
    ng.gain.value = 0.25;
    const formants = [700, 1200, 2500].map((f) => {
      const b = ctx.createBiquadFilter();
      b.type = "bandpass";
      b.frequency.value = f;
      b.Q.value = 9;
      src.connect(b);
      n.connect(ng).connect(b);
      b.connect(out);
      return b;
    });
    let at = t;
    while (at < t + seconds) {
      const syl = 0.09 + Math.random() * 0.16;
      out.gain.setValueAtTime(0, at);
      out.gain.linearRampToValueAtTime(0.32, at + 0.03);
      out.gain.linearRampToValueAtTime(0.0, at + syl);
      src.frequency.setValueAtTime(pitch * (0.85 + Math.random() * 0.35), at);
      formants[0].frequency.setValueAtTime(400 + Math.random() * 500, at);
      formants[1].frequency.setValueAtTime(900 + Math.random() * 1200, at);
      at += syl + (Math.random() < 0.2 ? 0.25 : 0.03);
    }
    src.start(t);
    n.start(t);
    src.stop(t + seconds + 0.3);
    n.stop(t + seconds + 0.3);
    // the radio fights it
    this.staticGain.gain.setTargetAtTime(0.12, t, 0.05);
    this.staticGain.gain.setTargetAtTime(this.staticLevel * 0.22, t + seconds, 0.2);
  }

  /** Phone handset lifted / put down. */
  click() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const n = this.noise(false);
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 900;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.6, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    n.connect(f).connect(g).connect(this.sfx);
    n.start(t);
    n.stop(t + 0.15);
  }

  /** A heavy pipe cutting the air. */
  whoosh() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const n = this.noise(false);
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.Q.value = 1.2;
    f.frequency.setValueAtTime(300, t);
    f.frequency.exponentialRampToValueAtTime(1800, t + 0.18);
    f.frequency.exponentialRampToValueAtTime(400, t + 0.32);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.5, t + 0.12);
    g.gain.linearRampToValueAtTime(0, t + 0.34);
    n.connect(f).connect(g).connect(this.sfx);
    n.start(t, Math.random());
    n.stop(t + 0.36);
  }

  /** Metal on flesh, or flesh on you. */
  impact() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    this.thump(t, 1.2);
    const n = this.noise(false);
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 900;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.7, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    n.connect(f).connect(g).connect(this.sfx);
    n.start(t, Math.random());
    n.stop(t + 0.25);
  }

  blip() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const n = this.noise(false);
    const f = ctx.createBiquadFilter();
    f.type = "highpass";
    f.frequency.value = 1800;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.25, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    n.connect(f).connect(g).connect(this.master);
    n.start(t, Math.random());
    n.stop(t + 0.2);
  }

  // ------------------------------------------------------------ tapes

  playTape(src: string | undefined, onEnded: () => void) {
    this.start();
    this.stopTape();
    const ctx = this.ctx!;
    // tape hiss under everything
    const hiss = this.noise();
    const hf = ctx.createBiquadFilter();
    hf.type = "highpass";
    hf.frequency.value = 5000;
    this.tapeHiss = ctx.createGain();
    this.tapeHiss.gain.value = 0.012;
    hiss.connect(hf).connect(this.tapeHiss).connect(this.music);
    hiss.start();
    const stopHiss = () => {
      try {
        hiss.stop();
      } catch {
        /* already stopped */
      }
    };

    if (src) {
      const el = new Audio(src);
      el.loop = true;
      this.tapeEl = el;
      this.tapeSrc = ctx.createMediaElementSource(el);
      this.tapeSrc.connect(this.music);
      el.onended = () => {
        stopHiss();
        onEnded();
      };
      void el.play();
      this.genTape = { stop: stopHiss };
      return;
    }
    this.genTape = this.generatedTape(stopHiss);
  }

  /** A slow, detuned pad progression standing in until real tapes are added. */
  private generatedTape(onStop: () => void) {
    const ctx = this.ctx!;
    const out = ctx.createGain();
    out.gain.value = 0;
    out.gain.setTargetAtTime(0.16, ctx.currentTime, 1.5);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 1400;
    out.connect(lp).connect(this.music);
    lp.connect(this.reverb);
    const chords = [
      [220, 261.6, 329.6],
      [196, 246.9, 293.7],
      [174.6, 220, 261.6],
      [164.8, 207.7, 246.9],
    ];
    const oscs: OscillatorNode[] = [];
    let step = 0;
    const play = () => {
      const t = ctx.currentTime;
      chords[step % chords.length].forEach((f) => {
        [-4, 4].forEach((det) => {
          const o = ctx.createOscillator();
          o.type = "triangle";
          o.frequency.value = f;
          o.detune.value = det;
          const g = ctx.createGain();
          g.gain.setValueAtTime(0, t);
          g.gain.linearRampToValueAtTime(0.12, t + 1.5);
          g.gain.linearRampToValueAtTime(0, t + 4.4);
          o.connect(g).connect(out);
          o.start(t);
          o.stop(t + 4.5);
          oscs.push(o);
        });
      });
      step++;
    };
    play();
    const timer = window.setInterval(play, 4000);
    return {
      stop: () => {
        window.clearInterval(timer);
        out.gain.setTargetAtTime(0, ctx.currentTime, 0.2);
        onStop();
      },
    };
  }

  stopTape() {
    this.genTape?.stop();
    this.genTape = null;
    if (this.tapeEl) {
      this.tapeEl.pause();
      this.tapeEl.onended = null;
      this.tapeSrc?.disconnect();
      this.tapeEl = null;
      this.tapeSrc = null;
    }
    this.tapeHiss?.disconnect();
    this.tapeHiss = null;
  }
}

export const audio = new AudioEngine();
export type { Surface };
