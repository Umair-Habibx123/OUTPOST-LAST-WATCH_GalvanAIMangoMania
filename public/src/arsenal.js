// src/arsenal.js
/* Weapons, ammo, coins, levels, and the Armory — an additive layer over the game.

   Multi-dev safe: never rewrites Game.strikeAt (the teammate's shared P1/P2 fire
   method). It WRAPS reset/strikeAt/update/gameOver and builds its own HUD + shop.

   Economy:
   - START with the Sidearm: infinite ammo, always owned.
   - Other guns are ONE-TIME unlocks (stash). Each has its own limited ammo,
     bought in clips in the Armory (pre-run) and consumed per shot in a run.
     Out of ammo -> auto-fallback to the Sidearm.
   - You CANNOT buy during play — the in-run bar only SELECTS owned guns.
   - LEVEL (persistent, from XP) raises ammo caps and a little item power.
   - Coins earned in a run bank to the persistent stash at game over. */
window.OLW = window.OLW || {};

OLW.Arsenal = (function () {
  const D = OLW.Device;

  // ---- weapon catalogue ----
  const WEAPONS = [
    { id: 'sidearm', key: '1', name: 'Sidearm', tag: 'Standard', starter: true,
      unlockCost: 0, cdMul: 1.0, mode: 'single',
      desc: 'Old service pistol. Endless rounds, modest bite.' },
    { id: 'repeater', key: '2', name: 'Repeater', tag: 'Rapid',
      unlockCost: 220, cdMul: 0.5, mode: 'single',
      ammoBase: 40, ammoPerLevel: 8, clip: 20, clipCost: 40,
      desc: 'Double fire-rate. Shreds single targets — feed it rounds.' },
    { id: 'scattergun', key: '3', name: 'Scattergun', tag: 'Spread',
      unlockCost: 400, cdMul: 1.5, mode: 'spread', spread: 3, radius: 78,
      ammoBase: 24, ammoPerLevel: 5, clip: 10, clipCost: 45,
      desc: 'Strikes up to 3 nearby raiders. Crowd control.' },
    { id: 'cannon', key: '4', name: 'Siege Cannon', tag: 'Heavy',
      unlockCost: 650, cdMul: 2.3, mode: 'aoe', radius: 66, punch: 3,
      ammoBase: 12, ammoPerLevel: 3, clip: 5, clipCost: 60,
      desc: 'Heavy splash. One-shots armoured raiders. Rare, precious shells.' },
    { id: 'mortar', key: '5', name: 'Mortar', tag: 'Artillery',
      unlockCost: 900, cdMul: 2.7, mode: 'aoe', radius: 104, punch: 2,
      ammoBase: 8, ammoPerLevel: 2, clip: 4, clipCost: 80,
      desc: 'Lobs a shell — massive blast radius, slow reload.' },
    { id: 'tesla', key: '6', name: 'Tesla Coil', tag: 'Chain',
      unlockCost: 1100, cdMul: 1.2, mode: 'chain', chain: 4, radius: 150,
      ammoBase: 30, ammoPerLevel: 6, clip: 12, clipCost: 55,
      desc: 'An arc leaps between nearby raiders.' },
  ];
  const byId = (id) => WEAPONS.find(w => w.id === id) || WEAPONS[0];
  const SIDEARM = WEAPONS[0];

  const UPGRADES = [
    { key: 'armour', name: 'Warden Armour', max: 4, cost: [200, 400, 700, 1100], desc: '-10% wall damage taken per level.' },
    { key: 'coinGain', name: 'Coin Runners', max: 3, cost: [150, 300, 500], desc: '+15% coins earned per level.' },
    { key: 'startCoins', name: 'War Chest', max: 3, cost: [120, 240, 400], desc: '+80 starting run-coins per level.' },
  ];
  const upCost = (u) => u.cost[D.upgradeLevel(u.key)] || null;

  // ---- consumables / allies (bought pre-run, used in-run; limits rise with level) ----
  const CONSUMABLES = [
    { id: 'supply', key: 'z', name: 'Supply Line', tag: 'Repair', cost: 60, base: 1, perLevel: 0.5,
      desc: 'Restores +28 wall integrity instantly.' },
    { id: 'rally', key: 'x', name: 'Backup Team', tag: 'Allies', cost: 120, base: 1, perLevel: 0.34,
      desc: 'Allied guards auto-fire on the nearest breach for 10s.' },
    { id: 'warhound', key: 'c', name: 'War Beast', tag: 'Beast', cost: 160, base: 1, perLevel: 0.25,
      desc: 'A beast hunts raiders across the field for 12s.' },
    { id: 'dragon', key: 'v', name: 'Dragon Strike', tag: 'Ultimate', cost: 300, base: 0, perLevel: 0.2,
      desc: 'A dragon scorches the field — clears nearby raiders.' },
  ];
  const conById = (id) => CONSUMABLES.find(c => c.id === id);
  function itemLimit(c) { return Math.floor(c.base + (level() - 1) * c.perLevel); }

  // Optional art: assets/art/icons/<id>.png. Missing files just remove themselves,
  // so the text/key layout stays intact until icons are dropped in.
  const iconImg = (id, cls) => `<img class="${cls || 'ars-ic'}" src="assets/art/icons/${id}.png" onerror="this.remove()" alt="">`;

  const COIN = { kill: 8, perfect: 50, mango: 30 };

  // ---- level / xp ----
  const MAX_LEVEL = 20;
  function xpToAdvance(L) { return 150 * L; }          // xp to go from L -> L+1
  function levelFromXp(xp) {
    let L = 1, need = 0;
    while (L < MAX_LEVEL) { need += xpToAdvance(L); if (xp < need) break; L++; }
    return L;
  }
  function levelProgress(xp) {
    let L = 1, floor = 0;
    while (L < MAX_LEVEL) { const step = xpToAdvance(L); if (xp < floor + step) return { L, into: xp - floor, need: step }; floor += step; L++; }
    return { L: MAX_LEVEL, into: 1, need: 1 };
  }
  function level() { return levelFromXp(D.profile.xp || 0); }

  function ammoCap(w) {
    if (w.starter) return Infinity;
    const lv = level();
    return (w.ammoBase || 0) + (lv - 1) * (w.ammoPerLevel || 0);
  }

  const A = {
    WEAPONS, UPGRADES, CONSUMABLES,
    current: SIDEARM,
    runCoins: 0,
    _run: {},        // live ammo during a run: { gunId: rounds }
    _items: {},      // live consumables during a run: { itemId: count }
    _active: {},     // active ally timers: { rally:{left,acc}, warhound:{left,acc} }
    _flash: 0,
    _game: null,
  };

  function coinMult() { return 1 + 0.15 * D.upgradeLevel('coinGain'); }
  function startCoins() { return 80 * D.upgradeLevel('startCoins'); }

  A.owned = (w) => w.starter || D.isUnlocked(w.id);
  A.runAmmo = (id) => (byId(id).starter ? Infinity : (A._run[id] || 0));
  A.consume = (id, n) => { if (!byId(id).starter) A._run[id] = Math.max(0, (A._run[id] || 0) - n); };

  // In-run: SELECT an owned gun (no buying).
  A.equip = function (id) {
    const w = byId(id);
    if (!A.owned(w)) { A.bump(); return false; }
    if (!w.starter && A.runAmmo(id) <= 0) { A.bump(); OLW.Audio && OLW.Audio.strike(); return false; }
    A.current = w;
    D.patch({ loadout: id });
    OLW.Audio && OLW.Audio.hit();
    renderBar();
    return true;
  };

  A.addRunCoins = function (n) { A.runCoins += Math.round(n * coinMult()); };
  A.bump = function () { A._flash = 0.5; };
  A.level = level;

  /* ---------- firing behaviours ---------- */
  A.applyWeaponExtras = function (game, ax, ay) {
    const C = OLW.CONFIG, U = OLW.U, COL = OLW.COLORS;
    const w = A.current, lv = level();
    if (w.mode === 'spread') {
      const count = w.spread + (lv >= 8 ? 1 : 0);
      const near = game.raiders
        .filter(r => r.alive && U.dist(ax, ay, r.x, r.y) < w.radius)
        .sort((p, q) => U.dist(ax, ay, p.x, p.y) - U.dist(ax, ay, q.x, q.y))
        .slice(0, count);
      for (const r of near) {
        game.fireBolt(r.x, r.y, false, 1);
        const killed = r.strike();
        if (killed) { game.kills++; game.bonusScore += C.SCORE_PER_KILL; game.spawnSparks(r.x, r.y, COL.parchment, 6); }
        else game.spawnSparks(r.x, r.y, r.rim, 3);
      }
    } else if (w.mode === 'aoe') {
      const punch = w.punch + Math.floor(lv / 6);
      const inR = game.raiders.filter(r => r.alive && U.dist(ax, ay, r.x, r.y) < w.radius);
      for (const r of inR) {
        let hits = punch;
        while (hits-- > 0 && r.alive) { const killed = r.strike(); if (killed) { game.kills++; game.bonusScore += C.SCORE_PER_KILL; } }
        game.spawnSparks(r.x, r.y, COL.torch, 7, 200);
      }
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * U.TAU;
        game.effects.push(new OLW.Particle(ax + Math.cos(a) * 6, ay + Math.sin(a) * 6, COL.torchCore,
          { angle: a, speed: U.rand(120, 200), life: 0.3, r: U.rand(1.5, 3) }));
      }
      game.shake = Math.min(12, game.shake + 4);
    } else if (w.mode === 'chain') {
      // arc leaps from the aim point to the nearest raider, then hops onward
      const links = w.chain + (lv >= 10 ? 1 : 0);
      const hit = new Set();
      let fx = ax, fy = ay;
      for (let i = 0; i < links; i++) {
        let best = null, bd = w.radius;
        for (const r of game.raiders) {
          if (!r.alive || hit.has(r)) continue;
          const d = U.dist(fx, fy, r.x, r.y);
          if (d < bd) { bd = d; best = r; }
        }
        if (!best) break;
        hit.add(best);
        game.bolts.push({ x1: fx, y1: fy, x2: best.x, y2: best.y, life: 0.12, max: 0.12, playerSlot: 2 });
        const killed = best.strike();
        if (killed) { game.kills++; game.bonusScore += C.SCORE_PER_KILL; game.spawnSparks(best.x, best.y, '#8ed4f0', 6); }
        else game.spawnSparks(best.x, best.y, '#8ed4f0', 3);
        fx = best.x; fy = best.y;
      }
    }
  };

  /* ---------- consumables / allies ---------- */
  A.useItem = function (id) {
    const g = A._game;
    if (!g || g.state !== 'playing') return false;
    if ((A._items[id] || 0) <= 0) { A.bump(); OLW.Audio && OLW.Audio.strike(); return false; }
    A._items[id] -= 1;
    const C = OLW.CONFIG, U = OLW.U, COL = OLW.COLORS, CX = C.WIDTH / 2, CY = C.HEIGHT / 2;

    if (id === 'supply') {
      const before = g.integrity;
      g.integrity = U.clamp(g.integrity + 28, 0, C.INTEGRITY_MAX);
      const healed = Math.round(g.integrity - before);
      g.addFloater(CX, CY - C.WALL_RADIUS - 26, healed > 0 ? `SUPPLY +${healed}` : 'SUPPLY', COL.mango, 18);
      g.spawnSparks(CX, CY, COL.mango, 18, 200);
      OLW.Audio && OLW.Audio.mango();
    } else if (id === 'rally') {
      A._active.rally = { left: 10, acc: 0 };
      g.addFloater(CX, CY - 110, 'BACKUP TEAM DEPLOYED', '#8ed4f0', 18);
      OLW.Audio && OLW.Audio.waveStart();
    } else if (id === 'warhound') {
      A._active.warhound = { left: 12, acc: 0 };
      g.addFloater(CX, CY - 110, 'WAR BEAST UNLEASHED', '#c98a4a', 18);
      OLW.Audio && OLW.Audio.waveStart();
    } else if (id === 'dragon') {
      let hit = 0;
      for (const r of g.raiders) {
        if (r.alive && U.dist(r.x, r.y, CX, CY) < 320) {
          r.hp = 1; if (r.strike()) { hit++; g.kills++; g.bonusScore += C.SCORE_PER_KILL; g.spawnSparks(r.x, r.y, '#ff7412', 10, 260); }
        }
      }
      for (let i = 0; i < 40; i++) {
        const a = U.rand(0, U.TAU), rad = U.rand(30, 300);
        g.effects.push(new OLW.Particle(CX + Math.cos(a) * rad, CY + Math.sin(a) * rad, '#ff7412',
          { angle: a, speed: U.rand(60, 180), life: U.rand(0.4, 0.9), r: U.rand(2, 4) }));
      }
      g.shake = 16;
      g.addFloater(CX, CY - 120, `DRAGON STRIKE  +${hit * C.SCORE_PER_KILL}`, '#ff7412', 20);
      OLW.Audio && OLW.Audio.volley();
    }
    renderItemBar();
    return true;
  };

  // ally auto-attacks, ticked from the update wrap while active
  A.tickAllies = function (game, dt) {
    const U = OLW.U, C = OLW.CONFIG, COL = OLW.COLORS, CX = C.WIDTH / 2, CY = C.HEIGHT / 2;
    const doKill = (pickWall, color) => {
      let best = null, bd = Infinity;
      for (const r of game.raiders) {
        if (!r.alive) continue;
        const d = pickWall ? U.dist(r.x, r.y, CX, CY) : U.dist(game.aim.x, game.aim.y, r.x, r.y);
        if (d < bd) { bd = d; best = r; }
      }
      if (best) {
        game.bolts.push({ x1: CX, y1: CY, x2: best.x, y2: best.y, life: 0.12, max: 0.12, playerSlot: 2 });
        if (best.strike()) { game.kills++; game.bonusScore += C.SCORE_PER_KILL; game.spawnSparks(best.x, best.y, color, 6); }
      }
    };
    const a = A._active;
    if (a.rally) {
      a.rally.left -= dt; a.rally.acc += dt;
      while (a.rally.acc >= 0.5) { a.rally.acc -= 0.5; doKill(true, '#8ed4f0'); }
      if (a.rally.left <= 0) a.rally = null;
    }
    if (a.warhound) {
      a.warhound.left -= dt; a.warhound.acc += dt;
      while (a.warhound.acc >= 0.8) { a.warhound.acc -= 0.8; doKill(false, '#c98a4a'); }
      if (a.warhound.left <= 0) a.warhound = null;
    }
  };

  /* ---------- wrap Game ---------- */
  A.install = function () {
    if (!OLW.Game || OLW.Game.__arsenal) return;
    OLW.Game.__arsenal = true;
    const P = OLW.Game.prototype;

    const origReset = P.reset;
    P.reset = function () {
      origReset.call(this);
      A._game = this;
      A.runCoins = startCoins();
      // seed live ammo from the stored (bought) balance
      A._run = {};
      for (const w of WEAPONS) if (!w.starter) A._run[w.id] = Math.min(D.profile.ammo[w.id] || 0, ammoCap(w));
      A._items = {};
      for (const c of CONSUMABLES) A._items[c.id] = Math.min(D.profile.items[c.id] || 0, itemLimit(c) || 0);
      A._active = {};
      A.current = SIDEARM;   // always start on the infinite sidearm
      A._k = this.kills;
      renderBar();
      renderItemBar();
    };

    const origStrikeAt = P.strikeAt;
    P.strikeAt = function (ax, ay, slot) {
      const ready = slot === 2 ? this.player2StrikeCd <= 0 : this.strikeCd <= 0;
      // ammo gate: empty non-starter gun falls back to the sidearm before firing
      if (slot !== 2 && ready && !A.current.starter && A.runAmmo(A.current.id) <= 0) {
        A.current = SIDEARM; renderBar();
      }
      const res = origStrikeAt.call(this, ax, ay, slot);
      if (slot !== 2 && ready) {
        const w = A.current;
        if (!w.starter) A.consume(w.id, 1);
        if (w.cdMul !== 1 && this.strikeCd > 0) this.strikeCd = OLW.CONFIG.STRIKE_COOLDOWN * w.cdMul;
        if (res && w.mode !== 'single') A.applyWeaponExtras(this, ax, ay);
      }
      return res;
    };

    const origUpdate = P.update;
    P.update = function (dt) {
      const k0 = this.kills, pw0 = this.perfectWaves, mg0 = this.mangoGrabbed;
      origUpdate.call(this, dt);
      if (this.state === 'playing') {
        const dk = this.kills - k0;
        if (dk > 0) A.addRunCoins(dk * COIN.kill);
        if (this.perfectWaves > pw0) A.addRunCoins((this.perfectWaves - pw0) * COIN.perfect);
        if (this.mangoGrabbed > mg0) A.addRunCoins((this.mangoGrabbed - mg0) * COIN.mango);
        if (A._flash > 0) A._flash = Math.max(0, A._flash - dt);
        A.tickAllies(this, dt);
        updateHud(this);
      }
    };

    // Warden Armour reduces the wall damage a raider deals when it lands.
    const origLanded = P.onRaiderLanded;
    P.onRaiderLanded = function (r) {
      const lvl = D.upgradeLevel('armour');
      if (lvl > 0) {
        const orig = r.dmg;
        r.dmg = Math.max(1, Math.round(orig * (1 - 0.10 * lvl)));
        origLanded.call(this, r);
        r.dmg = orig;
      } else {
        origLanded.call(this, r);
      }
    };

    const origOver = P.gameOver;
    P.gameOver = function () {
      const was = this.state;
      origOver.call(this);
      if (was !== 'over' && this.state === 'over') A.bankRun(this);
    };
  };

  // Bank coins, spend ammo, award XP/level. Called on game over AND on quit.
  A.bankRun = function (game) {
    D.addStash(A.runCoins);
    // write live ammo + consumables back so consumption persists
    for (const w of WEAPONS) if (!w.starter) D.profile.ammo[w.id] = A._run[w.id] || 0;
    for (const c of CONSUMABLES) D.profile.items[c.id] = A._items[c.id] || 0;
    const gained = Math.round((game.score || 0) / 8) + (game.kills || 0) * 2;
    const before = level();
    D.patch({ xp: (D.profile.xp || 0) + gained, level: levelFromXp((D.profile.xp || 0) + gained) });
    D.rememberBest(game.score || 0);
    A.runCoins = 0;
    hideHud();
    A._lastXp = gained;
    A._leveledTo = level() > before ? level() : 0;
  };

  /* ---------- HUD ---------- */
  let elCoins, elBar, elItems, elShop, elQuit;
  function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }

  function buildHud() {
    const stage = document.getElementById('stage');
    if (!stage || elBar) return;

    elCoins = el('div', 'ars-coins hidden',
      '<span class="ars-lv" id="ars-lv">Lv 1</span><span class="ars-coin-ico">◎</span><b id="ars-coin-val">0</b>');
    stage.appendChild(elCoins);

    elBar = el('div', 'ars-bar hidden');
    stage.appendChild(elBar);
    renderBar();

    elItems = el('div', 'ars-items hidden');
    stage.appendChild(elItems);
    renderItemBar();

    elQuit = el('button', 'ghost-btn ars-quit hidden', 'QUIT');
    elQuit.title = 'Abandon the watch (coins are kept)';
    elQuit.onclick = quitToMenu;
    stage.appendChild(elQuit);

    injectShopButton();
  }

  function renderBar() {
    if (!elBar) return;
    elBar.innerHTML = '';
    for (const w of WEAPONS) {
      if (!A.owned(w)) continue;                 // only owned guns show in-run
      const cur = A.current.id === w.id;
      const ammo = w.starter ? '∞' : A.runAmmo(w.id);
      const empty = !w.starter && A.runAmmo(w.id) <= 0;
      const slot = el('button', 'ars-w' + (cur ? ' cur' : '') + (empty ? ' empty' : ''));
      slot.innerHTML =
        `<span class="ars-w-key">${w.key}</span>` +
        iconImg(w.id, 'ars-w-ic') +
        `<span class="ars-w-body"><b>${w.name}</b><small>${w.starter ? w.tag : ('▮ ' + ammo)}</small></span>`;
      slot.title = w.desc;
      slot.onclick = () => A.equip(w.id);
      elBar.appendChild(slot);
    }
  }

  function renderItemBar() {
    if (!elItems) return;
    elItems.innerHTML = '';
    for (const c of CONSUMABLES) {
      const count = A._items[c.id] || 0;
      if (count <= 0) continue;                  // only carry what you bought
      const slot = el('button', 'ars-item' + (count <= 0 ? ' empty' : ''));
      slot.innerHTML =
        `<span class="ars-item-key">${c.key.toUpperCase()}</span>` +
        iconImg(c.id, 'ars-item-ic') +
        `<span class="ars-item-body"><b>${c.name}</b><small>×${count}</small></span>`;
      slot.title = c.desc;
      slot.onclick = () => A.useItem(c.id);
      elItems.appendChild(slot);
    }
    elItems.classList.toggle('is-empty', elItems.children.length === 0);
  }

  function updateHud(game) {
    if (!elBar) return;
    const show = game.state === 'playing';
    elCoins.classList.toggle('hidden', !show);
    elBar.classList.toggle('hidden', !show);
    elQuit.classList.toggle('hidden', !show);
    elItems.classList.toggle('hidden', !show || elItems.children.length === 0);
    if (!show) return;
    document.getElementById('ars-coin-val').textContent = A.runCoins;
    document.getElementById('ars-lv').textContent = 'Lv ' + level();
    elCoins.classList.toggle('flash', A._flash > 0);
    const kids = elBar.children;
    let i = 0;
    for (const w of WEAPONS) {
      if (!A.owned(w)) continue;
      const node = kids[i++]; if (!node) continue;
      node.classList.toggle('cur', A.current.id === w.id);
      const empty = !w.starter && A.runAmmo(w.id) <= 0;
      node.classList.toggle('empty', empty);
      const small = node.querySelector('.ars-w-body small');
      if (small && !w.starter) small.textContent = '▮ ' + A.runAmmo(w.id);
    }
  }
  function hideHud() {
    [elCoins, elBar, elItems, elQuit].forEach(e => e && e.classList.add('hidden'));
  }

  function quitToMenu() {
    const g = A._game;
    if (!g) return;
    A.bankRun(g);          // keep coins + spent ammo + xp
    g.stop();
    g.state = 'menu';
    hideHud();
    const menu = document.getElementById('btn-menu');
    if (menu) menu.click();               // reuse main.js screen manager -> title
  }

  /* ---------- Armory shop ---------- */
  function injectShopButton() {
    const actions = document.querySelector('.title-actions');
    if (!actions || document.getElementById('btn-armory')) return;
    const b = el('button', 'secondary-btn', 'Armory <span id="armory-stash">◎ ' + D.profile.stash + '</span>');
    b.id = 'btn-armory';
    b.onclick = openShop;
    actions.appendChild(b);
  }

  function buildShop() {
    if (elShop) return;
    elShop = el('div', 'ars-shop hidden');
    (document.getElementById('stage') || document.body).appendChild(elShop);
  }

  function renderShop() {
    const p = D.profile, prog = levelProgress(p.xp || 0), lv = prog.L;
    const weaponRows = WEAPONS.map(w => {
      const ic = iconImg(w.id);
      if (w.starter) return row(`${w.name} <em>${w.tag}</em>`, w.desc, `<span class="ars-tag-owned">∞ ammo</span>`, ic);
      if (!D.isUnlocked(w.id)) {
        const can = p.stash >= w.unlockCost;
        return row(`${w.name} <em>${w.tag}</em>`, w.desc + ' <i>Locked — one-time unlock.</i>',
          `<button class="ars-buy${can ? '' : ' dis'}" data-unlock="${w.id}">Unlock ◎${w.unlockCost}</button>`, ic);
      }
      const cap = ammoCap(w), have = p.ammo[w.id] || 0;
      const full = have >= cap, can = !full && p.stash >= w.clipCost;
      const bar = `<div class="ars-ammo"><div class="ars-ammo-fill" style="width:${Math.min(100, have / cap * 100)}%"></div></div><small>${have}/${cap} rounds · Lv-capped</small>`;
      return row(`${w.name} <em>${w.tag}</em>`, bar,
        full ? `<span class="ars-tag-owned">Full</span>`
             : `<button class="ars-buy${can ? '' : ' dis'}" data-ammo="${w.id}">+${w.clip} ◎${w.clipCost}</button>`, ic);
    }).join('');

    const upRows = UPGRADES.map(u => {
      const l = D.upgradeLevel(u.key), cost = upCost(u), maxed = l >= u.max, can = !maxed && p.stash >= cost;
      return row(`${u.name} <em>Lv ${l}/${u.max}</em>`, u.desc,
        maxed ? `<span class="ars-tag-owned">Max</span>` : `<button class="ars-buy${can ? '' : ' dis'}" data-up="${u.key}">◎ ${cost}</button>`);
    }).join('');

    const conRows = CONSUMABLES.map(c => {
      const ic = iconImg(c.id);
      const limit = itemLimit(c), have = p.items[c.id] || 0;
      if (limit <= 0) {
        const need = Math.ceil(1 / c.perLevel) + 1;
        return row(`${c.name} <em>${c.tag}</em>`, c.desc, `<span class="ars-tag-lock">Unlocks Lv ${need}</span>`, ic);
      }
      const full = have >= limit, can = !full && p.stash >= c.cost;
      return row(`${c.name} <em>${c.tag}</em>`, c.desc + ` <i>Carry up to ${limit} (level-capped).</i>`,
        full ? `<span class="ars-tag-owned">${have}/${limit}</span>`
             : `<button class="ars-buy${can ? '' : ' dis'}" data-item="${c.id}">${have}/${limit} · +1 ◎${c.cost}</button>`, ic);
    }).join('');

    elShop.innerHTML =
      `<div class="ars-shop-panel">
        <div class="ars-shop-head">
          <span class="panel-kicker">ARMORY</span>
          <span class="ars-shop-right"><span class="ars-shop-stash">Stash <b>◎ ${p.stash}</b></span><button class="ars-shop-x" aria-label="Close armory" title="Close">✕</button></span>
        </div>
        <div class="ars-lvbar"><span>Level ${lv}</span><div class="ars-lvbar-track"><div style="width:${(prog.into / prog.need * 100).toFixed(0)}%"></div></div><span class="ars-lvxp">${prog.into}/${prog.need} XP</span></div>
        <p class="ars-shop-sub">Unlock guns once. Buy their ammo before each watch — caps rise with your level. Leftover run-coins bank here.</p>
        <div class="ars-shop-scroll">
          <h4>Weapons &amp; Ammo</h4>${weaponRows}
          <h4>Field Kit — used in battle (keys Z X C V)</h4>${conRows}
          <h4>Upgrades</h4>${upRows}
        </div>
        <button class="primary-btn ars-shop-close">Back to outpost</button>
      </div>`;

    elShop.querySelector('.ars-shop-close').onclick = closeShop;
    elShop.querySelector('.ars-shop-x').onclick = closeShop;
    elShop.querySelectorAll('[data-unlock]').forEach(b => b.onclick = () => {
      const w = byId(b.getAttribute('data-unlock'));
      if (D.spendStash(w.unlockCost)) { D.unlock(w.id); OLW.Audio && OLW.Audio.mango(); afterBuy(); }
    });
    elShop.querySelectorAll('[data-ammo]').forEach(b => b.onclick = () => {
      const w = byId(b.getAttribute('data-ammo')), cap = ammoCap(w);
      if ((p.ammo[w.id] || 0) < cap && D.spendStash(w.clipCost)) {
        D.profile.ammo[w.id] = Math.min(cap, (D.profile.ammo[w.id] || 0) + w.clip); D.save();
        OLW.Audio && OLW.Audio.hit(); afterBuy();
      }
    });
    elShop.querySelectorAll('[data-up]').forEach(b => b.onclick = () => {
      const u = UPGRADES.find(x => x.key === b.getAttribute('data-up')), cost = upCost(u);
      if (cost != null && D.spendStash(cost)) { D.setUpgradeLevel(u.key, D.upgradeLevel(u.key) + 1); OLW.Audio && OLW.Audio.mango(); afterBuy(); }
    });
    elShop.querySelectorAll('[data-item]').forEach(b => b.onclick = () => {
      const c = conById(b.getAttribute('data-item')), limit = itemLimit(c);
      if ((p.items[c.id] || 0) < limit && D.spendStash(c.cost)) {
        p.items[c.id] = (p.items[c.id] || 0) + 1; D.save();
        OLW.Audio && OLW.Audio.hit(); afterBuy();
      }
    });
  }
  function row(title, sub, action, icon) {
    return `<div class="ars-shop-row">${icon || ''}<div class="ars-shop-info"><b>${title}</b><small>${sub}</small></div>${action}</div>`;
  }
  function afterBuy() { refreshStashLabels(); renderShop(); renderBar(); }
  function refreshStashLabels() { const s = document.getElementById('armory-stash'); if (s) s.textContent = '◎ ' + D.profile.stash; }
  function openShop() { buildShop(); renderShop(); elShop.classList.remove('hidden'); OLW.Audio && OLW.Audio.resume(); }
  function closeShop() { if (elShop) elShop.classList.add('hidden'); refreshStashLabels(); }

  /* ---------- input ---------- */
  function bindKeys() {
    window.addEventListener('keydown', (e) => {
      if (!A._game || A._game.state !== 'playing') return;
      const w = WEAPONS.find(x => x.key === e.key);
      if (w) { e.preventDefault(); A.equip(w.id); return; }
      const c = CONSUMABLES.find(x => x.key === (e.key || '').toLowerCase());
      if (c) { e.preventDefault(); A.useItem(c.id); }
    });
  }

  /* ---------- styles ---------- */
  function injectCss() {
    if (document.getElementById('ars-css')) return;
    const s = el('style'); s.id = 'ars-css';
    s.textContent = `
.ars-coins{position:absolute;top:clamp(9px,2vmin,17px);left:50%;transform:translateX(-50%);z-index:6;display:flex;align-items:center;gap:7px;padding:4px 12px;background:rgba(10,13,18,.82);border:1px solid #4a4436;border-radius:20px;color:var(--gold,#f5c36b);font-weight:900;pointer-events:none;transition:transform .1s}
.ars-coins.flash{transform:translateX(-50%) scale(1.15);color:#fff}
.ars-lv{font-size:10px;letter-spacing:1px;color:#e9dfcb;background:rgba(255,255,255,.08);padding:1px 7px;border-radius:10px}
.ars-coin-ico{font-size:13px}
.ars-bar{position:absolute;left:50%;bottom:64px;transform:translateX(-50%);z-index:6;display:flex;gap:7px;pointer-events:auto;flex-wrap:wrap;justify-content:center;max-width:94%}
.ars-w{display:flex;align-items:center;gap:7px;padding:6px 11px 6px 7px;background:rgba(10,13,18,.85);border:1px solid #3b3b44;color:#e9dfcb;cursor:pointer;border-radius:4px;transition:.12s}
.ars-w-key{display:grid;place-items:center;width:20px;height:20px;border:1px solid #6c6457;border-radius:3px;font-size:11px;font-weight:900}
.ars-w-body{display:flex;flex-direction:column;text-align:left;line-height:1.1}
.ars-w-body b{font-size:11px}
.ars-w-body small{font-size:9px;color:var(--gold,#f5c36b)}
.ars-w.cur{border-color:var(--amber,#e8a13a);box-shadow:0 0 14px rgba(232,161,58,.35);background:rgba(40,32,16,.9)}
.ars-w.empty{opacity:.45}
.ars-w.empty .ars-w-body small{color:#c5543f}
.ars-w:hover{border-color:#8a8270}
.ars-items{position:absolute;left:50%;bottom:104px;transform:translateX(-50%);z-index:6;display:flex;gap:7px;pointer-events:auto;flex-wrap:wrap;justify-content:center;max-width:94%}
.ars-item{display:flex;align-items:center;gap:6px;padding:5px 10px 5px 6px;background:rgba(18,14,20,.85);border:1px solid #4a3b52;color:#e9dfcb;cursor:pointer;border-radius:4px;transition:.12s}
.ars-item:hover{border-color:#b07fd0}
.ars-item-key{display:grid;place-items:center;width:19px;height:19px;border:1px solid #7a6c86;border-radius:3px;font-size:10px;font-weight:900}
.ars-item-body{display:flex;flex-direction:column;text-align:left;line-height:1.05}
.ars-item-body b{font-size:10.5px}
.ars-item-body small{font-size:9px;color:#c9a7e0}
.ars-tag-lock{font-size:11px;font-weight:800;color:#9e988b;white-space:nowrap}
.ars-quit{right:auto!important;left:15px;bottom:15px;padding:0 12px}
.ars-shop{position:absolute;inset:0;z-index:40;display:grid;place-items:center;padding:clamp(8px,2.5vmin,24px);background:rgba(6,8,11,.85);backdrop-filter:blur(4px)}
.ars-shop-panel{width:min(600px,96%);height:min(680px,94%);display:flex;flex-direction:column;padding:clamp(16px,3vmin,28px);background:linear-gradient(165deg,rgba(40,44,50,.98),rgba(17,21,28,.99));border:1px solid #343941;box-shadow:0 24px 70px rgba(0,0,0,.65)}
.ars-shop-head{display:flex;justify-content:space-between;align-items:center;flex:none}
.ars-shop-right{display:flex;align-items:center;gap:12px}
.ars-shop-stash b{color:var(--gold,#f5c36b)}
.ars-shop-x{width:30px;height:30px;flex:none;border:1px solid #4a4638;background:rgba(10,13,18,.7);color:#e9dfcb;font-size:14px;cursor:pointer;border-radius:6px;line-height:1}
.ars-shop-x:hover{border-color:#c5543f;color:#e88}
.ars-lvbar{display:flex;align-items:center;gap:10px;margin-top:12px;font-size:11px;color:#c9c1b0}
.ars-lvbar-track{flex:1;height:6px;background:rgba(255,255,255,.08);border-radius:3px;overflow:hidden}
.ars-lvbar-track div{height:100%;background:linear-gradient(90deg,#f5c36b,#e8a13a)}
.ars-lvxp{color:#9e988b}
.ars-shop-sub{margin:10px 0 12px;color:#9e988b;font-size:12px;flex:none}
.ars-shop-scroll{overflow-y:auto;flex:1 1 auto;min-height:0;-webkit-overflow-scrolling:touch}
.ars-lvbar{flex:none}
.ars-shop-close{flex:none}
.ars-shop-scroll h4{margin:14px 0 8px;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:var(--amber,#e8a13a)}
.ars-shop-row{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:10px 12px;margin-bottom:6px;background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.06)}
.ars-shop-info{min-width:0}
.ars-ic{width:46px;height:46px;object-fit:contain;flex:none;filter:drop-shadow(0 2px 4px rgba(0,0,0,.5))}
.ars-w-ic{width:22px;height:22px;object-fit:contain;flex:none}
.ars-item-ic{width:20px;height:20px;object-fit:contain;flex:none}
.ars-shop-info b{font-size:13px}
.ars-shop-info em{font-style:normal;color:var(--amber,#e8a13a);font-size:10px;letter-spacing:1px;margin-left:4px}
.ars-shop-info i{color:#9e988b;font-style:normal}
.ars-shop-info small{display:block;color:#9e988b;font-size:11px;margin-top:3px}
.ars-ammo{height:5px;background:rgba(255,255,255,.1);border-radius:3px;overflow:hidden;margin-bottom:3px;max-width:180px}
.ars-ammo-fill{height:100%;background:var(--amber,#e8a13a)}
.ars-buy{border:0;cursor:pointer;font-weight:900;color:#231708;background:linear-gradient(180deg,#f5c36b,#e8a13a);padding:8px 12px;border-radius:3px;white-space:nowrap}
.ars-buy.dis{opacity:.4;cursor:not-allowed;filter:grayscale(.6)}
.ars-tag-owned{font-size:11px;font-weight:800;color:var(--green,#8fae5c);white-space:nowrap}
.ars-shop-close{margin-top:14px}
@media(max-width:650px){.ars-bar{bottom:54px;gap:5px}.ars-w{padding:5px 8px}.ars-w-body b{font-size:10px}}
`;
    document.head.appendChild(s);
  }

  A.init = function () {
    injectCss(); buildHud(); bindKeys(); A.install();
    // when the server profile arrives, refresh anything showing stash/unlocks
    window.addEventListener('olw:profilesync', () => {
      A.current = byId(D.profile.loadout);
      if (!A.owned(A.current)) A.current = SIDEARM;
      renderBar();
      refreshStashLabels();
      if (elShop && !elShop.classList.contains('hidden')) renderShop();
    });
  };
  A.init();
  return A;
})();
