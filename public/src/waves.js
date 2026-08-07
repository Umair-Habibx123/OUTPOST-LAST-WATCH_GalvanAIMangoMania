// src/waves.js

/* Wave director. Owns pacing and escalation:
   - more raiders each wave
   - more simultaneous approach directions (split attention)
   - faster movement, more fast/tough mix
   - every RAID_EVERY-th wave is a harder surge

   The director only decides WHEN and WHAT to spawn. Whether a wave is
   "cleared" depends on live raiders, which the game tracks — so the game
   calls notifyWaveClear() once the field is empty. */
window.OLW = window.OLW || {};

(function () {
  const C = OLW.CONFIG;
  const U = OLW.U;

  class WaveDirector {
    constructor(hooks) {
      this.hooks = hooks || {};      // { onWaveStart(wave, isRaid, plan), spawn(spec) }
      this.wave = 0;
      this.state = 'idle';           // idle | breather | spawning | done
      this.timer = 0;
      this.pending = [];             // [{t, spec}]
      this.spawnedThisWave = 0;
    }

    start() {
      this.state = 'breather';
      this.timer = 1.2;              // short lead-in before wave 1
    }

    isRaid(w) { return w > 0 && w % C.RAID_EVERY === 0; }

    plan(wave) {
      const raid = this.isRaid(wave);
      // Superlinear count + a capped (shrinking-per-raider) duration means
      // incoming pressure eventually outpaces even a perfect defender — the
      // wall WILL fall. Rounds stay in the ~1–3 min band that suits a kiosk.
      let count = Math.round(4 + wave * 2.2 + wave * wave * 0.09);
      if (raid) count = Math.round(count * 1.5);

      const directions = Math.min(1 + Math.floor(wave / 1.8) + (raid ? 1 : 0), 8);
      const speedMul = Math.min(1 + wave * 0.055, 2.3);
      const fastChance = U.clamp((wave - 2) * 0.055, 0, 0.42);
      const toughChance = U.clamp((wave - 3) * 0.05 + (raid ? 0.12 : 0), 0, 0.42);
      const duration = U.clamp(5 + count * 0.15, 4.5, 9);

      return { raid, count, directions, speedMul, fastChance, toughChance, duration };
    }

    beginWave() {
      this.wave += 1;
      const p = this.plan(this.wave);
      this.currentPlan = p;
      this.spawnedThisWave = 0;
      this.pending = [];

      // Map art uses eight real approach lanes. Keep enemy movement on those
      // lanes instead of rotating the whole wave to arbitrary angles, which made
      // raiders appear to cross cliffs / empty background areas.
      const fixedLanes = [
        0,
        Math.PI * 0.25,
        Math.PI * 0.5,
        Math.PI * 0.75,
        Math.PI,
        Math.PI * 1.25,
        Math.PI * 1.5,
        Math.PI * 1.75
      ];

      // Pick a different subset/order each wave while preserving the same
      // physical lanes drawn into every battlefield.
      const lanes = fixedLanes.slice();
      for (let i = lanes.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [lanes[i], lanes[j]] = [lanes[j], lanes[i]];
      }
      const sectors = lanes.slice(0, p.directions);

      const interval = p.duration / p.count;
      for (let i = 0; i < p.count; i++) {
        // spread raiders across the active sectors, jittered so they don't stack
        const sector = sectors[i % sectors.length];
        const angle = sector + U.rand(-0.07, 0.07);

        let type = 'basic';
        const roll = Math.random();
        if (roll < p.toughChance) type = 'tough';
        else if (roll < p.toughChance + p.fastChance) type = 'fast';

        // small per-raider speed variance so a lane doesn't arrive as one clump
        const spec = { angle, type, speedMul: p.speedMul * U.rand(0.92, 1.1) };
        const t = i * interval + U.rand(-interval * 0.25, interval * 0.25);
        this.pending.push({ t: Math.max(0, t), spec });
      }
      this.pending.sort((a, b) => a.t - b.t);
      this.elapsed = 0;
      this.state = 'spawning';
      if (this.hooks.onWaveStart) this.hooks.onWaveStart(this.wave, p.raid, p);
    }

    update(dt) {
      if (this.state === 'breather') {
        this.timer -= dt;
        if (this.timer <= 0) this.beginWave();
      } else if (this.state === 'spawning') {
        this.elapsed += dt;
        while (this.pending.length && this.pending[0].t <= this.elapsed) {
          const item = this.pending.shift();
          this.spawnedThisWave++;
          if (this.hooks.spawn) this.hooks.spawn(item.spec);
        }
      }
    }

    get finishedSpawning() {
      return this.state === 'spawning' && this.pending.length === 0;
    }

    // Called by the game once the field is clear of raiders.
    notifyWaveClear() {
      this.state = 'breather';
      this.timer = C.BREATHER;
    }

    // time left in the current breather (for the countdown UI)
    get breatherLeft() { return this.state === 'breather' ? Math.max(0, this.timer) : 0; }
  }

  OLW.WaveDirector = WaveDirector;
})();
