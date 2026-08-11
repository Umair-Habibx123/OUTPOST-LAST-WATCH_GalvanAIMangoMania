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
      id: "frontier",

      name: "Dust Frontier",

      blurb: "Open ground. Clear sightlines. The standard watch.",

      hazard: null,
    },

    {
      id: "orchard",

      name: "Burnt Orchard",

      blurb: "Cinders move through the dead trees.",

      hazard: {
        id: "ember",

        name: "EMBER SQUALL",

        sub: "Cinders drive the raiders forward.",

        every: 16,
        duration: 5,
      },
    },

    {
      id: "frost",

      name: "Frostwatch Ridge",

      blurb: "Snow and whiteout reduce visibility.",

      hazard: {
        id: "whiteout",

        name: "WHITEOUT",

        sub: "Visibility collapses in the storm.",

        every: 16,
        duration: 5,
      },
    },
  ];

  const byId = (id) => MAPS.find((m) => m.id === id) || MAPS[0];

  const M = {
    MAPS,
    currentId: (D && D.profile.map) || "frontier",
    _baseAssist: null,
    _hz: 0, // hazard clock
    _active: false, // hazard currently firing
    _left: 0, // seconds left in active hazard
    _spawnAcc: 0,
    _gradePulse: 0,
    _game: null,
  };
  M.image = function () {
    return OLW.Assets?.map?.(M.currentId) || null;
  };

  M.active = () => byId(M.currentId);

  /* TITLE BACKDROP FOLLOWS THE MAP PICK.
     A fresh visitor sees the painted title backdrop; the moment they choose a
     battlefield the title screen becomes that battlefield. The CSS keeps the
     original artwork as the var() fallback, so if a map image is missing or
     fails to decode the screen silently stays on the backdrop rather than
     showing an empty gradient. The image is preloaded first for the same
     reason — the swap only happens once the new art is actually ready, so
     there is never a flash of nothing between the two. */
  function applyTitleBackdrop(id) {
    const title = document.getElementById('screen-title');
    if (!title) return;
    const url = 'assets/art/maps/map-' + id + '-960.webp';
    const probe = new Image();
    probe.onload = () => title.style.setProperty('--title-bg', 'url("' + url + '")');
    probe.onerror = () => title.style.removeProperty('--title-bg');   // back to the backdrop
    probe.src = url;
  }

  M.setMap = function (id) {
    M.currentId = byId(id).id;
    if (D) D.patch({ map: M.currentId });
    renderPicker();
    applyTitleBackdrop(M.currentId);
  };

  /* ---------- install (wrap Game) ---------- */
  M.install = function () {
    if (!OLW.Game || OLW.Game.__maps) return;
    OLW.Game.__maps = true;
    const P = OLW.Game.prototype,
      C = OLW.CONFIG;
    if (M._baseAssist == null) M._baseAssist = C.AIM_ASSIST_RADIUS;

    const origReset = P.reset;
    P.reset = function () {
      origReset.call(this);
      M._game = this;
      // solo runs keep the title picker's choice; only a live multiplayer room
      // overrides the map from the room screen's selector.
      const mp = OLW.Multiplayer;
      if (mp && mp.mode && mp.mode !== "solo") {
        M.currentId = byId(mp.mapId || "frontier").id;
      }
      M._hz = 0;
      M._active = false;
      M._left = 0;
      M._spawnAcc = 0;
      M._gradePulse = 0;
      C.AIM_ASSIST_RADIUS = M._baseAssist; // clear any lingering hazard effect
    };

    const origUpdate = P.update;
    P.update = function (dt) {
      origUpdate.call(this, dt);
      if (this.state === "playing") M.tickHazard(this, dt);
    };

    const origRender = P.render;
    P.render = function () {
      origRender.call(this);
      M.applyGrade(this.ctx);
    };
  };

  /* ---------- hazards ---------- */
  M.tickHazard = function (game, dt) {
    const map = M.active(),
      C = OLW.CONFIG,
      U = OLW.U;
    if (M._gradePulse > 0) M._gradePulse = Math.max(0, M._gradePulse - dt);
    if (!map.hazard) return;

    if (M._active) {
      M._left -= dt;
      M._gradePulse = 1;
      if (map.hazard.id === "ember") {
        game.integrity = U.clamp(game.integrity - 1.1 * dt, 0, C.INTEGRITY_MAX);
        M._spawnAcc += dt;
        if (M._spawnAcc >= 1.1) {
          M._spawnAcc = 0;
          const wave = game.director.wave || 1;
          game.spawnRaider({
            angle: U.rand(0, U.TAU),
            type: "basic",
            speedMul: 1 + wave * 0.05,
          });
        }
      }
      if (M._left <= 0) {
        M._active = false;
        C.AIM_ASSIST_RADIUS = M._baseAssist; // restore aim on whiteout end
      }
    } else {
      M._hz += dt;
      if (M._hz >= map.hazard.every) {
        M._hz = 0;
        M._active = true;
        M._left = map.hazard.duration;
        M._spawnAcc = 0;
        if (map.hazard.id === "whiteout")
          C.AIM_ASSIST_RADIUS = M._baseAssist * 0.45;
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
    const map = M.active(),
      C = OLW.CONFIG;
    if (!map.grade) {
      // still allow a whiteout haze if this map has one (none for frontier)
      return;
    }
    const boost = 1 + M._gradePulse * 0.6;
    ctx.save();
    ctx.globalCompositeOperation = map.grade.blend || "soft-light";
    ctx.globalAlpha = Math.min(0.85, map.grade.alpha * boost);
    ctx.fillStyle = map.grade.color;
    ctx.fillRect(0, 0, C.WIDTH, C.HEIGHT);
    ctx.restore();

    // frost whiteout: a breathing white haze while the hazard is live
    if (map.hazard && map.hazard.id === "whiteout" && M._gradePulse > 0) {
      ctx.save();
      ctx.globalAlpha = 0.1 + 0.1 * M._gradePulse;
      ctx.fillStyle = "#dbe7f2";
      ctx.fillRect(0, 0, C.WIDTH, C.HEIGHT);
      ctx.restore();
    }
  };

  /* ---------- title map picker (solo) ---------- */
  let picker;

function injectPicker() {
  const layout =
    document.querySelector(
      '.title-layout'
    );

  if (
    !layout ||
    document.getElementById(
      'map-picker'
    )
  ) {
    return;
  }

  picker =
    document.createElement('div');

  picker.id = 'map-picker';

  picker.className =
    'map-picker-grid';

  layout.appendChild(picker);

  renderPicker();
}

function renderPicker() {
  if (!picker) return;

  picker.innerHTML =
    MAPS.map((map) => {
      const selected =
        map.id === M.currentId;

      return `
        <button
          type="button"
          class="map-card ${
            selected
              ? 'selected'
              : ''
          }"
          data-map="${map.id}"
        >
          <img
            src="assets/art/maps/map-${map.id}-960.webp"
            alt=""
          />

          <span class="map-card-overlay">
            <strong>
              ${map.name}
            </strong>

            <small>
              ${map.blurb}
            </small>
          </span>
        </button>
      `;
    }).join('');

  picker
    .querySelectorAll(
      '[data-map]'
    )
    .forEach((button) => {
      button.onclick = () => {
        M.setMap(
          button.dataset.map
        );

        OLW.Audio?.hit?.();
      };
    });
}

  function injectCss() {
    if (document.getElementById("maps-css")) return;
    const s = document.createElement("style");
    s.id = "maps-css";
    s.textContent = `
.map-picker-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;width:min(520px,100%);margin-top:12px}
.map-card{position:relative;min-width:0;height:76px;padding:0;overflow:hidden;border:1px solid rgba(255,255,255,.12);border-radius:5px;background:#0b0e13;color:#e9dfcb;cursor:pointer;text-align:left}
.map-card img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.62;filter:brightness(.68)}
.map-card-overlay{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:flex-end;padding:8px;background:linear-gradient(0deg,rgba(4,6,9,.94),rgba(4,6,9,.08) 75%)}
.map-card strong{font-size:10px;line-height:1.1}.map-card small{margin-top:2px;color:#bbb2a1;font-size:7px;line-height:1.2}
.map-card:hover,.map-card.selected{border-color:var(--amber,#e8a13a)}
.map-card.selected{box-shadow:0 0 0 1px rgba(232,161,58,.28),0 0 16px rgba(232,161,58,.16)}
.map-card.selected:after{content:"SELECTED";position:absolute;right:5px;top:5px;padding:2px 4px;background:rgba(8,10,14,.86);color:var(--gold,#f5c36b);font-size:6px;font-weight:900;letter-spacing:.7px}
@media(max-width:650px){.map-picker-grid{grid-template-columns:1fr 1fr 1fr}.map-card{height:62px}.map-card small{display:none}}
@media(max-height:560px) and (orientation:landscape){.map-picker-grid{position:absolute;left:clamp(300px,47vw,470px);bottom:54px;width:min(430px,47vw);margin:0}.map-card{height:58px}}
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
      if (!e.mapId || e.mapId === "frontier") e.mapId = M.currentId;
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
