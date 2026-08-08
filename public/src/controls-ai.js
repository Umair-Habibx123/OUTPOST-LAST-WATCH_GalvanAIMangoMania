// src/controls-ai.js
/* Optional AI / hands-free control modes for Player 1. The device mouse+keyboard
   stay active at ALL times as the fallback (these modes only ADD input), so a
   denied camera, a failed CDN load, or bad lighting never softlocks the game.

   Modes (Settings → Control mode):
     device  — mouse aims, click/Space fires (default, always available)
     assist  — AI aims at the nearest breach; you fire (click/Space)
     gesture — webcam hand: move to aim, pinch to fire        (MediaPipe Hands)
     face    — webcam face: head aims, blink to fire          (MediaPipe FaceMesh)
     voice   — mic: say "fire/left/right/up/down/volley"      (Web Speech API)

   Efficiency: webcam inference is throttled (~20fps), the camera/mic are only
   opened for the active mode and fully released when you switch away. */
window.OLW = window.OLW || {};

OLW.AIControls = (function () {
  const VISION_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
  const HAND_MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
  const FACE_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

  let mode = 'device';
  let stream = null, video = null, loopId = null, recog = null;
  let hand = null, faceLm = null, vision = null;
  let lastInfer = 0;
  let fireLatch = false;       // rising-edge fire trigger for pinch/blink
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
      status('Hand control · move to aim, pinch to fire');
      const loop = () => {
        loopId = requestAnimationFrame(loop);
        const now = performance.now();
        if (now - lastInfer < 50 || !video || video.readyState < 2) return;   // ~20fps
        lastInfer = now;
        let res; try { res = hand.detectForVideo(video, now); } catch (e) { return; }
        const lm = res && res.landmarks && res.landmarks[0];
        if (lm) {
          const tip = lm[8], thumb = lm[4];
          aimTo(1 - tip.x, tip.y);                                  // mirror x for natural aim
          const pinch = Math.hypot(tip.x - thumb.x, tip.y - thumb.y) < 0.06;
          edgeFire(pinch);
        }
      };
      loop();
    } catch (e) { fallback('Hand tracking unavailable — using mouse/keyboard.', e); }
  }

  /* ---------------- face + blink ---------------- */
  async function startFace() {
    status('Loading face tracking…');
    try {
      await getCamera();
      const v = await loadVision();
      faceLm = await v.mod.FaceLandmarker.createFromOptions(v.fileset, {
        baseOptions: { modelAssetPath: FACE_MODEL, delegate: 'GPU' },
        numFaces: 1, runningMode: 'VIDEO', outputFaceBlendshapes: true,
      });
      status('Face control · head aims, blink to fire');
      const loop = () => {
        loopId = requestAnimationFrame(loop);
        const now = performance.now();
        if (now - lastInfer < 50 || !video || video.readyState < 2) return;
        lastInfer = now;
        let res; try { res = faceLm.detectForVideo(video, now); } catch (e) { return; }
        const f = res && res.faceLandmarks && res.faceLandmarks[0];
        if (f) {
          const nose = f[1];
          // amplify head movement around centre so small tilts reach the edges
          aimTo(OLW.U.clamp(0.5 + (0.5 - nose.x) * 2.2, 0, 1), OLW.U.clamp(0.5 + (nose.y - 0.5) * 2.2, 0, 1));
        }
        const bs = res && res.faceBlendshapes && res.faceBlendshapes[0];
        if (bs) {
          const get = (n) => { const c = bs.categories.find(x => x.categoryName === n); return c ? c.score : 0; };
          edgeFire(get('eyeBlinkLeft') > 0.5 && get('eyeBlinkRight') > 0.5);
        }
      };
      loop();
    } catch (e) { fallback('Face tracking unavailable — using mouse/keyboard.', e); }
  }

  /* ---------------- voice ---------------- */
  function startVoice() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { fallback('Voice control not supported in this browser.'); return; }
    try {
      recog = new SR();
      recog.continuous = true; recog.interimResults = true; recog.lang = 'en-US';
      recog.onresult = (ev) => {
        const g = G(); if (!g) return;
        const txt = ev.results[ev.results.length - 1][0].transcript.toLowerCase();
        const nudge = 0.12;
        if (/\b(fire|shoot|shot|hit)\b/.test(txt)) fire();
        if (/\bleft\b/.test(txt)) g.setAim(g.aim.x - nudge * W(), g.aim.y);
        if (/\bright\b/.test(txt)) g.setAim(g.aim.x + nudge * W(), g.aim.y);
        if (/\bup\b/.test(txt)) g.setAim(g.aim.x, g.aim.y - nudge * H());
        if (/\bdown\b/.test(txt)) g.setAim(g.aim.x, g.aim.y + nudge * H());
        if (/\bvolley\b/.test(txt) && g.useVolley) g.useVolley();
      };
      recog.onend = () => { if (mode === 'voice' && recog) { try { recog.start(); } catch (e) {} } };
      recog.onerror = (e) => { if (e && (e.error === 'not-allowed' || e.error === 'service-not-allowed')) fallback('Microphone blocked — using mouse/keyboard.'); };
      recog.start();
      status('Voice control · say "fire", "left/right/up/down", "volley"');
    } catch (e) { fallback('Voice control unavailable — using mouse/keyboard.', e); }
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
    if (mode === 'face') return startFace();
    if (mode === 'voice') return startVoice();
  }

  function init() {
    installAssist();
    const applyFromSettings = () => { const m = (OLW.Settings && OLW.Settings.get('controlMode')) || 'device'; if (m !== mode) setMode(m); };
    // apply once settings/profile are ready, and whenever they change
    window.addEventListener('olw:profilesync', applyFromSettings);
    window.addEventListener('olw:controlmode', (e) => setMode(e.detail));
    applyFromSettings();
    // release the camera if the tab is hidden (efficiency)
    document.addEventListener('visibilitychange', () => { if (document.hidden && (mode === 'gesture' || mode === 'face')) stopAll(); else if (!document.hidden) applyFromSettings(); });
  }

  init();
  return { setMode, get mode() { return mode; }, stopAll };
})();
