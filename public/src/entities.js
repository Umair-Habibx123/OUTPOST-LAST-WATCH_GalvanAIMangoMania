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
  const RAIDER_TYPES = {
    basic: { hp: 1, speed: 42, r: 15, dmg: 8,  rim: COL.raiderRim,      body: COL.raider },
    fast:  { hp: 1, speed: 74, r: 13, dmg: 6,  rim: COL.raiderFastRim,  body: COL.raiderFast },
    tough: { hp: 3, speed: 27, r: 20, dmg: 17, rim: COL.raiderToughRim, body: COL.raiderTough },
  };

  class Raider {
    constructor(angle, type, speedMul) {
      const t = RAIDER_TYPES[type] || RAIDER_TYPES.basic;
      this.type = type;
      this.angle = angle;                     // approach direction (from edge toward center)
      this.x = CX + Math.cos(angle) * SPAWN_DIST;
      this.y = CY + Math.sin(angle) * SPAWN_DIST;
      this.speed = t.speed * (speedMul || 1);
      this.hp = t.hp;
      this.maxHp = t.hp;
      this.r = t.r;
      this.dmg = t.dmg;
      this.rim = t.rim;
      this.body = t.body;
      this.alive = true;
      this.landed = false;
      this.hitFlash = 0;
      this.bob = Math.random() * U.TAU;       // walk animation phase
      this.deadTimer = 0;
    }

    update(dt) {
      if (!this.alive) { this.deadTimer -= dt; return; }
      this.bob += dt * (4 + this.speed * 0.04);
      // move toward center
      const dirx = Math.cos(this.angle), diry = Math.sin(this.angle);
      this.x -= dirx * this.speed * dt;
      this.y -= diry * this.speed * dt;
      if (this.hitFlash > 0) this.hitFlash -= dt;
      const d = U.dist(this.x, this.y, CX, CY);
      if (d <= C.WALL_RADIUS + this.r * 0.4) {
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

  function drawSilhouette(ctx, rd, walk) {
    const r = rd.r;
    const flash = rd.hitFlash > 0;

    // Production atlas path: three classes x four animation frames.
    if (OLW.Assets && OLW.Assets.ready('raiders')) {
      const img = OLW.Assets.images.raiders;
      const cw = img.naturalWidth / 4, ch = img.naturalHeight / 3;
      const row = rd.type === 'fast' ? 0 : (rd.type === 'tough' ? 2 : 1);
      const frame = Math.floor(rd.bob / 1.35) % 4;
      const size = r * (rd.type === 'tough' ? 4.65 : 4.5);
      ctx.save();
      // Atlas characters face down; rotate them toward the outpost.
      ctx.rotate(rd.angle + Math.PI / 2);
      ctx.shadowColor = flash ? COL.torchCore : 'rgba(0,0,0,.65)';
      ctx.shadowBlur = flash ? 18 : 8;
      ctx.filter = flash ? 'brightness(2.1) saturate(.35)' : 'none';
      ctx.drawImage(img, frame * cw, row * ch, cw, ch, -size / 2, -size * .62, size, size);
      ctx.restore();
      if (rd.type === 'tough' && rd.alive) {
        const pipW = r * .42;
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
      const bob = Math.sin(this.wobble) * 2;
      ctx.save();
      ctx.translate(this.x, this.y + bob);
      // shadow
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath();
      ctx.ellipse(0, 16, 26, 7, 0, 0, U.TAU);
      ctx.fill();
      // cart bed
      ctx.fillStyle = this.hitFlash > 0 ? '#caa76a' : COL.wood;
      ctx.fillRect(-22, -6, 44, 14);
      ctx.fillStyle = COL.woodDark;
      ctx.fillRect(-22, 4, 44, 4);
      // wheels
      ctx.fillStyle = '#241a10';
      ctx.beginPath(); ctx.arc(-13, 12, 6, 0, U.TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(13, 12, 6, 0, U.TAU); ctx.fill();
      // mango pile
      const mango = (mx, my, s) => {
        ctx.fillStyle = COL.mango;
        ctx.beginPath(); ctx.ellipse(mx, my, s, s * 0.82, 0.3, 0, U.TAU); ctx.fill();
        ctx.fillStyle = COL.mangoShade;
        ctx.beginPath(); ctx.ellipse(mx + s * 0.25, my + s * 0.2, s * 0.5, s * 0.4, 0.3, 0, U.TAU); ctx.fill();
        ctx.fillStyle = COL.mangoLeaf;
        ctx.beginPath(); ctx.ellipse(mx - s * 0.4, my - s * 0.7, s * 0.35, s * 0.16, -0.5, 0, U.TAU); ctx.fill();
      };
      mango(-9, -10, 7); mango(8, -9, 8); mango(-1, -16, 6.5);
      // faint warm glow so it reads as the "prize"
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = COL.mango;
      ctx.beginPath(); ctx.arc(0, -8, 30, 0, U.TAU); ctx.fill();
      ctx.restore();
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
