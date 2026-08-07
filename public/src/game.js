// src/game.js

/* Game core: state, the fixed loop, collisions, scoring, and wave flow.
   main.js wires DOM + input to this; the game reports out through `hooks`. */
window.OLW = window.OLW || {};

(function () {
  const C = OLW.CONFIG;
  const COL = OLW.COLORS;
  const U = OLW.U;
  const CX = C.WIDTH / 2,
    CY = C.HEIGHT / 2;

  class Game {
    constructor(canvas, hooks) {
      this.canvas = canvas;
      this.ctx =
  canvas.getContext(
    '2d',
    {
      alpha: false,
      desynchronized: true
    }
  );
      this.hooks = hooks || {};
      this.state = "menu"; // menu | playing | paused | over
      this.aim = { x: CX, y: CY - 120 };
      this.last = 0;
      this._raf = null;
      this.reset(); // populate arrays/state for the idle menu frame
      this.resize();
      window.addEventListener("resize", () => this.resize());
    }

    resize() {
      // Keep internal resolution fixed; CSS handles visual scaling.
      const cv = this.canvas;
      cv.width = C.WIDTH;
      cv.height = C.HEIGHT;
    }

    /* ---- lifecycle ---- */
    reset() {
      this.raiders = [];
      this.effects = [];
      this.bolts = [];
      this.cart = null;
      this.integrity = C.INTEGRITY_START;
      this.time = 0;
      this.kills = 0;
      this.perfectWaves = 0;
      this.mangoGrabbed = 0;
      this.statsTick = 0;
      this.bonusScore = 0;
      this.strikeCd = 0;
      this.player2StrikeCd = 0;
      // Visual firing animation is intentionally longer than the gameplay cooldown.
      // This keeps the warden readable instead of flashing a single still frame.
      this.wardenShotAnim = 0;

      this.combo = 0;

      this.comboTimer = 0;
      this.volleyCharge = 0;
      this.shake = 0;
      this.damageFlash = 0;
      this.bannerText = "";
      this.bannerSub = "";
      this.bannerTimer = 0;
      this.damageThisWave = 0;
      this.player2Aim = {
  x: CX,
  y: CY + 120,
  active: false
};

this.player2Kills = 0;
this.player2Shots = 0;
this.player2Hits = 0;
this.player2VolleyCharge = 0;
      this.mangoScheduled = -1; // time-in-wave to drop cart, or -1
      this.mangoDroppedThisWave = false;
      this.director = new OLW.WaveDirector({
        onWaveStart: (w, raid, plan) => this.onWaveStart(w, raid, plan),
        spawn: (spec) => this.spawnRaider(spec),
      });
    }

    start() {
      this.reset();
      this.state = "playing";
      this.director.start();
      OLW.Audio.resume();
      if (!this._raf) {
        this.last = performance.now();
        this._raf = requestAnimationFrame((t) => this.loop(t));
      }
      this.emitStats();
    }

    stop() {
      if (this._raf) cancelAnimationFrame(this._raf);
      this._raf = null;
    }

    pause() {
      if (this.state === "playing") this.state = "paused";
    }
    resume() {
      if (this.state === "paused") {
        this.state = "playing";
        this.last = performance.now();
      }
    }

    get score() {
      return Math.floor(this.time * C.SCORE_PER_SECOND) + this.bonusScore;
    }

    /* ---- input ---- */
    setAim(x, y) {
      this.aim.x = x;
      this.aim.y = y;
    }

   strike() {
  return this.strikeAt(
    this.aim.x,
    this.aim.y,
    1
  );
}

setPlayer2Aim(x, y) {
  this.player2Aim.x = U.clamp(x, 0, C.WIDTH);
  this.player2Aim.y = U.clamp(y, 0, C.HEIGHT);
  this.player2Aim.active = true;
}

strikePlayer2(x, y) {
  this.setPlayer2Aim(x, y);

  return this.strikeAt(
    this.player2Aim.x,
    this.player2Aim.y,
    2
  );
}

strikeAt(ax, ay, playerSlot) {
  if (this.state !== 'playing') {
    return false;
  }

  const isPlayerTwo = playerSlot === 2;

  if (isPlayerTwo) {
    if (this.player2StrikeCd > 0) {
      return false;
    }

    this.player2StrikeCd = C.STRIKE_COOLDOWN;
    this.player2Shots += 1;
  } else {
    if (this.strikeCd > 0) {
      return false;
    }

    this.strikeCd = C.STRIKE_COOLDOWN;
    this.wardenShotAnim = 0.42;
  }

  /*
   * Mango cart remains shared.
   */
  if (
    this.cart &&
    this.cart.alive &&
    U.dist(
      ax,
      ay,
      this.cart.x,
      this.cart.y
    ) <
      this.cart.r + C.AIM_ASSIST_RADIUS
  ) {
    this.fireBolt(
      this.cart.x,
      this.cart.y,
      false,
      playerSlot
    );

    const destroyed = this.cart.strike();

    this.spawnSparks(
      this.cart.x,
      this.cart.y,
      COL.mango,
      4
    );

    if (isPlayerTwo) {
      this.player2Hits += 1;
    }

    if (destroyed) {
      this.collectMango();
    } else {
      OLW.Audio.strike();
    }

    return true;
  }

  let best = null;
  let bestDistance = Infinity;

  for (const raider of this.raiders) {
    if (!raider.alive) {
      continue;
    }

    const distance = U.dist(
      ax,
      ay,
      raider.x,
      raider.y
    );

    if (
      distance <
        raider.r + C.AIM_ASSIST_RADIUS &&
      distance < bestDistance
    ) {
      best = raider;
      bestDistance = distance;
    }
  }

  if (!best) {
    this.fireBolt(
      ax,
      ay,
      true,
      playerSlot
    );

    this.spawnSparks(
      ax,
      ay,
      '#6b6350',
      3
    );

    OLW.Audio.strike();

    /*
     * Player 1 misses still break the shared combo.
     * Player 2 misses do not punish Player 1.
     */
    if (!isPlayerTwo) {
      this.breakCombo();
    }

    return false;
  }

  this.fireBolt(
    best.x,
    best.y,
    false,
    playerSlot
  );

  const killed = best.strike();

  if (isPlayerTwo) {
    this.player2Hits += 1;
  }

  if (killed) {
    this.kills += 1;

    if (isPlayerTwo) {
      this.player2Kills += 1;

      this.player2VolleyCharge = Math.min(
        C.VOLLEY_CHARGE_MAX,
        this.player2VolleyCharge + 1
      );
    } else {
      this.combo += 1;
      this.comboTimer = C.COMBO_WINDOW;

      this.volleyCharge = Math.min(
        C.VOLLEY_CHARGE_MAX,
        this.volleyCharge + 1
      );
    }

    const multiplier = isPlayerTwo
      ? 1
      : this.comboMultiplier;

    const earned =
      C.SCORE_PER_KILL * multiplier;

    this.bonusScore += earned;

    this.spawnSparks(
      best.x,
      best.y,
      isPlayerTwo
        ? '#6eb6d9'
        : COL.parchment,
      9
    );

    this.addFloater(
      best.x,
      best.y - 10,
      `+${earned}`,
      isPlayerTwo
        ? '#8ed4f0'
        : COL.parchment,
      13
    );

    if (
      !isPlayerTwo &&
      this.combo % C.COMBO_STEP === 0
    ) {
      OLW.Audio.combo(multiplier);
    } else {
      OLW.Audio.hit();
    }

    return true;
  }

  this.spawnSparks(
    best.x,
    best.y,
    best.rim,
    5
  );

  OLW.Audio.strike();

  return true;
}

    get comboMultiplier() {
      return Math.min(C.COMBO_MAX, 1 + Math.floor(this.combo / C.COMBO_STEP));
    }

    breakCombo() {
      this.combo = 0;
      this.comboTimer = 0;
    }

    useVolley() {
      if (this.state !== "playing" || this.volleyCharge < C.VOLLEY_CHARGE_MAX)
        return false;
      this.volleyCharge = 0;
      let hit = 0;
      for (const r of this.raiders) {
        if (!r.alive || U.dist(r.x, r.y, CX, CY) > C.VOLLEY_SAFE_RADIUS)
          continue;
        r.hp = 1;
        if (r.strike()) {
          hit++;
          this.kills++;
          this.bonusScore += C.SCORE_PER_KILL;
          this.spawnSparks(r.x, r.y, COL.torchCore, 12, 240);
        }
      }
      this.bolts.push({ volley: true, life: 0.45, max: 0.45 });
      this.shake = 10;
      this.addFloater(
        CX,
        CY - 105,
        hit ? `SIGNAL VOLLEY  +${hit * C.SCORE_PER_KILL}` : "SIGNAL VOLLEY",
        COL.torchCore,
        19,
      );
      OLW.Audio.volley();
      return true;
    }

    usePlayer2Volley() {
  if (
    this.state !== 'playing' ||
    this.player2VolleyCharge <
      C.VOLLEY_CHARGE_MAX
  ) {
    return false;
  }

  this.player2VolleyCharge = 0;

  let hit = 0;

  for (const raider of this.raiders) {
    if (
      !raider.alive ||
      U.dist(
        raider.x,
        raider.y,
        CX,
        CY
      ) > C.VOLLEY_SAFE_RADIUS
    ) {
      continue;
    }

    raider.hp = 1;

    if (raider.strike()) {
      hit += 1;
      this.kills += 1;
      this.player2Kills += 1;

      this.bonusScore += C.SCORE_PER_KILL;

      this.spawnSparks(
        raider.x,
        raider.y,
        '#8ed4f0',
        12,
        240
      );
    }
  }

  this.bolts.push({
    volley: true,
    playerSlot: 2,
    life: 0.45,
    max: 0.45
  });

  this.shake = 10;

  this.addFloater(
    CX,
    CY - 105,
    hit
      ? `PLAYER 2 VOLLEY +${hit * C.SCORE_PER_KILL}`
      : 'PLAYER 2 VOLLEY',
    '#8ed4f0',
    18
  );

  OLW.Audio.volley();

  return true;
}

    fireBolt(tx, ty, miss, playerSlot) {
  const slot = playerSlot || 1;

  this.bolts.push({
    x1: CX + (slot === 2 ? 13 : -13),
    y1: CY - 4,

    x2: tx,
    y2: ty,

    life: 0.12,
    max: 0.12,

    miss: Boolean(miss),
    playerSlot: slot
  });
}

    collectMango() {
      this.mangoGrabbed++;
      this.bonusScore += C.SCORE_MANGO;
      const before = this.integrity;
      this.integrity = U.clamp(
        this.integrity + C.MANGO_REPAIR,
        0,
        C.INTEGRITY_MAX,
      );
      const healed = Math.round(this.integrity - before);
      this.spawnSparks(this.cart.x, this.cart.y, COL.mango, 22, 220);
      this.addFloater(
        this.cart.x,
        this.cart.y - 18,
        healed > 0 ? `SUPPLY +${healed}` : "SUPPLY",
        COL.mango,
        17,
      );
      OLW.Audio.mango();
      this.emitStats();
    }

    /* ---- spawning ---- */
    spawnRaider(spec) {
      this.raiders.push(new OLW.Raider(spec.angle, spec.type, spec.speedMul));
    }

    onWaveStart(wave, raid, plan) {
      this.damageThisWave = 0;
      this.mangoDroppedThisWave = false;
      // maybe schedule a mango supply cart partway through the wave
      if (wave >= C.MANGO_FIRST_AT && U.chance(C.MANGO_CHANCE)) {
        this.mangoScheduled = U.rand(1.5, Math.max(2, plan.duration * 0.6));
        this.waveElapsed = 0;
      } else {
        this.mangoScheduled = -1;
      }
      this.bannerText = raid ? `RAID — WAVE ${wave}` : `WAVE ${wave}`;
      this.bannerSub = raid
        ? "They come in force. Hold the line."
        : this.waveSub(plan);
      this.bannerTimer = 2.0;
      OLW.Audio.waveStart();
      this.hooks.onWave && this.hooks.onWave(wave, raid);
      this.emitStats();
    }

    waveSub(plan) {
      if (plan.directions >= 5) return "They circle the outpost.";
      if (plan.directions >= 3) return "Attacks from several sides.";
      return "Stay sharp.";
    }

    waveCleared(wave) {
      const perfect = this.damageThisWave === 0;
      if (perfect) {
        this.perfectWaves++;
        this.bonusScore += C.SCORE_PERFECT_WAVE;
        const before = this.integrity;
        this.integrity = U.clamp(
          this.integrity + C.PERFECT_WAVE_REPAIR,
          0,
          C.INTEGRITY_MAX,
        );
        const rep = Math.round(this.integrity - before);
        this.bannerText = `WAVE ${wave} — PERFECT`;
        this.bannerSub =
          rep > 0
            ? `Wall shored up +${rep}. Bonus +${C.SCORE_PERFECT_WAVE}.`
            : `Bonus +${C.SCORE_PERFECT_WAVE}.`;
        this.addFloater(
          CX,
          CY - C.WALL_RADIUS - 24,
          "PERFECT",
          COL.torchCore,
          20,
        );
        OLW.Audio.perfect();
      } else {
        this.bannerText = `WAVE ${wave} CLEARED`;
        this.bannerSub = "Brace for the next.";
      }
      this.bannerTimer = 2.0;
      this.director.notifyWaveClear();
      this.emitStats();
    }

    /* ---- effects ---- */
   spawnSparks(
  x,
  y,
  color,
  n,
  speed
) {
  const MAX_EFFECTS = 420;

  const available =
    Math.max(
      0,
      MAX_EFFECTS -
      this.effects.length
    );

  const count =
    Math.min(n, available);

  for (
    let i = 0;
    i < count;
    i += 1
  ) {
    this.effects.push(
      new OLW.Particle(
        x,
        y,
        color,
        {
          speed:
            speed
              ? U.rand(
                  60,
                  speed
                )
              : undefined
        }
      )
    );
  }
}
    addFloater(x, y, text, color, size) {
      this.effects.push(new OLW.Floater(x, y, text, color, size));
    }

    /* ---- main update ---- */
    update(dt) {
      if (this.state !== "playing") return;
      this.time += dt;
      if (this.strikeCd > 0) {
  this.strikeCd -= dt;
}

if (this.player2StrikeCd > 0) {
  this.player2StrikeCd -= dt;
}
if (this.wardenShotAnim > 0) {
  this.wardenShotAnim = Math.max(0, this.wardenShotAnim - dt);
}
      if (this.comboTimer > 0) {
        this.comboTimer -= dt;
        if (this.comboTimer <= 0) this.breakCombo();
      }
      if (this.shake > 0)
        this.shake = Math.max(0, this.shake - C.SHAKE_DECAY * dt);
      if (this.damageFlash > 0)
        this.damageFlash = Math.max(0, this.damageFlash - dt * 1.6);
      if (this.bannerTimer > 0) this.bannerTimer -= dt;

      this.director.update(dt);

      // scheduled mango cart
      if (this.mangoScheduled >= 0) {
        this.waveElapsed += dt;
        if (
          !this.mangoDroppedThisWave &&
          this.waveElapsed >= this.mangoScheduled
        ) {
          this.cart = new OLW.MangoCart();
          this.mangoDroppedThisWave = true;
        }
      }

      // raiders
      for (const r of this.raiders) {
        r.update(dt);
        if (r.landed) this.onRaiderLanded(r);
      }
      this.raiders = this.raiders.filter((r) => !r.gone);

      // cart
      if (this.cart) {
        this.cart.update(dt);
        if (!this.cart.alive) this.cart = null;
      }

      // bolts + effects
      for (const b of this.bolts) b.life -= dt;
      this.bolts = this.bolts.filter((b) => b.life > 0);
      for (const e of this.effects) e.update(dt);
      this.effects = this.effects.filter((e) => !e.gone);

      // wave clear: director done spawning and no live raiders remain
      if (
        this.director.finishedSpawning &&
        !this.raiders.some((r) => r.alive)
      ) {
        this.waveCleared(this.director.wave);
      }

      // defeat
      if (this.integrity <= 0) this.gameOver();

   this.statsTick += dt;

if (this.statsTick >= 0.05) {
  this.statsTick = 0;
  this.emitStats();
}
    }

    onRaiderLanded(r) {
      this.integrity = U.clamp(this.integrity - r.dmg, 0, C.INTEGRITY_MAX);
      this.damageThisWave += r.dmg;
      this.breakCombo();
      this.shake = Math.min(14, this.shake + 6);
      this.damageFlash = Math.min(1, this.damageFlash + 0.5);
      // impact particles at the wall point
      const a = U.angleTo(CX, CY, r.x, r.y);
      const wx = CX + Math.cos(a) * C.WALL_RADIUS;
      const wy = CY + Math.sin(a) * C.WALL_RADIUS;
      this.spawnSparks(wx, wy, COL.stone, 8);
      this.addFloater(wx, wy - 8, "-" + r.dmg, COL.danger, 14);
      OLW.Audio.land();
    }

    gameOver() {
      if (this.state === "over") return;
      this.state = "over";
      OLW.Audio.over();
      const result = {
  time: +this.time.toFixed(1),

  waves: Math.max(
    0,
    this.director.wave -
      (this.director.state === 'spawning' ? 1 : 0)
  ),

  wavesReached: this.director.wave,

  kills: this.kills,
  perfectWaves: this.perfectWaves,
  score: this.score,

  player2: {
    kills: this.player2Kills,
    shots: this.player2Shots,
    hits: this.player2Hits
  }
};
if (
  OLW.Multiplayer &&
  OLW.Multiplayer.mode !== 'solo'
) {
  OLW.Multiplayer.notifyMatchEnded(result);
}
      this.hooks.onGameOver && this.hooks.onGameOver(result);
      /*
 * Game-over screen is DOM-driven.
 * No reason to render the battlefield at 60 FPS
 * while a modal covers it.
 */
this.render();
this.stop();
    }

    emitStats() {
  if (!this.hooks.onStats) {
    return;
  }

  this.hooks.onStats({
    integrity: this.integrity,
    integrityMax: C.INTEGRITY_MAX,

    time: this.time,
    score: this.score,
    wave: this.director.wave,
    breather: this.director.breatherLeft,

    combo: this.combo,
    multiplier: this.comboMultiplier,

    volleyCharge: this.volleyCharge,
    volleyMax: C.VOLLEY_CHARGE_MAX,

    player2Charge: this.player2VolleyCharge,
    player2Kills: this.player2Kills,
    player2Shots: this.player2Shots,
    player2Hits: this.player2Hits
  });
}

    /* ---- render ---- */
    render() {
      const ctx = this.ctx;
      ctx.save();
      // screen shake
      if (this.shake > 0) {
        ctx.translate(
          (Math.random() - 0.5) * this.shake,
          (Math.random() - 0.5) * this.shake,
        );
      }

      OLW.Render.background(ctx, this.time);

      OLW.Render.threats(ctx, this.raiders, this.time);

      // sort raiders so nearer-the-bottom draw last (fake depth)
      const drawList = this.raiders.slice().sort((a, b) => a.y - b.y);

      // draw raiders behind the outpost (those above center) first is complex;
      // simple readable approach: outpost, then raiders, then near effects.
      OLW.Render.outpost(
        ctx,
        this.integrity / C.INTEGRITY_MAX,
        this.time,
        {
          p1Shooting: this.wardenShotAnim > 0,
          p1ShotAnim: this.wardenShotAnim,
          aimX: this.aim.x,
          aimY: this.aim.y,
          p2Shooting: this.player2StrikeCd > 0
        }
      );

      for (const r of drawList) r.draw(ctx);
      if (this.cart) this.cart.draw(ctx);

      // bolts (tower strikes)
      for (const b of this.bolts) {
        const a = U.clamp(b.life / b.max, 0, 1);
        if (b.volley) {
          ctx.globalAlpha = a;
          ctx.strokeStyle =
  b.playerSlot === 2
    ? '#8ed4f0'
    : COL.torchCore;
          ctx.lineWidth = 5 * a;
          ctx.beginPath();
          ctx.arc(CX, CY, C.VOLLEY_SAFE_RADIUS * (1 - a * 0.16), 0, U.TAU);
          ctx.stroke();
          ctx.globalAlpha = 1;
          continue;
        }
        ctx.globalAlpha = a;
        if (b.miss) {
  ctx.strokeStyle =
    U.rgba(COL.parchmentDim, 0.5);
} else if (b.playerSlot === 2) {
  ctx.strokeStyle = '#8ed4f0';
} else {
  ctx.strokeStyle = COL.torchCore;
}
        ctx.lineWidth = b.miss ? 1 : 2.2;
        ctx.beginPath();
        ctx.moveTo(b.x1, b.y1);
        ctx.lineTo(b.x2, b.y2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      for (const e of this.effects) e.draw(ctx);

      // reticle
      const onTarget = this.aimOnTarget();
     OLW.Render.reticle(
  ctx,
  this.aim.x,
  this.aim.y,
  this.strikeCd <= 0 ? 1 : 0,
  onTarget,
  1
);

if (
  this.player2Aim.active &&
  OLW.Multiplayer &&
  OLW.Multiplayer.mode !== 'solo'
) {
  const player2OnTarget =
    this.aimOnTargetAt(
      this.player2Aim.x,
      this.player2Aim.y
    );

  OLW.Render.reticle(
    ctx,
    this.player2Aim.x,
    this.player2Aim.y,
    this.player2StrikeCd <= 0 ? 1 : 0,
    player2OnTarget,
    2
  );
}

      // low-integrity + damage vignette
      const lowPulse =
        this.integrity < 30
          ? (0.18 + Math.sin(this.time * 6) * 0.08) * (1 - this.integrity / 30)
          : 0;
      OLW.Render.vignette(ctx, Math.max(lowPulse, this.damageFlash * 0.5));

      // wave banner
      const bt = U.clamp(this.bannerTimer / 2.0, 0, 1);
      const bAlpha = bt > 0.85 ? (1 - bt) / 0.15 : Math.min(1, bt / 0.4);
      OLW.Render.banner(
        ctx,
        this.bannerText,
        this.bannerSub,
        this.bannerTimer > 0 ? bAlpha : 0,
      );

      ctx.restore();

      if (this.state === "paused") {
        ctx.fillStyle = "rgba(8,10,14,0.62)";
        ctx.fillRect(0, 0, C.WIDTH, C.HEIGHT);
        ctx.textAlign = "center";
        ctx.fillStyle = COL.parchment;
        ctx.font = '800 44px "Segoe UI", system-ui, sans-serif';
        ctx.fillText("PAUSED", CX, CY - 6);
        ctx.font = '600 16px "Segoe UI", system-ui, sans-serif';
        ctx.fillStyle = COL.parchmentDim;
        ctx.fillText("Press P or the II button to resume", CX, CY + 26);
      }
    }

  aimOnTarget() {
  return this.aimOnTargetAt(
    this.aim.x,
    this.aim.y
  );
}

aimOnTargetAt(ax, ay) {
  if (
    this.cart &&
    this.cart.alive &&
    U.dist(
      ax,
      ay,
      this.cart.x,
      this.cart.y
    ) < this.cart.r + C.AIM_ASSIST_RADIUS
  ) {
    return true;
  }

  for (const raider of this.raiders) {
    if (
      raider.alive &&
      U.dist(
        ax,
        ay,
        raider.x,
        raider.y
      ) < raider.r + C.AIM_ASSIST_RADIUS
    ) {
      return true;
    }
  }

  return false;
}

    /* ---- loop ---- */
    loop(t) {
      this._raf = requestAnimationFrame((tt) => this.loop(tt));
      let dt = (t - this.last) / 1000;
      this.last = t;
      if (dt > 0.05) dt = 0.05; // clamp big frame gaps (tab switch)
      if (this.state === "playing") this.update(dt);
      this.render();
    }
  }

  OLW.Game = Game;
})();
