// src/controls-ai.js
/* Hands-free control for Player 1. The device mouse+keyboard stay active at ALL
   times as the fallback (this mode only ADDS input), so a denied camera, a
   failed CDN load, or bad lighting never softlocks the game.

   Player-selectable mode (Settings → Control mode):
     device  — mouse aims, click/Space fires (default, always available)
     gesture — webcam hand: move hand to aim, make a FIST to fire (MediaPipe Hands)

   'assist' (AI aims at the nearest breach) still exists but is a SYSTEM-only aid
   for demos/attract mode — it is not exposed in Settings, because auto-aim would
   be an unfair advantage for a real player. Face + voice modes were removed.

   Efficiency: webcam inference is throttled (~22fps), the camera is only opened
   for the active mode and fully released when you switch away or hide the tab. */
window.OLW = window.OLW || {};

OLW.AIControls = (function () {
  const VISION_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
  const HAND_MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

  let mode = 'device';
  let stream = null, video = null, loopId = null, recog = null;
  let hand = null, vision = null;
  let lastInfer = 0;
  let fireLatch = false;       // rising-edge fire trigger (kept for edgeFire helper)
  let statusEl, previewEl;

  const G = () => window.OLW_GAME;
  const W = () => OLW.CONFIG.WIDTH;
  const H = () => OLW.CONFIG.HEIGHT;

  /* ---------------- status pill + camera preview ---------------- */
  function ensureUI() {
    if (statusEl) return;
    if (!document.getElementById('aic-css')) {
      const s = document.createElement('style'); s.id = 'aic-css';
      s.textContent =
        '.aic-status{position:absolute;left:50%;top:78px;transform:translateX(-50%);z-index:7;background:rgba(12,16,22,.85);border:1px solid #3b3b44;color:#e9dfcb;font-size:11px;font-weight:700;padding:5px 12px;border-radius:14px;pointer-events:none;white-space:nowrap;display:none}' +
        '.aic-status.warn{border-color:#c5543f;color:#f2a295}' +
        '.aic-preview{position:absolute;right:10px;bottom:56px;width:132px;height:99px;z-index:7;border:1px solid #3b3b44;border-radius:8px;object-fit:cover;transform:scaleX(-1);background:#000;display:none;box-shadow:0 6px 18px rgba(0,0,0,.5)}';
      document.head.appendChild(s);
    }
    const stage = document.getElementById('stage') || document.body;
    statusEl = document.createElement('div'); statusEl.className = 'aic-status'; stage.appendChild(statusEl);
    previewEl = document.createElement('video'); previewEl.className = 'aic-preview'; previewEl.muted = true; previewEl.playsInline = true; stage.appendChild(previewEl);
  }
  function status(msg, warn) {
    ensureUI();
    if (!msg) { statusEl.style.display = 'none'; return; }
    statusEl.textContent = msg;
    statusEl.classList.toggle('warn', !!warn);
    statusEl.style.display = 'block';
  }
  function showPreview(on) { ensureUI(); previewEl.style.display = on ? 'block' : 'none'; }

  /* ---------------- teardown ---------------- */
  function stopAll() {
    if (loopId) { cancelAnimationFrame(loopId); loopId = null; }
    if (recog) { try { recog.onend = null; recog.stop(); } catch (e) {} recog = null; }
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
    if (video) { try { video.pause(); } catch (e) {} video.srcObject = null; }
    showPreview(false);
    fireLatch = false;
  }

  /* ---------------- shared helpers ---------------- */
  function aimTo(nx, ny) {                    // normalized 0..1 (already mirror-corrected)
    const g = G(); if (!g) return;
    g.setAim(OLW.U.clamp(nx * W(), 0, W()), OLW.U.clamp(ny * H(), 0, H()));
  }
  function fire() { const g = G(); if (g && g.state === 'playing') g.strike(); }
  function edgeFire(trigger) {                // one shot per rising edge
    if (trigger && !fireLatch) { fireLatch = true; fire(); }
    else if (!trigger) fireLatch = false;
  }

  async function getCamera() {
    stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: 'user' }, audio: false });
    if (!video) { video = document.createElement('video'); video.muted = true; video.playsInline = true; }
    video.srcObject = stream;
    await video.play();
    if (previewEl) { previewEl.srcObject = stream; previewEl.play().catch(() => {}); }
    showPreview(true);
  }

  async function loadVision() {
    if (!vision) {
      const mod = await import(/* @vite-ignore */ VISION_CDN);
      OLW._vision = mod;
      const fileset = await mod.FilesetResolver.forVisionTasks(VISION_CDN + '/wasm');
      vision = { mod, fileset };
    }
    return vision;
  }

  /* ---------------- AI aim-assist (no camera) ---------------- */
  function installAssist() {
    if (OLW.Game.__aicAssist) return;
    OLW.Game.__aicAssist = true;
    const P = OLW.Game.prototype, origUpdate = P.update;
    P.update = function (dt) {
      origUpdate.call(this, dt);
      if (mode === 'assist' && this.state === 'playing') {
        let best = null, bd = Infinity;
        const CX = W() / 2, CY = H() / 2;
        for (const r of this.raiders) { if (!r.alive) continue; const d = OLW.U.dist(r.x, r.y, CX, CY); if (d < bd) { bd = d; best = r; } }
        if (best) this.setAim(best.x, best.y);   // you still pull the trigger (click/Space)
      }
    };
  }

  /* ---------------- gesture (hands) ---------------- */
  async function startGesture() {
    status('Loading hand tracking…');
    try {
      await getCamera();
      const v = await loadVision();
      hand = await v.mod.HandLandmarker.createFromOptions(v.fileset, {
        baseOptions: { modelAssetPath: HAND_MODEL, delegate: 'GPU' },
        numHands: 1, runningMode: 'VIDEO',
      });
      status('Hand control · move hand to aim · make a fist to fire');

      // aim uses the PALM CENTRE (stable whether the hand is open or a fist), is
      // amplified around the centre so small hand moves reach the screen edges,
      // and is exponentially smoothed to kill landmark jitter.
      let sx = 0.5, sy = 0.5, primed = false;
      let fistHold = false;                 // hysteresis so fire doesn't flicker
      const AIM_GAIN = 1.9, SMOOTH = 0.4;
      const dist = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);

      const loop = () => {
        loopId = requestAnimationFrame(loop);
        const now = performance.now();
        if (now - lastInfer < 45 || !video || video.readyState < 2) return;   // ~22fps
        lastInfer = now;
        let res; try { res = hand.detectForVideo(video, now); } catch (e) { return; }
        const lm = res && res.landmarks && res.landmarks[0];
        if (!lm) return;

        // palm centre = centroid of wrist + the four finger MCP knuckles
        const palm = [0, 5, 9, 13, 17];
        let px = 0, py = 0;
        for (const i of palm) { px += lm[i].x; py += lm[i].y; }
        px /= palm.length; py /= palm.length;

        let nx = OLW.U.clamp(0.5 + ((1 - px) - 0.5) * AIM_GAIN, 0, 1);  // mirror x
        let ny = OLW.U.clamp(0.5 + (py - 0.5) * AIM_GAIN, 0, 1);
        if (!primed) { sx = nx; sy = ny; primed = true; }
        else { sx += (nx - sx) * SMOOTH; sy += (ny - sy) * SMOOTH; }
        aimTo(sx, sy);

        // fist = fingers curled: a finger is "extended" when its tip is farther
        // from the wrist than its middle joint. Fist when 0–1 fingers extended.
        const wrist = lm[0];
        const fingers = [[8, 6], [12, 10], [16, 14], [20, 18]];
        let extended = 0;
        for (const [tip, pip] of fingers) {
          if (dist(lm[tip], wrist) > dist(lm[pip], wrist) * 1.05) extended++;
        }
        // hysteresis: clench (≤1) to start firing, open (≥3) to stop
        if (!fistHold && extended <= 1) fistHold = true;
        else if (fistHold && extended >= 3) fistHold = false;
        if (fistHold) fire();               // auto-fire while fist held (cooldown-limited)
      };
      loop();
    } catch (e) { fallback('Hand tracking unavailable — using mouse/keyboard.', e); }
  }

  function fallback(msg, err) {
    if (err) console.warn('[AIControls]', msg, err);
    stopAll();
    mode = 'device';
    if (OLW.Settings) OLW.Settings.set('controlMode', 'device');
    status(msg, true);
    setTimeout(() => { if (mode === 'device') status(''); }, 4000);
  }

  /* ---------------- mode switch ---------------- */
  async function setMode(next) {
    stopAll();
    mode = next || 'device';
    status('');
    if (mode === 'device') return;
    if (mode === 'assist') { status('AI aim-assist · you fire, it aims'); setTimeout(() => { if (mode === 'assist') status(''); }, 3500); return; }
    if (mode === 'gesture') return startGesture();
    // any unknown/removed mode falls back to device
    return fallback('Using mouse/keyboard.');
  }

  function init() {
    installAssist();
    const applyFromSettings = () => { const m = (OLW.Settings && OLW.Settings.get('controlMode')) || 'device'; if (m !== mode) setMode(m); };
    // apply once settings/profile are ready, and whenever they change
    window.addEventListener('olw:profilesync', applyFromSettings);
    window.addEventListener('olw:controlmode', (e) => setMode(e.detail));
    applyFromSettings();
    // release the camera if the tab is hidden (efficiency)
    document.addEventListener('visibilitychange', () => { if (document.hidden && mode === 'gesture') stopAll(); else if (!document.hidden) applyFromSettings(); });
  }

  init();
  return { setMode, get mode() { return mode; }, stopAll };
})();
