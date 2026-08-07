// src/maps.js
/* Battlefields: one illustrated arena, re-graded per map, each with a signature
   periodic hazard. Additive layer — wraps Game.render/update/reset so it never
   edits the teammate's render.js. A solo map picker is injected on the title;
   multiplayer map choice (the room screen's #room-map) is honoured if present. */
window.OLW = window.OLW || {};

OLW.Maps = (function () {
  const D = OLW.Device;

  const MAPS = [
    {
      id: 'frontier', name: 'Dust Frontier',
      blurb: 'The open border. A fair, cold night.',
      grade: null,
      hazard: null,
    },
    {
      id: 'orchard', name: 'Burnt Orchard',
      blurb: 'Smoke on the wind — cinders drive them on.',
      grade: { color: '#ff7412', blend: 'soft-light', alpha: 0.5 },
      hazard: { id: 'ember', name: 'EMBER SQUALL', sub: 'Cinders drive the raiders on.',
                every: 16, duration: 5 },
    },
    {
      id: 'frost', name: 'Frostwatch Ridge',
      blurb: 'The whiteout blunts your aim. Watch the haze.',
      grade: { color: '#5f93bd', blend: 'soft-light', alpha: 0.52 },
      hazard: { id: 'whiteout', name: 'WHITEOUT', sub: 'The cold runs your aim wide.',
                every: 16, duration: 5 },
    },
  ];
  const byId = (id) => MAPS.find(m => m.id === id) || MAPS[0];

  const M = {
    MAPS,
    currentId: (D && D.profile.map) || 'frontier',
    _baseAssist: null,
    _hz: 0,          // hazard clock
    _active: false,  // hazard currently firing
    _left: 0,        // seconds left in active hazard
    _spawnAcc: 0,
    _gradePulse: 0,
    _game: null,
  };
  M.active = () => byId(M.currentId);

  M.setMap = function (id) {
    M.currentId = byId(id).id;
    if (D) D.patch({ map: M.currentId });
    renderPicker();
  };

  /* ---------- install (wrap Game) ---------- */
  M.install = function () {
    if (!OLW.Game || OLW.Game.__maps) return;
    OLW.Game.__maps = true;
    const P = OLW.Game.prototype, C = OLW.CONFIG;
    if (M._baseAssist == null) M._baseAssist = C.AIM_ASSIST_RADIUS;

    const origReset = P.reset;
    P.reset = function () {
      origReset.call(this);
      M._game = this;
      // solo runs keep the title picker's choice; only a live multiplayer room
      // overrides the map from the room screen's selector.
      const mp = OLW.Multiplayer;
      const roomMap = document.getElementById('room-map');
      if (mp && mp.mode && mp.mode !== 'solo' && roomMap && roomMap.value) {
        M.currentId = byId(roomMap.value).id;
      }
      M._hz = 0; M._active = false; M._left = 0; M._spawnAcc = 0; M._gradePulse = 0;
      C.AIM_ASSIST_RADIUS = M._baseAssist;   // clear any lingering hazard effect
    };

    const origUpdate = P.update;
    P.update = function (dt) {
      origUpdate.call(this, dt);
      if (this.state === 'playing') M.tickHazard(this, dt);
    };

    const origRender = P.render;
    P.render = function () {
      origRender.call(this);
      M.applyGrade(this.ctx);
    };
  };

  /* ---------- hazards ---------- */
  M.tickHazard = function (game, dt) {
    const map = M.active(), C = OLW.CONFIG, U = OLW.U;
    if (M._gradePulse > 0) M._gradePulse = Math.max(0, M._gradePulse - dt);
    if (!map.hazard) return;

    if (M._active) {
      M._left -= dt;
      M._gradePulse = 1;
      if (map.hazard.id === 'ember') {
        game.integrity = U.clamp(game.integrity - 1.1 * dt, 0, C.INTEGRITY_MAX);
        M._spawnAcc += dt;
        if (M._spawnAcc >= 1.1) {
          M._spawnAcc = 0;
          const wave = game.director.wave || 1;
          game.spawnRaider({ angle: U.rand(0, U.TAU), type: 'basic', speedMul: 1 + wave * 0.05 });
        }
      }
      if (M._left <= 0) {
        M._active = false;
        C.AIM_ASSIST_RADIUS = M._baseAssist;   // restore aim on whiteout end
      }
    } else {
      M._hz += dt;
      if (M._hz >= map.hazard.every) {
        M._hz = 0;
        M._active = true;
        M._left = map.hazard.duration;
        M._spawnAcc = 0;
        if (map.hazard.id === 'whiteout') C.AIM_ASSIST_RADIUS = M._baseAssist * 0.45;
        game.bannerText = map.hazard.name;
        game.bannerSub = map.hazard.sub;
        game.bannerTimer = 2.0;
        game.shake = Math.min(12, game.shake + 5);
        if (OLW.Audio && OLW.Audio.waveStart) OLW.Audio.waveStart();
      }
    }
  };

  /* ---------- colour grade (drawn over the finished frame) ---------- */
  M.applyGrade = function (ctx) {
    const map = M.active(), C = OLW.CONFIG;
    if (!map.grade) {
      // still allow a whiteout haze if this map has one (none for frontier)
      return;
    }
    const boost = 1 + M._gradePulse * 0.6;
    ctx.save();
    ctx.globalCompositeOperation = map.grade.blend || 'soft-light';
    ctx.globalAlpha = Math.min(0.85, map.grade.alpha * boost);
    ctx.fillStyle = map.grade.color;
    ctx.fillRect(0, 0, C.WIDTH, C.HEIGHT);
    ctx.restore();

    // frost whiteout: a breathing white haze while the hazard is live
    if (map.hazard && map.hazard.id === 'whiteout' && M._gradePulse > 0) {
      ctx.save();
      ctx.globalAlpha = 0.10 + 0.10 * M._gradePulse;
      ctx.fillStyle = '#dbe7f2';
      ctx.fillRect(0, 0, C.WIDTH, C.HEIGHT);
      ctx.restore();
    }
  };

  /* ---------- title map picker (solo) ---------- */
  let picker;
  function injectPicker() {
    const layout = document.querySelector('.title-layout');
    const actions = document.querySelector('.title-actions');
    if (!layout || !actions || document.getElementById('map-picker')) return;
    picker = document.createElement('button');
    picker.id = 'map-picker';
    picker.className = 'map-picker';
    picker.onclick = () => {
      const i = MAPS.findIndex(m => m.id === M.currentId);
      M.setMap(MAPS[(i + 1) % MAPS.length].id);
      if (OLW.Audio) OLW.Audio.hit();
    };
    actions.insertAdjacentElement('afterend', picker);
    renderPicker();
  }
  function renderPicker() {
    if (!picker) return;
    const m = M.active();
    picker.innerHTML =
      `<span class="mp-ico">◧</span><span class="mp-body"><b>Battlefield · ${m.name}</b>` +
      `<small>${m.blurb}</small></span><span class="mp-cy">tap to change ›</span>`;
  }

  function injectCss() {
    if (document.getElementById('maps-css')) return;
    const s = document.createElement('style'); s.id = 'maps-css';
    s.textContent = `
.map-picker{display:flex;align-items:center;gap:10px;width:max-content;max-width:100%;margin-top:12px;padding:8px 12px;background:rgba(12,15,20,.7);border:1px solid #4a4638;color:#e9dfcb;cursor:pointer;text-align:left;border-radius:4px;transition:.12s}
.map-picker:hover{border-color:var(--amber,#e8a13a)}
.map-picker .mp-ico{font-size:16px;color:var(--amber,#e8a13a)}
.map-picker .mp-body{display:flex;flex-direction:column;line-height:1.2}
.map-picker .mp-body b{font-size:13px}
.map-picker .mp-body small{font-size:11px;color:#9e988b}
.map-picker .mp-cy{margin-left:6px;font-size:10px;color:var(--gold,#f5c36b);letter-spacing:.5px}
`;
    document.head.appendChild(s);
  }

  /* record the map on leaderboard submissions */
  function wrapLeaderboard() {
    if (!OLW.Leaderboard || OLW.Leaderboard.__mapWrapped) return;
    OLW.Leaderboard.__mapWrapped = true;
    const origSubmit = OLW.Leaderboard.submit.bind(OLW.Leaderboard);
    OLW.Leaderboard.submit = function (entry) {
      const e = Object.assign({}, entry);
      if (!e.mapId || e.mapId === 'frontier') e.mapId = M.currentId;
      return origSubmit(e);
    };
  }

  M.init = function () {
    injectCss();
    injectPicker();
    wrapLeaderboard();
    M.install();
  };

  M.init();
  return M;
})();
