// server/economy.js
/* Authoritative economy config + rules. The CLIENT may mirror these numbers for
   display, but every coin/unlock/ammo/upgrade change is validated HERE, so a
   tampered browser can't grant itself stash, unlocks, or levels. */

export const WEAPONS = {
  sidearm:    { starter: true, unlockCost: 0 },
  repeater:   { unlockCost: 220, ammoBase: 40, ammoPerLevel: 8, clip: 20, clipCost: 40 },
  scattergun: { unlockCost: 400, ammoBase: 24, ammoPerLevel: 5, clip: 10, clipCost: 45 },
  cannon:     { unlockCost: 650, ammoBase: 12, ammoPerLevel: 3, clip: 5,  clipCost: 60 },
  mortar:     { unlockCost: 900, ammoBase: 8,  ammoPerLevel: 2, clip: 4,  clipCost: 80 },
  tesla:      { unlockCost: 1100, ammoBase: 30, ammoPerLevel: 6, clip: 12, clipCost: 55 },
};

export const CONSUMABLES = {
  supply:   { cost: 60,  base: 1, perLevel: 0.5 },
  rally:    { cost: 120, base: 1, perLevel: 0.34 },
  warhound: { cost: 160, base: 1, perLevel: 0.25 },
  dragon:   { cost: 300, base: 0, perLevel: 0.2 },
};

export const UPGRADES = {
  armour:     { max: 4, cost: [200, 400, 700, 1100] },
  coinGain:   { max: 3, cost: [150, 300, 500] },
  startCoins: { max: 3, cost: [120, 240, 400] },
};

const MAX_LEVEL = 20;
const COIN = { kill: 8, perfect: 50, mango: 30 };

// per-run anti-cheat ceilings (a great run earns a few thousand)
const CAPS = {
  kills: 100000, perfectWaves: 1000, mango: 1000,
  score: 100000000, time: 36000,
  coinsPerRun: 20000, xpPerRun: 5000,
};

export function defaults() {
  return {
    stash: 0, unlocked: ['sidearm'], ammo: {}, items: {}, upgrades: {},
    xp: 0, level: 1, settings: {},
    loadout: 'sidearm', map: 'frontier', bestScore: 0, name: '',
  };
}

export function levelFromXp(xp) {
  let L = 1, need = 0;
  while (L < MAX_LEVEL) { need += 150 * L; if ((xp || 0) < need) break; L++; }
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
