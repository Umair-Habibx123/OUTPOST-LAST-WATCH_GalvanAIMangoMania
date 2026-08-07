// src/audio.js

/* Procedural WebAudio SFX — no audio files needed.
   Kept dry and percussive to fit the grounded tone. */
window.OLW = window.OLW || {};

OLW.Audio = (function () {
  let ctx = null;
  let master = null;
  let muted = false;

  function ensure() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
  }

  function resume() {
    ensure();
    if (ctx && ctx.state === 'suspended') ctx.resume();
  }

  function tone(freq, dur, type, vol, decay) {
    if (muted || !ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t);
    if (decay) osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq * decay), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(master);
    osc.start(t); osc.stop(t + dur + 0.02);
  }

  function noise(dur, vol, freq) {
    if (muted || !ctx) return;
    const t = ctx.currentTime;
    const n = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq || 900;
    const g = ctx.createGain();
    g.gain.value = vol;
    src.connect(bp); bp.connect(g); g.connect(master);
    src.start(t); src.stop(t + dur);
  }

  return {
    resume,
    setMuted(m) { muted = m; },
    isMuted() { return muted; },
    toggle() { muted = !muted; return muted; },

    strike() { noise(0.09, 0.25, 1400); tone(320, 0.08, 'square', 0.12, 0.7); },
    hit()    { noise(0.12, 0.30, 700); tone(140, 0.14, 'triangle', 0.18, 0.5); },
    land()   { tone(90, 0.28, 'sawtooth', 0.28, 0.4); noise(0.2, 0.18, 240); },
    mango()  { tone(520, 0.10, 'sine', 0.22, 1.6); tone(780, 0.14, 'sine', 0.18, 1.5); },
    waveStart() { tone(300, 0.18, 'sine', 0.16, 1.3); tone(450, 0.2, 'sine', 0.12, 1.3); },
    perfect() { [523, 659, 784].forEach((f, i) => setTimeout(() => tone(f, 0.18, 'sine', 0.16), i * 90)); },
    combo(level) { tone(380 + level * 90, 0.09, 'triangle', 0.12, 1.35); },
    volley() { noise(0.42, 0.32, 480); [180, 260, 390].forEach((f, i) => setTimeout(() => tone(f, 0.3, 'sawtooth', 0.2, 1.8), i * 55)); },
    over()   { [300, 240, 180, 120].forEach((f, i) => setTimeout(() => tone(f, 0.3, 'sawtooth', 0.2, 0.6), i * 140)); },
  };
})();
