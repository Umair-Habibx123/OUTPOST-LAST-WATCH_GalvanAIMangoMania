// src/responsive.js
/* Full-screen experience helpers: a fullscreen toggle and a portrait rotate
   prompt (the game is landscape). Pure DOM injection — no other files touched. */
(function () {
  const docEl = document.documentElement;
  const canFullscreen = !!(docEl.requestFullscreen || docEl.webkitRequestFullscreen);

  // ---- fullscreen toggle ----
  if (canFullscreen) {
    const fs = document.createElement('button');
    fs.id = 'fs-btn';
    fs.title = 'Toggle fullscreen';
    fs.setAttribute('aria-label', 'Toggle fullscreen');
    fs.textContent = '⛶';
    fs.addEventListener('click', () => {
      if (!document.fullscreenElement && !document.webkitFullscreenElement) {
        (docEl.requestFullscreen || docEl.webkitRequestFullscreen).call(docEl);
      } else {
        (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      }
    });
    document.body.appendChild(fs);
    document.addEventListener('fullscreenchange', () => {
      fs.textContent = document.fullscreenElement ? '✕' : '⛶';
    });
  }

  // ---- portrait rotate prompt ----
  const rot = document.createElement('div');
  rot.id = 'rotate-hint';
  rot.innerHTML =
    '<div class="rot-ico">📱</div>' +
    '<b>Rotate your device</b>' +
    '<small>Outpost: Last Watch plays in landscape. Turn your phone sideways to take the watch.</small>';
  document.body.appendChild(rot);
})();
