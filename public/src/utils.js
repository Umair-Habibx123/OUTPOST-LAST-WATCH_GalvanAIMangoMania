// src/utils.js

/* Small math / helper utilities. */
window.OLW = window.OLW || {};

OLW.U = {
  TAU: Math.PI * 2,

  clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); },

  lerp(a, b, t) { return a + (b - a) * t; },

  rand(a, b) { return a + Math.random() * (b - a); },

  randInt(a, b) { return Math.floor(a + Math.random() * (b - a + 1)); },

  pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; },

  chance(p) { return Math.random() < p; },

  dist(ax, ay, bx, by) {
    const dx = ax - bx, dy = ay - by;
    return Math.sqrt(dx * dx + dy * dy);
  },

  dist2(ax, ay, bx, by) {
    const dx = ax - bx, dy = ay - by;
    return dx * dx + dy * dy;
  },

  angleTo(ax, ay, bx, by) { return Math.atan2(by - ay, bx - ax); },

  // Ease helpers
  easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); },
  easeInQuad(t) { return t * t; },

  // Format seconds as "12.3"
  fmtTime(s) { return s.toFixed(1); },

  // Hex -> rgba string
  rgba(hex, a) {
    const h = hex.replace('#', '');
    const r = parseInt(h.substring(0, 2), 16);
    const g = parseInt(h.substring(2, 4), 16);
    const b = parseInt(h.substring(4, 6), 16);
    return `rgba(${r},${g},${b},${a})`;
  },
};
