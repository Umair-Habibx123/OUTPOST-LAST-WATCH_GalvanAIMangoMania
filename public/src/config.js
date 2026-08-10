// src/config.js

/* Outpost: Last Watch — central config & tuning.
   Everything the designer might tweak lives here. */
window.OLW = window.OLW || {};

OLW.CONFIG = {
  WIDTH: 960,
  HEIGHT: 540,

  // The fort wall in the map art is an ISOMETRIC ellipse (wider than tall), so
  // the play boundary is an ellipse too: WALL_RADIUS is the horizontal half-axis
  // and WALL_RADIUS_Y the vertical one. Keeps the ring + landings on the art wall.
  //
  // These are MEASURED FROM THE MAP ART, not chosen freely — the painted palisade
  // and the collision boundary have to be the same ellipse or raiders stop short
  // of the wall (or walk through it). If you regenerate the maps, re-measure the
  // painted wall and update these together; see docs/map-art-pipeline.md.
  WALL_RADIUS: 180,
  WALL_RADIUS_Y: 117,
  TOWER_RADIUS: 30,

  INTEGRITY_MAX: 100,
  INTEGRITY_START: 100,
  PERFECT_WAVE_REPAIR: 6,
  MANGO_REPAIR: 14,

  AIM_ASSIST_RADIUS: 28,
  STRIKE_COOLDOWN: 0.10,
  STRIKE_RANGE: 999,

  SCORE_PER_SECOND: 10,
  SCORE_PER_KILL: 5,
  SCORE_PERFECT_WAVE: 150,
  SCORE_MANGO: 60,

  COMBO_WINDOW: 2.2,
  COMBO_STEP: 4,
  COMBO_MAX: 5,

  VOLLEY_CHARGE_MAX: 12,
  VOLLEY_SAFE_RADIUS: 220,

  BREATHER: 2.6,
  RAID_EVERY: 5,

  // Versus (attacker vs defender): seconds the defender must survive to win.
  VERSUS_DURATION: 90,

  MANGO_FIRST_AT: 2,
  MANGO_CHANCE: 0.55,

  SHAKE_DECAY: 5.0
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
