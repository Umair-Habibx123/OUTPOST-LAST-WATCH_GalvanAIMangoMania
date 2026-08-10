// src/backup-controls.js
/* Backup device controls for when an external (phone) controller has network
   trouble. Player 2's actions already run on the HOST (the phone only streams
   input over WebSocket), so the host can keep P2 alive with NO connectivity:

     • 'auto'     — P2 auto-defends (AI aims + fires at the nearest breach)
     • 'keyboard' — the host drives P2 with Arrow keys + Enter
     • 'off'      — no backup (P2 simply idles if the phone drops)

   CO-OP NEVER GETS THE AI. A shared watch is meant to be two people; an AI
   quietly taking over the second post plays the game for them. If Player 2
   drops out of a co-op run their post stands empty until they come back.
   'keyboard' still applies there, because that is the host deciding to work
   both posts by hand rather than an aim-assist doing it for them.

   It engages automatically the moment the controller goes offline mid-match and
   hands control back the instant the phone reconnects. Press B to force it on
   (e.g. to take over a laggy phone). Solo play is always fully local anyway. */
window.OLW = window.OLW || {};

OLW.BackupControls = (function () {
  const MP = OLW.Multiplayer;

  let engaged = false;
  let controllerOnline = true;
  let manual = false;                 // host-forced backup (B key)
  const keys = {};
  let p2 = { x: null, y: null };

  function mode() { return (OLW.Settings && OLW.Settings.get && OLW.Settings.get('backup')) || 'auto'; }
  function coopActive(g) { return g && g.state === 'playing' && MP && MP.mode && MP.mode !== 'solo'; }

  /* NO AI STAND-IN IN CO-OP.
     When Player 2 leaves a shared watch their post simply goes empty — an AI
     that keeps aiming and firing for them turns a two-player run into a
     one-and-a-half-player run and quietly plays the game for you. The keyboard
     option is different: that is the HOST choosing to work the second post
     themselves, so it still engages. */
  function aiAllowed() { return !MP || MP.mode !== 'coop'; }

  function shouldBackup(g) {
    if (!coopActive(g) || mode() === 'off') return false;
    if (!controllerOnline || manual) return mode() === 'keyboard' || aiAllowed();
    return false;
  }

  /* ---- drive Player 2 locally ---- */
  function driveAI(g) {
    const U = OLW.U, C = OLW.CONFIG, CX = C.WIDTH / 2, CY = C.HEIGHT / 2;
    let best = null, bd = Infinity;
    for (const r of g.raiders) {
      if (!r.alive) continue;
      const d = U.dist(r.x, r.y, CX, CY);   // triage the nearest breach
      if (d < bd) { bd = d; best = r; }
    }
    if (best) {
      g.setPlayer2Aim(best.x, best.y);
      if (g.player2StrikeCd <= 0) g.strikePlayer2(best.x, best.y);
    }
  }

  function driveKeyboard(g, dt) {
    const C = OLW.CONFIG, U = OLW.U;
    if (p2.x == null) { p2.x = C.WIDTH / 2; p2.y = C.HEIGHT / 2 + 120; }
    const sp = 420 * dt;
    if (keys.ArrowLeft) p2.x -= sp;
    if (keys.ArrowRight) p2.x += sp;
    if (keys.ArrowUp) p2.y -= sp;
    if (keys.ArrowDown) p2.y += sp;
    p2.x = U.clamp(p2.x, 0, C.WIDTH);
    p2.y = U.clamp(p2.y, 0, C.HEIGHT);
    g.setPlayer2Aim(p2.x, p2.y);
    if (keys.Enter && g.player2StrikeCd <= 0) g.strikePlayer2(p2.x, p2.y);
  }

  function tick(g, dt) {
    const active = shouldBackup(g);
    if (active && !engaged) { engaged = true; showNote(); }
    if (!active && engaged) { engaged = false; hideNote(); }

    if (!active) {
      // co-op with nobody on the second post: mark it empty, drive nothing
      if (coopActive(g) && !controllerOnline && !aiAllowed()) showEmptyNote();
      else if (!engaged) hideNote();
      return;
    }

    if (mode() === 'keyboard') driveKeyboard(g, dt);
    else driveAI(g);
  }

  /* ---- wrap the game loop ---- */
  function install() {
    if (!OLW.Game || OLW.Game.__backup) return;
    OLW.Game.__backup = true;
    const P = OLW.Game.prototype;
    const origUpdate = P.update;
    P.update = function (dt) {
      origUpdate.call(this, dt);
      if (this.state === 'playing') tick(this, dt);
    };
  }

  /* ---- controller online/offline signals ---- */
  if (MP && MP.on) {
    MP.on('peerAway', (p) => { if (p && p.role === 'controller') controllerOnline = false; });
    MP.on('playerLeft', (p) => { if (p && p.role === 'controller') controllerOnline = false; });
    MP.on('roomState', (room) => { if (room && room.controller) controllerOnline = !!room.controller.connected; });
    MP.on('player2Aim', () => { controllerOnline = true; });   // real input ⇒ phone is live
    MP.on('player2Strike', () => { controllerOnline = true; });
  }

  /* ---- keys (manual toggle + keyboard driving) ---- */
  window.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    if (e.key === 'b' || e.key === 'B') manual = !manual;
    keys[e.key] = true;
  });
  window.addEventListener('keyup', (e) => { keys[e.key] = false; });

  /* ---- on-screen note ---- */
  let note;
  function ensureNote() {
    if (note) return;
    if (!document.getElementById('backup-css')) {
      const s = document.createElement('style');
      s.id = 'backup-css';
      s.textContent = '.backup-note{position:absolute;left:50%;top:52px;transform:translateX(-50%);z-index:7;background:rgba(20,14,10,.86);border:1px solid #7a5a2a;color:#f5c36b;font-size:11px;font-weight:800;letter-spacing:.4px;padding:5px 12px;border-radius:14px;pointer-events:none;white-space:nowrap}';
      document.head.appendChild(s);
    }
    note = document.createElement('div');
    note.className = 'backup-note';
    (document.getElementById('stage') || document.body).appendChild(note);
  }
  function showNote() {
    ensureNote();
    note.textContent = mode() === 'keyboard'
      ? 'PLAYER 2 · LOCAL KEYBOARD BACKUP  (arrows + Enter)'
      : 'PLAYER 2 · AUTO-DEFEND  (controller offline)';
    note.style.display = 'block';
  }

  // The post is unmanned and staying that way — say so plainly.
  function showEmptyNote() {
    ensureNote();
    note.textContent = 'PLAYER 2 POST UNMANNED';
    note.style.display = 'block';
  }
  function hideNote() { if (note) note.style.display = 'none'; }

  install();

  return {
    get engaged() { return engaged; },
    get controllerOnline() { return controllerOnline; },
    setControllerOnline(v) { controllerOnline = !!v; },
    setManual(v) { manual = !!v; },
    _tick: tick,   // exposed for QA
  };
})();
