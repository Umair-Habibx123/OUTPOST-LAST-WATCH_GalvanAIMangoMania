// src/config.js

/* Outpost: Last Watch — central config & tuning.
   Everything the designer might tweak lives here. */
window.OLW = window.OLW || {};

OLW.CONFIG = {
  // Internal render resolution (game logic space). Canvas scales to fit.
  WIDTH: 960,
  HEIGHT: 600,

  // The outpost sits at center.
  WALL_RADIUS: 124,       // aligned to the illustrated palisade
  TOWER_RADIUS: 30,

  // Integrity (the health bar that never resets between waves).
  INTEGRITY_MAX: 100,
  INTEGRITY_START: 100,
  PERFECT_WAVE_REPAIR: 6,  // small — decay is meant to outpace it
  MANGO_REPAIR: 14,

  // Aiming / striking
  AIM_ASSIST_RADIUS: 26,   // click within this of a raider still connects (touch-friendly)
  STRIKE_COOLDOWN: 0.10,   // seconds between strikes
  STRIKE_RANGE: 999,       // ranged watchtower — you can hit anywhere on field

  // Scoring
  SCORE_PER_SECOND: 10,
  SCORE_PER_KILL: 5,
  SCORE_PERFECT_WAVE: 150,
  SCORE_MANGO: 60,

  // Combo / streak: rapid clean kills raise a points multiplier; a miss or a
  // hit to the wall breaks it.
  COMBO_WINDOW: 2.2,       // seconds a streak survives without a kill
  COMBO_STEP: 4,           // kills per +1 to the multiplier
  COMBO_MAX: 5,            // multiplier ceiling

  // Signal Volley: charges from kills; when full, a shockwave clears nearby raiders.
  VOLLEY_CHARGE_MAX: 12,   // kills to fully charge
  VOLLEY_SAFE_RADIUS: 245, // shockwave kill radius from the tower

  // Wave director
  BREATHER: 2.6,           // seconds of calm between waves
  RAID_EVERY: 5,           // every Nth wave is a harder raid surge

  // Mango supply cart
  MANGO_FIRST_AT: 2,       // earliest wave a cart can appear
  MANGO_CHANCE: 0.55,      // per-wave chance once eligible

  // Feel
  SHAKE_DECAY: 5.0,
};

// Cohesive dusty desert-night palette. No purple, no neon.
OLW.COLORS = {
  skyTop: '#0c0f16',
  ground: '#171b24',
  groundEdge: '#0b0e14',
  ringFar: 'rgba(232,161,58,0.05)',

  glow: 'rgba(232,161,58,0.16)',
  torch: '#e8a13a',
  torchCore: '#ffd98a',

  wood: '#6b4a2b',
  woodDark: '#4a3420',
  stone: '#4a4e57',
  stoneDark: '#31353d',

  raider: '#191b22',
  raiderRim: '#9a7d4e',
  raiderTough: '#211620',
  raiderToughRim: '#bd5842',
  raiderFast: '#141b24',
  raiderFastRim: '#5fa3ba',

  mango: '#f2a72b',
  mangoShade: '#d9861f',
  mangoLeaf: '#5c8a3a',

  parchment: '#e8ddc7',
  parchmentDim: '#9a927f',
  integrityGood: '#d8a24a',
  integrityMid: '#d17b34',
  integrityLow: '#c14a34',
  danger: '#c14a34',
};
