// src/assets.js

/* Lightweight asset registry. The game stays playable while images load. */
window.OLW = window.OLW || {};
OLW.Assets = (function () {
  const files = {
    arena: 'assets/art/outpost-arena-v2.png',
    raiders: 'assets/art/raider-atlas.png',
    warden: 'assets/art/warden-atlas.png',
  };
  const images = {};
  Object.keys(files).forEach((key) => {
    const img = new Image();
    img.decoding = 'async';
    img.src = files[key];
    images[key] = img;
  });
  return { images, ready(key) { const i = images[key]; return !!(i && i.complete && i.naturalWidth); } };
})();
