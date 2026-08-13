/* Outpost: Last Watch — Arsenal, economy, field kit and Armory UI. */
window.OLW = window.OLW || {};

OLW.Arsenal = (function () {
  const D = OLW.Device;

  /* EVENT-DAY BUILD economy: prices + level gates are deliberately LOW so a
     player killing guards can afford the next tier within a wave or two and the
     run keeps escalating in fun — no "everything's locked, max wave hit, never
     got to buy". Coins are earned AND spent live during the run (see A.buy). */
  const WEAPONS = [
    {
      id: 'sidearm', key: '1', name: 'Sidearm', tag: 'Standard', starter: true,
      unlockCost: 0, cdMul: 1.0, mode: 'single',
      desc: 'Old service pistol. Endless rounds, modest bite.'
    },
    {
      id: 'repeater', key: '2', name: 'Repeater', tag: 'Rapid',
      unlockCost: 70, cdMul: 0.5, mode: 'single',
      ammoBase: 40, ammoPerLevel: 8, clip: 20, clipCost: 18,
      desc: 'Double fire-rate. Shreds single targets — feed it rounds.'
    },
    {
      id: 'scattergun', key: '3', name: 'Scattergun', tag: 'Spread',
      unlockCost: 130, cdMul: 1.5, mode: 'spread', spread: 3, radius: 78,
      ammoBase: 24, ammoPerLevel: 5, clip: 10, clipCost: 24,
      desc: 'Strikes up to 3 nearby raiders. Crowd control.'
    },
    {
      id: 'cannon', key: '4', name: 'Siege Cannon', tag: 'Heavy',
      unlockCost: 220, cdMul: 2.3, mode: 'aoe', radius: 66, punch: 3,
      ammoBase: 12, ammoPerLevel: 3, clip: 5, clipCost: 30,
      desc: 'Heavy splash. One-shots armoured raiders. Rare, precious shells.'
    },
    {
      id: 'mortar', key: '5', name: 'Mortar', tag: 'Artillery',
      unlockCost: 320, cdMul: 2.7, mode: 'aoe', radius: 104, punch: 2,
      ammoBase: 8, ammoPerLevel: 2, clip: 4, clipCost: 40,
      desc: 'Lobs a shell — massive blast radius, slow reload.'
    },
    {
      id: 'tesla', key: '6', name: 'Tesla Coil', tag: 'Chain',
      unlockCost: 420, cdMul: 1.2, mode: 'chain', chain: 4, radius: 150,
      ammoBase: 30, ammoPerLevel: 6, clip: 12, clipCost: 28,
      desc: 'An arc leaps between nearby raiders.'
    }
  ];

  const byId = (id) => WEAPONS.find((w) => w.id === id) || WEAPONS[0];
  const SIDEARM = WEAPONS[0];

 // EVENT-DAY BUILD: run-scoped buffs, bought with coins earned during the run.
 const UPGRADES = [
  { key: 'armour',    icon: 'armour-ic',     name: 'Warden Armour', max: 4, cost: [80, 160, 280, 420], desc: '-10% wall damage taken per level.' },
  { key: 'reload',    icon: 'reload-ic',     name: 'Rapid Reload',  max: 4, cost: [80, 160, 260, 400], desc: '-6% fire cooldown per level (all weapons).' },
  { key: 'fieldKit',  icon: 'fieldkit-ic',   name: 'Field Kit',     max: 3, cost: [120, 240, 400],     desc: '+20% supply heal & ally strength per level.' },
  { key: 'wallMend',  icon: 'wallmender-ic', name: 'Wall Mender',   max: 3, cost: [100, 200, 340],     desc: '+4 perfect-wave repair per level.' },
  { key: 'coinGain',  icon: 'coinrunner-ic', name: 'Coin Runners',  max: 3, cost: [90, 180, 300],      desc: '+15% coins earned per level.' },
  { key: 'startCoins', icon: 'warchest-ic',  name: 'War Chest',     max: 3, cost: [80, 160, 260],      desc: '+80 starting run-coins per level.' }
];

  // EVENT-DAY BUILD: low level gates so every weapon is reachable within a few
  // waves (level rises live from kills — see A.addRunXp).
  const WEAPON_MINLEVEL = { sidearm: 1, repeater: 1, scattergun: 1, cannon: 2, mortar: 3, tesla: 4 };
  const weaponMinLevel = (id) => WEAPON_MINLEVEL[id] || 1;

  // per-weapon power levels. More level = more impact. (Cheapened for event day.)
  const WUP = { max: 5, base: 60, growth: 1.4 };
  const wupCost = (lvl) => Math.round(WUP.base * Math.pow(WUP.growth, lvl));
  const weaponLevel = (id) => (D.profile.weaponLevels && D.profile.weaponLevels[id]) || 0;
  const fieldKitMult = () => 1 + 0.2 * D.upgradeLevel('fieldKit');

  // EVENT-DAY BUILD: cheaper field gear, most usable from level 1 (dragon ~Lv 4).
  const CONSUMABLES = [
    { id: 'supply', key: 'z', name: 'Supply Line', tag: 'Repair', cost: 30, base: 1, perLevel: 0.5, desc: 'Restores +28 wall integrity instantly.' },
    { id: 'weaponSupply', icon: 'supply', key: 'b', name: 'Weapon Supply', tag: 'Ammo', cost: 40, base: 1, perLevel: 0.4, desc: 'Reloads a full clip into every purchased weapon.' },
    { id: 'rally', key: 'x', name: 'Backup Team', tag: 'Allies', cost: 55, base: 1, perLevel: 0.34, desc: 'Deploy two allied guards. Their life drains under combat pressure until the team is lost.' },
    { id: 'warhound', key: 'c', name: 'War Beast', tag: 'Beast', cost: 75, base: 1, perLevel: 0.25, desc: 'Unleash an armoured war beast. It fights until its life is exhausted.' },
    { id: 'dragon', key: 'v', name: 'Dragon Strike', tag: 'Ultimate', cost: 130, base: 0, perLevel: 0.4, desc: 'Call an ember dragon that makes repeated attack runs while its life holds.' }
  ];

  const conById = (id) => CONSUMABLES.find((c) => c.id === id);
  const upCost = (u) => u.cost[D.upgradeLevel(u.key)] ?? null;

  const iconImg = (id, cls = 'ars-ic') => {
    const lightweight = cls === 'ars-w-ic' || cls === 'ars-item-ic';
    const suffix = lightweight ? '-192' : '';
    return `<img class="${cls}" src="assets/art/icons/${id}${suffix}.webp" loading="eager" decoding="async" draggable="false" alt="">`;
  };

  // Upgrade art uses its own filenames (optimised webp copies).
  const UP_ICON = {
    armour: 'armour-ic.webp',
    reload: 'reload-ic.webp',
    fieldKit: 'fieldkit-ic.webp',
    wallMend: 'wallmender-ic.webp',
    coinGain: 'coinrunner-ic.webp',
    startCoins: 'warchest-ic.webp',
  };
  const upIconImg = (key) => {
    const f = UP_ICON[key];
    return f ? `<img class="ars-ic" src="assets/art/icons/${f}" loading="lazy" decoding="async" draggable="false" alt="" onerror="this.remove()">` : '';
  };

  // EVENT-DAY BUILD: coins earned per event, and XP that raises the player's
  // level LIVE during the run (kills → level → more weapons/gear unlock).
  // Earnings are modest: a from-zero player has to work a bit for each purchase,
  // so buying is an earned advantage rather than a handout.
  const COIN = { kill: 11, perfect: 65, mango: 45 };
  const XP = { kill: 20, perfect: 50 };

  // Field-kit allies use LIFE instead of fixed timers. Their life drains much
  // faster than wall integrity so they remain powerful temporary tactical tools.
  // Any damage that reaches the wall also shocks deployed allies and accelerates
  // their loss, but each ally class has a different endurance profile.
  // Allies have their own health meter. Life drains a little over time (passive)
  // but MOSTLY when the wall is breached (wall × integrity lost) — they're far
  // weaker than the wall, so every hit that gets past them costs them heavily.
  const FIELD_LIFE = {
    rally:    { max: 100, passive: 1.4, wall: 2.4, attack: 0.35 },
    warhound: { max: 100, passive: 1.8, wall: 3.0, attack: 0.90 },
    dragon:   { max: 100, passive: 2.2, wall: 3.6, attack: 2.20 }
  };
  const MAX_LEVEL = 20;

  // EVENT-DAY BUILD: gentler curve so a player levels up several times in one
  // run and keeps unlocking gear (was 150 * level).
  function xpToAdvance(level) { return 100 * level; }

  function levelFromXp(xp) {
    let level = 1;
    let need = 0;
    while (level < MAX_LEVEL) {
      need += xpToAdvance(level);
      if (xp < need) break;
      level += 1;
    }
    return level;
  }

  function levelProgress(xp) {
    let level = 1;
    let floor = 0;
    while (level < MAX_LEVEL) {
      const step = xpToAdvance(level);
      if (xp < floor + step) return { L: level, into: xp - floor, need: step };
      floor += step;
      level += 1;
    }
    return { L: MAX_LEVEL, into: 1, need: 1 };
  }

  function level() { return levelFromXp(D.profile.xp || 0); }
  function itemLimit(c) { return Math.floor(c.base + (level() - 1) * c.perLevel); }

  function ammoCap(w) {
    if (w.starter) return Infinity;
    return (w.ammoBase || 0) + (level() - 1) * (w.ammoPerLevel || 0);
  }

  const A = {
    WEAPONS,
    UPGRADES,
    CONSUMABLES,
    current: SIDEARM,
    runCoins: 0,
    _run: {},
    _items: {},
    // each is an ARRAY so several allies of any type can coexist, each with its
    // own health, covering a different direction (deploys stack, never override)
    _active: { rally: [], warhound: [], dragon: [] },
    _blasts: [],
    _flash: 0,
    _game: null
  };

  // expanding shock-rings for weapon impacts (small pop → huge blast)
  A.addBlast = function (x, y, radius, color, width, life) {
    A._blasts.push({ x, y, max: radius, color: color || '#ffb347', width: width || 3, life: life || 0.3, maxLife: life || 0.3 });
    if (A._blasts.length > 60) A._blasts.shift();
  };

  // Per-weapon muzzle + impact so each gun FEELS different (pistol tick → mortar BOOM)
  A.weaponImpact = function (game, ax, ay, hit) {
    const U = OLW.U, C = OLW.CONFIG, COL = OLW.COLORS;
    const CX = C.WIDTH / 2, CY = C.HEIGHT / 2;
    const w = A.current;
    A.addBlast(CX, CY - 4, 14, '#ffd98a', 2, 0.09);   // muzzle flash at the tower
    const puff = (n, color, spd, life, rr) => {
      for (let i = 0; i < n; i++) {
        const a = U.rand(0, U.TAU);
        game.effects.push(new OLW.Particle(ax + Math.cos(a) * 4, ay + Math.sin(a) * 4, color,
          { angle: a, speed: U.rand(spd * 0.4, spd), life: life, r: U.rand(1, rr) }));
      }
    };
    switch (w.id) {
      case 'sidearm':   game.spawnSparks(ax, ay, hit ? COL.parchment : '#6b6350', hit ? 4 : 2); break;
      case 'repeater':  puff(4, '#bfe3ff', 150, 0.16, 2.2); A.addBlast(ax, ay, 11, '#bfe3ff', 2, 0.09); break;
      case 'scattergun': puff(7, '#ffe1a8', 190, 0.22, 2.6); A.addBlast(ax, ay, 22, '#ffd08a', 2, 0.14); break;
      case 'cannon':    A.addBlast(ax, ay, 58, '#ffb347', 5, 0.30); puff(18, '#ff7412', 260, 0.5, 4); game.shake = Math.min(14, game.shake + 7); break;
      case 'mortar':    A.addBlast(ax, ay, 106, '#ff7412', 7, 0.4); A.addBlast(ax, ay, 60, '#ffd98a', 4, 0.28); puff(30, '#ff9a3c', 320, 0.7, 5); game.shake = Math.min(18, game.shake + 12); break;
      case 'tesla':     A.addBlast(ax, ay, 40, '#8ed4f0', 3, 0.16); puff(9, '#8ed4f0', 230, 0.24, 2.6); break;
      default:          game.spawnSparks(ax, ay, COL.parchment, 4);
    }
  };

  A.drawBlasts = function (ctx) {
    for (const b of A._blasts) {
      const t = 1 - b.life / b.maxLife;
      const r = b.max * (1 - Math.pow(1 - t, 2));   // ease-out expansion
      ctx.save();
      ctx.globalAlpha = Math.max(0, b.life / b.maxLife);
      ctx.strokeStyle = b.color;
      ctx.lineWidth = b.width * (1 - t) + 0.6;
      ctx.beginPath();
      ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  };

  function coinMult() { return 1 + 0.15 * D.upgradeLevel('coinGain'); }
  // EVENT-DAY BUILD: every player starts a run bone-clean — just the sidearm and
  // ZERO coins. They earn their first weapon by killing guards (War Chest, if
  // ever bought mid-run, still adds +80/level, but a fresh player has none).
  function startCoins() { return 80 * D.upgradeLevel('startCoins'); }

  A.owned = (w) => w.starter || D.isUnlocked(w.id);
  A.runAmmo = (id) => byId(id).starter ? Infinity : (A._run[id] || 0);
  // exposed so the Remote Control can mirror the real arsenal instead of
  // hardcoding a weapon list that would drift out of sync with the game
  A.WEAPONS = WEAPONS;
  A.CONSUMABLES = CONSUMABLES;
  A.itemCount = (id) => A._items[id] || 0;
  A.consume = (
  id,
  n
) => {
  const weapon =
    byId(id);

  if (
    !weapon ||
    weapon.starter
  ) {
    return;
  }

  const before =
    A._run[id] || 0;

  A._run[id] =
    Math.max(
      0,
      before - n
    );

  /*
    Announce only the transition:
      1+ ammo -> 0 ammo

    Not every attempted empty shot.
  */
  if (
    before > 0 &&
    A._run[id] === 0
  ) {
    OLW.Voice?.speak?.(
      `${weapon.name} ammunition depleted.`
    );
  }
};
  A.level = level;
  A.addRunCoins = (n) => { A.runCoins += Math.round(n * coinMult()); };
  // EVENT-DAY BUILD: run XP is written straight into the (run-scoped) profile so
  // level(), ammoCap(), itemLimit() and the weapon level-gates all rise LIVE.
  // The device is wiped between players, so this never persists.
  A.addRunXp = (n) => { D.profile.xp = (D.profile.xp || 0) + Math.max(0, Math.round(n)); };
  A.bump = () => { A._flash = 0.5; };

  /* ---------- EVENT-DAY client-side economy ----------
     Buying happens DURING the run and spends the coins earned this run
     (A.runCoins). No server round-trip: it's instant, and since every player is
     wiped on game-over, server anti-cheat is irrelevant on the kiosk. Ammo and
     items apply straight into the live run buffers so they're usable at once. */
  function spendCoins(n) { A.runCoins = Math.max(0, A.runCoins - n); A._flash = 0.5; }

  A.buy = function (kind, id) {
    const p = D.profile;
    const lv = level();

    if (kind === 'unlock') {
      const w = byId(id);
      if (!w || w.starter || D.isUnlocked(w.id)) return false;
      if (lv < weaponMinLevel(w.id) || A.runCoins < w.unlockCost) return false;
      spendCoins(w.unlockCost);
      p.unlocked = Array.from(new Set([...(p.unlocked || []), w.id]));
      // hand over one clip on unlock so the weapon is immediately usable
      A._run[w.id] = Math.max(A._run[w.id] || 0, Math.min(ammoCap(w), w.clip));
      return true;
    }

    if (kind === 'ammo') {
      const w = byId(id);
      if (!w || w.starter || !D.isUnlocked(w.id)) return false;
      const cap = ammoCap(w);
      const have = A.runAmmo(w.id);
      if (have >= cap || A.runCoins < w.clipCost) return false;
      spendCoins(w.clipCost);
      A._run[w.id] = Math.min(cap, have + w.clip);
      return true;
    }

    if (kind === 'item') {
      const c = conById(id);
      if (!c) return false;
      const limit = itemLimit(c);
      const have = A._items[c.id] || 0;
      if (limit <= 0 || have >= limit || A.runCoins < c.cost) return false;
      spendCoins(c.cost);
      A._items[c.id] = have + 1;
      return true;
    }

    if (kind === 'upgrade') {
      const u = UPGRADES.find((x) => x.key === id);
      if (!u) return false;
      const cur = D.upgradeLevel(u.key);
      const cost = u.cost[cur];
      if (cur >= u.max || cost == null || A.runCoins < cost) return false;
      spendCoins(cost);
      p.upgrades = { ...(p.upgrades || {}), [u.key]: cur + 1 };
      return true;
    }

    if (kind === 'weaponUpgrade') {
      const w = byId(id);
      if (!w || !D.isUnlocked(w.id)) return false;
      const wl = weaponLevel(id);
      const cost = wupCost(wl);
      if (wl >= WUP.max || A.runCoins < cost) return false;
      spendCoins(cost);
      p.weaponLevels = { ...(p.weaponLevels || {}), [id]: wl + 1 };
      return true;
    }

    return false;
  };

  // seed a run's ammo/items from the (server-synced) profile
  A.seedRun = function () {
    A._run = {};
    A._items = {};
    for (const w of WEAPONS) if (!w.starter) A._run[w.id] = Math.min(D.profile.ammo[w.id] || 0, ammoCap(w));
    for (const c of CONSUMABLES) A._items[c.id] = Math.min(D.profile.items[c.id] || 0, itemLimit(c) || 0);
  };

  /* Weapons you can actually fire right now, in bar order. Used by the wheel so
     a scroll never lands on a locked or empty slot. */
  A.usableWeapons = () =>
    WEAPONS.filter((w) => A.owned(w) && (w.starter || A.runAmmo(w.id) > 0));

  A.cycleWeapon = function (dir) {
    const list = A.usableWeapons();
    if (list.length < 2) return false;
    const at = list.findIndex((w) => w.id === A.current.id);
    // wrap in both directions so one flick reaches either end
    const next = list[((at < 0 ? 0 : at + dir) % list.length + list.length) % list.length];
    if (!next || next.id === A.current.id) return false;
    return A.equip(next.id);
  };

  A.equip = function (id) {
    const w = byId(id);
   if (!A.owned(w)) {
  A.bump();

  OLW.Voice?.speak?.(
    `${w.name} locked.`
  );

  return false;
}

if (
  !w.starter &&
  A.runAmmo(id) <= 0
) {
  A.bump();
  OLW.Audio?.strike?.();

  OLW.Voice?.speak?.(
    `${w.name} ammunition depleted.`
  );

  return false;
}
    A.current = w;   // loadout is persisted at run end via submitRun, not per-switch
    OLW.Audio?.hit?.();
    paintWeaponSlots();
    return true;
  };

  A.applyWeaponExtras = function (game, ax, ay) {
    const C = OLW.CONFIG;
    const U = OLW.U;
    const COL = OLW.COLORS;
    const w = A.current;
    const lv = level();               // player XP level
    const wl = weaponLevel(w.id);     // this weapon's upgrade level

    const strike = (r, color, n) => {
      if (r.strike()) { game.kills += 1; game.bonusScore += C.SCORE_PER_KILL; game.spawnSparks(r.x, r.y, color, n || 6); }
      else game.spawnSparks(r.x, r.y, r.rim, 3);
    };

    if (w.mode === 'single') {
      // upgraded pistol/repeater hits harder: extra strikes on the aimed target
      if (wl <= 0) return;
      let best = null, bd = C.AIM_ASSIST_RADIUS + 6;
      for (const r of game.raiders) { if (!r.alive) continue; const d = U.dist(ax, ay, r.x, r.y); if (d < bd) { bd = d; best = r; } }
      if (best) { let hits = wl; while (hits-- > 0 && best.alive) strike(best, COL.parchment, 6); }
      return;
    }

    if (w.mode === 'spread') {
      const count = w.spread + Math.floor(lv / 8) + wl;   // +1 pellet per weapon level
      const radius = w.radius + wl * 8;
      const near = game.raiders
        .filter((r) => r.alive && U.dist(ax, ay, r.x, r.y) < radius)
        .sort((p, q) => U.dist(ax, ay, p.x, p.y) - U.dist(ax, ay, q.x, q.y))
        .slice(0, count);
      for (const r of near) { game.fireBolt(r.x, r.y, false, 1); strike(r, COL.parchment, 6); }
      return;
    }

    if (w.mode === 'aoe') {
      const radius = w.radius + wl * 12;
      const mortar = w.id === 'mortar';                    // Mortar wipes its whole blast
      const punch = w.punch + Math.floor(lv / 6) + wl;
      const inRange = game.raiders.filter((r) => r.alive && U.dist(ax, ay, r.x, r.y) < radius);
      for (const r of inRange) {
        if (mortar) { while (r.alive) strike(r, COL.torch, 7); }
        else { let hits = punch; while (hits-- > 0 && r.alive) strike(r, COL.torch, 7); }
      }
      const ring = mortar ? 24 : 14;
      for (let i = 0; i < ring; i += 1) {
        const angle = (i / ring) * U.TAU;
        game.effects.push(new OLW.Particle(ax + Math.cos(angle) * 6, ay + Math.sin(angle) * 6, COL.torchCore,
          { angle, speed: U.rand(140, 240), life: 0.34, r: U.rand(1.6, 3.4) }));
      }
      game.shake = Math.min(mortar ? 18 : 12, game.shake + (mortar ? 10 : 4));
      return;
    }

    if (w.mode === 'chain') {
      const links = w.chain + Math.floor(lv / 10) + Math.ceil(wl / 1.5);
      const radius = w.radius + wl * 10;
      const hit = new Set();
      let fx = ax, fy = ay;
      for (let i = 0; i < links; i += 1) {
        let best = null, bd = radius;
        for (const r of game.raiders) { if (!r.alive || hit.has(r)) continue; const d = U.dist(fx, fy, r.x, r.y); if (d < bd) { bd = d; best = r; } }
        if (!best) break;
        hit.add(best);
        game.bolts.push({ x1: fx, y1: fy, x2: best.x, y2: best.y, life: 0.12, max: 0.12, playerSlot: 2 });
        strike(best, '#8ed4f0', 6);
        fx = best.x; fy = best.y;
      }
    }
  };

  A.useItem = function (id) {
    const g = A._game;
    if (!g || g.state !== 'playing') return false;
   if ((A._items[id] || 0) <= 0) {
  A.bump();
  OLW.Audio?.strike?.();

  const item =
    CONSUMABLES.find(
      c => c.id === id
    );

  OLW.Voice?.speak?.(
    item
      ? `${item.name} unavailable.`
      : 'Equipment unavailable.'
  );

  return false;
}

    A._items[id] -= 1;

    const C = OLW.CONFIG;
    const U = OLW.U;
    const COL = OLW.COLORS;
    const CX = C.WIDTH / 2;
    const CY = C.HEIGHT / 2;

    if (id === 'supply') {
      const before = g.integrity;
      g.integrity = U.clamp(g.integrity + Math.round(28 * fieldKitMult()), 0, C.INTEGRITY_MAX);
      const healed = Math.round(g.integrity - before);

      // Supplies also replenish one random owned weapon that is not full.
      const candidates = WEAPONS.filter((w) =>
        !w.starter && A.owned(w) && A.runAmmo(w.id) < ammoCap(w)
      );
      let ammoMessage = '';
      if (candidates.length) {
        const w = U.pick(candidates);
        const cap = ammoCap(w);
        const minGain = Math.max(1, Math.ceil((w.clip || 1) * .5));
        const maxGain = Math.max(minGain, w.clip || 1);
        const gain = Math.min(cap - A.runAmmo(w.id), U.randInt(minGain, maxGain));
        A._run[w.id] = Math.min(cap, A.runAmmo(w.id) + gain);
        ammoMessage = ` · ${w.name.toUpperCase()} +${gain}`;
        paintWeaponSlots();
      }

      g.addFloater(
        CX, CY - C.WALL_RADIUS_Y - 26,
        `${healed > 0 ? `SUPPLY +${healed}` : 'SUPPLY'}${ammoMessage}`,
        COL.mango, 18
      );
      g.spawnSparks(CX, CY, COL.mango, 18, 200);
      OLW.Audio?.mango?.();

    } else if (id === 'weaponSupply') {
      // Reload a full clip into every purchased (non-starter) weapon, up to cap.
      const guns = WEAPONS.filter((w) => !w.starter && A.owned(w));
      let total = 0, reloaded = 0;
      for (const w of guns) {
        const cap = ammoCap(w);
        const have = A.runAmmo(w.id);
        if (have >= cap) continue;
        const gain = Math.min(cap - have, w.clip || 1);
        A._run[w.id] = have + gain;
        total += gain;
        reloaded += 1;
      }
      if (reloaded) paintWeaponSlots();
      g.addFloater(
        CX, CY - C.WALL_RADIUS_Y - 26,
        total > 0 ? `WEAPON SUPPLY · +${total} AMMO` : 'WEAPON SUPPLY · ALL FULL',
        COL.mango, 18
      );
      g.spawnSparks(CX, CY, COL.mango, 16, 200);
      OLW.Audio?.mango?.();

    } else if (id === 'rally') {
      const spec = FIELD_LIFE.rally;
      const hp = Math.round(spec.max * fieldKitMult());
      const homeAngle = nextHomeAngle(A._active.rally);
      A._active.rally.push({
        hp, maxHp: hp, acc: 0, phase: 0, muzzle: -1, muzzleLife: 0,
        homeAngle, guards: rallyGuards(homeAngle),
        targets: [{ x: CX, y: CY - 100 }, { x: CX, y: CY - 100 }]
      });
      g.addFloater(CX, CY - 110, 'BACKUP TEAM DEPLOYED', '#8ed4f0', 18);
      OLW.Audio?.waveStart?.();

    } else if (id === 'warhound') {
      const spec = FIELD_LIFE.warhound;
      const hp = Math.round(spec.max * fieldKitMult());
      const homeAngle = nextHomeAngle(A._active.warhound);
      const gr = 42;
      A._active.warhound.push({
        hp, maxHp: hp, acc: 0,
        x: CX + Math.cos(homeAngle) * gr, y: CY + Math.sin(homeAngle) * gr,
        phase: Math.random() * 10, pounce: 0, angle: homeAngle
      });
      g.addFloater(CX, CY - 110, 'WAR BEAST UNLEASHED', '#c98a4a', 18);
      OLW.Audio?.waveStart?.();

    } else if (id === 'dragon') {
      const spec = FIELD_LIFE.dragon;
      const hp = Math.round(spec.max * fieldKitMult());
      A._active.dragon.push({
        hp, maxHp: hp,
        phase: (A._active.dragon.length * 0.37) % 1,   // spread around the orbit
        attackAcc: .65, breathFlash: 0
      });
      g.addFloater(CX, CY - 120, 'EMBER DRAGON CALLED', '#ff7412', 20);
      g.shake = Math.min(12, g.shake + 5);
      OLW.Audio?.volley?.();
    }

    A._lastIntegrity = g.integrity;
    paintItemSlots();
    return true;
  };

  // Successive deploys of the same ally type spread around the wall so each new
  // one guards a fresh direction (top → right → bottom → left → …).
  function nextHomeAngle(list) {
    return -Math.PI / 2 + (list.length) * (Math.PI / 2) + OLW.U.rand(-0.22, 0.22);
  }
  // The two guards of one backup team, placed around a home direction.
  function rallyGuards(homeAngle) {
    const C = OLW.CONFIG, CX = C.WIDTH / 2, CY = C.HEIGHT / 2;
    const gr = 66, perp = homeAngle + Math.PI / 2, off = 22;
    const bx = CX + Math.cos(homeAngle) * gr, by = CY + Math.sin(homeAngle) * gr;
    return [
      { gx: bx + Math.cos(perp) * off, gy: by + Math.sin(perp) * off },
      { gx: bx - Math.cos(perp) * off, gy: by - Math.sin(perp) * off },
    ];
  }

  A.tickAllies = function (game, dt) {
  const U = OLW.U;
  const C = OLW.CONFIG;
  const CX = C.WIDTH / 2;
  const CY = C.HEIGHT / 2;

  const previousIntegrity =
    A._lastIntegrity == null
      ? game.integrity
      : A._lastIntegrity;

  const wallLoss =
    Math.max(
      0,
      previousIntegrity -
        game.integrity
    );

  A._lastIntegrity =
    game.integrity;

  const nearest = (
    x,
    y,
    range
  ) => {
    let best = null;

    let bestDistance =
      range == null
        ? Infinity
        : range;

    for (
      const r
      of game.raiders
    ) {
      if (!r.alive) {
        continue;
      }

      const d =
        U.dist(
          x,
          y,
          r.x,
          r.y
        );

      if (
        d <
        bestDistance
      ) {
        bestDistance =
          d;

        best =
          r;
      }
    }

    return best;
  };

  const killRaider = (
    target,
    color,
    sparks = 6
  ) => {
    if (
      !target ||
      !target.alive
    ) {
      return false;
    }

    if (
      target.strike()
    ) {
      game.kills += 1;

      game.bonusScore +=
        C.SCORE_PER_KILL;

      game.spawnSparks(
        target.x,
        target.y,
        color,
        sparks
      );

      return true;
    }

    return false;
  };

  // ---------------------------------------------------------
  // ALLY DEATH HANDLER
  // ---------------------------------------------------------

  const cull = (
    key,
    label,
    color,
    voiceLine
  ) => {
    const list =
      A._active[key];

    const dead =
      list.filter(
        ally =>
          ally.hp <= 0
      );

    if (!dead.length) {
      return;
    }

    A._active[key] =
      list.filter(
        ally =>
          ally.hp > 0
      );

    game.addFloater(
      CX,
      CY - 105,
      dead.length > 1
        ? `${label} ×${dead.length}`
        : label,
      color,
      15
    );

    game.spawnSparks(
      CX,
      CY,
      color,
      Math.min(
        22,
        10 +
          dead.length * 3
      ),
      150
    );

    OLW.Voice?.speak?.(
      dead.length > 1
        ? `${dead.length} ${voiceLine}`
        : voiceLine
    );
  };


  // =========================================================
  // BACKUP TEAMS
  // =========================================================

  for (
    const a
    of A._active.rally
  ) {
    const spec =
      FIELD_LIFE.rally;

    a.hp -=
      spec.passive * dt +
      wallLoss * spec.wall;

    a.acc += dt;

    a.phase +=
      dt * 5.5;

    const RANGE =
      a.range || 205;

    while (
      a.acc >= .42 &&
      a.hp > 0
    ) {
      a.acc -= .42;

      a.guards.forEach(
        (g, idx) => {
          const best =
            nearest(
              g.gx,
              g.gy,
              RANGE
            );

          if (!best) {
            return;
          }

          a.targets[idx] = {
            x: best.x,
            y: best.y
          };

          game.bolts.push({
            x1: g.gx,
            y1: g.gy,

            x2: best.x,
            y2: best.y,

            life: .12,
            max: .12,

            playerSlot: 2,
            ally: true
          });

          killRaider(
            best,
            '#8ed4f0',
            5
          );

          a.hp -=
            spec.attack;

          a.muzzle =
            idx;

          a.muzzleLife =
            .10;
        }
      );
    }

    if (
      a.muzzleLife > 0
    ) {
      a.muzzleLife -=
        dt;
    }
  }

  cull(
    'rally',
    'BACKUP TEAM LOST',
    '#8ed4f0',
    'Reinforcement team lost.'
  );


  // =========================================================
  // WAR BEASTS
  // =========================================================

  for (
    const h
    of A._active.warhound
  ) {
    const spec =
      FIELD_LIFE.warhound;

    h.hp -=
      spec.passive * dt +
      wallLoss * spec.wall;

    h.phase +=
      dt * 11;

    const target =
      nearest(
        h.x,
        h.y
      );

    if (target) {
      const angle =
        Math.atan2(
          target.y - h.y,
          target.x - h.x
        );

      h.angle =
        angle;

      h.x +=
        Math.cos(angle) *
        155 *
        dt;

      h.y +=
        Math.sin(angle) *
        155 *
        dt;

      if (
        U.dist(
          h.x,
          h.y,
          target.x,
          target.y
        ) <
        target.r + 22
      ) {
        h.acc += dt;

        if (
          h.acc >= .30
        ) {
          h.acc = 0;

          h.pounce =
            .18;

          killRaider(
            target,
            '#c98a4a',
            8
          );

          h.hp -=
            spec.attack;
        }
      } else {
        h.acc =
          0;
      }
    }

    const FR =
      Math.min(
        CX,
        CY
      ) - 16;

    const dc =
      U.dist(
        h.x,
        h.y,
        CX,
        CY
      );

    if (
      dc > FR
    ) {
      h.x =
        CX +
        (h.x - CX) /
          dc *
          FR;

      h.y =
        CY +
        (h.y - CY) /
          dc *
          FR;
    }

    h.x =
      U.clamp(
        h.x,
        26,
        C.WIDTH - 26
      );

    h.y =
      U.clamp(
        h.y,
        26,
        C.HEIGHT - 26
      );

    if (
      h.pounce > 0
    ) {
      h.pounce -= dt;
    }
  }

  cull(
    'warhound',
    'WAR BEAST FALLEN',
    '#c98a4a',
    'War beast lost.'
  );


  // =========================================================
  // DRAGONS
  // =========================================================

  for (
    const d
    of A._active.dragon
  ) {
    const spec =
      FIELD_LIFE.dragon;

    d.hp -=
      spec.passive * dt +
      wallLoss * spec.wall;

    d.phase =
      (
        d.phase +
        dt * .16
      ) % 1;

    d.attackAcc +=
      dt;

    if (
      d.breathFlash > 0
    ) {
      d.breathFlash -=
        dt;
    }

    const guardBand =
      C.WALL_RADIUS +
      150;

    const targets =
      game.raiders
        .filter(
          r =>
            r.alive &&
            U.dist(
              r.x,
              r.y,
              CX,
              CY
            ) <
              guardBand
        )
        .sort(
          (a, b) =>
            U.dist2(
              a.x,
              a.y,
              CX,
              CY
            ) -
            U.dist2(
              b.x,
              b.y,
              CX,
              CY
            )
        )
        .slice(
          0,
          3
        );

    if (
      targets.length &&
      d.attackAcc >=
        1.05 &&
      d.hp >
        spec.attack
    ) {
      d.attackAcc =
        0;

      d.hp -=
        spec.attack;

      d.breathFlash =
        .35;

      let hits =
        0;

      for (
        const r
        of targets
      ) {
        let strikes =
          r.type === 'tough'
            ? 2
            : 1;

        while (
          strikes-- > 0 &&
          r.alive
        ) {
          if (
            killRaider(
              r,
              '#ff7412',
              10
            )
          ) {
            hits += 1;
          }
        }
      }

      if (hits) {
        game.addFloater(
          CX,
          CY - 126,
          `DRAGON BREATH +${
            hits *
            C.SCORE_PER_KILL
          }`,
          '#ff7412',
          17
        );

        game.shake =
          Math.min(
            13,
            game.shake + 4
          );

        OLW.Audio?.volley?.();
      }
    }
  }

  cull(
    'dragon',
    'DRAGON WITHDRAWS',
    '#ff7412',
    'Dragon strike exhausted.'
  );
};

  function atlasDirectionRow(angle) {
    return ((Math.round(angle / (Math.PI / 4)) % 8) + 8) % 8;
  }

  function drawAtlasFrame(ctx, image, cols, rows, col, row, x, y, width, alpha = 1) {
    if (!image || !image.complete || !image.naturalWidth) return false;
    const cw = image.naturalWidth / cols, ch = image.naturalHeight / rows;
    const height = width * (ch / cw);
    ctx.save(); ctx.globalAlpha = alpha; ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, col*cw, row*ch, cw, ch, x-width/2, y-height*.78, width, height); ctx.restore(); return true;
  }

  function drawFieldLifeBar(ctx, x, y, width, hp, maxHp, color) {
    const pct = OLW.U.clamp(hp / Math.max(1, maxHp), 0, 1);
    ctx.save();
    ctx.fillStyle = 'rgba(4,6,9,.76)';
    ctx.fillRect(x - width/2 - 1, y - 1, width + 2, 6);
    ctx.fillStyle = color;
    ctx.fillRect(x - width/2, y, width * pct, 4);
    ctx.strokeStyle = 'rgba(255,255,255,.18)';
    ctx.strokeRect(x - width/2 -.5, y -.5, width + 1, 5);
    ctx.restore();
  }

  function drawBackupTeam(ctx) {
    const C = OLW.CONFIG, CX = C.WIDTH/2, CY = C.HEIGHT/2;
    const atlas = OLW.Assets?.ready?.('backupGuardAtlas') ? OLW.Assets.images.backupGuardAtlas : null;
    for (const a of A._active.rally) {
      a.guards.forEach((g, index) => {
        const target = a.targets?.[index] || { x: CX, y: CY - 100 };
        const row = atlasDirectionRow(Math.atan2(target.y - g.gy, target.x - g.gx));
        const firing = a.muzzle === index && a.muzzleLife > 0;
        const frame = firing ? (a.muzzleLife>.065 ? 2 : (a.muzzleLife>.025 ? 3 : 4)) : 1;
        // 82 not 59: atlas cells reserve the space below the foot anchor, so the
        // figure fills ~74% of the cell. Sized to stand level with a warden.
        if (atlas) drawAtlasFrame(ctx, atlas, 5, 8, frame, row, g.gx, g.gy, 82, .98);
        else if (OLW.Assets?.ready?.('backupGuard')) { const im=OLW.Assets.images.backupGuard,w=57,h=w*im.naturalHeight/im.naturalWidth; ctx.drawImage(im,g.gx-w/2,g.gy-h*.78,w,h); }
      });
      const bx = (a.guards[0].gx + a.guards[1].gx) / 2;
      const by = Math.max(a.guards[0].gy, a.guards[1].gy) + 27;
      drawFieldLifeBar(ctx, bx, by, 105, a.hp, a.maxHp, '#8ed4f0');
    }
  }

  function drawWarhound(ctx) {
    for (const h of A._active.warhound) {
      if (OLW.Assets?.ready?.('warBeastAtlas')) {
        const atlas = OLW.Assets.images.warBeastAtlas, row = atlasDirectionRow(h.angle || 0);
        const frame = h.pounce > 0 ? (h.pounce > .075 ? 4 : 5) : Math.floor(h.phase * .72) % 4;
        // widened for the same reason as the guards — a war hound should read
        // as a heavy animal, roughly chest-high to a warden
        drawAtlasFrame(ctx, atlas, 6, 8, frame, row, h.x, h.y, h.pounce > 0 ? 118 : 105, .99);
      } else if (OLW.Assets?.ready?.('warBeast')) {
        const im = OLW.Assets.images.warBeast, w = 72, hh = w * im.naturalHeight / im.naturalWidth;
        ctx.drawImage(im, h.x - w / 2, h.y - hh * .76, w, hh);
      }
      drawFieldLifeBar(ctx, h.x, h.y - 30, 58, h.hp, h.maxHp, '#c98a4a');
    }
  }

  function drawDragon(ctx) {
    const C = OLW.CONFIG;
    for (const d of A._active.dragon) {
      // Orbit OVER the field (stays fully on-screen); each dragon has its own phase.
      const ang = (d.phase % 1) * Math.PI * 2;
      const Rx = C.WIDTH * 0.30, Ry = C.HEIGHT * 0.22;
      const x = C.WIDTH / 2 + Math.cos(ang) * Rx;
      const y = C.HEIGHT * 0.40 + Math.sin(ang) * Ry;
      const flip = (-Math.sin(ang)) < 0 ? -1 : 1;

      let frame;
      if (d.breathFlash > 0) {
        const breathProgress = 1 - d.breathFlash / .35;
        frame = 5 + Math.min(2, Math.floor(breathProgress * 3));
      } else if (d.attackAcc > 1.05) {
        frame = 4;
      } else {
        frame = Math.floor((d.phase % 1) * 24) % 4;
      }

      let drawn = false;
      if (OLW.Assets?.ready?.('dragonAtlas')) {
        const atlas = OLW.Assets.images.dragonAtlas;
        ctx.save(); ctx.translate(x, y); ctx.scale(flip, 1);
        drawAtlasFrame(ctx, atlas, 8, 1, frame, 0, 0, 0, 200, .98);
        ctx.restore(); drawn = true;
      } else if (OLW.Assets?.ready?.('dragon')) {
        const im = OLW.Assets.images.dragon;
        const w = 185, h = w * im.naturalHeight / im.naturalWidth;
        ctx.save(); ctx.translate(x, y); ctx.scale(flip, 1);
        ctx.drawImage(im, -w / 2, -h * .72, w, h);
        ctx.restore(); drawn = true;
      }
      if (!drawn) continue;

      if (frame >= 5) {
        const hx = x + flip * 92, hy = y - 24;
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        const g = ctx.createRadialGradient(hx, hy, 0, hx, hy, 70);
        g.addColorStop(0, 'rgba(255,189,78,.36)');
        g.addColorStop(1, 'rgba(255,84,14,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(hx, hy, 70, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }

      drawFieldLifeBar(ctx, x, y + 40, 78, d.hp, d.maxHp, '#ff7412');
    }
  }

  A.drawFieldKit = function (game) {
    if (!game || game.state !== 'playing') return;
    const ctx = game.ctx;
    ctx.save();
    drawBackupTeam(ctx, game);
    drawWarhound(ctx);
    drawDragon(ctx);
    A.drawBlasts(ctx);
    ctx.restore();
  };

  A.install = function () {
    if (!OLW.Game || OLW.Game.__arsenal) return;
    OLW.Game.__arsenal = true;

    const P = OLW.Game.prototype;

    const origReset = P.reset;
    P.reset = function () {
      origReset.call(this);
      A._game = this;
      // EVENT-DAY BUILD: every run starts from a clean economy, independent of
      // whatever the device last synced from the server — so the FIRST player
      // after a page load is as fresh as everyone after them. Level, unlocks,
      // ammo, items and buffs all reset; only display prefs live on elsewhere.
      const p = D.profile;
      p.xp = 0;
      p.unlocked = ['sidearm'];
      p.ammo = {};
      p.items = {};
      p.upgrades = {};
      p.weaponLevels = {};
      p.loadout = 'sidearm';
      A.runCoins = startCoins();
      A._lastLevel = level();   // baseline (1) for live level-up callouts
      A._active = { rally: [], warhound: [], dragon: [] };
      A._lastIntegrity = this.integrity;
      A._runStarted = performance.now();
      if (!D.synced && D.load) D.load();   // ensure the profile is on its way
      A.seedRun();
      A.current = SIDEARM;
      renderBar();
      renderItemBar();
    };

    const origStrikeAt = P.strikeAt;
    P.strikeAt = function (ax, ay, slot) {
      const ready = slot === 2 ? this.player2StrikeCd <= 0 : this.strikeCd <= 0;

      // Both players share the host's active weapon + ammo pool, so a co-op
      // Player 2 fires whatever the host is wielding (auto-swaps to sidearm when
      // the shared weapon runs dry — for whoever pulls the trigger).
      if (ready && !A.current.starter && A.runAmmo(A.current.id) <= 0) {
        A.current = SIDEARM;
        paintWeaponSlots();
      }

      const result = origStrikeAt.call(this, ax, ay, slot);

      if (ready) {
        const w = A.current;
        if (!w.starter) A.consume(w.id, 1);
        // weapon cadence × Rapid Reload upgrade, applied to the firer's cooldown
        const reloadF = 1 - 0.06 * D.upgradeLevel('reload');
        const cd = OLW.CONFIG.STRIKE_COOLDOWN * w.cdMul * reloadF;
        if (slot === 2) { if (this.player2StrikeCd > 0) this.player2StrikeCd = cd; }
        else { if (this.strikeCd > 0) this.strikeCd = cd; this.wardenShotAnim = 0.42; }
        if (result && (w.mode !== 'single' || weaponLevel(w.id) > 0)) A.applyWeaponExtras(this, ax, ay);
        A.weaponImpact(this, ax, ay, !!result);   // per-weapon muzzle + impact
      }

      return result;
    };

    const origUpdate = P.update;
    P.update = function (dt) {
      const killsBefore = this.kills;
      const perfectBefore = this.perfectWaves;
      const mangoBefore = this.mangoGrabbed;

      origUpdate.call(this, dt);

      if (this.state === 'playing') {
        const killDelta = this.kills - killsBefore;
        const perfectDelta = this.perfectWaves - perfectBefore;
        if (killDelta > 0) { A.addRunCoins(killDelta * COIN.kill); A.addRunXp(killDelta * XP.kill); }
        if (perfectDelta > 0) { A.addRunCoins(perfectDelta * COIN.perfect); A.addRunXp(perfectDelta * XP.perfect); }
        if (this.mangoGrabbed > mangoBefore) A.addRunCoins((this.mangoGrabbed - mangoBefore) * COIN.mango);
        // live level-ups: flash the HUD + a short warden callout, and the rails
        // repaint (below) so freshly unlocked weapons switch to a buy price.
        const nowLevel = level();
        if (nowLevel > (A._lastLevel || 1)) {
          A._lastLevel = nowLevel;
          A._flash = 0.6;
          OLW.Voice?.speak?.(`Level ${nowLevel}. New gear available.`);
        }
        if (A._flash > 0) A._flash = Math.max(0, A._flash - dt);
        for (const b of A._blasts) b.life -= dt;
        if (A._blasts.length) A._blasts = A._blasts.filter((b) => b.life > 0);
        A.tickAllies(this, dt);
        updateHud(this);
      }
    };

    const origLanded = P.onRaiderLanded;
    P.onRaiderLanded = function (r) {
      const lvl = D.upgradeLevel('armour');
      if (lvl <= 0) {
        origLanded.call(this, r);
        return;
      }

      const originalDamage = r.dmg;
      r.dmg = Math.max(1, Math.round(originalDamage * (1 - 0.10 * lvl)));
      origLanded.call(this, r);
      r.dmg = originalDamage;
    };

    // Wall Mender upgrade: extra integrity on a perfect (no-damage) wave.
    const origWave = P.waveCleared;
    if (origWave) {
      P.waveCleared = function (wave) {
        const perfect = this.damageThisWave === 0;
        origWave.call(this, wave);
        const wm = D.upgradeLevel('wallMend');
        if (perfect && wm > 0) this.integrity = OLW.U.clamp(this.integrity + 4 * wm, 0, OLW.CONFIG.INTEGRITY_MAX);
      };
    }

    const origRender = P.render;
    P.render = function () {
      origRender.call(this);
      A.drawFieldKit(this);
    };

    const origOver = P.gameOver;
    P.gameOver = function () {
      const was = this.state;
      origOver.call(this);
      if (was !== 'over' && this.state === 'over') A.bankRun(this);
    };
  };

  A.bankRun = function (game) {
    // EVENT-DAY BUILD: nothing to bank. The economy is client-side and
    // run-scoped, and the device is wiped between players on game-over, so there
    // is no persistent stash to credit. The leaderboard score is recorded
    // separately (see main.js recordCompletedWatch), independent of economy.
    // Submitting a run here would only write to a device that is about to be
    // discarded — and applyServerProfile could clobber the fresh reset — so skip.
    A.runCoins = 0;
    hideHud();
  };

  let elCoins;
  let elBar;
  let elItems;
  let elShop;
  let elQuit;
  let elBuy;

  function el(tag, cls, html) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (html != null) node.innerHTML = html;
    return node;
  }

  function buildHud() {
    const stage = document.getElementById('stage');
    if (!stage || elBar) return;

    elCoins = el('div', 'ars-coins hidden', '<span class="ars-lv" id="ars-lv">Lv 1</span><span class="ars-coin-ico">◎</span><b id="ars-coin-val">0</b>');
    stage.appendChild(elCoins);

    // Quick-use lives on the screen EDGES so the play field stays clear:
    // weapons on the left rail, consumables on the right rail. Both are compact
    // icon buttons (icon + shortcut key + count), vertically centred.
    const leftRail = el('div', 'ars-rail ars-rail-left');
    const rightRail = el('div', 'ars-rail ars-rail-right');
    elBar = el('div', 'ars-bar hidden');       // weapons -> left
    elItems = el('div', 'ars-items hidden');    // consumables -> right
    leftRail.appendChild(elBar);
    rightRail.appendChild(elItems);
    stage.appendChild(leftRail);
    stage.appendChild(rightRail);

    elQuit = el('button', 'ghost-btn ars-quit hidden', 'QUIT');
    elQuit.title = 'Abandon the watch (coins are kept)';
    elQuit.onclick = quitToMenu;
    stage.appendChild(elQuit);

    // In-run "full armory" — ammo fills, weapon level-ups and permanent upgrades
    // that don't fit the one-tap rails. Opens without pausing (there is no pause).
    elBuy = el('button', 'ghost-btn ars-buy-open hidden', 'ARMORY ⚒');
    elBuy.title = 'Open the armory — fills & upgrades (the raid keeps coming)';
    elBuy.onclick = openShop;
    stage.appendChild(elBuy);

    renderBar();
    renderItemBar();
  }

  /* ---------- EVENT-DAY quick-buy rails ----------
     Both rails show EVERY weapon (left) and EVERY item (right) at all times. A
     single tap does the sensible next thing:
       weapon: owned+loaded → wield · owned+empty → buy a clip & wield ·
               not owned (level ok) → buy & wield · level-locked → refused
       item:   have some → use · none (level ok) → buy one · locked → refused
     Slots are built ONCE; paint*Slots() updates badges/affordability every frame
     (cheap: text + class on ~11 nodes) so prices, ammo and level gates stay live. */

  function weaponClickAction(w) {
    if (w.starter) { A.equip(w.id); return; }
    if (A.owned(w)) {
      if (A.runAmmo(w.id) > 0) { A.equip(w.id); return; }
      if (buyOne('ammo', w.id, () => OLW.Audio?.hit?.())) A.equip(w.id);   // empty → restock & wield
      return;
    }
    if (level() < weaponMinLevel(w.id)) {
      A.bump(); OLW.Audio?.strike?.();
      OLW.Voice?.speak?.(`${w.name} locked. Reach level ${weaponMinLevel(w.id)}.`);
      return;
    }
    if (buyOne('unlock', w.id)) A.equip(w.id);
  }

  function itemClickAction(c) {
    const have = A._items[c.id] || 0;
    if (have > 0) { A.useItem(c.id); return; }
    if (itemLimit(c) <= 0) { A.bump(); OLW.Audio?.strike?.(); return; }   // level-locked
    buyOne('item', c.id, () => OLW.Audio?.hit?.());
  }

  function renderBar() {
    if (!elBar) return;
    elBar.innerHTML = '';
    for (const w of WEAPONS) {
      const slot = el('button', 'ars-w');
      slot.dataset.wid = w.id;
      slot.innerHTML =
        `<span class="ars-w-key">${w.key}</span>` +
        iconImg(w.id, 'ars-w-ic') +
        `<span class="ars-w-body"><small></small></span>` +
        `<span class="ars-slot-name">${w.name}</span>`;
      slot.title = w.desc;
      slot.onclick = () => weaponClickAction(w);
      elBar.appendChild(slot);
    }
    paintWeaponSlots();
  }

  function paintWeaponSlots() {
    if (!elBar) return;
    const lv = level();
    for (const node of elBar.children) {
      const w = byId(node.dataset.wid);
      const small = node.querySelector('.ars-w-body small');
      let cls = 'ars-w', text = '';
      const owned = A.owned(w);
      if (owned && (w.starter || A.runAmmo(w.id) > 0) && A.current.id === w.id) cls += ' cur';
      if (w.starter) {
        text = '∞';
      } else if (owned) {
        const ammo = A.runAmmo(w.id);
        if (ammo > 0) { text = `${ammo}`; }
        else { cls += ' empty'; text = `◎${w.clipCost}`; if (A.runCoins < w.clipCost) cls += ' unaff'; }
      } else if (lv < weaponMinLevel(w.id)) {
        cls += ' locked'; text = `L${weaponMinLevel(w.id)}`;
      } else {
        cls += ' tobuy'; text = `◎${w.unlockCost}`; if (A.runCoins < w.unlockCost) cls += ' unaff';
      }
      node.className = cls;
      if (small) small.textContent = text;
    }
  }

  function renderItemBar() {
    if (!elItems) return;
    elItems.innerHTML = '';
    for (const c of CONSUMABLES) {
      const slot = el('button', 'ars-item');
      slot.dataset.cid = c.id;
      slot.innerHTML =
        `<span class="ars-item-key">${c.key.toUpperCase()}</span>` +
        iconImg(c.icon || c.id, 'ars-item-ic') +
        `<span class="ars-item-body"><small></small></span>` +
        `<span class="ars-slot-name">${c.name}</span>`;
      slot.title = c.desc;
      slot.onclick = () => itemClickAction(c);
      elItems.appendChild(slot);
    }
    paintItemSlots();
  }

  function paintItemSlots() {
    if (!elItems) return;
    for (const node of elItems.children) {
      const c = conById(node.dataset.cid);
      const small = node.querySelector('.ars-item-body small');
      const have = A._items[c.id] || 0;
      const limit = itemLimit(c);
      let cls = 'ars-item', text = '';
      if (have > 0) {
        text = `×${have}`;
      } else if (limit <= 0) {
        cls += ' locked'; text = `L${Math.ceil(1 / c.perLevel) + 1}`;
      } else {
        cls += ' tobuy'; text = `◎${c.cost}`; if (A.runCoins < c.cost) cls += ' unaff';
      }
      node.className = cls;
      if (small) small.textContent = text;
    }
  }

  // One-tap buy with instant feedback; false when it can't be afforded/allowed.
  function buyOne(kind, id, sound) {
    if (!A.buy(kind, id)) { A.bump(); OLW.Audio?.strike?.(); return false; }
    (sound || OLW.Audio?.mango || function () {})();
    afterBuy();
    return true;
  }

  // Repeat a buy until it stops succeeding (used by the armory "Fill" button).
  function buyFill(kind, id, sound) {
    let n = 0;
    while (A.buy(kind, id)) n++;
    if (!n) { A.bump(); OLW.Audio?.strike?.(); return; }
    (sound || OLW.Audio?.mango || function () {})();
    afterBuy();
  }

  function updateHud(game) {
    if (!elBar) return;

    const show = game.state === 'playing';
    elCoins.classList.toggle('hidden', !show);
    elBar.classList.toggle('hidden', !show);
    elQuit.classList.toggle('hidden', !show);
    elItems.classList.toggle('hidden', !show);
    if (elBuy) elBuy.classList.toggle('hidden', !show);
    if (!show) return;

    document.getElementById('ars-coin-val').textContent = A.runCoins;
    document.getElementById('ars-lv').textContent = `Lv ${level()}`;
    elCoins.classList.toggle('flash', A._flash > 0);

    paintWeaponSlots();
    paintItemSlots();
  }

  function hideHud() {
    // EVENT-DAY: also close the in-run armory so it can't linger over the
    // game-over screen if the wall fell while it was open.
    elShop?.classList.add('hidden');
    [elCoins, elBar, elItems, elQuit, elBuy].forEach((node) => node?.classList.add('hidden'));
  }

  function doQuit() {
    const game = A._game;
    if (!game) return;
    // Quitting a live 1v1 is a FORFEIT — the quitter (host/defender) loses.
    if (game.versus && game.state === 'playing') {
      game._forcedVersusWinner = 'attacker';
      if (OLW.Multiplayer && OLW.Multiplayer.cancelRoom) OLW.Multiplayer.cancelRoom();
      game.gameOver();        // over screen shows "YOU LOSE"; onGameOver records it
      return;
    }
    A.bankRun(game);          // banked coins are kept
    game.stop();
    game.state = 'menu';
    hideHud();
    const menu = document.getElementById('btn-menu');
    if (menu) menu.click();
  }

  let quitModal;
  function hideQuitModal() { if (quitModal) quitModal.style.display = 'none'; }
  function quitToMenu() {
    const game = A._game;
    if (!game) return;
    // No freeze while asking — there is no pause in this game, so the raid
    // keeps coming while the player decides whether to abandon the watch.
    if (!quitModal) {
      quitModal = el('div', 'ars-confirm');
      quitModal.innerHTML =
        `<div class="ars-confirm-box">
          <h3>Abandon the watch?</h3>
          <p>A watch runs until the wall falls — there's no saving mid-run. Quit now and <b>this run is over</b> and won't reach the Watch Roll. (Coins you've already banked are kept.)</p>
          <div class="ars-confirm-actions">
            <button class="primary-btn ars-confirm-yes">Abandon watch</button>
            <button class="secondary-btn ars-confirm-no">Keep playing</button>
          </div>
        </div>`;
      (document.getElementById('stage') || document.body).appendChild(quitModal);
      quitModal.querySelector('.ars-confirm-yes').onclick = () => { hideQuitModal(); doQuit(); };
      quitModal.querySelector('.ars-confirm-no').onclick = () => { hideQuitModal(); };
    }
    quitModal.style.display = 'grid';
  }

  function injectLegacyShopButton() {
    // EVENT-DAY BUILD: no pre-game Armory. The title-screen shop (legacy or
    // #btn-armory-launch) is intentionally NOT created — all buying happens
    // in-run from the side rails. Left as a no-op so callers stay valid.
  }

  function bindExternalArmoryButton() {
    const button = document.getElementById('btn-armory-launch');
    if (!button || button.dataset.armoryBound === '1') return;
    button.dataset.armoryBound = '1';
    button.addEventListener('click', openShop);
  }

  function buildShop() {
    if (elShop) return;
    elShop = el('div', 'ars-shop hidden');
    (document.getElementById('stage') || document.body).appendChild(elShop);
  }

  function row(title, sub, action, icon) {
    return `
      <div class="ars-shop-row">
        <div class="ars-card-art${icon ? '' : ' ars-card-art-generic'}">
          ${icon || '⚒'}
        </div>
        <div class="ars-shop-info">
          <b>${title}</b>
          <small>${sub}</small>
        </div>
        <div class="ars-shop-action">${action}</div>
      </div>`;
  }

  // EVENT-DAY BUILD: the old server-validated "optimistic purchase" queue is
  // gone. All buying is now client-side and run-scoped through A.buy() +
  // buyOne()/buyFill() (defined with the quick-buy rails above), spending the
  // coins earned this run. No /api/purchase round-trips, no stash.

  function renderShop() {
    const p = D.profile;
    const prog = levelProgress(p.xp || 0);
    const lv = prog.L;

    const weaponRows = WEAPONS.map((w) => {
      const icon = iconImg(w.id);

      if (w.starter) {
        return row(`${w.name} <em>${w.tag}</em>`, w.desc, '<span class="ars-tag-owned">∞ ammo</span>', icon);
      }

      if (!D.isUnlocked(w.id)) {
        const need = weaponMinLevel(w.id);
        if (level() < need) {
          return row(
            `${w.name} <em>${w.tag}</em>`,
            `${w.desc} <i>Unlocks at level ${need}.</i>`,
            `<span class="ars-tag-lock">Lv ${need}</span>`,
            icon
          );
        }
        const can = A.runCoins >= w.unlockCost;
        return row(
          `${w.name} <em>${w.tag}</em>`,
          `${w.desc} <i>One-time unlock.</i>`,
          `<button class="ars-buy${can ? '' : ' dis'}" data-unlock="${w.id}">Unlock ◎${w.unlockCost}</button>`,
          icon
        );
      }

      const cap = ammoCap(w);
      const have = A.runAmmo(w.id);
      const full = have >= cap;
      const canAmmo = !full && A.runCoins >= w.clipCost;
      const wl = weaponLevel(w.id);
      const canUp = wl < WUP.max && A.runCoins >= wupCost(wl);
      const ammoBar = `<div class="ars-ammo"><div class="ars-ammo-fill" style="width:${Math.min(100, (have / cap) * 100)}%"></div></div><small>${have}/${cap} rounds${wl > 0 ? ` · Lv ${wl}` : ''}</small>`;
      const clipsToFull = Math.max(1, Math.ceil((cap - have) / w.clip));
      const fillCost = clipsToFull * w.clipCost;
      const ammoBtn = full
        ? '<span class="ars-tag-owned">Full</span>'
        : `<button class="ars-buy${canAmmo ? '' : ' dis'}" data-ammo="${w.id}">+${w.clip} ◎${w.clipCost}</button>`;
      // one-click "buy clips until full" (or as many as affordable)
      const fillBtn = full || clipsToFull <= 1
        ? ''
        : `<button class="ars-buy ars-buy-fill${canAmmo ? '' : ' dis'}" data-fill="${w.id}" title="Buy clips until full">Fill ◎${fillCost}</button>`;
      const upBtn = wl >= WUP.max
        ? '<span class="ars-tag-owned">Lv MAX</span>'
        : `<button class="ars-buy ars-buy-alt${canUp ? '' : ' dis'}" data-wup="${w.id}">Upgrade Lv ${wl + 1} ◎${wupCost(wl)}</button>`;

      return row(
        `${w.name} <em>${w.tag}${wl > 0 ? ` · Lv ${wl}` : ''}</em>`,
        ammoBar,
        `<div class="ars-actions">${ammoBtn}${fillBtn}${upBtn}</div>`,
        icon
      );
    }).join('');

    const consumableRows = CONSUMABLES.map((c) => {
      const icon = iconImg(c.icon || c.id);
      const limit = itemLimit(c);
      const have = A._items[c.id] || 0;

      if (limit <= 0) {
        const neededLevel = Math.ceil(1 / c.perLevel) + 1;
        return row(
          `${c.name} <em>${c.tag}</em>`,
          c.desc,
          `<span class="ars-tag-lock">Unlocks Lv ${neededLevel}</span>`,
          icon
        );
      }

      const full = have >= limit;
      const can = !full && A.runCoins >= c.cost;

      return row(
        `${c.name} <em>${c.tag}</em>`,
        `${c.desc} <i>Carry up to ${limit}.</i>`,
        full
          ? `<span class="ars-tag-owned">${have}/${limit}</span>`
          : `<button class="ars-buy${can ? '' : ' dis'}" data-item="${c.id}">${have}/${limit} · +1 ◎${c.cost}</button>`,
        icon
      );
    }).join('');

    const upgradeRows = UPGRADES.map((u) => {
      const currentLevel = D.upgradeLevel(u.key);
      const cost = upCost(u);
      const maxed = currentLevel >= u.max;
      const can = !maxed && A.runCoins >= cost;

      return row(
  `${u.name} <em>Lv ${currentLevel}/${u.max}</em>`,
  u.desc,
  maxed
    ? '<span class="ars-tag-owned">Max</span>'
    : `<button class="ars-buy${can ? '' : ' dis'}" data-up="${u.key}">◎ ${cost}</button>`,
  iconImg(u.icon)
);
    }).join('');

    elShop.innerHTML = `
      <div class="ars-shop-panel" role="dialog" aria-modal="true" aria-label="Armory">
        <div class="ars-shop-head">
          <div>
            <h2 class="ars-shop-title">Armory</h2>
          </div>

          <span class="ars-shop-right">
            <span class="ars-shop-stash">
              <small>COINS</small>
              <b>◎ ${A.runCoins}</b>
            </span>
            <button class="ars-shop-x" aria-label="Close armory" title="Close">✕</button>
          </span>
        </div>

        <div class="ars-lvbar">
          <span>Level ${lv}</span>
          <div class="ars-lvbar-track"><div style="width:${Math.round((prog.into / prog.need) * 100)}%"></div></div>
          <span class="ars-lvxp">${prog.into}/${prog.need} XP</span>
        </div>

        <p class="ars-shop-sub">Spend the coins you earn this run. The raid does <b>not</b> pause — buy between waves. Quick-buy weapons &amp; gear on the side rails; fills &amp; upgrades here.</p>

        <div class="ars-shop-scroll">
          <h4>Weapons &amp; Ammo</h4>
          ${weaponRows}

          <h4>Field Kit · Z X C V</h4>
          ${consumableRows}

          <h4>Permanent Upgrades</h4>
          ${upgradeRows}
        </div>

        <button class="primary-btn ars-shop-close">Back to outpost</button>
      </div>`;

    elShop.querySelector('.ars-shop-close').onclick = closeShop;
    elShop.querySelector('.ars-shop-x').onclick = closeShop;

    // EVENT-DAY BUILD: instant client-side buys spending this run's coins.
    const buy = (button, kind, id, sound) => {
      if (button.classList.contains('dis')) return;
      buyOne(kind, id, sound);
    };
    elShop.querySelectorAll('[data-unlock]').forEach((b) => { b.onclick = () => buy(b, 'unlock', b.dataset.unlock); });
    elShop.querySelectorAll('[data-ammo]').forEach((b) => { b.onclick = () => buy(b, 'ammo', b.dataset.ammo, () => OLW.Audio?.hit?.()); });
    elShop.querySelectorAll('[data-fill]').forEach((b) => { b.onclick = () => { if (b.classList.contains('dis')) return; buyFill('ammo', b.dataset.fill, () => OLW.Audio?.hit?.()); }; });
    elShop.querySelectorAll('[data-wup]').forEach((b) => { b.onclick = () => buy(b, 'weaponUpgrade', b.dataset.wup); });
    elShop.querySelectorAll('[data-item]').forEach((b) => { b.onclick = () => buy(b, 'item', b.dataset.item, () => OLW.Audio?.hit?.()); });
    elShop.querySelectorAll('[data-up]').forEach((b) => { b.onclick = () => buy(b, 'upgrade', b.dataset.up); });
  }

  
function renderShopPreserveScroll() {
  if (!elShop) return;

  const scroller = elShop.querySelector('.ars-shop-scroll');
  const top = scroller ? scroller.scrollTop : 0;

  renderShop();

  requestAnimationFrame(() => {
    const next = elShop?.querySelector('.ars-shop-scroll');
    if (next) next.scrollTop = top;
  });
}

// EVENT-DAY BUILD: after any buy, repaint the always-visible rails and the coin
  // counter, and (if open) the full armory panel — all from live run state.
  function afterBuy() {
    paintWeaponSlots();
    paintItemSlots();
    const cv = document.getElementById('ars-coin-val');
    if (cv) cv.textContent = A.runCoins;
    if (elShop && !elShop.classList.contains('hidden')) renderShopPreserveScroll();
  }

  function refreshStashLabels() {
    // EVENT-DAY BUILD: no persistent stash / legacy label anymore — no-op kept
    // so existing callers (profilesync, closeShop) stay valid.
  }

  function openShop() {
    buildShop();
    renderShop();
    elShop.classList.remove('hidden');
    OLW.Audio?.resume?.();
  }

  function closeShop() {
    elShop?.classList.add('hidden');
    refreshStashLabels();
  }

  function bindKeys() {
    window.addEventListener('keydown', (event) => {
      if (!A._game || A._game.state !== 'playing') return;

      const weapon = WEAPONS.find((w) => w.key === event.key);
      if (weapon) {
        event.preventDefault();
        A.equip(weapon.id);
        return;
      }

      const item = CONSUMABLES.find((c) => c.key === (event.key || '').toLowerCase());
      if (item) {
        event.preventDefault();
        A.useItem(item.id);
      }
    });

    /* Mouse wheel cycles weapons, GTA style. It only walks weapons you can
       actually fire — owned and not out of ammo — because scrolling onto a dead
       slot mid-raid and hearing "depleted" is worse than skipping it. Wrapping
       both ways means one flick reaches the far end of the list. */
    let wheelAcc = 0, wheelAt = 0;
    window.addEventListener('wheel', (event) => {
      if (!A._game || A._game.state !== 'playing') return;
      // let menus, shop and any scrollable rail keep their own scrolling
      if (event.target && event.target.closest &&
          event.target.closest('.ars-shop, .set-overlay, .ars-rail, #screens')) return;

      const now = performance.now();
      if (now - wheelAt > 260) wheelAcc = 0;   // new flick, not a continuation
      wheelAt = now;
      wheelAcc += event.deltaY;
      // trackpads emit many tiny deltas; require a real notch before switching
      if (Math.abs(wheelAcc) < 40) return;
      const dir = wheelAcc > 0 ? 1 : -1;
      wheelAcc = 0;
      event.preventDefault();
      A.cycleWeapon(dir);
    }, { passive: false });
  }

  function injectCss() {
    if (document.getElementById('ars-css')) return;

    const style = el('style');
    style.id = 'ars-css';
    style.textContent = `
      /* Lv + coins: top-left, tucked just under the wave counter */
      .ars-coins{position:absolute;top:52px;left:clamp(9px,2vmin,17px);transform-origin:left center;z-index:6;display:flex;align-items:center;gap:7px;padding:3px 10px;background:rgba(10,13,18,.82);border:1px solid #4a4436;border-radius:20px;color:var(--gold,#f5c36b);font-weight:900;pointer-events:none;transition:transform .1s}
      .ars-coins.flash{transform:scale(1.14);color:#fff}
      .ars-lv{font-size:10px;letter-spacing:1px;color:#e9dfcb;background:rgba(255,255,255,.08);padding:1px 7px;border-radius:10px}
      .ars-coin-ico{font-size:13px}

      /* quick-use side rails: weapons left, consumables right, vertically centred */
      .ars-rail{position:absolute;top:50%;transform:translateY(-50%);z-index:6;display:flex;flex-direction:column;gap:8px;pointer-events:none;max-height:84vh}
      .ars-rail-left{left:clamp(6px,1.4vmin,14px)}
      .ars-rail-right{right:clamp(6px,1.4vmin,14px)}
      .ars-bar,.ars-items{display:flex;flex-direction:column;gap:8px;pointer-events:auto;overflow-y:auto;overflow-x:hidden;max-height:84vh;scrollbar-width:none}
      .ars-bar::-webkit-scrollbar,.ars-items::-webkit-scrollbar{display:none}

      /* square icon buttons; key badge top-left, count badge bottom-right */
      .ars-w,.ars-item{position:relative;width:clamp(48px,7vmin,64px);height:clamp(48px,7vmin,64px);display:grid;place-items:center;padding:0;background:rgba(10,13,18,.85);border:1px solid #3b3b44;color:#e9dfcb;cursor:pointer;border-radius:10px;transition:.12s}
      .ars-w:hover{border-color:#8a8270}
      .ars-w.cur{border-color:var(--amber,#e8a13a);box-shadow:0 0 14px rgba(232,161,58,.35);background:rgba(40,32,16,.9)}
      .ars-w.empty{opacity:.5}
      .ars-w.empty .ars-w-body small{color:#c5543f;border-color:#c5543f}
      .ars-item{background:rgba(18,14,20,.85);border-color:#4a3b52}
      .ars-item:hover{border-color:#b07fd0}
      .ars-w-ic,.ars-item-ic{width:74%;height:74%;object-fit:contain}
      .ars-w-key,.ars-item-key{position:absolute;top:-6px;left:-6px;z-index:2;display:grid;place-items:center;width:18px;height:18px;font-size:10px;font-weight:900;border-radius:5px;background:rgba(10,13,18,.96);border:1px solid #6c6457}
      .ars-item-key{border-color:#7a6c86}
      .ars-w-body,.ars-item-body{position:absolute;right:-6px;bottom:-6px;z-index:2}
      .ars-w-body small,.ars-item-body small{display:block;min-width:20px;height:17px;padding:0 5px;line-height:15px;text-align:center;font-size:10px;font-weight:900;border-radius:9px;background:rgba(10,13,18,.96);border:1px solid #4a4436;color:var(--gold,#f5c36b)}
      .ars-item-body small{border-color:#4a3b52;color:#d8b8ee}
      /* the icons are small — reveal the full name as a flyout on hover */
      .ars-slot-name{position:absolute;top:50%;transform:translateY(-50%);white-space:nowrap;padding:5px 10px;font-size:12px;font-weight:800;letter-spacing:.3px;color:#f0e6d2;background:rgba(10,13,18,.97);border:1px solid #5a5344;border-radius:7px;opacity:0;pointer-events:none;transition:opacity .1s;z-index:30;box-shadow:0 6px 18px rgba(0,0,0,.5)}
      .ars-rail-left .ars-slot-name{left:calc(100% + 9px)}
      .ars-rail-right .ars-slot-name{right:calc(100% + 9px)}
      .ars-item .ars-slot-name{border-color:#6b5a78}
      .ars-w:hover .ars-slot-name,.ars-item:hover .ars-slot-name{opacity:1}

      /* EVENT-DAY quick-buy rail states. tobuy = affordable purchase (green tint);
         unaff = shown but can't afford yet (dim, amber price); locked = level gate. */
      .ars-w.tobuy,.ars-item.tobuy{border-color:#6f8a4a;box-shadow:0 0 10px rgba(143,174,92,.28)}
      .ars-w.tobuy .ars-w-body small,.ars-item.tobuy .ars-item-body small{color:#0d1a07;background:linear-gradient(180deg,#bfe08a,#8fae5c);border-color:#6f8a4a}
      .ars-w.unaff,.ars-item.unaff{opacity:.5}
      .ars-w.unaff .ars-w-body small,.ars-item.unaff .ars-item-body small{color:#e9c07a;background:rgba(10,13,18,.96);border-color:#6a5a3a}
      .ars-w.locked,.ars-item.locked{opacity:.4;filter:grayscale(.5)}
      .ars-w.locked .ars-w-body small,.ars-item.locked .ars-item-body small{color:#c9c1b0;background:rgba(10,13,18,.96);border-color:#4a4638}

      .ars-quit{right:96px!important;left:auto;bottom:15px;padding:0 12px;z-index:8}
      /* Stacked just ABOVE the QUIT button on the bottom-RIGHT, clear of the
         wall-integrity readout that lives bottom-left (.hud-bottom). */
      .ars-buy-open{right:96px!important;left:auto;bottom:56px;padding:0 12px;z-index:8;color:var(--gold,#f5c36b);border-color:#6a5a3a}
      .ars-buy-open:hover{border-color:var(--amber,#e8a13a)}

      .ars-shop{position:absolute;inset:0;z-index:70;display:grid;place-items:center;padding:clamp(8px,2vmin,22px);background:rgba(4,6,9,.88);backdrop-filter:blur(9px)}
      .ars-shop-panel{width:min(760px,96vw);height:min(760px,94dvh);max-height:calc(100dvh - 18px);display:flex;flex-direction:column;overflow:hidden;padding:clamp(15px,2.5vmin,28px);border:1px solid rgba(255,255,255,.11);border-radius:7px;background:linear-gradient(155deg,rgba(34,39,47,.99),rgba(11,14,19,.995));box-shadow:0 30px 100px rgba(0,0,0,.7)}
      .ars-shop-head{display:flex;justify-content:space-between;align-items:center;gap:14px;flex:none}
      .ars-shop-title{margin:3px 0 0;font-family:Georgia,serif;font-size:clamp(25px,4vmin,36px)}
      .ars-shop-right{display:flex;align-items:center;gap:12px}
      .ars-shop-stash{display:flex;flex-direction:column;align-items:flex-end;line-height:1.1}
      .ars-shop-stash small{color:#9e988b;font-size:7px;font-weight:900;letter-spacing:1.5px}.ars-shop-stash b{margin-top:4px;color:var(--gold,#f5c36b);font-size:15px}
      .ars-shop-x{width:32px;height:32px;display:grid;place-items:center;flex:none;border:1px solid #4a4638;background:rgba(10,13,18,.7);color:#e9dfcb;font-size:14px;cursor:pointer;border-radius:6px;line-height:1}
      .ars-shop-x:hover{border-color:#c5543f;color:#f2a295}
      .ars-lvbar{display:flex;align-items:center;gap:10px;margin-top:12px;font-size:11px;color:#c9c1b0;flex:none}
      .ars-lvbar-track{flex:1;height:6px;background:rgba(255,255,255,.08);border-radius:3px;overflow:hidden}.ars-lvbar-track div{height:100%;background:linear-gradient(90deg,#f5c36b,#e8a13a)}
      .ars-lvxp{color:#9e988b}.ars-shop-sub{margin:10px 0 12px;color:#9e988b;font-size:12px;flex:none}
      .ars-shop-scroll{flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding-right:3px;scrollbar-width:thin;scrollbar-color:#645137 transparent}
      .ars-shop-scroll h4{margin:14px 0 8px;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:var(--amber,#e8a13a)}

      .ars-shop-row{position:relative;display:grid;grid-template-columns:82px minmax(0,1fr) auto;align-items:center;gap:13px;min-height:91px;margin-bottom:8px;padding:8px 10px 8px 8px;overflow:hidden;border:1px solid rgba(255,255,255,.07);background:linear-gradient(110deg,rgba(255,255,255,.055),rgba(255,255,255,.015));transition:border-color .15s ease,transform .15s ease,background .15s ease}
      .ars-shop-row::after{content:"";position:absolute;inset:auto 0 0 0;height:1px;opacity:.35;background:linear-gradient(90deg,transparent,var(--amber,#e8a13a),transparent)}
      .ars-shop-row:hover{transform:translateY(-1px);border-color:rgba(232,161,58,.32);background:linear-gradient(110deg,rgba(232,161,58,.075),rgba(255,255,255,.018))}
      .ars-card-art{position:relative;width:82px;height:72px;overflow:hidden;display:grid;place-items:center;border:1px solid rgba(255,255,255,.08);background:radial-gradient(circle at 50% 50%,rgba(232,161,58,.11),rgba(7,9,13,.8))}
      .ars-card-art::after{content:"";position:absolute;inset:0;pointer-events:none;box-shadow:inset 0 0 22px rgba(0,0,0,.55)}
      .ars-card-art .ars-ic{width:100%;height:100%;object-fit:cover;transition:transform .2s ease}.ars-shop-row:hover .ars-card-art .ars-ic{transform:scale(1.045)}
      .ars-card-art-generic{color:var(--amber,#e8a13a);font-size:24px}
      .ars-shop-info{min-width:0}.ars-shop-info>b{display:block;color:#ede5d5;font-size:13px}.ars-shop-info em{font-style:normal;color:var(--amber,#e8a13a);font-size:10px;letter-spacing:1px;margin-left:4px}.ars-shop-info i{color:#9e988b;font-style:normal}.ars-shop-info small{display:block;margin-top:5px;color:#9e988b;font-size:10px;line-height:1.4}
      .ars-shop-action{display:flex;justify-content:flex-end;min-width:86px}.ars-tag-lock{font-size:11px;font-weight:800;color:#9e988b;white-space:nowrap}.ars-tag-owned{font-size:11px;font-weight:800;color:var(--green,#8fae5c);white-space:nowrap}
      .ars-ammo{height:5px;background:rgba(255,255,255,.1);border-radius:3px;overflow:hidden;margin-bottom:3px;max-width:180px}.ars-ammo-fill{height:100%;background:var(--amber,#e8a13a)}
      .ars-actions{display:flex;flex-direction:column;gap:5px;align-items:flex-end}
      .ars-buy-alt{background:linear-gradient(180deg,#8ec3f5,#3a78c4)!important;color:#0b1626!important}
      .ars-buy-fill{background:linear-gradient(180deg,#9ad48b,#4f9a37)!important;color:#0d1a07!important}
      .ars-confirm{position:absolute;inset:0;z-index:50;display:none;place-items:center;background:rgba(4,6,9,.74);backdrop-filter:blur(3px)}
      .ars-confirm-box{width:min(430px,90%);padding:24px;background:linear-gradient(165deg,rgba(40,44,50,.98),rgba(14,18,24,.99));border:1px solid #3b3b44;text-align:center;color:#e9dfcb;box-shadow:0 24px 70px rgba(0,0,0,.6)}
      .ars-confirm-box h3{margin:0 0 10px;font-size:21px;color:#f2d9a6}
      .ars-confirm-box p{margin:0 0 18px;font-size:13px;color:#c9c1b0;line-height:1.55}
      .ars-confirm-actions{display:flex;gap:10px;justify-content:center;flex-wrap:wrap}
      .ars-buy{border:0;cursor:pointer;font-weight:900;color:#231708;background:linear-gradient(180deg,#f5c36b,#e8a13a);padding:8px 12px;border-radius:3px;white-space:nowrap}.ars-buy.dis{opacity:.4;cursor:not-allowed;filter:grayscale(.6)}
      .ars-shop-close{flex:none;margin-top:14px}

      @media(max-width:650px){
        .ars-rail{gap:6px}.ars-bar,.ars-items{gap:6px}.ars-w,.ars-item{width:44px;height:44px;border-radius:8px}
        .ars-shop{padding:0}.ars-shop-panel{width:100vw;height:100dvh;max-height:none;border:0;border-radius:0;padding:14px}
        .ars-shop-row{grid-template-columns:68px minmax(0,1fr);min-height:78px}.ars-card-art{width:68px;height:62px}.ars-shop-action{grid-column:2;justify-content:flex-start;width:100%}.ars-buy{width:100%;padding:8px}
      }

      @media(max-height:540px) and (orientation:landscape){
        .ars-rail,.ars-bar,.ars-items{gap:5px;max-height:90vh}
        .ars-w,.ars-item{width:38px;height:38px}
        .ars-w-key,.ars-item-key{width:15px;height:15px;font-size:8px}
        .ars-w-body small,.ars-item-body small{min-width:16px;height:14px;line-height:12px;font-size:8px}
        .ars-shop{padding:5px}.ars-shop-panel{width:min(920px,98vw);height:calc(100dvh - 10px);padding:11px 14px}.ars-shop-title{font-size:22px}.ars-shop-sub{margin:5px 0 7px;font-size:9px}.ars-lvbar{margin-top:6px}
        .ars-shop-row{min-height:65px;grid-template-columns:62px 1fr auto}.ars-card-art{width:62px;height:52px}.ars-shop-scroll h4{margin:8px 0 5px}.ars-shop-close{margin-top:7px;padding:8px}
      }
    `;

    document.head.appendChild(style);
  }

  A.init = function () {
    injectCss();
    buildHud();
    bindKeys();
    A.install();
    bindExternalArmoryButton();

    // Robust fallback: always open the Armory on click, even if the launcher
    // button was (re)rendered after the direct binding ran.
    document.addEventListener('click', (e) => {
      const t = e.target;
      if (t && t.closest && t.closest('#btn-armory-launch')) { e.preventDefault(); openShop(); }
    });

    window.addEventListener('olw:profilesync', () => {
      // if the profile arrived just after a run started, re-seed so the player
      // gets the weapons/ammo they actually own (fixes "armory not loaded yet")
      if (A._game && A._game.state === 'playing' && (performance.now() - (A._runStarted || 0)) < 1800) {
        A.seedRun();
      }
      A.current = byId(D.profile.loadout);
      if (!A.owned(A.current)) A.current = SIDEARM;
      renderBar();
      renderItemBar();
      refreshStashLabels();
      bindExternalArmoryButton();
      if (elShop && !elShop.classList.contains('hidden')) renderShopPreserveScroll();
    });
  };

  A.open = openShop;
  A.close = closeShop;
  A.isOpen = () => Boolean(elShop && !elShop.classList.contains('hidden'));

  A.init();
  return A;
})();
