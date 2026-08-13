// server/economy.js
/* Authoritative economy config + rules. The CLIENT may mirror these numbers for
   display, but every coin/unlock/ammo/upgrade change is validated HERE, so a
   tampered browser can't grant itself stash, unlocks, or levels. */

// EVENT-DAY BUILD: mirrors public/src/arsenal.js. NOTE the event client now runs
// a CLIENT-SIDE, run-scoped economy (buying happens live during the run, spending
// coins earned that run) and does not call /api/purchase or /api/run — so this
// server config is effectively dormant. It is kept in sync for hygiene and in case
// the server-authoritative path is restored. Prices/level gates are deliberately
// low so weapons open up within a couple of waves.
export const WEAPONS = {
  sidearm:    { starter: true, unlockCost: 0, minLevel: 1 },
  repeater:   { unlockCost: 70,  ammoBase: 40, ammoPerLevel: 8, clip: 20, clipCost: 18, minLevel: 1 },
  scattergun: { unlockCost: 130, ammoBase: 24, ammoPerLevel: 5, clip: 10, clipCost: 24, minLevel: 1 },
  cannon:     { unlockCost: 220, ammoBase: 12, ammoPerLevel: 3, clip: 5,  clipCost: 30, minLevel: 2 },
  mortar:     { unlockCost: 320, ammoBase: 8,  ammoPerLevel: 2, clip: 4,  clipCost: 40, minLevel: 3 },
  tesla:      { unlockCost: 420, ammoBase: 30, ammoPerLevel: 6, clip: 12, clipCost: 28, minLevel: 4 },
};

export const CONSUMABLES = {
  supply:       { cost: 30, base: 1, perLevel: 0.5 },
  weaponSupply: { cost: 40, base: 1, perLevel: 0.4 },   // reloads all owned guns
  rally:        { cost: 55, base: 1, perLevel: 0.34 },
  warhound:     { cost: 75, base: 1, perLevel: 0.25 },
  dragon:       { cost: 130, base: 0, perLevel: 0.4 },
};

export const UPGRADES = {
  armour:     { max: 4, cost: [80, 160, 280, 420] },
  reload:     { max: 4, cost: [80, 160, 260, 400] },    // faster fire, all guns
  fieldKit:   { max: 3, cost: [120, 240, 400] },        // stronger supplies/allies
  wallMend:   { max: 3, cost: [100, 200, 340] },        // bigger perfect-wave repair
  coinGain:   { max: 3, cost: [90, 180, 300] },
  startCoins: { max: 3, cost: [80, 160, 260] },
};

// Per-weapon power levels — more level, more impact.
export const WEAPON_UPGRADE = { max: 5, base: 60, growth: 1.4 };
export function weaponUpgradeCost(lvl) {
  return Math.round(WEAPON_UPGRADE.base * Math.pow(WEAPON_UPGRADE.growth, lvl));
}

const MAX_LEVEL = 20;
const COIN = { kill: 8, perfect: 45, mango: 30 };

// per-run anti-cheat ceilings (a great run earns a few thousand)
const CAPS = {
  kills: 100000, perfectWaves: 1000, mango: 1000,
  score: 100000000, time: 36000,
  coinsPerRun: 20000, xpPerRun: 5000,
};

export function defaults() {
  return {
    stash: 0, unlocked: ['sidearm'], ammo: {}, items: {}, upgrades: {}, weaponLevels: {},
    xp: 0, level: 1, settings: {},
    loadout: 'sidearm', map: 'frontier', bestScore: 0, name: '', company: '',
    versusWins: 0, versusLosses: 0,
  };
}

export function levelFromXp(xp) {
  let L = 1, need = 0;
  while (L < MAX_LEVEL) { need += 100 * L; if ((xp || 0) < need) break; L++; }
  return L;
}
export function ammoCap(weaponId, level) {
  const w = WEAPONS[weaponId];
  if (!w || w.starter) return Infinity;
  return (w.ammoBase || 0) + (level - 1) * (w.ammoPerLevel || 0);
}
export function itemLimit(itemId, level) {
  const c = CONSUMABLES[itemId];
  if (!c) return 0;
  return Math.floor(c.base + (level - 1) * c.perLevel);
}
export function coinMult(profile) { return 1 + 0.15 * ((profile.upgrades && profile.upgrades.coinGain) || 0); }
export function startCoins(profile) { return 80 * ((profile.upgrades && profile.upgrades.startCoins) || 0); }

// normalise anything loaded from the DB into a full, safe profile shape
export function sanitize(p) {
  const d = defaults();
  if (!p || typeof p !== 'object') return d;
  const out = Object.assign(d, p);
  out.stash = Math.max(0, Math.floor(Number(out.stash) || 0));
  out.xp = Math.max(0, Math.floor(Number(out.xp) || 0));
  out.unlocked = Array.isArray(out.unlocked) ? out.unlocked.filter(id => WEAPONS[id]) : ['sidearm'];
  if (!out.unlocked.includes('sidearm')) out.unlocked.push('sidearm');
  out.ammo = (out.ammo && typeof out.ammo === 'object') ? out.ammo : {};
  out.items = (out.items && typeof out.items === 'object') ? out.items : {};
  out.upgrades = (out.upgrades && typeof out.upgrades === 'object') ? out.upgrades : {};
  out.weaponLevels = (out.weaponLevels && typeof out.weaponLevels === 'object') ? out.weaponLevels : {};
  out.level = levelFromXp(out.xp);
  return out;
}

/* ---- authoritative mutations ---- */

// Apply a purchase; returns { ok, profile?, message? }. Mutates a copy.
export function applyPurchase(profile, kind, id) {
  const p = sanitize(profile);
  const level = p.level;

  if (kind === 'unlock') {
    const w = WEAPONS[id];
    if (!w || w.starter) return { ok: false, message: 'Not purchasable.' };
    if (p.unlocked.includes(id)) return { ok: false, message: 'Already unlocked.' };
    if (level < (w.minLevel || 1)) return { ok: false, message: `Reach level ${w.minLevel}.` };
    if (p.stash < w.unlockCost) return { ok: false, message: 'Not enough coins.' };
    p.stash -= w.unlockCost;
    p.unlocked.push(id);
  } else if (kind === 'ammo') {
    const w = WEAPONS[id];
    if (!w || w.starter) return { ok: false, message: 'No ammo for this weapon.' };
    if (!p.unlocked.includes(id)) return { ok: false, message: 'Unlock it first.' };
    const cap = ammoCap(id, level), have = p.ammo[id] || 0;
    if (have >= cap) return { ok: false, message: 'Ammo full.' };
    if (p.stash < w.clipCost) return { ok: false, message: 'Not enough coins.' };
    p.stash -= w.clipCost;
    p.ammo[id] = Math.min(cap, have + w.clip);
  } else if (kind === 'item') {
    const c = CONSUMABLES[id];
    if (!c) return { ok: false, message: 'Unknown item.' };
    const limit = itemLimit(id, level), have = p.items[id] || 0;
    if (limit <= 0) return { ok: false, message: 'Locked at your level.' };
    if (have >= limit) return { ok: false, message: 'At carry limit.' };
    if (p.stash < c.cost) return { ok: false, message: 'Not enough coins.' };
    p.stash -= c.cost;
    p.items[id] = have + 1;
  } else if (kind === 'upgrade') {
    const u = UPGRADES[id];
    if (!u) return { ok: false, message: 'Unknown upgrade.' };
    const lvl = p.upgrades[id] || 0;
    if (lvl >= u.max) return { ok: false, message: 'Maxed.' };
    const cost = u.cost[lvl];
    if (p.stash < cost) return { ok: false, message: 'Not enough coins.' };
    p.stash -= cost;
    p.upgrades[id] = lvl + 1;
  } else if (kind === 'weaponUpgrade') {
    const w = WEAPONS[id];
    if (!w) return { ok: false, message: 'Unknown weapon.' };
    if (!p.unlocked.includes(id)) return { ok: false, message: 'Unlock it first.' };
    const lvl = (p.weaponLevels && p.weaponLevels[id]) || 0;
    if (lvl >= WEAPON_UPGRADE.max) return { ok: false, message: 'Max level.' };
    const cost = weaponUpgradeCost(lvl);
    if (p.stash < cost) return { ok: false, message: 'Not enough coins.' };
    p.stash -= cost;
    p.weaponLevels = p.weaponLevels || {};
    p.weaponLevels[id] = lvl + 1;
  } else {
    return { ok: false, message: 'Unknown purchase kind.' };
  }

  return { ok: true, profile: p };
}

// Credit a finished run from reported stats (server computes coins/xp, capped).
export function applyRun(profile, stats) {
  const p = sanitize(profile);
  const s = stats || {};
  const clamp = (v, max) => Math.max(0, Math.min(Math.floor(Number(v) || 0), max));

  const kills = clamp(s.kills, CAPS.kills);
  const perfectWaves = clamp(s.perfectWaves, CAPS.perfectWaves);
  const mango = clamp(s.mango, CAPS.mango);
  const score = clamp(s.score, CAPS.score);

  const earned = Math.min(
    CAPS.coinsPerRun,
    Math.round(startCoins(p) + coinMult(p) * (kills * COIN.kill + perfectWaves * COIN.perfect + mango * COIN.mango))
  );
  const xpGain = Math.min(CAPS.xpPerRun, Math.round(score / 8) + kills * 2);

  p.stash += earned;
  p.xp += xpGain;
  p.level = levelFromXp(p.xp);
  if (score > (p.bestScore || 0)) p.bestScore = score;

  // remaining ammo/items may only DECREASE (consumption) vs what was owned
  if (s.ammo && typeof s.ammo === 'object') {
    for (const id of Object.keys(p.ammo)) {
      if (id in s.ammo) p.ammo[id] = Math.max(0, Math.min(p.ammo[id] || 0, Math.floor(Number(s.ammo[id]) || 0)));
    }
  }
  if (s.items && typeof s.items === 'object') {
    for (const id of Object.keys(p.items)) {
      if (id in s.items) p.items[id] = Math.max(0, Math.min(p.items[id] || 0, Math.floor(Number(s.items[id]) || 0)));
    }
  }
  if (typeof s.loadout === 'string' && WEAPONS[s.loadout]) p.loadout = s.loadout;

  return { ok: true, profile: p, earned, xpGain };
}
