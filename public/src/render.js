/* src/render.js
   Asset-driven battlefield renderer for Outpost: Last Watch.
   Maps remain authored artwork; characters are layered above them. */
window.OLW = window.OLW || {};

(function () {
  const C = OLW.CONFIG;
  const COL = OLW.COLORS;
  const U = OLW.U;
  const CX = C.WIDTH / 2;
  const CY = C.HEIGHT / 2;

  function drawMapAtmosphere(ctx, time, mapId) {
    ctx.save();

    if (mapId === 'frontier') {
      for (let i = 0; i < 18; i += 1) {
        const x = (i * 143 + time * (7 + i % 3)) % (C.WIDTH + 40);
        const y = (i * 89 + Math.sin(time + i) * 14) % C.HEIGHT;
        ctx.globalAlpha = .025 + (i % 3) * .008;
        ctx.fillStyle = COL.torchCore;
        ctx.fillRect(x, y, 1.2, 1.2);
      }
    } else if (mapId === 'orchard') {
      for (let i = 0; i < 30; i += 1) {
        const x = (i * 97 + time * (16 + i % 5)) % C.WIDTH;
        const y = C.HEIGHT - ((i * 71 + time * (10 + i % 4)) % C.HEIGHT);
        ctx.globalAlpha = .10 + (i % 4) * .025;
        ctx.fillStyle = '#ff8a32';
        ctx.fillRect(x, y, 1.4, 1.4);
      }
    } else if (mapId === 'frost') {
      for (let i = 0; i < 34; i += 1) {
        const x = (i * 137 + time * (8 + i % 4)) % C.WIDTH;
        const y = (i * 61 + time * (18 + i % 5)) % C.HEIGHT;
        ctx.globalAlpha = .08 + (i % 4) * .02;
        ctx.fillStyle = '#e8f5ff';
        ctx.fillRect(x, y, 1.4, 1.4);
      }
    }

    ctx.restore();
  }

  function atlasDirectionRow(angle) {
    return ((Math.round(angle / (Math.PI / 4)) % 8) + 8) % 8;
  }

  /* One warden, drawn as a self-contained unit.

     `w` carries everything that makes this warden its own character: where it
     stands, where IT is aiming and whether IT is mid-shot. Both wardens run
     through here with their own state, so their facing rows and firing frames
     advance completely independently — P2 can be shooting north-west while P1
     idles facing east. Nothing here reads the fort centre any more, because
     the two of them no longer stand on it. */
  function drawWarden(ctx, time, w) {
    const x = w.x, y = w.y;
    const aimX = w.aimX ?? (x + 100);
    const aimY = w.aimY ?? y;
    const angle = Math.atan2(aimY - y, aimX - x);
    const slot = w.slot || 1;

    // An unmanned post: the figure stays (they may reconnect) but reads as
    // inactive, so nobody mistakes it for a warden still covering that arc.
    if (w.away) {
      ctx.save();
      ctx.globalAlpha = 0.34;
    }

    if (OLW.Assets?.ready?.('wardenDirectional')) {
      const img = OLW.Assets.images.wardenDirectional;
      const cols = 6, rows = 8;
      const cw = img.naturalWidth / cols, ch = img.naturalHeight / rows;
      const row = atlasDirectionRow(angle);
      const shooting = Boolean(w.shooting);
      const remaining = U.clamp(w.shotAnim || 0, 0, .42);
      const frame = shooting ? Math.min(5, Math.floor(U.clamp(1 - remaining / .42, 0, .999) * 6)) : 0;
      // Sized against the map art: a warden should read as a person beside the
      // watchtower, not tower over it. Re-check this if the maps are replaced.
      const h = w.height || 98, ww = h * (cw / ch);
      ctx.save(); ctx.translate(x, y);
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      // P2 reads with the same cool blue as their reticle and bolts
      ctx.shadowColor = shooting
        ? (slot === 2 ? 'rgba(142,212,240,.78)' : 'rgba(255,210,132,.74)')
        : 'rgba(0,0,0,.64)';
      ctx.shadowBlur = shooting ? 14 : 7;
      ctx.drawImage(img, frame * cw, row * ch, cw, ch, -ww / 2, -h * .73, ww, h);
      ctx.restore();
      drawWardenTag(ctx, x, y, slot, w.away);
      if (w.away) ctx.restore();
      return true;
    }

    if (!OLW.Assets?.ready?.('warden')) { if (w.away) ctx.restore(); return false; }
    const img = OLW.Assets.images.warden, h = w.height || 96;
    const ww = h * (img.naturalWidth / img.naturalHeight);
    ctx.save(); ctx.translate(x, y); if (aimX < x) ctx.scale(-1, 1);
    ctx.drawImage(img, -ww / 2, -h * .72, ww, h); ctx.restore();
    drawWardenTag(ctx, x, y, slot, w.away);
    if (w.away) ctx.restore();
    return true;
  }

  /* A small footing marker under each warden. With two of them on the wall it
     is otherwise easy to lose track of which one you are driving. */
  function drawWardenTag(ctx, x, y, slot, away) {
    const c = away ? COL.parchmentDim : (slot === 2 ? '#8ed4f0' : COL.torchCore);
    ctx.save();
    ctx.translate(x, y + 7);
    ctx.globalAlpha = .55;
    ctx.strokeStyle = c;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.ellipse(0, 0, 16, 6, 0, 0, U.TAU);
    ctx.stroke();
    ctx.globalAlpha = .95;
    ctx.fillStyle = c;
    ctx.font = '800 9px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(slot === 2 ? 'P2' : 'P1', 0, 15);
    ctx.restore();
  }

  const Render = {
    background(ctx, time) {
      const activeMap = OLW.Maps?.image?.() || OLW.Assets?.map?.('frontier');

      if (activeMap) {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(activeMap, 0, 0, C.WIDTH, C.HEIGHT);

        // Mild unifying night treatment only; do not bury authored map art.
        ctx.save();
        ctx.fillStyle = 'rgba(3, 6, 10, .07)';
        ctx.fillRect(0, 0, C.WIDTH, C.HEIGHT);
        ctx.restore();

        drawMapAtmosphere(ctx, time, OLW.Maps?.currentId || 'frontier');
        return;
      }

      // Safe fallback if a map asset fails.
      ctx.fillStyle = COL.ground;
      ctx.fillRect(0, 0, C.WIDTH, C.HEIGHT);

      const g = ctx.createRadialGradient(CX, CY, 30, CX, CY, C.WIDTH * .66);
      g.addColorStop(0, U.rgba(COL.torch, .17));
      g.addColorStop(.42, U.rgba(COL.torch, .035));
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, C.WIDTH, C.HEIGHT);
    },

    outpost(ctx, integrity01, time, actionState) {
      // Readable wall-condition ring aligned around the map's central fort.
      ctx.save();
      ctx.translate(CX, CY);
      ctx.strokeStyle = integrity01 < .30
        ? U.rgba(COL.danger, .78)
        : U.rgba(COL.torch, .28);
      ctx.lineWidth = 2.4;
      ctx.setLineDash([4, 8]);
      ctx.lineDashOffset = -time * 10;
      ctx.beginPath();
      // isometric ellipse ring so it hugs the map's oval stone wall
      ctx.ellipse(0, 0, C.WALL_RADIUS, C.WALL_RADIUS_Y, 0, 0, U.TAU * integrity01);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      // Draw the wardens back-to-front so the nearer one overlaps correctly.
      const crew = (actionState && actionState.wardens) || [];
      crew.slice().sort((a, b) => a.y - b.y).forEach((w) => drawWarden(ctx, time, w));
    },

    threats(ctx, raiders, time) {
      const active = raiders
        .filter(r => r.alive)
        .sort((a, b) => U.dist2(a.x, a.y, CX, CY) - U.dist2(b.x, b.y, CX, CY))
        .slice(0, 4);

      for (const r of active) {
        const d = U.dist(r.x, r.y, CX, CY);
        if (d < 230) continue;
        const a = Math.atan2(r.y - CY, r.x - CX);
        const rr = Math.min(245, d * .62);
        const x = CX + Math.cos(a) * rr;
        const y = CY + Math.sin(a) * rr;

        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(a + Math.PI / 2);
        const pulse = .50 + Math.sin(time * 7 + a * 3) * .16;
        ctx.fillStyle = U.rgba(r.type === 'tough' ? COL.danger : COL.torch, pulse);
        ctx.beginPath();
        ctx.moveTo(0, -8);
        ctx.lineTo(6, 5);
        ctx.lineTo(0, 3);
        ctx.lineTo(-6, 5);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    },

    reticle(ctx, x, y, cd01, onTarget, playerSlot) {
      const slot = playerSlot || 1;
      const activeColor = slot === 2 ? '#8ed4f0' : COL.torchCore;
      const inactiveColor = slot === 2 ? 'rgba(142,212,240,.78)' : U.rgba(COL.parchment, .82);

      ctx.save();
      ctx.translate(x, y);
      const radius = onTarget ? 15 : 12;
      ctx.strokeStyle = onTarget ? activeColor : inactiveColor;
      ctx.lineWidth = onTarget ? 2.2 : 1.6;

      if (slot === 2) ctx.rotate(Math.PI / 4);

      for (let i = 0; i < 4; i += 1) {
        const a = i * Math.PI / 2 + (onTarget ? .50 : .20);
        ctx.beginPath();
        ctx.arc(0, 0, radius, a, a + .58);
        ctx.stroke();
      }

      ctx.fillStyle = cd01 >= 1 ? activeColor : inactiveColor;
      ctx.beginPath();
      ctx.arc(0, 0, 2, 0, U.TAU);
      ctx.fill();
      ctx.restore();
    },

    vignette(ctx, intensity) {
      if (intensity <= .001) return;
      const g = ctx.createRadialGradient(CX, CY, C.HEIGHT * .30, CX, CY, C.HEIGHT * .76);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, U.rgba(COL.danger, U.clamp(intensity, 0, .55)));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, C.WIDTH, C.HEIGHT);
    },

    banner(ctx, text, sub, alpha) {
      if (alpha <= .001 || !text) return;

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.textAlign = 'center';

      const bw = Math.min(500, C.WIDTH * .62);
      const x = CX - bw / 2;
      const y = CY - 50;

      ctx.fillStyle = 'rgba(6,7,9,.72)';
      ctx.fillRect(x, y, bw, 78);

      ctx.strokeStyle = 'rgba(232,161,58,.42)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + .5, y + .5, bw - 1, 77);

      ctx.fillStyle = COL.parchment;
      ctx.font = '800 31px Georgia, serif';
      ctx.fillText(text, CX, CY - 12);

      if (sub) {
        ctx.font = '600 13px "Segoe UI", system-ui, sans-serif';
        ctx.fillStyle = COL.parchmentDim;
        ctx.fillText(sub, CX, CY + 13);
      }

      ctx.restore();
    }
  };

  OLW.Render = Render;
})();
