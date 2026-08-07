// src/render.js

/* World rendering: ground, the outpost + watchfire, aim reticle, vignette.
   Entities draw themselves; this handles the stage they stand on.
   Everything is procedural — no image assets — for a cohesive hand-built look. */
window.OLW = window.OLW || {};

(function () {
  const C = OLW.CONFIG;
  const COL = OLW.COLORS;
  const U = OLW.U;
  const CX = C.WIDTH / 2, CY = C.HEIGHT / 2;

  // Pre-baked ground speckle so the terrain reads as dusty, not flat.
  const speckle = [];
  (function seed() {
    let s = 1337;
    const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
    for (let i = 0; i < 220; i++) {
      speckle.push({ x: rnd() * C.WIDTH, y: rnd() * C.HEIGHT, r: rnd() * 1.4 + 0.3, a: rnd() * 0.05 + 0.02 });
    }
  })();

  const Render = {
    background(ctx, time) {
      if (OLW.Assets && OLW.Assets.ready('arena')) {
        const img = OLW.Assets.images.arena;
        const scale = Math.max(C.WIDTH / img.naturalWidth, C.HEIGHT / img.naturalHeight);
        const dw = img.naturalWidth * scale, dh = img.naturalHeight * scale;
        ctx.drawImage(img, (C.WIDTH - dw) / 2, (C.HEIGHT - dh) / 2, dw, dh);

        // Slow moonlit haze and drifting dust keep the illustrated board alive.
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        for (let i = 0; i < 3; i++) {
          const x = ((time * (5 + i * 2) + i * 320) % (C.WIDTH + 300)) - 150;
          const y = 120 + i * 165 + Math.sin(time * .35 + i) * 18;
          const fog = ctx.createRadialGradient(x, y, 0, x, y, 180);
          fog.addColorStop(0, 'rgba(115,137,150,.035)');
          fog.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = fog; ctx.fillRect(x - 180, y - 110, 360, 220);
        }
        ctx.restore();
        for (const s of speckle) {
          const driftY = (s.y + time * (2 + s.r)) % C.HEIGHT;
          ctx.fillStyle = `rgba(224,190,132,${s.a * .6})`;
          ctx.fillRect(s.x, driftY, s.r, s.r);
        }
        return;
      }
      // base ground
      ctx.fillStyle = COL.ground;
      ctx.fillRect(0, 0, C.WIDTH, C.HEIGHT);

      // dust speckle
      for (const s of speckle) {
        ctx.fillStyle = `rgba(120,110,90,${s.a})`;
        ctx.fillRect(s.x, s.y, s.r, s.r);
      }

      // warm pool of light from the watchfire, fading to dark open terrain
      const g = ctx.createRadialGradient(CX, CY, 40, CX, CY, C.WIDTH * 0.62);
      g.addColorStop(0, U.rgba(COL.torch, 0.20));
      g.addColorStop(0.35, U.rgba(COL.torch, 0.07));
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, C.WIDTH, C.HEIGHT);

      // darken the outer edges (open dark terrain the raiders emerge from)
      const eg = ctx.createRadialGradient(CX, CY, C.WIDTH * 0.3, CX, CY, C.WIDTH * 0.72);
      eg.addColorStop(0, 'rgba(0,0,0,0)');
      eg.addColorStop(1, U.rgba(COL.groundEdge, 0.9));
      ctx.fillStyle = eg;
      ctx.fillRect(0, 0, C.WIDTH, C.HEIGHT);

      // faint approach ring near the wall
      ctx.strokeStyle = U.rgba(COL.torch, 0.06);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(CX, CY, C.WALL_RADIUS + 22, 0, U.TAU);
      ctx.stroke();
    },

    outpost(ctx, integrity01, time) {
      const flick = 0.85 + Math.sin(time * 12) * 0.06 + Math.sin(time * 27) * 0.04;

      if (OLW.Assets && OLW.Assets.ready('arena')) {
        // Integrity halo sits exactly over the palisade in the arena art.
        ctx.save();
        ctx.translate(CX, CY);
        ctx.strokeStyle = integrity01 < .3 ? U.rgba(COL.danger, .75) : U.rgba(COL.torch, .34);
        ctx.lineWidth = 3;
        ctx.setLineDash([4, 7]);
        ctx.lineDashOffset = -time * 12;
        ctx.beginPath(); ctx.arc(0, 0, C.WALL_RADIUS, 0, U.TAU * integrity01); ctx.stroke();
        ctx.setLineDash([]);

        // Animated guard on the watch platform.
        if (OLW.Assets.ready('warden')) {
          const img = OLW.Assets.images.warden;
          const cw = img.naturalWidth / 5, ch = img.naturalHeight;
          const frame = Math.floor(time * 2.6) % 4;
          const h = 112 + Math.sin(time * 2.1) * 1.5, w = h * (cw / ch);
          ctx.shadowColor = 'rgba(232,161,58,.55)'; ctx.shadowBlur = 12;
          ctx.drawImage(img, frame * cw, 0, cw, ch, -w / 2, -h * .66, w, h);
        }
        // Pulsing watchfire lens glow.
        const gg = ctx.createRadialGradient(0, -10, 0, 0, -10, 88);
        gg.addColorStop(0, U.rgba(COL.torchCore, .12 * flick));
        gg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(0, -10, 88, 0, U.TAU); ctx.fill();
        ctx.restore();
        return;
      }

      // ground glow under the tower
      const gg = ctx.createRadialGradient(CX, CY, 6, CX, CY, C.WALL_RADIUS + 30);
      gg.addColorStop(0, U.rgba(COL.torch, 0.30 * flick));
      gg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gg;
      ctx.beginPath(); ctx.arc(CX, CY, C.WALL_RADIUS + 30, 0, U.TAU); ctx.fill();

      // --- stone wall ring (its condition reflects integrity) ---
      const dmg = 1 - integrity01;
      ctx.save();
      ctx.translate(CX, CY);
      ctx.lineWidth = 9;
      // base ring
      ctx.strokeStyle = COL.stoneDark;
      ctx.beginPath(); ctx.arc(0, 0, C.WALL_RADIUS, 0, U.TAU); ctx.stroke();
      // lit top of ring
      ctx.lineWidth = 6;
      ctx.strokeStyle = COL.stone;
      ctx.beginPath(); ctx.arc(0, 0, C.WALL_RADIUS - 1.5, -Math.PI * 0.85, Math.PI * 0.15); ctx.stroke();

      // crenellations
      const merlons = 16;
      for (let i = 0; i < merlons; i++) {
        const a = (i / merlons) * U.TAU;
        // as damage rises, some merlons are "broken" (skipped / darkened)
        const broken = (Math.sin(i * 12.9898) * 43758.5453) % 1;
        const isGone = (broken * 0.999 + 0.0005) < dmg * 0.9;
        const rr = C.WALL_RADIUS;
        const mx = Math.cos(a) * rr, my = Math.sin(a) * rr;
        ctx.fillStyle = isGone ? COL.stoneDark : COL.stone;
        ctx.save();
        ctx.translate(mx, my);
        ctx.rotate(a);
        const h = isGone ? 2 : 6;
        ctx.fillRect(-4, -h, 8, h + 4);
        ctx.restore();
      }

      // cracks that grow with damage
      if (dmg > 0.15) {
        ctx.strokeStyle = U.rgba(COL.danger, U.clamp(dmg, 0, 0.6));
        ctx.lineWidth = 1.4;
        const cracks = Math.floor(dmg * 7);
        for (let i = 0; i < cracks; i++) {
          const a = (i / 7) * U.TAU + 0.4;
          const r0 = C.WALL_RADIUS;
          ctx.beginPath();
          ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
          ctx.lineTo(Math.cos(a + 0.15) * (r0 - 12), Math.sin(a + 0.15) * (r0 - 12));
          ctx.lineTo(Math.cos(a - 0.05) * (r0 - 22), Math.sin(a - 0.05) * (r0 - 22));
          ctx.stroke();
        }
      }

      // --- the tower ---
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath(); ctx.ellipse(0, C.TOWER_RADIUS * 0.7, C.TOWER_RADIUS * 1.1, C.TOWER_RADIUS * 0.4, 0, 0, U.TAU); ctx.fill();
      // tower base
      ctx.fillStyle = COL.woodDark;
      ctx.beginPath(); ctx.arc(0, 0, C.TOWER_RADIUS, 0, U.TAU); ctx.fill();
      ctx.fillStyle = COL.wood;
      ctx.beginPath(); ctx.arc(0, -2, C.TOWER_RADIUS - 5, 0, U.TAU); ctx.fill();
      // wooden planks
      ctx.strokeStyle = COL.woodDark;
      ctx.lineWidth = 1;
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.moveTo(-C.TOWER_RADIUS + 4, i * 7);
        ctx.lineTo(C.TOWER_RADIUS - 4, i * 7);
        ctx.stroke();
      }

      // --- watchfire on top ---
      const fh = 16 * flick;
      const fg = ctx.createRadialGradient(0, -6, 1, 0, -6, 22);
      fg.addColorStop(0, U.rgba(COL.torchCore, 0.95 * flick));
      fg.addColorStop(0.5, U.rgba(COL.torch, 0.6 * flick));
      fg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = fg;
      ctx.beginPath(); ctx.arc(0, -6, 22, 0, U.TAU); ctx.fill();
      // flame body
      ctx.fillStyle = COL.torch;
      ctx.beginPath();
      ctx.moveTo(-6, 2);
      ctx.quadraticCurveTo(-7, -fh * 0.5, 0, -fh);
      ctx.quadraticCurveTo(7, -fh * 0.5, 6, 2);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = COL.torchCore;
      ctx.beginPath();
      ctx.moveTo(-3, 1);
      ctx.quadraticCurveTo(-3.5, -fh * 0.4, 0, -fh * 0.7);
      ctx.quadraticCurveTo(3.5, -fh * 0.4, 3, 1);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    },

    threats(ctx, raiders, time) {
      const active = raiders.filter(r => r.alive).sort((a, b) =>
        U.dist2(a.x, a.y, CX, CY) - U.dist2(b.x, b.y, CX, CY)).slice(0, 4);
      for (const r of active) {
        const d = U.dist(r.x, r.y, CX, CY);
        if (d < 230) continue;
        const a = Math.atan2(r.y - CY, r.x - CX);
        const rr = Math.min(245, d * .62);
        const x = CX + Math.cos(a) * rr, y = CY + Math.sin(a) * rr;
        ctx.save(); ctx.translate(x, y); ctx.rotate(a + Math.PI / 2);
        const pulse = .55 + Math.sin(time * 7 + a * 3) * .2;
        ctx.fillStyle = U.rgba(r.type === 'tough' ? COL.danger : COL.torch, pulse);
        ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(7, 6); ctx.lineTo(0, 3); ctx.lineTo(-7, 6); ctx.closePath(); ctx.fill();
        ctx.restore();
      }
    },

    // ambient embers drifting up from the watchfire
    reticle(
  ctx,
  x,
  y,
  cd01,
  onTarget,
  playerSlot
) {
  const slot = playerSlot || 1;

  const activeColor =
    slot === 2
      ? '#8ed4f0'
      : COL.torchCore;

  const inactiveColor =
    slot === 2
      ? 'rgba(142,212,240,.78)'
      : U.rgba(COL.parchment, 0.8);

  ctx.save();
  ctx.translate(x, y);

  const radius = onTarget ? 15 : 12;

  ctx.strokeStyle = onTarget
    ? activeColor
    : inactiveColor;

  ctx.lineWidth = onTarget ? 2.4 : 1.8;

  if (slot === 2) {
    /*
     * Diamond reticle makes Player 2 distinguishable
     * without relying only on colour.
     */
    ctx.rotate(Math.PI / 4);
  }

  for (let index = 0; index < 4; index += 1) {
    const angle =
      index * Math.PI / 2 +
      (onTarget ? 0.5 : 0.2);

    ctx.beginPath();
    ctx.arc(
      0,
      0,
      radius,
      angle,
      angle + 0.6
    );
    ctx.stroke();
  }

  ctx.fillStyle =
    cd01 >= 1
      ? activeColor
      : inactiveColor;

  ctx.beginPath();
  ctx.arc(0, 0, 2, 0, U.TAU);
  ctx.fill();

  ctx.restore();
},

    // red vignette that pulses when integrity is low or on damage
    vignette(ctx, intensity) {
      if (intensity <= 0.001) return;
      const g = ctx.createRadialGradient(CX, CY, C.HEIGHT * 0.3, CX, CY, C.HEIGHT * 0.75);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, U.rgba(COL.danger, U.clamp(intensity, 0, 0.55)));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, C.WIDTH, C.HEIGHT);
    },

    // big centered wave banner
    banner(ctx, text, sub, alpha) {
      if (alpha <= 0.001) return;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(0, CY - 52, C.WIDTH, 88);
      ctx.fillStyle = COL.parchment;
      ctx.font = '800 40px "Segoe UI", system-ui, sans-serif';
      ctx.fillText(text, CX, CY - 6);
      if (sub) {
        ctx.font = '600 17px "Segoe UI", system-ui, sans-serif';
        ctx.fillStyle = COL.parchmentDim;
        ctx.fillText(sub, CX, CY + 22);
      }
      ctx.restore();
    },
  };

  OLW.Render = Render;
})();
