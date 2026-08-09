// src/settings.js
/* Settings page + control options, persisted per device (profile.settings, which
   syncs to Neon). Additive: wraps Render.reticle (aim style) and Game.update
   (screen shake) and toggles OLW.Audio — no edits to the teammate's files.

   Controls: mouse aims; BOTH left-click and Space fire (Space added per request).
   Weapons 1-6, items Z/X/C/V, Q volley, P/Esc pause. */
window.OLW = window.OLW || {};

OLW.Settings = (function () {
  const D = OLW.Device;
  const DEFAULTS = {
  sound: true,
  reticle: 'brackets',
  shake: true,
  backup: 'auto',
  controlMode: 'device',

  voiceHelp: false,
  voiceResponse: true
};
  // Player-selectable control modes ONLY. AI aim-assist is intentionally NOT
  // here — it's a system/demo aid and would be an unfair advantage if players
  // could switch it on. Face + voice modes were removed; hand-cam is the one
  // hands-free option (move hand to aim, make a fist to fire).
  const CONTROLMODES = [
    { id: 'device', name: 'Mouse / Keys' },
    { id: 'gesture', name: 'Hand (cam)' },
  ];

  const RETICLES = [
    { id: 'brackets', name: 'Brackets' },
    { id: 'ring', name: 'Ring' },
    { id: 'dot', name: 'Dot + cross' },
    { id: 'chevron', name: 'Chevrons' },
  ];

  const BACKUPS = [
    { id: 'auto', name: 'Auto-defend' },
    { id: 'keyboard', name: 'Keyboard' },
    { id: 'off', name: 'Off' },
  ];

  function all() { return Object.assign({}, DEFAULTS, D.profile.settings || {}); }
  const S = {
    get(k) { const v = (D.profile.settings || {})[k]; return v === undefined ? DEFAULTS[k] : v; },
    set(k, v) {
      const s = Object.assign({}, D.profile.settings || {});
      s[k] = v; D.patch({ settings: s });
      apply();
      renderPanel();
    },
  };

  /* ---------- apply settings to the running game ---------- */
  function apply() {
    if (OLW.Audio) OLW.Audio.setMuted(!S.get('sound'));
    if (OLW.Music) OLW.Music.setMuted(!S.get('sound'));
    if (OLW.Voice && OLW.Voice.evaluate) OLW.Voice.evaluate();   // start/stop voice help
    const mute = document.getElementById('mute-btn');
    if (mute) {
      const on = S.get('sound');
      mute.textContent = on ? '🔊' : '🔇';
      mute.title = on ? 'Sound on' : 'Sound off';
    }
  }

  /* ---------- reticle styles (wrap Render.reticle) ---------- */
  function installReticle() {
    if (!OLW.Render || OLW.Render.__settingsReticle) return;
    OLW.Render.__settingsReticle = true;
    const orig = OLW.Render.reticle;
    const U = OLW.U;
    OLW.Render.reticle = function (ctx, x, y, cd01, onTarget, slot) {
      const style = S.get('reticle');
      if (style === 'brackets' || slot === 2) return orig.call(this, ctx, x, y, cd01, onTarget, slot);
      const COL = OLW.COLORS;
      const c = onTarget ? COL.torchCore : U.rgba(COL.parchment, 0.85);
      ctx.save();
      ctx.translate(x, y);
      ctx.strokeStyle = c; ctx.fillStyle = c;
      ctx.lineWidth = onTarget ? 2.4 : 1.8;
      const r = onTarget ? 15 : 12;
      if (style === 'ring') {
        ctx.beginPath(); ctx.arc(0, 0, r, 0, U.TAU); ctx.stroke();
        ctx.beginPath(); ctx.arc(0, 0, 2, 0, U.TAU); ctx.fill();
      } else if (style === 'dot') {
        ctx.beginPath(); ctx.arc(0, 0, 2.4, 0, U.TAU); ctx.fill();
        for (const a of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
          ctx.beginPath();
          ctx.moveTo(Math.cos(a) * (r - 5), Math.sin(a) * (r - 5));
          ctx.lineTo(Math.cos(a) * (r + 2), Math.sin(a) * (r + 2));
          ctx.stroke();
        }
      } else if (style === 'chevron') {
        for (const a of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
          ctx.save(); ctx.rotate(a);
          ctx.beginPath();
          ctx.moveTo(r + 4, -5); ctx.lineTo(r - 2, 0); ctx.lineTo(r + 4, 5);
          ctx.stroke(); ctx.restore();
        }
        ctx.beginPath(); ctx.arc(0, 0, 1.8, 0, U.TAU); ctx.fill();
      }
      ctx.restore();
    };
  }

  /* ---------- screen-shake toggle (wrap Game.update) ---------- */
  function installShake() {
    if (!OLW.Game || OLW.Game.__settingsShake) return;
    OLW.Game.__settingsShake = true;
    const P = OLW.Game.prototype;
    const origUpdate = P.update;
    P.update = function (dt) {
      origUpdate.call(this, dt);
      if (!S.get('shake')) this.shake = 0;
    };
  }

  /* ---------- settings panel UI ---------- */
  let panel;
  function el(t, c, h) { const e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; }

  function injectButton() {
    const actions = document.querySelector('.title-actions');
    if (!actions || document.getElementById('btn-settings')) return;
    const b = el('button', 'secondary-btn', 'Settings <span>⚙</span>');
    b.id = 'btn-settings';
    b.onclick = openPanel;
    actions.appendChild(b);
  }

  function toggleRow(label, key, sub) {
    const on = S.get(key);
    return `<div class="set-row"><div class="set-info"><b>${label}</b>${sub ? `<small>${sub}</small>` : ''}</div>` +
      `<button class="set-toggle${on ? ' on' : ''}" data-toggle="${key}"><span></span></button></div>`;
  }

  function renderPanel() {
    if (!panel) return;
    const ret = S.get('reticle');
    const retOpts = RETICLES.map(r =>
      `<button class="set-chip${ret === r.id ? ' sel' : ''}" data-reticle="${r.id}">${r.name}</button>`).join('');
    const bk = S.get('backup');
    const bkOpts = BACKUPS.map(b =>
      `<button class="set-chip${bk === b.id ? ' sel' : ''}" data-backup="${b.id}">${b.name}</button>`).join('');
    const cm = S.get('controlMode');
    const cmOpts = CONTROLMODES.map(c =>
      `<button class="set-chip${cm === c.id ? ' sel' : ''}" data-ctrlmode="${c.id}">${c.name}</button>`).join('');
    panel.innerHTML =
      `<div class="set-panel">
        <div class="set-scroll">
          ${toggleRow('Sound', 'sound', 'Music &amp; effects')}
          ${toggleRow('Screen shake', 'shake', 'Camera kick on impacts')}
          ${toggleRow('Voice help during game', 'voiceHelp', 'Say “war beast”, “dragon”, “backup team”, “supply”, or a weapon name to deploy / switch. Needs mic permission — aiming &amp; firing stay manual.')}
          ${toggleRow(
  'Warden voice responses',
  'voiceResponse',
  'The outpost confirms commands and warns you during battle'
)}
          <div class="set-row voice-help-row">
  <div class="set-info">
    <b>Voice Command Codex</b>
    <small>
      See every accepted command, alternate phrase and battle cry.
    </small>
  </div>

  <button
    type="button"
    class="set-chip voice-codex-open"
  >
    View Commands
  </button>
</div>
          <div class="set-row set-col"><div class="set-info"><b>Aim reticle</b><small>Saved on this device</small></div><div class="set-chips">${retOpts}</div></div>
          <div class="set-row set-col"><div class="set-info"><b>Control mode</b><small>Mouse/keys always work as a fallback. Hand-cam: move your hand to aim, make a fist to fire.</small></div><div class="set-chips">${cmOpts}</div></div>
          <div class="set-row set-col"><div class="set-info"><b>Player 2 backup</b><small>If the phone controller loses connection mid-match</small></div><div class="set-chips">${bkOpts}</div></div>
          <div class="set-controls">
            <b>Controls</b>
            <ul>
              <li><span>Mouse</span> aim</li>
              <li><span>Left-click / Space</span> fire</li>
              <li><span>1 – 6</span> switch weapons</li>
              <li><span>Z X C V</span> use field-kit items</li>
              <li><span>Q</span> signal volley &nbsp; · &nbsp; <span>P / Esc</span> pause</li>
            </ul>
          </div>
        </div>
        <button class="primary-btn set-close">Back to outpost</button>
      </div>`;
    panel.querySelector('.set-close').onclick = closePanel;
    panel.querySelectorAll('[data-toggle]').forEach(b => b.onclick = () => { const k = b.getAttribute('data-toggle'); S.set(k, !S.get(k)); if (OLW.Audio) OLW.Audio.resume(); });
    panel.querySelectorAll('[data-reticle]').forEach(b => b.onclick = () => S.set('reticle', b.getAttribute('data-reticle')));
    panel.querySelectorAll('[data-backup]').forEach(b => b.onclick = () => S.set('backup', b.getAttribute('data-backup')));
    panel.querySelectorAll('[data-ctrlmode]').forEach(b => b.onclick = () => {
      const m = b.getAttribute('data-ctrlmode');
      S.set('controlMode', m);
      window.dispatchEvent(new CustomEvent('olw:controlmode', { detail: m }));  // switch live
      if (OLW.Audio) OLW.Audio.resume();
    });
    panel
  .querySelector('.voice-codex-open')
  ?.addEventListener(
    'click',
    () => {
      OLW.Voice?.openGuide?.();
    }
  );
  }

  function openPanel() { if (!panel) { panel = el('div', 'set-overlay hidden'); (document.getElementById('stage') || document.body).appendChild(panel); } renderPanel(); panel.classList.remove('hidden'); }
  function closePanel() { if (panel) panel.classList.add('hidden'); }

  function injectCss() {
    if (document.getElementById('set-css')) return;
    const s = el('style'); s.id = 'set-css';
    s.textContent = `
.set-overlay{position:absolute;inset:0;z-index:45;display:grid;place-items:center;padding:clamp(10px,3vmin,28px);background:rgba(6,8,11,.82);backdrop-filter:blur(4px)}
.set-overlay {
  position: absolute;
  inset: 0;

  z-index: 75;

  display: grid;
  place-items: center;

  padding:
    clamp(8px,2vmin,22px);

  background:
    rgba(4,6,9,.87);

  backdrop-filter:
    blur(9px);
}

.set-panel {
  width:
    min(520px, 96vw);

  max-height:
    min(690px, 94dvh);

  display: flex;
  flex-direction: column;

  overflow: hidden;

  padding:
    clamp(16px,3vmin,28px);

  border:
    1px solid
    rgba(255,255,255,.1);

  border-radius: 7px;

  color: #e9dfcb;

  background:
    linear-gradient(
      155deg,
      rgba(34,39,47,.99),
      rgba(11,14,19,.995)
    );

  box-shadow:
    0 30px 90px
    rgba(0,0,0,.7);
}

.set-scroll {
  flex: 1 1 auto;
  min-height: 0;

  overflow-y: auto;

  margin-top: 8px;
}

@media (max-width: 600px) {
  .set-overlay {
    padding: 0;
  }

  .set-panel {
    width: 100vw;
    height: 100dvh;
    max-height: none;

    border: 0;
    border-radius: 0;

    padding: 14px;
  }
}

@media (
  max-height: 480px
)
and
(
  orientation: landscape
) {
  .set-overlay {
    padding: 5px;
  }

  .set-panel {
    width:
      min(660px,98vw);

    height:
      calc(100dvh - 10px);

    padding: 10px 14px;
  }

  .set-row {
    padding: 8px;
    margin-bottom: 4px;
  }

  .set-close {
    margin-top: 6px;
    padding: 8px;
  }
}
.set-head{flex:none}
.set-scroll{overflow-y:auto;flex:1 1 auto;min-height:0;margin-top:8px;-webkit-overflow-scrolling:touch}
.set-close{flex:none}
.set-row{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px;margin-bottom:7px;background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.06)}
.set-row.set-col{flex-direction:column;align-items:stretch;gap:10px}
.set-info b{font-size:13px}
.set-info small{display:block;color:#9e988b;font-size:11px;margin-top:2px}
.set-toggle{width:44px;height:24px;border-radius:14px;border:1px solid #4a4638;background:#1a1e26;position:relative;cursor:pointer;flex:none}
.set-toggle span{position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:#8b8474;transition:.15s}
.set-toggle.on{background:rgba(232,161,58,.25);border-color:var(--amber,#e8a13a)}
.set-toggle.on span{left:22px;background:var(--gold,#f5c36b)}
.set-chips{display:flex;gap:7px;flex-wrap:wrap}
.set-chip{padding:8px 12px;border:1px solid #4a4638;background:rgba(10,13,18,.7);color:#e9dfcb;cursor:pointer;border-radius:4px;font-size:12px}
.set-chip.sel{border-color:var(--amber,#e8a13a);background:rgba(40,32,16,.9);color:var(--gold,#f5c36b);font-weight:800}
.set-controls{margin-top:6px;padding:12px;background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.05)}
.set-controls b{font-size:11px;letter-spacing:2px;text-transform:uppercase;color:var(--amber,#e8a13a)}
.set-controls ul{list-style:none;margin:8px 0 0;padding:0}
.set-controls li{font-size:12px;color:#c9c1b0;padding:3px 0}
.set-controls li span{display:inline-block;min-width:96px;color:#e9dfcb;font-weight:700}
.set-close{margin-top:14px}
`;
    document.head.appendChild(s);
  }

  function init() {
    injectCss();
    installReticle();
    installShake();
    apply();
    window.addEventListener('olw:profilesync', () => { apply(); renderPanel(); });
  }

  init();
  S.open = openPanel;
S.close = closePanel;
  return S;
})();
