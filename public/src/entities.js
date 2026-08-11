// src/entities.js

/* Entities: raiders, the mango supply cart, and visual effects.
   Each entity owns its own update() and draw(). The world is top-down:
   the outpost sits at center, raiders converge inward along radial paths. */
window.OLW = window.OLW || {};

(function () {
  const C = OLW.CONFIG;
  const COL = OLW.COLORS;
  const U = OLW.U;

  const CX = C.WIDTH / 2;
  const CY = C.HEIGHT / 2;

  // Distance from center at which a raider spawns (just off the visible ring).
  const SPAWN_DIST = Math.sqrt(CX * CX + CY * CY) + 40;

  /* ---------------- Raider ---------------- */
  /* Every hit removes exactly 1 hp regardless of weapon, so hp IS the shot
     count. A 3-hp brute died to three taps of the starting sidearm, which is
     why heavies felt like paper. */
  const RAIDER_TYPES = {
    basic: { hp: 2, speed: 42, r: 15, dmg: 8,  rim: COL.raiderRim,      body: COL.raider },
    fast:  { hp: 1, speed: 74, r: 13, dmg: 6,  rim: COL.raiderFastRim,  body: COL.raiderFast },
    tough: { hp: 5, speed: 27, r: 20, dmg: 17, rim: COL.raiderToughRim, body: COL.raiderTough },
  };

  /* CREATURES are the top of the food chain: the same three size tiers, but
     half again as tough and half again as dangerous. A creature brute is the
     worst thing that can reach the wall. They pay for it in speed — bigger,
     heavier, slower — so a wave of them is a different problem to a rush of
     fast humans rather than just a bigger number. */
  const CREATURE = { hp: 1.5, dmg: 1.5, speed: 0.9, r: 1.15 };

  class Raider {
    constructor(angle, type, speedMul, creature) {
      const t = RAIDER_TYPES[type] || RAIDER_TYPES.basic;
      const m = creature ? CREATURE : null;
      this.type = type;
      this.creature = !!creature;
      this.angle = angle;                     // approach direction (from edge toward center)
      this.x = CX + Math.cos(angle) * SPAWN_DIST;
      this.y = CY + Math.sin(angle) * SPAWN_DIST;
      this.speed = t.speed * (speedMul || 1) * (m ? m.speed : 1);
      this.hp = m ? Math.ceil(t.hp * m.hp) : t.hp;
      this.maxHp = this.hp;
      this.r = m ? Math.round(t.r * m.r) : t.r;
      this.dmg = m ? Math.round(t.dmg * m.dmg) : t.dmg;
      this.rim = t.rim;
      this.body = t.body;
      this.alive = true;
      this.landed = false;
      this.hitFlash = 0;
      this.bob = Math.random() * U.TAU;       // walk animation phase
      this.auraPhase = Math.random() * U.TAU; // so a pack shimmers, not blinks in unison
      this.deadTimer = 0;
    }

    update(dt) {
      if (!this.alive) { this.deadTimer -= dt; return; }
      this.bob += dt * (4 + this.speed * 0.04);
      /* Fair reaction time in every direction.
         The field is 16:9, so a raider entering from the top or bottom edge has
         far less ground to cross before the wall than one entering from the
         side — measured, 153px against 300px. Tightening the wall only recovers
         part of that, so steep approaches also move slower. The player now gets
         roughly comparable warning whichever way a raider comes from, instead of
         vertical attackers arriving almost on top of the palisade. */
      const dirx = Math.cos(this.angle), diry = Math.sin(this.angle);
      const steep = Math.abs(diry);                 // 0 = from the side, 1 = from above/below
      const approach = 1 - 0.28 * steep;
      this.x -= dirx * this.speed * approach * dt;
      this.y -= diry * this.speed * approach * dt;
      if (this.hitFlash > 0) this.hitFlash -= dt;
      // elliptical wall: normalised distance <= 1 means the raider reached it.
      // the +r term lets bigger raiders make contact slightly sooner.
      const nx = (this.x - CX) / (C.WALL_RADIUS + this.r * 0.4);
      const ny = (this.y - CY) / (C.WALL_RADIUS_Y + this.r * 0.4);
      if (nx * nx + ny * ny <= 1) {
        this.landed = true;
        this.alive = false;
        this.deadTimer = 0; // landed raiders vanish immediately
      }
    }

    // returns true if this hit killed the raider
    strike() {
      if (!this.alive) return false;
      this.hp -= 1;
      this.hitFlash = 0.12;
      if (this.hp <= 0) {
        this.alive = false;
        this.deadTimer = 0.32; // brief crumple
        return true;
      }
      return false;
    }

    get gone() { return !this.alive && this.deadTimer <= 0; }

    draw(ctx) {
      const walk = Math.sin(this.bob) * 2;
      if (!this.alive && !this.landed) {
        // crumple fade
        const a = U.clamp(this.deadTimer / 0.32, 0, 1);
        ctx.save();
        ctx.globalAlpha = a * 0.8;
        ctx.translate(this.x, this.y + (1 - a) * 4);
        ctx.scale(1, 0.5 + a * 0.5);
        drawSilhouette(ctx, this, 0);
        ctx.restore();
        return;
      }
      ctx.save();
      ctx.translate(this.x, this.y);
      drawSilhouette(ctx, this, walk);
      ctx.restore();
    }
  }

  function groundShadow(ctx, r) {
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.30)';
    ctx.beginPath();
    ctx.ellipse(0, r * 0.92, r * 0.85, r * 0.30, 0, 0, U.TAU);
    ctx.fill();
    ctx.restore();
  }

  /* THREAT AURA.
     Raiders are dark silhouettes on dark ground, which made them read as scenery
     rather than danger. Each class now carries a coloured aura: a soft ground
     pool under the feet plus a rising body glow, pulsing on its own phase so a
     crowd shimmers instead of blinking in unison. Tough raiders burn red and
     pulse slow and heavy; fast ones are a cold quick flicker; creatures get a
     sickly green. It brightens as they close on the wall — the closer the
     threat, the louder it reads. Drawn UNDER the sprite so it never muddies the
     silhouette. */
  const AURA = {
    basic:    { r: 233, g: 150, b: 68,  power: 0.88, speed: 3.4 },
    fast:     { r: 95,  g: 190, b: 226, power: 0.95, speed: 6.8 },
    tough:    { r: 224, g: 58,  b: 40,  power: 1.30, speed: 2.2 },
    creature: { r: 138, g: 214, b: 96,  power: 1.15, speed: 3.0 }
  };

  function threatAura(ctx, rd) {
    const cfg = (rd.creature ? AURA.creature : AURA[rd.type]) || AURA.basic;
    const r = rd.r;

    // proximity: 0 far out, 1 at the wall
    const dx = (rd.x - CX) / C.WALL_RADIUS, dy = (rd.y - CY) / C.WALL_RADIUS_Y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const near = U.clamp(1 - (dist - 1) / 2.6, 0, 1);

    const pulse = 0.72 + Math.sin(rd.bob * cfg.speed + rd.auraPhase) * 0.28;
    const a = cfg.power * pulse * (0.48 + near * 0.52);
    const rgb = cfg.r + ',' + cfg.g + ',' + cfg.b;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    // ground pool — sells weight and keeps them readable on any map
    const pool = ctx.createRadialGradient(0, r * 0.92, 0, 0, r * 0.92, r * 2.5);
    pool.addColorStop(0, 'rgba(' + rgb + ',' + (a * 0.58).toFixed(3) + ')');
    pool.addColorStop(1, 'rgba(' + rgb + ',0)');
    ctx.fillStyle = pool;
    ctx.beginPath();
    ctx.ellipse(0, r * 0.92, r * 2.5, r * 0.95, 0, 0, U.TAU);
    ctx.fill();

    // body glow rising off the figure
    const body = ctx.createRadialGradient(0, -r * 0.5, 0, 0, -r * 0.5, r * 2.1);
    body.addColorStop(0, 'rgba(' + rgb + ',' + (a * 0.40).toFixed(3) + ')');
    body.addColorStop(1, 'rgba(' + rgb + ',0)');
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(0, -r * 0.5, r * 2.1, 0, U.TAU);
    ctx.fill();

    ctx.restore();
  }

  function drawSilhouette(ctx, rd, walk) {
    const r = rd.r;
    const flash = rd.hitFlash > 0;

    // threat aura first, so the sprite always sits cleanly on top of it
    if (rd.alive) threatAura(ctx, rd);

    // Upright sprite that walks toward the outpost: no full rotation (that made
    // side/top raiders look tilted). We keep them vertical, flip to face their
    // travel direction, add a ground shadow + a gentle walk bob.
    const vx = -Math.cos(rd.angle);                 // horizontal travel toward centre
    const faceFlip = vx < 0 ? -1 : 1;               // art faces right by default
    const bobY = rd.alive ? Math.sin(rd.bob) * 2.2 : 0;

    // Creature atlas is mixed into later waves; gameplay stats still come from rd.type.
    if (rd.creature && OLW.Assets?.ready?.('raiderCreatures')) {
      const img = OLW.Assets.images.raiderCreatures;
      // atlas is 4 cols x 3 rows — 4 walk frames per creature tier
      const cw = img.naturalWidth / 4, ch = img.naturalHeight / 3;
      const row = rd.type === 'fast' ? 0 : (rd.type === 'tough' ? 1 : 2);
      const frame = Math.floor(rd.bob / 1.1) % 4;
      const size = r * (rd.type === 'tough' ? 3.8 : 3.4);   // smaller = more open field
      groundShadow(ctx, r);
      ctx.save();
      ctx.translate(0, bobY);
      ctx.scale(faceFlip, 1);
      ctx.shadowColor = flash ? COL.torchCore : 'rgba(0,0,0,.55)'; ctx.shadowBlur = flash ? 18 : 6;
      ctx.filter = flash ? 'brightness(2.1) saturate(.35)' : 'none';
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, frame * cw, row * ch, cw, ch, -size / 2, -size * 0.78, size, size);
      ctx.restore();
      return;
    }

    // Production human raider atlas: three classes x four animation frames.
    if (OLW.Assets && OLW.Assets.ready('raiders')) {
      const img = OLW.Assets.images.raiders;
      // atlas is 5 cols x 3 rows: cols 0-3 are walk frames, col 4 is a portrait.
      const cw = img.naturalWidth / 5, ch = img.naturalHeight / 3;
      const row = rd.type === 'fast' ? 0 : (rd.type === 'tough' ? 2 : 1);
      const frame = Math.floor(rd.bob / 1.1) % 4;   // only the 4 animation frames
      const size = r * (rd.type === 'tough' ? 3.7 : 3.5);   // smaller = more open field
      groundShadow(ctx, r);
      ctx.save();
      ctx.translate(0, bobY);
      ctx.scale(faceFlip, 1);
      ctx.shadowColor = flash ? COL.torchCore : 'rgba(0,0,0,.55)'; ctx.shadowBlur = flash ? 18 : 6;
      ctx.filter = flash ? 'brightness(2.1) saturate(.35)' : 'none';
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, frame * cw, row * ch, cw, ch, -size / 2, -size * 0.80, size, size);
      ctx.restore();
      if (rd.type === 'tough' && rd.alive) {
        const pipW = r * 0.42;
        for (let i = 0; i < rd.maxHp; i++) {
          ctx.fillStyle = i < rd.hp ? COL.raiderToughRim : 'rgba(255,255,255,.16)';
          ctx.fillRect((i - 1.5) * (pipW + 2), -r * 2.65, pipW, 3);
        }
      }
      return;
    }

    // ground shadow
    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    ctx.beginPath();
    ctx.ellipse(0, r * 0.92, r * 0.85, r * 0.32, 0, 0, U.TAU);
    ctx.fill();

    // faint type-colored aura so raiders are readable emerging from the dark
    if (rd.alive && !flash) {
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = rd.rim;
      ctx.beginPath();
      ctx.arc(0, -r * 0.35, r * 1.5, 0, U.TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // build the hooded body path (reused for fill + rim stroke)
    const bodyPath = () => {
      ctx.beginPath();
      ctx.moveTo(-r * 0.62, r * 0.9);
      ctx.quadraticCurveTo(-r * 0.72, -r * 0.2, 0, -r * 1.05);
      ctx.quadraticCurveTo(r * 0.72, -r * 0.2, r * 0.62, r * 0.9);
      ctx.closePath();
    };

    // body fill
    ctx.fillStyle = flash ? '#e7d6b4' : rd.body;
    bodyPath(); ctx.fill();
    // head
    ctx.beginPath();
    ctx.arc(walk * 0.3, -r * 0.98, r * 0.44, 0, U.TAU);
    ctx.fill();

    // full-perimeter rim (type color) — the primary readability cue
    ctx.strokeStyle = flash ? '#fff1d2' : rd.rim;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.9;
    bodyPath(); ctx.stroke();
    ctx.beginPath();
    ctx.arc(walk * 0.3, -r * 0.98, r * 0.44, 0, U.TAU);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // brighter catch-light on the watchfire-facing side
    const toC = Math.atan2(CY - rd.y, CX - rd.x);
    ctx.strokeStyle = flash ? '#fff1d2' : U.rgba(COL.torch, 0.55);
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    const rx = Math.cos(toC) * r * 0.45, ry = Math.sin(toC) * r * 0.45;
    ctx.arc(rx, ry - r * 0.35, r * 0.55, toC - 1.0, toC + 1.0);
    ctx.stroke();

    // tough raiders: heavier frame + hp pips
    if (rd.type === 'tough' && rd.alive) {
      for (let i = 0; i < rd.maxHp; i++) {
        ctx.fillStyle = i < rd.hp ? COL.raiderToughRim : 'rgba(255,255,255,0.14)';
        ctx.fillRect(-r * 0.6 + i * (r * 0.55), -r * 1.75, r * 0.4, 3.5);
      }
    }
  }

  /* ---------------- Mango supply cart ---------------- */
  class MangoCart {
    constructor() {
      // enters from a random edge, travels a straight chord across the field
      const fromLeft = Math.random() < 0.5;
      this.y = U.rand(C.HEIGHT * 0.2, C.HEIGHT * 0.8);
      this.x = fromLeft ? -50 : C.WIDTH + 50;
      this.vx = (fromLeft ? 1 : -1) * U.rand(70, 95);
      this.r = 22;
      this.hp = 2;
      this.alive = true;
      this.wobble = 0;
      this.hitFlash = 0;
    }
    update(dt) {
      if (!this.alive) return;
      this.x += this.vx * dt;
      this.wobble += dt * 9;
      if (this.hitFlash > 0) this.hitFlash -= dt;
      if (this.x < -80 || this.x > C.WIDTH + 80) this.alive = false; // escaped
    }
    get escaped() { return !this.alive && this.hp > 0; }
    strike() {
      this.hp -= 1;
      this.hitFlash = 0.12;
      if (this.hp <= 0) { this.alive = false; return true; }
      return false;
    }
    draw(ctx) {
      if (!this.alive) return;
      if (OLW.Assets?.ready?.('supplyCartAtlas')) {
        const img=OLW.Assets.images.supplyCartAtlas,cw=img.naturalWidth/4,ch=img.naturalHeight;
        let frame=Math.floor(this.wobble*.55)%2; if (this.hitFlash>0) frame=2; else if (this.hp===1) frame=3;
        const w=88,h=w*(ch/cw),bob=Math.sin(this.wobble)*1.8;
        ctx.save(); ctx.translate(this.x,this.y+bob); if (this.vx<0) ctx.scale(-1,1); ctx.imageSmoothingEnabled=true; ctx.imageSmoothingQuality='high';
        ctx.shadowColor='rgba(239,166,68,.34)'; ctx.shadowBlur=9; ctx.drawImage(img,frame*cw,0,cw,ch,-w/2,-h*.70,w,h); ctx.restore(); return;
      }
      const bob=Math.sin(this.wobble)*2; ctx.save(); ctx.translate(this.x,this.y+bob); ctx.fillStyle=this.hitFlash>0?'#caa76a':COL.wood; ctx.fillRect(-22,-6,44,14); ctx.fillStyle=COL.mango; ctx.beginPath(); ctx.arc(0,-10,12,0,U.TAU); ctx.fill(); ctx.restore();
    }
  }

  /* ---------------- Effects ---------------- */
  class Particle {
    constructor(x, y, color, opts) {
      opts = opts || {};
      this.x = x; this.y = y;
      const a = opts.angle != null ? opts.angle : U.rand(0, U.TAU);
      const sp = opts.speed != null ? opts.speed : U.rand(40, 160);
      this.vx = Math.cos(a) * sp;
      this.vy = Math.sin(a) * sp;
      this.life = opts.life || U.rand(0.3, 0.7);
      this.maxLife = this.life;
      this.r = opts.r || U.rand(1.5, 3.5);
      this.color = color;
      this.grav = opts.grav != null ? opts.grav : 60;
    }
    update(dt) {
      this.life -= dt;
      this.vy += this.grav * dt;
      this.vx *= 0.96;
      this.x += this.vx * dt;
      this.y += this.vy * dt;
    }
    get gone() { return this.life <= 0; }
    draw(ctx) {
      const a = U.clamp(this.life / this.maxLife, 0, 1);
      ctx.globalAlpha = a;
      ctx.fillStyle = this.color;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.r * a + 0.4, 0, U.TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  class Floater {
    constructor(x, y, text, color, size) {
      this.x = x; this.y = y;
      this.text = text;
      this.color = color || COL.parchment;
      this.size = size || 15;
      this.life = 0.9;
      this.maxLife = 0.9;
    }
    update(dt) { this.life -= dt; this.y -= 26 * dt; }
    get gone() { return this.life <= 0; }
    draw(ctx) {
      const a = U.clamp(this.life / this.maxLife, 0, 1);
      ctx.globalAlpha = a;
      ctx.font = `700 ${this.size}px "Segoe UI", system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillText(this.text, this.x + 1, this.y + 1);
      ctx.fillStyle = this.color;
      ctx.fillText(this.text, this.x, this.y);
      ctx.globalAlpha = 1;
    }
  }

  OLW.Raider = Raider;
  OLW.MangoCart = MangoCart;
  OLW.Particle = Particle;
  OLW.Floater = Floater;
  OLW.RAIDER_TYPES = RAIDER_TYPES;
  OLW.SPAWN_DIST = SPAWN_DIST;
})();
