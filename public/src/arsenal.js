/* Outpost: Last Watch — Arsenal, economy, field kit and Armory UI. */
window.OLW = window.OLW || {};

OLW.Arsenal = (function () {
  const D = OLW.Device;

  const WEAPONS = [
    {
      id: 'sidearm', key: '1', name: 'Sidearm', tag: 'Standard', starter: true,
      unlockCost: 0, cdMul: 1.0, mode: 'single',
      desc: 'Old service pistol. Endless rounds, modest bite.'
    },
    {
      id: 'repeater', key: '2', name: 'Repeater', tag: 'Rapid',
      unlockCost: 220, cdMul: 0.5, mode: 'single',
      ammoBase: 40, ammoPerLevel: 8, clip: 20, clipCost: 40,
      desc: 'Double fire-rate. Shreds single targets — feed it rounds.'
    },
    {
      id: 'scattergun', key: '3', name: 'Scattergun', tag: 'Spread',
      unlockCost: 400, cdMul: 1.5, mode: 'spread', spread: 3, radius: 78,
      ammoBase: 24, ammoPerLevel: 5, clip: 10, clipCost: 45,
      desc: 'Strikes up to 3 nearby raiders. Crowd control.'
    },
    {
      id: 'cannon', key: '4', name: 'Siege Cannon', tag: 'Heavy',
      unlockCost: 650, cdMul: 2.3, mode: 'aoe', radius: 66, punch: 3,
      ammoBase: 12, ammoPerLevel: 3, clip: 5, clipCost: 60,
      desc: 'Heavy splash. One-shots armoured raiders. Rare, precious shells.'
    },
    {
      id: 'mortar', key: '5', name: 'Mortar', tag: 'Artillery',
      unlockCost: 900, cdMul: 2.7, mode: 'aoe', radius: 104, punch: 2,
      ammoBase: 8, ammoPerLevel: 2, clip: 4, clipCost: 80,
      desc: 'Lobs a shell — massive blast radius, slow reload.'
    },
    {
      id: 'tesla', key: '6', name: 'Tesla Coil', tag: 'Chain',
      unlockCost: 1100, cdMul: 1.2, mode: 'chain', chain: 4, radius: 150,
      ammoBase: 30, ammoPerLevel: 6, clip: 12, clipCost: 55,
      desc: 'An arc leaps between nearby raiders.'
    }
  ];

  const byId = (id) => WEAPONS.find((w) => w.id === id) || WEAPONS[0];
  const SIDEARM = WEAPONS[0];

 const UPGRADES = [
  {
    key: 'armour',
    icon: 'armour',
    name: 'Warden Armour',
    max: 4,
    cost: [200, 400, 700, 1100],
    desc: '-10% wall damage taken per level.'
  },
  {
    key: 'coinGain',
    icon: 'coinrunner',
    name: 'Coin Runners',
    max: 3,
    cost: [150, 300, 500],
    desc: '+15% coins earned per level.'
  },
  {
    key: 'startCoins',
    icon: 'warchest',
    name: 'War Chest',
    max: 3,
    cost: [120, 240, 400],
    desc: '+80 starting run-coins per level.'
  }
];

  const CONSUMABLES = [
    { id: 'supply', key: 'z', name: 'Supply Line', tag: 'Repair', cost: 60, base: 1, perLevel: 0.5, desc: 'Restores +28 wall integrity instantly.' },
    { id: 'rally', key: 'x', name: 'Backup Team', tag: 'Allies', cost: 120, base: 1, perLevel: 0.34, desc: 'Deploy two allied guards. Their life drains under combat pressure until the team is lost.' },
    { id: 'warhound', key: 'c', name: 'War Beast', tag: 'Beast', cost: 160, base: 1, perLevel: 0.25, desc: 'Unleash an armoured war beast. It fights until its life is exhausted.' },
    { id: 'dragon', key: 'v', name: 'Dragon Strike', tag: 'Ultimate', cost: 300, base: 0, perLevel: 0.2, desc: 'Call an ember dragon that makes repeated attack runs while its life holds.' }
  ];

  const conById = (id) => CONSUMABLES.find((c) => c.id === id);
  const upCost = (u) => u.cost[D.upgradeLevel(u.key)] ?? null;

  const iconImg = (id, cls = 'ars-ic') => {
    const lightweight = cls === 'ars-w-ic' || cls === 'ars-item-ic';
    const suffix = lightweight ? '-192' : '';
    return `<img class="${cls}" src="assets/art/icons/${id}${suffix}.webp" loading="eager" decoding="async" draggable="false" alt="">`;
  };

  // Upgrade art uses its own filenames (optimised webp copies).
  const UP_ICON = { armour: 'armour-ic.webp', coinGain: 'coinrunner-ic.webp', startCoins: 'warchest-ic.webp' };
  const upIconImg = (key) => {
    const f = UP_ICON[key];
    return f ? `<img class="ars-ic" src="assets/art/icons/${f}" loading="lazy" decoding="async" draggable="false" alt="" onerror="this.remove()">` : '';
  };

  const COIN = { kill: 8, perfect: 50, mango: 30 };

  // Field-kit allies use LIFE instead of fixed timers. Their life drains much
  // faster than wall integrity so they remain powerful temporary tactical tools.
  // Any damage that reaches the wall also shocks deployed allies and accelerates
  // their loss, but each ally class has a different endurance profile.
  const FIELD_LIFE = {
    rally:    { max: 100, passive: 2.8, wall: 0.90, attack: 0.45 }, // ~25–35s
    warhound: { max: 100, passive: 3.9, wall: 0.68, attack: 1.15 }, // ~18–25s
    dragon:   { max: 100, passive: 4.8, wall: 0.42, attack: 7.50 }  // ~10–18s
  };
  const MAX_LEVEL = 20;

  function xpToAdvance(level) { return 150 * level; }

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
    _active: {},
    _flash: 0,
    _game: null
  };

  function coinMult() { return 1 + 0.15 * D.upgradeLevel('coinGain'); }
  function startCoins() { return 80 * D.upgradeLevel('startCoins'); }

  A.owned = (w) => w.starter || D.isUnlocked(w.id);
  A.runAmmo = (id) => byId(id).starter ? Infinity : (A._run[id] || 0);
  A.consume = (id, n) => {
    if (!byId(id).starter) A._run[id] = Math.max(0, (A._run[id] || 0) - n);
  };
  A.level = level;
  A.addRunCoins = (n) => { A.runCoins += Math.round(n * coinMult()); };
  A.bump = () => { A._flash = 0.5; };

  A.equip = function (id) {
    const w = byId(id);
    if (!A.owned(w)) { A.bump(); return false; }
    if (!w.starter && A.runAmmo(id) <= 0) {
      A.bump();
      OLW.Audio?.strike?.();
      return false;
    }
    A.current = w;   // loadout is persisted at run end via submitRun, not per-switch
    OLW.Audio?.hit?.();
    renderBar();
    return true;
  };

  A.applyWeaponExtras = function (game, ax, ay) {
    const C = OLW.CONFIG;
    const U = OLW.U;
    const COL = OLW.COLORS;
    const w = A.current;
    const lv = level();

    if (w.mode === 'spread') {
      const count = w.spread + (lv >= 8 ? 1 : 0);
      const near = game.raiders
        .filter((r) => r.alive && U.dist(ax, ay, r.x, r.y) < w.radius)
        .sort((p, q) => U.dist(ax, ay, p.x, p.y) - U.dist(ax, ay, q.x, q.y))
        .slice(0, count);

      for (const r of near) {
        game.fireBolt(r.x, r.y, false, 1);
        const killed = r.strike();
        if (killed) {
          game.kills += 1;
          game.bonusScore += C.SCORE_PER_KILL;
          game.spawnSparks(r.x, r.y, COL.parchment, 6);
        } else {
          game.spawnSparks(r.x, r.y, r.rim, 3);
        }
      }
      return;
    }

    if (w.mode === 'aoe') {
      const punch = w.punch + Math.floor(lv / 6);
      const inRange = game.raiders.filter((r) => r.alive && U.dist(ax, ay, r.x, r.y) < w.radius);

      for (const r of inRange) {
        let hits = punch;
        while (hits-- > 0 && r.alive) {
          if (r.strike()) {
            game.kills += 1;
            game.bonusScore += C.SCORE_PER_KILL;
          }
        }
        game.spawnSparks(r.x, r.y, COL.torch, 7, 200);
      }

      for (let i = 0; i < 14; i += 1) {
        const angle = (i / 14) * U.TAU;
        game.effects.push(new OLW.Particle(
          ax + Math.cos(angle) * 6,
          ay + Math.sin(angle) * 6,
          COL.torchCore,
          { angle, speed: U.rand(120, 200), life: 0.3, r: U.rand(1.5, 3) }
        ));
      }

      game.shake = Math.min(12, game.shake + 4);
      return;
    }

    if (w.mode === 'chain') {
      const links = w.chain + (lv >= 10 ? 1 : 0);
      const hit = new Set();
      let fx = ax;
      let fy = ay;

      for (let i = 0; i < links; i += 1) {
        let best = null;
        let bestDistance = w.radius;

        for (const r of game.raiders) {
          if (!r.alive || hit.has(r)) continue;
          const distance = U.dist(fx, fy, r.x, r.y);
          if (distance < bestDistance) {
            bestDistance = distance;
            best = r;
          }
        }

        if (!best) break;

        hit.add(best);
        game.bolts.push({ x1: fx, y1: fy, x2: best.x, y2: best.y, life: 0.12, max: 0.12, playerSlot: 2 });
        const killed = best.strike();

        if (killed) {
          game.kills += 1;
          game.bonusScore += C.SCORE_PER_KILL;
          game.spawnSparks(best.x, best.y, '#8ed4f0', 6);
        } else {
          game.spawnSparks(best.x, best.y, '#8ed4f0', 3);
        }

        fx = best.x;
        fy = best.y;
      }
    }
  };

  A.useItem = function (id) {
    const g = A._game;
    if (!g || g.state !== 'playing') return false;
    if ((A._items[id] || 0) <= 0) {
      A.bump();
      OLW.Audio?.strike?.();
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
      g.integrity = U.clamp(g.integrity + 28, 0, C.INTEGRITY_MAX);
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
        renderBar();
      }

      g.addFloater(
        CX, CY - C.WALL_RADIUS - 26,
        `${healed > 0 ? `SUPPLY +${healed}` : 'SUPPLY'}${ammoMessage}`,
        COL.mango, 18
      );
      g.spawnSparks(CX, CY, COL.mango, 18, 200);
      OLW.Audio?.mango?.();

    } else if (id === 'rally') {
      const spec = FIELD_LIFE.rally;
      A._active.rally = {
        hp: spec.max, maxHp: spec.max,
        acc: 0, phase: 0, muzzle: -1, muzzleLife: 0,
        targets: [{ x: CX, y: CY - 100 }, { x: CX, y: CY - 100 }]
      };
      g.addFloater(CX, CY - 110, 'BACKUP TEAM DEPLOYED · 100 LIFE', '#8ed4f0', 18);
      OLW.Audio?.waveStart?.();

    } else if (id === 'warhound') {
      const spec = FIELD_LIFE.warhound;
      A._active.warhound = {
        hp: spec.max, maxHp: spec.max,
        acc: 0, x: CX, y: CY + 34, phase: 0, pounce: 0, angle: 0
      };
      g.addFloater(CX, CY - 110, 'WAR BEAST UNLEASHED · 100 LIFE', '#c98a4a', 18);
      OLW.Audio?.waveStart?.();

    } else if (id === 'dragon') {
      const spec = FIELD_LIFE.dragon;
      A._active.dragon = {
        hp: spec.max, maxHp: spec.max,
        phase: 0, attackAcc: .65,
        breathFlash: 0
      };
      g.addFloater(CX, CY - 120, 'EMBER DRAGON CALLED · 100 LIFE', '#ff7412', 20);
      g.shake = Math.min(12, g.shake + 5);
      OLW.Audio?.volley?.();
    }

    A._lastIntegrity = g.integrity;
    renderItemBar();
    return true;
  };

  A.tickAllies = function (game, dt) {
    const U = OLW.U;
    const C = OLW.CONFIG;
    const CX = C.WIDTH / 2;
    const CY = C.HEIGHT / 2;

    const previousIntegrity = A._lastIntegrity == null ? game.integrity : A._lastIntegrity;
    const wallLoss = Math.max(0, previousIntegrity - game.integrity);
    A._lastIntegrity = game.integrity;

    const nearest = (x, y) => {
      let best = null;
      let bestDistance = Infinity;
      for (const r of game.raiders) {
        if (!r.alive) continue;
        const d = U.dist(x, y, r.x, r.y);
        if (d < bestDistance) { bestDistance = d; best = r; }
      }
      return best;
    };

    const killRaider = (target, color, sparks = 6) => {
      if (!target || !target.alive) return false;
      if (target.strike()) {
        game.kills += 1;
        game.bonusScore += C.SCORE_PER_KILL;
        game.spawnSparks(target.x, target.y, color, sparks);
        return true;
      }
      return false;
    };

    const destroyAlly = (key, label, color) => {
      if (!A._active[key]) return;
      A._active[key] = null;
      game.addFloater(CX, CY - 105, label, color, 15);
      game.spawnSparks(CX, CY, color, 10, 150);
    };

    const active = A._active;

    if (active.rally) {
      const a = active.rally;
      const spec = FIELD_LIFE.rally;
      a.hp -= spec.passive * dt + wallLoss * spec.wall;
      a.acc += dt;
      a.phase += dt * 5.5;

      while (a.acc >= .48 && a.hp > 0) {
        a.acc -= .48;
        const which = Math.floor(a.phase) % 2;
        const angle = which === 0 ? Math.PI * 1.08 : Math.PI * 1.92;
        const gx = CX + Math.cos(angle) * 54;
        const gy = CY + Math.sin(angle) * 38;
        const best = nearest(gx, gy);

        if (best) {
          a.targets[which] = { x: best.x, y: best.y };
          game.bolts.push({ x1: gx, y1: gy, x2: best.x, y2: best.y, life: .12, max: .12, playerSlot: 2, ally: true });
          killRaider(best, '#8ed4f0', 6);
          a.hp -= spec.attack;
          a.muzzle = which;
          a.muzzleLife = .10;
        }
      }

      if (a.muzzleLife > 0) a.muzzleLife -= dt;
      if (a.hp <= 0) destroyAlly('rally', 'BACKUP TEAM LOST', '#8ed4f0');
    }

    if (active.warhound) {
      const h = active.warhound;
      const spec = FIELD_LIFE.warhound;
      h.hp -= spec.passive * dt + wallLoss * spec.wall;
      h.phase += dt * 11;

      const target = nearest(h.x, h.y);
      if (target) {
        const angle = Math.atan2(target.y - h.y, target.x - h.x);
        h.angle = angle;
        h.x += Math.cos(angle) * 155 * dt;
        h.y += Math.sin(angle) * 155 * dt;

        if (U.dist(h.x, h.y, target.x, target.y) < target.r + 22) {
          h.acc += dt;
          if (h.acc >= .30) {
            h.acc = 0;
            h.pounce = .18;
            killRaider(target, '#c98a4a', 8);
            h.hp -= spec.attack;
          }
        } else h.acc = 0;
      }

      if (h.pounce > 0) h.pounce -= dt;
      if (h.hp <= 0) destroyAlly('warhound', 'WAR BEAST FALLEN', '#c98a4a');
    }

    if (active.dragon) {
      const d = active.dragon;
      const spec = FIELD_LIFE.dragon;
      d.hp -= spec.passive * dt + wallLoss * spec.wall;
      d.phase = (d.phase + dt * .16) % 1;
      d.attackAcc += dt;
      if (d.breathFlash > 0) d.breathFlash -= dt;

      // Repeated attack runs replace the old one-frame instant screen clear.
      if (d.attackAcc >= 1.35 && d.hp > spec.attack) {
        d.attackAcc -= 1.35;
        d.hp -= spec.attack;
        d.breathFlash = .35;

        const targets = game.raiders
          .filter((r) => r.alive)
          .sort((a, b) => U.dist2(a.x, a.y, CX, CY) - U.dist2(b.x, b.y, CX, CY))
          .slice(0, 3);

        let hits = 0;
        for (const r of targets) {
          // Dragon fire is heavy but not an unlimited full-screen wipe.
          let strikes = r.type === 'tough' ? 2 : 1;
          while (strikes-- > 0 && r.alive) {
            if (killRaider(r, '#ff7412', 10)) hits += 1;
          }
        }

        if (hits) {
          game.addFloater(CX, CY - 126, `DRAGON BREATH +${hits * C.SCORE_PER_KILL}`, '#ff7412', 17);
          game.shake = Math.min(13, game.shake + 4);
          OLW.Audio?.volley?.();
        }
      }

      if (d.hp <= 0) destroyAlly('dragon', 'DRAGON WITHDRAWS', '#ff7412');
    }
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
    const a = A._active.rally; if (!a) return;
    const C = OLW.CONFIG, CX = C.WIDTH/2, CY = C.HEIGHT/2;
    const atlas = OLW.Assets?.ready?.('backupGuardAtlas') ? OLW.Assets.images.backupGuardAtlas : null;
    const positions = [{x:CX-64,y:CY+40,index:0},{x:CX+64,y:CY+40,index:1}];
    for (const p of positions) {
      const target = a.targets?.[p.index] || {x:CX,y:CY-100};
      const row = atlasDirectionRow(Math.atan2(target.y-p.y,target.x-p.x));
      const firing = a.muzzle === p.index && a.muzzleLife > 0;
      const frame = firing ? (a.muzzleLife>.065 ? 2 : (a.muzzleLife>.025 ? 3 : 4)) : 1;
      if (atlas) drawAtlasFrame(ctx, atlas, 5, 8, frame, row, p.x, p.y, 59, .98);
      else if (OLW.Assets?.ready?.('backupGuard')) { const im=OLW.Assets.images.backupGuard,w=57,h=w*im.naturalHeight/im.naturalWidth; ctx.drawImage(im,p.x-w/2,p.y-h*.78,w,h); }
    }
    drawFieldLifeBar(ctx, CX, CY + 61, 105, a.hp, a.maxHp, '#8ed4f0');
  }

  function drawWarhound(ctx) {
    const h = A._active.warhound; if (!h) return;
    if (OLW.Assets?.ready?.('warBeastAtlas')) {
      const atlas = OLW.Assets.images.warBeastAtlas, row = atlasDirectionRow(h.angle || 0);
      const frame = h.pounce > 0 ? (h.pounce > .075 ? 4 : 5) : Math.floor(h.phase*.72)%4;
      drawAtlasFrame(ctx, atlas, 6, 8, frame, row, h.x, h.y, h.pounce > 0 ? 84 : 75, .99); return;
    }
    if (OLW.Assets?.ready?.('warBeast')) { const im=OLW.Assets.images.warBeast,w=72,hh=w*im.naturalHeight/im.naturalWidth; ctx.drawImage(im,h.x-w/2,h.y-hh*.76,w,hh); }
    drawFieldLifeBar(ctx, h.x, h.y + 12, 62, h.hp, h.maxHp, '#c98a4a');
  }

  function drawDragon(ctx) {
    const d = A._active.dragon;
    if (!d) return;

    const C = OLW.CONFIG;
    const progress = d.phase % 1;
    const x = -125 + progress * (C.WIDTH + 250);
    const y = 132 - Math.sin(progress * Math.PI) * 76;

    if (OLW.Assets?.ready?.('dragonAtlas')) {
      const atlas = OLW.Assets.images.dragonAtlas;
      let frame;

      if (d.breathFlash > 0) {
        const breathProgress = 1 - d.breathFlash / .35;
        frame = 5 + Math.min(2, Math.floor(breathProgress * 3));
      } else if (d.attackAcc > 1.05) {
        frame = 4; // inhale just before the next breath attack
      } else {
        frame = Math.floor(progress * 24) % 4;
      }

      drawAtlasFrame(ctx, atlas, 8, 1, frame, 0, x, y, 210, .98);

      if (frame >= 5) {
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        const g = ctx.createRadialGradient(x + 92, y - 24, 0, x + 92, y - 24, 68);
        g.addColorStop(0, 'rgba(255,189,78,.34)');
        g.addColorStop(1, 'rgba(255,84,14,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(x + 92, y - 24, 68, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }

      drawFieldLifeBar(ctx, x, y + 36, 78, d.hp, d.maxHp, '#ff7412');
      return;
    }

    if (OLW.Assets?.ready?.('dragon')) {
      const im = OLW.Assets.images.dragon;
      const w = 185, h = w * im.naturalHeight / im.naturalWidth;
      ctx.drawImage(im, x - w/2, y - h*.72, w, h);
      drawFieldLifeBar(ctx, x, y + 36, 78, d.hp, d.maxHp, '#ff7412');
    }
  }

  A.drawFieldKit = function (game) {
    if (!game || game.state !== 'playing') return;
    const ctx = game.ctx;
    ctx.save();
    drawBackupTeam(ctx, game);
    drawWarhound(ctx);
    drawDragon(ctx);
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
      A.runCoins = startCoins();
      A._run = {};
      A._items = {};
      A._active = {};
      A._lastIntegrity = this.integrity;

      for (const w of WEAPONS) {
        if (!w.starter) A._run[w.id] = Math.min(D.profile.ammo[w.id] || 0, ammoCap(w));
      }

      for (const c of CONSUMABLES) {
        A._items[c.id] = Math.min(D.profile.items[c.id] || 0, itemLimit(c) || 0);
      }

      A.current = SIDEARM;
      renderBar();
      renderItemBar();
    };

    const origStrikeAt = P.strikeAt;
    P.strikeAt = function (ax, ay, slot) {
      const ready = slot === 2 ? this.player2StrikeCd <= 0 : this.strikeCd <= 0;

      if (slot !== 2 && ready && !A.current.starter && A.runAmmo(A.current.id) <= 0) {
        A.current = SIDEARM;
        renderBar();
      }

      const result = origStrikeAt.call(this, ax, ay, slot);

      if (slot !== 2 && ready) {
        const w = A.current;
        if (!w.starter) A.consume(w.id, 1);
        if (w.cdMul !== 1 && this.strikeCd > 0) {
          this.strikeCd = OLW.CONFIG.STRIKE_COOLDOWN * w.cdMul;
        }
        if (result && w.mode !== 'single') A.applyWeaponExtras(this, ax, ay);
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
        if (killDelta > 0) A.addRunCoins(killDelta * COIN.kill);
        if (this.perfectWaves > perfectBefore) A.addRunCoins((this.perfectWaves - perfectBefore) * COIN.perfect);
        if (this.mangoGrabbed > mangoBefore) A.addRunCoins((this.mangoGrabbed - mangoBefore) * COIN.mango);
        if (A._flash > 0) A._flash = Math.max(0, A._flash - dt);
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
    // Report the run to the server, which credits coins/xp (capped) and records
    // remaining ammo/items. Fire-and-forget: the profile updates on response and
    // the olw:profilesync listener refreshes the UI.
    const ammo = {};
    for (const w of WEAPONS) if (!w.starter) ammo[w.id] = A._run[w.id] || 0;
    const items = {};
    for (const c of CONSUMABLES) items[c.id] = A._items[c.id] || 0;

    OLW.Device.submitRun({
      score: game.score || 0,
      time: game.time || 0,
      kills: game.kills || 0,
      waves: game.director ? game.director.wave : 0,
      perfectWaves: game.perfectWaves || 0,
      mango: game.mangoGrabbed || 0,
      ammo,
      items,
      loadout: A.current.id,
    });

    A.runCoins = 0;
    hideHud();
  };

  let elCoins;
  let elBar;
  let elItems;
  let elShop;
  let elQuit;

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

    // A single bottom dock stacks the items row above the weapons row, so they
    // can never overlap no matter how many are owned or how they wrap.
    const dock = el('div', 'ars-dock');
    elItems = el('div', 'ars-items hidden');
    elBar = el('div', 'ars-bar hidden');
    dock.appendChild(elItems);
    dock.appendChild(elBar);
    stage.appendChild(dock);

    elQuit = el('button', 'ghost-btn ars-quit hidden', 'QUIT');
    elQuit.title = 'Abandon the watch (coins are kept)';
    elQuit.onclick = quitToMenu;
    stage.appendChild(elQuit);

    renderBar();
    renderItemBar();
    injectLegacyShopButton();
  }

  function renderBar() {
    if (!elBar) return;
    elBar.innerHTML = '';

    for (const w of WEAPONS) {
      if (!A.owned(w)) continue;

      const current = A.current.id === w.id;
      const ammo = w.starter ? '∞' : A.runAmmo(w.id);
      const empty = !w.starter && A.runAmmo(w.id) <= 0;
      const slot = el('button', `ars-w${current ? ' cur' : ''}${empty ? ' empty' : ''}`);

      slot.innerHTML =
        `<span class="ars-w-key">${w.key}</span>` +
        iconImg(w.id, 'ars-w-ic') +
        `<span class="ars-w-body"><b>${w.name}</b><small>${w.starter ? w.tag : `▮ ${ammo}`}</small></span>`;

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
      if (count <= 0) continue;

      const slot = el('button', 'ars-item');
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
    document.getElementById('ars-lv').textContent = `Lv ${level()}`;
    elCoins.classList.toggle('flash', A._flash > 0);

    const children = elBar.children;
    let index = 0;

    for (const w of WEAPONS) {
      if (!A.owned(w)) continue;
      const node = children[index++];
      if (!node) continue;

      node.classList.toggle('cur', A.current.id === w.id);
      const empty = !w.starter && A.runAmmo(w.id) <= 0;
      node.classList.toggle('empty', empty);

      const small = node.querySelector('.ars-w-body small');
      if (small && !w.starter) small.textContent = `▮ ${A.runAmmo(w.id)}`;
    }
  }

  function hideHud() {
    [elCoins, elBar, elItems, elQuit].forEach((node) => node?.classList.add('hidden'));
  }

  function quitToMenu() {
    const game = A._game;
    if (!game) return;

    A.bankRun(game);
    game.stop();
    game.state = 'menu';
    hideHud();

    const menu = document.getElementById('btn-menu');
    if (menu) menu.click();
  }

  function injectLegacyShopButton() {
    // Keep compatibility with the old title screen. If your new title has
    // #btn-armory-launch, this legacy button is not created.
    if (document.getElementById('btn-armory-launch')) return;

    const actions = document.querySelector('.title-actions');
    if (!actions || document.getElementById('btn-armory')) return;

    const button = el('button', 'secondary-btn', `Armory <span id="armory-stash">◎ ${D.profile.stash}</span>`);
    button.id = 'btn-armory';
    button.onclick = openShop;
    actions.appendChild(button);
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

  // ---------- optimistic Armory purchases ----------
  // The UI changes instantly; server validation runs serially in the background.
  // Intermediate server responses are intentionally not applied because they
  // would overwrite newer optimistic clicks. When the queue drains, the last
  // authoritative server profile reconciles everything.
  const purchaseQueue = [];
  let purchaseQueueRunning = false;

  function optimisticPurchase(kind, id) {
    const p = D.profile;

    if (kind === 'unlock') {
      const w = byId(id);
      if (!w || w.starter || D.isUnlocked(w.id) || p.stash < w.unlockCost) return false;
      p.stash -= w.unlockCost;
      p.unlocked = Array.from(new Set([...(p.unlocked || []), w.id]));
      return true;
    }

    if (kind === 'ammo') {
      const w = byId(id);
      if (!w || w.starter || !D.isUnlocked(w.id)) return false;
      const cap = ammoCap(w);
      const have = p.ammo[w.id] || 0;
      if (have >= cap || p.stash < w.clipCost) return false;
      p.stash -= w.clipCost;
      p.ammo = { ...(p.ammo || {}), [w.id]: Math.min(cap, have + w.clip) };
      return true;
    }

    if (kind === 'item') {
      const item = conById(id);
      if (!item) return false;
      const limit = itemLimit(item);
      const have = p.items[item.id] || 0;
      if (limit <= 0 || have >= limit || p.stash < item.cost) return false;
      p.stash -= item.cost;
      p.items = { ...(p.items || {}), [item.id]: have + 1 };
      return true;
    }

    if (kind === 'upgrade') {
      const u = UPGRADES.find((x) => x.key === id);
      if (!u) return false;
      const current = D.upgradeLevel(u.key);
      const cost = u.cost[current];
      if (current >= u.max || cost == null || p.stash < cost) return false;
      p.stash -= cost;
      p.upgrades = { ...(p.upgrades || {}), [u.key]: current + 1 };
      return true;
    }

    return false;
  }

  async function processPurchaseQueue() {
    if (purchaseQueueRunning) return;
    purchaseQueueRunning = true;
    let lastServerProfile = null;

    try {
      while (purchaseQueue.length) {
        const job = purchaseQueue[0];
        const res = await D.purchase(job.kind, job.id, { applyProfile: false });

        if (!res || !res.ok) {
          // Server remains authoritative. One rejected operation causes a clean
          // reconciliation so the client cannot drift from Neon.
          purchaseQueue.length = 0;
          A.bump();
          OLW.Audio?.strike?.();
          await D.load();
          return;
        }

        lastServerProfile = res.profile || lastServerProfile;
        purchaseQueue.shift();
      }

      if (lastServerProfile) D.applyServerProfile(lastServerProfile);
    } catch (error) {
      console.error('Armory purchase sync failed:', error);
      purchaseQueue.length = 0;
      A.bump();
      OLW.Audio?.strike?.();
      await D.load();
    } finally {
      purchaseQueueRunning = false;
    }
  }

  function queueOptimisticPurchase(kind, id, sound) {
    if (!optimisticPurchase(kind, id)) {
      A.bump();
      OLW.Audio?.strike?.();
      return;
    }

    // Immediate local feedback — no waiting for network latency.
    (sound || OLW.Audio?.mango || function () {})();
    window.dispatchEvent(new CustomEvent('olw:profilesync', { detail: { optimistic: true } }));
    purchaseQueue.push({ kind, id });
    processPurchaseQueue();
  }

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
        const can = p.stash >= w.unlockCost;
        return row(
          `${w.name} <em>${w.tag}</em>`,
          `${w.desc} <i>Locked — one-time unlock.</i>`,
          `<button class="ars-buy${can ? '' : ' dis'}" data-unlock="${w.id}">Unlock ◎${w.unlockCost}</button>`,
          icon
        );
      }

      const cap = ammoCap(w);
      const have = p.ammo[w.id] || 0;
      const full = have >= cap;
      const can = !full && p.stash >= w.clipCost;
      const ammoBar = `<div class="ars-ammo"><div class="ars-ammo-fill" style="width:${Math.min(100, (have / cap) * 100)}%"></div></div><small>${have}/${cap} rounds · Lv-capped</small>`;

      return row(
        `${w.name} <em>${w.tag}</em>`,
        ammoBar,
        full
          ? '<span class="ars-tag-owned">Full</span>'
          : `<button class="ars-buy${can ? '' : ' dis'}" data-ammo="${w.id}">+${w.clip} ◎${w.clipCost}</button>`,
        icon
      );
    }).join('');

    const consumableRows = CONSUMABLES.map((c) => {
      const icon = iconImg(c.id);
      const limit = itemLimit(c);
      const have = p.items[c.id] || 0;

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
      const can = !full && p.stash >= c.cost;

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
      const can = !maxed && p.stash >= cost;

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
            <span class="panel-kicker">OUTPOST QUARTERMASTER</span>
            <h2 class="ars-shop-title">Armory</h2>
          </div>

          <span class="ars-shop-right">
            <span class="ars-shop-stash">
              <small>STASH</small>
              <b>◎ ${p.stash}</b>
            </span>
            <button class="ars-shop-x" aria-label="Close armory" title="Close">✕</button>
          </span>
        </div>

        <div class="ars-lvbar">
          <span>Level ${lv}</span>
          <div class="ars-lvbar-track"><div style="width:${Math.round((prog.into / prog.need) * 100)}%"></div></div>
          <span class="ars-lvxp">${prog.into}/${prog.need} XP</span>
        </div>

        <p class="ars-shop-sub">Unlock weapons once, stock ammunition, and prepare field equipment before the next watch.</p>

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

    // Instant optimistic UI; server validation continues in the background.
    const buy = (button, kind, id, sound) => {
      if (button.classList.contains('dis')) return;
      queueOptimisticPurchase(kind, id, sound);
    };
    elShop.querySelectorAll('[data-unlock]').forEach((b) => { b.onclick = () => buy(b, 'unlock', b.dataset.unlock); });
    elShop.querySelectorAll('[data-ammo]').forEach((b) => { b.onclick = () => buy(b, 'ammo', b.dataset.ammo, () => OLW.Audio?.hit?.()); });
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

function afterBuy() {
    const oldScroller = elShop?.querySelector('.ars-shop-scroll');
    const oldScrollTop = oldScroller ? oldScroller.scrollTop : 0;
    refreshStashLabels();
    renderShop();
    renderBar();
    requestAnimationFrame(() => {
      const newScroller = elShop?.querySelector('.ars-shop-scroll');
      if (newScroller) newScroller.scrollTop = oldScrollTop;
    });
  }

  function refreshStashLabels() {
    const legacy = document.getElementById('armory-stash');
    if (legacy) legacy.textContent = `◎ ${D.profile.stash}`;
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
  }

  function injectCss() {
    if (document.getElementById('ars-css')) return;

    const style = el('style');
    style.id = 'ars-css';
    style.textContent = `
      .ars-coins{position:absolute;top:clamp(9px,2vmin,17px);left:50%;transform:translateX(-50%);z-index:6;display:flex;align-items:center;gap:7px;padding:4px 12px;background:rgba(10,13,18,.82);border:1px solid #4a4436;border-radius:20px;color:var(--gold,#f5c36b);font-weight:900;pointer-events:none;transition:transform .1s}
      .ars-coins.flash{transform:translateX(-50%) scale(1.15);color:#fff}
      .ars-lv{font-size:10px;letter-spacing:1px;color:#e9dfcb;background:rgba(255,255,255,.08);padding:1px 7px;border-radius:10px}
      .ars-coin-ico{font-size:13px}
      .ars-dock{position:absolute;left:50%;bottom:66px;transform:translateX(-50%);z-index:6;display:flex;flex-direction:column;align-items:center;gap:8px;pointer-events:none;width:96%;max-width:920px}
      .ars-bar{display:flex;gap:6px;pointer-events:auto;flex-wrap:wrap;justify-content:center;max-width:100%}
      .ars-w{display:flex;align-items:center;gap:7px;padding:6px 11px 6px 7px;background:rgba(10,13,18,.85);border:1px solid #3b3b44;color:#e9dfcb;cursor:pointer;border-radius:4px;transition:.12s}
      .ars-w:hover{border-color:#8a8270}
      .ars-w.cur{border-color:var(--amber,#e8a13a);box-shadow:0 0 14px rgba(232,161,58,.35);background:rgba(40,32,16,.9)}
      .ars-w.empty{opacity:.45}
      .ars-w.empty .ars-w-body small{color:#c5543f}
      .ars-w-key{display:grid;place-items:center;width:20px;height:20px;border:1px solid #6c6457;border-radius:3px;font-size:11px;font-weight:900}
      .ars-w-ic{width:22px;height:22px;object-fit:contain;flex:none}
      .ars-w-body{display:flex;flex-direction:column;text-align:left;line-height:1.1}
      .ars-w-body b{font-size:11px}.ars-w-body small{font-size:9px;color:var(--gold,#f5c36b)}

      .ars-items{display:flex;gap:6px;pointer-events:auto;flex-wrap:wrap;justify-content:center;max-width:100%}
      .ars-item{display:flex;align-items:center;gap:6px;padding:5px 10px 5px 6px;background:rgba(18,14,20,.85);border:1px solid #4a3b52;color:#e9dfcb;cursor:pointer;border-radius:4px;transition:.12s}
      .ars-item:hover{border-color:#b07fd0}
      .ars-item-key{display:grid;place-items:center;width:19px;height:19px;border:1px solid #7a6c86;border-radius:3px;font-size:10px;font-weight:900}
      .ars-item-ic{width:20px;height:20px;object-fit:contain;flex:none}
      .ars-item-body{display:flex;flex-direction:column;text-align:left;line-height:1.05}
      .ars-item-body b{font-size:10.5px}.ars-item-body small{font-size:9px;color:#c9a7e0}
      .ars-quit{right:auto!important;left:15px;bottom:15px;padding:0 12px;z-index:8}

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
      .ars-buy{border:0;cursor:pointer;font-weight:900;color:#231708;background:linear-gradient(180deg,#f5c36b,#e8a13a);padding:8px 12px;border-radius:3px;white-space:nowrap}.ars-buy.dis{opacity:.4;cursor:not-allowed;filter:grayscale(.6)}
      .ars-shop-close{flex:none;margin-top:14px}

      @media(max-width:650px){
        .ars-dock{bottom:58px;gap:6px}.ars-bar{gap:4px}.ars-w{padding:4px 6px;gap:4px}.ars-w-body b{font-size:9px}.ars-w-body small{font-size:8px}.ars-w-key{width:17px;height:17px}.ars-w-ic{width:18px;height:18px}.ars-items{gap:4px}.ars-item{padding:4px 6px}.ars-item-body b{font-size:9px}
        .ars-shop{padding:0}.ars-shop-panel{width:100vw;height:100dvh;max-height:none;border:0;border-radius:0;padding:14px}
        .ars-shop-row{grid-template-columns:68px minmax(0,1fr);min-height:78px}.ars-card-art{width:68px;height:62px}.ars-shop-action{grid-column:2;justify-content:flex-start;width:100%}.ars-buy{width:100%;padding:8px}
      }

      @media(max-height:540px) and (orientation:landscape){
        .ars-dock{bottom:46px;gap:5px;width:94vw}
        .ars-bar,.ars-items{gap:3px;flex-wrap:nowrap;overflow-x:auto;max-width:94vw}
        .ars-w,.ars-item{padding:3px 5px}
        .ars-w-body b,.ars-item-body b{font-size:8px}
        .ars-w-body small,.ars-item-body small{font-size:7px}
        .ars-w-key,.ars-item-key{width:16px;height:16px;font-size:8px}
        .ars-w-ic,.ars-item-ic{width:17px;height:17px}
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

    window.addEventListener('olw:profilesync', () => {
      A.current = byId(D.profile.loadout);
      if (!A.owned(A.current)) A.current = SIDEARM;
      renderBar();
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
