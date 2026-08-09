// src/holdfire.js
/* Hold-to-fire: keep firing while a touch / mouse button (left or right) is held
   on the play surface, or while Space is held — matching the "hold to keep
   shooting" feel. game.strike() self-limits to the weapon's cooldown, so holding
   simply fires at that weapon's rate. Coexists with the tap/click handlers in
   main.js (the cooldown de-dupes any overlap). */
(function () {
  const canvas = document.getElementById('game');
  if (!canvas) return;
  const C = OLW.CONFIG, U = OLW.U;

  let pointerHeld = false;
  let spaceHeld = false;
  let px = C.WIDTH / 2, py = C.HEIGHT / 2;

  function toGame(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    return {
      x: U.clamp((clientX - r.left) * (C.WIDTH / r.width), 0, C.WIDTH),
      y: U.clamp((clientY - r.top) * (C.HEIGHT / r.height), 0, C.HEIGHT),
    };
  }

  canvas.addEventListener('pointerdown', (e) => {
    const p = toGame(e.clientX, e.clientY);
    px = p.x; py = p.y;
    pointerHeld = true;
    try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = toGame(e.clientX, e.clientY);
    px = p.x; py = p.y;
  });
  const release = () => { pointerHeld = false; };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('lostpointercapture', release);
  window.addEventListener('blur', release);
  // keep right-click hold firing instead of popping the context menu
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  window.addEventListener('keydown', (e) => { if (e.code === 'Space') spaceHeld = true; });
  window.addEventListener('keyup', (e) => { if (e.code === 'Space') spaceHeld = false; });

  function loop() {
    requestAnimationFrame(loop);
    const g = window.OLW_GAME;
    if (!g || g.state !== 'playing') return;
    if (pointerHeld) { g.setAim(px, py); g.strike(); }
    else if (spaceHeld) { g.strike(); }
  }
  requestAnimationFrame(loop);
})();
