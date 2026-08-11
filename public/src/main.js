// src/main.js

/* Bootstrap: wires DOM, input, HUD, screens and the leaderboard to the Game. */
(function () {
  const C = OLW.CONFIG, COL = OLW.COLORS, U = OLW.U;
  const $ = (id) => document.getElementById(id);

  const canvas = $('game');
  const hud = $('hud');
  const screens = $('screens');

  let lastResult = null;
  let currentJoinUrl = '';
let roomCreationInProgress = false;
let lastMultiplayerStatsSent = 0;
let selectedRoomMode = 'coop';
let selectedDefendTime = 60;    // versus: seconds the defender must survive
let soloPhoneStarted = false;   // guard so auto-start fires once per solo-phone room

let lastPreviewSent =
  0;

const previewCanvas =
  document.createElement(
    'canvas'
  );

previewCanvas.width =
  640;

previewCanvas.height =
  360;

const previewCtx =
  previewCanvas.getContext(
    '2d',
    {
      alpha: false
    }
  );

  /* ---------- screen manager ---------- */
  const screenEls = {
    title: $('screen-title'),
    how: $('screen-how'),
    scores: $('screen-scores'),
    qr: $('screen-qr'),
    over: $('screen-over'),
  };
  function showScreen(name) {
    for (const k in screenEls) screenEls[k].classList.toggle('hidden', k !== name);
    screens.classList.remove('hidden');
    hud.classList.add('hidden');
    if (name === 'title') updateTitleBest();
    const active = screenEls[name];
    if (active && window.gsap) {
      gsap.fromTo(active, { autoAlpha: 0 }, { autoAlpha: 1, duration: .38, ease: 'power2.out' });
      const card = active.querySelector('.panel, .title-layout');
      if (card) gsap.fromTo(card, { y: 18, scale: .985 }, { y: 0, scale: 1, duration: .55, ease: 'power3.out' });
    }
  }
  function enterGameUI() {
    screens.classList.add('hidden');
    hud.classList.remove('hidden');
    if (window.gsap) gsap.fromTo(hud, { autoAlpha: 0 }, { autoAlpha: 1, duration: .45 });
  }

  /* ---------- loading gate: don't drop into the field until art is decoded ---
     Fixes the mobile "start then everything is stuck while images stream in"
     feeling. Shows a progress overlay; starts as soon as assets settle, with a
     safety timeout so the booth kiosk never hard-blocks. */
  let loadEl = null, loadTimer = null;
  function showLoadingOverlay() {
    if (!loadEl) {
      if (!document.getElementById('load-css')) {
        const st = document.createElement('style'); st.id = 'load-css';
        st.textContent = '#load-overlay{position:absolute;inset:0;z-index:80;display:grid;place-items:center;background:radial-gradient(circle at 50% 40%,#12161d,#070a0e);color:#e9dfcb}#load-overlay .lo-box{display:flex;flex-direction:column;align-items:center;gap:14px;text-align:center;padding:20px}#load-overlay .lo-title{font-family:Georgia,serif;font-size:clamp(18px,3vmin,26px);color:#f5c36b}#load-overlay .lo-track{width:min(260px,60vw);height:6px;border-radius:3px;background:rgba(255,255,255,.1);overflow:hidden}#load-overlay .lo-fill{height:100%;width:0;background:linear-gradient(90deg,#f5c36b,#e8a13a);transition:width .2s}#load-overlay .lo-sub{font-size:11px;color:#9e988b;letter-spacing:2px;text-transform:uppercase}';
        document.head.appendChild(st);
      }
      loadEl = document.createElement('div'); loadEl.id = 'load-overlay';
      loadEl.innerHTML = '<div class="lo-box"><div class="lo-title">Preparing the outpost…</div><div class="lo-track"><div class="lo-fill" id="lo-fill"></div></div><div class="lo-sub" id="lo-pct">Loading 0%</div></div>';
      (document.getElementById('stage') || document.body).appendChild(loadEl);
    }
    loadEl.style.display = 'grid';
    const upd = () => {
      const p = (OLW.Assets && OLW.Assets.progress) ? OLW.Assets.progress() : { loaded: 1, total: 1 };
      const pct = Math.round(100 * p.loaded / Math.max(1, p.total));
      const f = document.getElementById('lo-fill'), t = document.getElementById('lo-pct');
      if (f) f.style.width = pct + '%';
      if (t) t.textContent = 'Loading ' + pct + '%';
    };
    upd(); loadTimer = setInterval(upd, 120);
  }
  function hideLoadingOverlay() {
    if (loadTimer) { clearInterval(loadTimer); loadTimer = null; }
    if (loadEl) loadEl.style.display = 'none';
  }
  function startGameWithLoader() {
    const prog = (OLW.Assets && OLW.Assets.progress) ? OLW.Assets.progress() : { loaded: 1, total: 1 };
    if (!OLW.Assets || prog.loaded >= prog.total) { enterGameUI(); game.start(); return; }
    showLoadingOverlay();
    let started = false;
    const go = () => { if (started) return; started = true; hideLoadingOverlay(); enterGameUI(); game.start(); };
    OLW.Assets.whenLoaded(go);
    setTimeout(go, 6000);   // safety: never hard-block the kiosk
  }

  /* ---------- render resolution ----------
     The mirror can only be Full-HD if the canvas actually holds Full-HD
     pixels, so supersample the 960x540 logical space to 1920x1080 on any
     machine that can afford it. Phones and weak CPUs stay at 1x; the stream
     controller drops this again if the encoder reports CPU pressure. */
  OLW.CONFIG.RENDER_SCALE = (function () {
    try {
      const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
      const cores = navigator.hardwareConcurrency || 2;
      // screen.* reads 0 in some embedded webviews — fall back to the window.
      const px = Math.max(screen.width || 0, screen.height || 0, window.innerWidth || 0);
      const wide = px === 0 || px >= 1024;
      if (coarse || cores < 4 || !wide) return 1;
      return cores >= 8 ? 2 : 1.5;
    } catch (e) { return 1; }
  })();

  /* ---------- game ---------- */
  const game = new OLW.Game(canvas, {
    onStats: updateHud,
    onGameOver: onGameOver,
  });
  OLW.Multiplayer.on('roomState', (room) => {
  if (!room?.controller?.connected) {
    return;
  }

  $('player-two-card').classList.remove('waiting');
  $('player-two-card').classList.add('connected');

  $('controller-player-name').textContent =
    room.controller.name || 'Warden 2';

  $('controller-player-status').textContent =
    'Connected and ready';

  $('room-message').classList.remove('error');

  // Solo-phone: the phone IS the only player — start automatically on connect.
  if (OLW.Multiplayer.mode === 'solophone') {
    $('room-message').textContent = 'Phone connected — starting the watch…';
    if (!soloPhoneStarted) {
      soloPhoneStarted = true;
      OLW.Multiplayer.startRoom();
    }
    return;
  }

  $('room-message').textContent =
    'Both guards are ready. Begin the watch.';

  $('btn-start-room').disabled = false;
});

OLW.Multiplayer.on('matchStarted', (payload) => {
  // versus: this kiosk is the DEFENDER; the phone attacker spawns raiders
  const mode = (payload && payload.room && payload.room.mode) || OLW.Multiplayer.mode;
  game._versusPending = (mode === 'versus');
  if (mode === 'versus') game._versusDurationPending = selectedDefendTime;
  enterGameUI();
  game.start();
});

// keep a resumable ?room= in the host's URL so a refresh / reopen can rejoin
function setRoomUrl(code) { try { history.replaceState(null, '', '/?room=' + encodeURIComponent(code)); } catch (e) {} }
function clearRoomUrl() { try { history.replaceState(null, '', '/'); } catch (e) {} }

// Opponent left / room closed. In a live versus match the player still here wins;
// otherwise just bounce back to the outpost. Always clear the resume + URL so the
// device is never pulled back into a dead room.
OLW.Multiplayer.on('roomCancelled', (info) => {
  clearRoomUrl();
  const playing = game.state === 'playing';
  if (playing && info && info.mode === 'versus') {
    // host is the defender and is still connected → host wins by forfeit
    // (onGameOver records the W/L from res.versusWinner, so don't double-count)
    game._forcedVersusWinner = 'defender';
    game.gameOver();
  } else if (!playing) {
    resetRoomScreen();
    showScreen('title');
  }
  soloPhoneStarted = false;
});

// Reconnected into a room. If it's a LIVE match but our game isn't running (the
// page was reloaded → state is gone), the host can't continue → forfeit cleanly.
OLW.Multiplayer.on('resumed', (info) => {
  const room = info && info.room;
  if (!room) return;
  if (room.status === 'active' && game.state !== 'playing') {
    // can't restore a live match after a reload → leave (host forfeits)
    OLW.Multiplayer.cancelRoom();
    clearRoomUrl();
    resetRoomScreen();
    showScreen('title');
  } else if (room.status !== 'active') {
    // back in the lobby → show it
    selectedRoomMode = room.mode || selectedRoomMode;
    showScreen('qr');
  }
});

function recordVersusResult(outcome) {
  try { return (OLW.Device && OLW.Device.recordVersus) ? OLW.Device.recordVersus(outcome) : null; }
  catch (e) { return null; }
}

// versus: the attacker's phone requested a raider from a lane
OLW.Multiplayer.on('player2Spawn', (payload) => {
  if (game.versus) game.spawnAttackerRaider({ lane: payload.lane, type: payload.raiderType });
});

// In solo-phone the phone drives the MAIN warden (Player 1); in co-op/versus it
// drives the second reticle (Player 2).
OLW.Multiplayer.on('player2Aim', (payload) => {
  const x = payload.x * C.WIDTH, y = payload.y * C.HEIGHT;
  if (OLW.Multiplayer.mode === 'solophone') game.setAim(x, y);
  else game.setPlayer2Aim(x, y);
});

OLW.Multiplayer.on('player2Strike', (payload) => {
  const x = payload.x * C.WIDTH, y = payload.y * C.HEIGHT;
  if (OLW.Multiplayer.mode === 'solophone') { game.setAim(x, y); game.strike(); }
  else game.strikePlayer2(x, y);
});

OLW.Multiplayer.on('player2Volley', () => {
  if (OLW.Multiplayer.mode === 'solophone') game.useVolley();
  else game.usePlayer2Volley();
});

/* ---------------- in-game announcement (toast + spoken warden line) ----------
   Used for the co-op partner events, which happen mid-fight when the player is
   watching the wall, not the lobby card. */
function announce(text, speech, tone) {
  let el = document.getElementById('olw-announce');
  if (!el) {
    const css = document.createElement('style');
    css.textContent =
      '#olw-announce{position:absolute;left:50%;top:84px;transform:translateX(-50%) translateY(-8px);' +
      'z-index:30;max-width:min(560px,88vw);text-align:center;padding:9px 18px;border-radius:4px;' +
      'background:rgba(18,13,9,.92);border:1px solid #7a5a2a;color:#f5c36b;font:800 13px/1.45 "Segoe UI",system-ui,sans-serif;' +
      'letter-spacing:.3px;pointer-events:none;opacity:0;transition:opacity .28s ease,transform .28s ease}' +
      '#olw-announce.show{opacity:1;transform:translateX(-50%) translateY(0)}' +
      '#olw-announce.bad{color:#e8907a;border-color:#8c4433}';
    document.head.appendChild(css);
    el = document.createElement('div');
    el.id = 'olw-announce';
    (document.getElementById('stage') || document.body).appendChild(el);
  }
  el.textContent = text;
  el.classList.toggle('bad', tone === 'bad');
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 4200);

  if (speech) {
    OLW.Voice?.speak?.(speech, { interrupt: true, rate: 0.9, pitch: 0.72 });
  }
}

OLW.Multiplayer.on('playerLeft', (payload) => {
  if (payload.role !== 'controller') {
    return;
  }

  // Mid-match in co-op the wall is still standing: Player 1 fights on alone and
  // the backup controls pick up P2. Say so out loud — the player is looking at
  // the battlefield, not the lobby card.
  if (game.state === 'playing' && OLW.Multiplayer.mode === 'coop') {
    announce._p2Away = true;
    game.setPlayer2Away(true);      // empty the post — nothing takes it over
    announce(
      'PLAYER 2 IS DOWN — their post is unmanned. You hold the wall alone.',
      'Player two is down. You hold the wall alone.',
      'bad'
    );
    return;
  }

  $('player-two-card').classList.add('waiting');
  $('player-two-card').classList.remove('connected');

  $('controller-player-name').textContent =
    'Player 2 disconnected';

  $('controller-player-status').textContent =
    'Waiting for reconnection';

  $('room-message').classList.add('error');
  $('room-message').textContent =
    'Player 2 lost connection.';
});

// Lost the phone but not yet timed out — empty the post straight away rather
// than leaving a reticle frozen mid-battlefield.
OLW.Multiplayer.on('peerAway', (p) => {
  if (p && p.role === 'controller' && OLW.Multiplayer.mode === 'coop') {
    game.setPlayer2Away(true);
  }
});

// Partner is back on the wall.
OLW.Multiplayer.on('roomState', (room) => {
  const back = room && room.controller && room.controller.connected;
  if (!back || game.state !== 'playing' || OLW.Multiplayer.mode !== 'coop') return;
  game.setPlayer2Away(false);
  if (!announce._p2Away) return;
  announce._p2Away = false;
  announce('PLAYER 2 IS BACK ON THE WALL', 'Player two is back.', 'ok');
});
  window.OLW_GAME = game; // exposed for debugging / QA

  /* ---------------- HD adaptive screen mirror (host / sender) ----------------
     Streams the live canvas to the phone over WebRTC. The phone runs the ABR
     control loop and asks for a rendition; we honour it, capped by what our
     own uplink measurement says we can actually push. The old webp-frame path
     stays as the bootstrap picture and the fallback if WebRTC can't connect. */
  const hostStream = (OLW.Stream && OLW.Stream.createHost({
    canvas: canvas,
    socket: OLW.Multiplayer.socket,
    getRoomCode: () => OLW.Multiplayer.roomCode,
    onLevel: (rung, why) => {
      if (window.OLW_STREAM_DEBUG) console.log('[mirror] ->', rung.label, why);
    },
    onCpuPressure: () => {
      // encoder is CPU-bound: shed supersampling before gameplay stutters
      game.setRenderScale((game.renderScale || 1) - 0.5);
    }
  })) || null;

  window.OLW_MIRROR = hostStream;   // exposed for debugging / QA

  function startMirror() {
    if (!hostStream) return;
    if (OLW.Multiplayer.mode === 'solo' || !OLW.Multiplayer.roomCode) return;
    hostStream.start();
  }
  function stopMirror() { if (hostStream) hostStream.stop(); }

  if (hostStream && OLW.Multiplayer.socket) {
    const sock = OLW.Multiplayer.socket;
    sock.on('rtc:request', startMirror);
    sock.on('rtc:answer', (p) => hostStream.onAnswer(p));
    sock.on('rtc:ice', (p) => hostStream.onIce(p));
    sock.on('stream:quality', (p) => hostStream.onQualityRequest(p));
    sock.on('rtc:down', () => { /* phone dropped the view; keep sending, it re-asks */ });
  }

  OLW.Multiplayer.on('matchStarted', startMirror);
  // host refreshed mid-match: the phone is still there, so put the mirror back
  OLW.Multiplayer.on('resumed', (p) => {
    if (p && p.room && p.room.status === 'active') startMirror();
  });
  OLW.Multiplayer.on('roomCancelled', stopMirror);
  OLW.Multiplayer.on('playerLeft', (p) => { if (p && p.role === 'controller') stopMirror(); });

  function updateHud(s) {
    const pct = U.clamp(s.integrity / s.integrityMax, 0, 1);
    const fill = $('integrity-fill');
    fill.style.width = (pct * 100).toFixed(1) + '%';
    let col = COL.integrityGood;
    if (pct < 0.55) col = COL.integrityMid;
    if (pct < 0.28) col = COL.integrityLow;
    fill.style.background = col;
    $('integrity-text').textContent = Math.ceil(pct * 100) + '%';

    $('time-val').textContent = U.fmtTime(s.time);
    $('score-val').textContent = s.score;
    if (s.versus) {
      $('wave-tag').textContent = 'DEFEND';
      $('wave-sub').textContent = 'Hold ' + (s.versusTimeLeft != null ? s.versusTimeLeft : 0) + 's';
    } else {
      $('wave-tag').textContent = s.wave > 0 ? ('Wave ' + s.wave) : 'Standing by';
      $('wave-sub').textContent = s.breather > 0.05
        ? ('Next wave in ' + Math.ceil(s.breather) + 's')
        : '';
    }
    const combo = $('combo-pill');
    combo.classList.toggle('hidden', s.multiplier < 2);
    $('combo-val').textContent = 'x' + s.multiplier;
    const volleyPct = Math.min(100, (s.volleyCharge / s.volleyMax) * 100);
    $('volley-fill').style.width = volleyPct + '%';
    $('volley-status').textContent = s.volleyCharge >= s.volleyMax ? 'READY — FIRE!' : `${s.volleyCharge} / ${s.volleyMax}`;
    $('volley-btn').disabled = s.volleyCharge < s.volleyMax;
    $('volley-btn').classList.toggle('ready', s.volleyCharge >= s.volleyMax);

    const now = performance.now();

if (
  OLW.Multiplayer.mode !== 'solo' &&
  now - lastMultiplayerStatsSent >= 100
) {
  lastMultiplayerStatsSent = now;

  OLW.Multiplayer.sendMatchStats({
    integrity: s.integrity,
    integrityMax: s.integrityMax,
    score: s.score,
    time: s.time,
    wave: s.wave,
    versus: s.versus,
    versusTimeLeft: s.versusTimeLeft,
    player2Charge: s.player2Charge
  });
}
/* Legacy webp-frame mirror. This is the bootstrap picture (shown until the
   WebRTC stream connects) and the fallback if it never does. Once the HD
   stream is live we stop entirely — toDataURL every 70ms is a main-thread
   JPEG-style encode that was costing the game more than it was worth. */
const mirrorLive = hostStream && hostStream.isLive();
if (
  OLW.Multiplayer.mode !== 'solo' &&
  !mirrorLive &&
  now - lastPreviewSent >= 70
) {
  lastPreviewSent = now;

  try {
    previewCtx.drawImage(canvas, 0, 0, 640, 360);

    const preview = previewCanvas.toDataURL('image/webp', 0.6);

    OLW.Multiplayer.sendMatchPreview?.(preview);
  } catch (error) {
    /*
      Preview is non-essential.
      Never interrupt the game.
    */
  }
}

  }
async function recordCompletedWatch(result) {
  if (!result) return null;

  if (result._recordPromise) {
    return result._recordPromise;
  }

  result._recordPromise = (async () => {
    try {
      const response =
        await OLW.Leaderboard.submit({
          name: 'Unclaimed Guard',

          company: '',
          playerName: '',

          mode:
            (
              OLW.Multiplayer?.mode === 'coop' ||
              OLW.Multiplayer?.mode === 'versus'
            )
              ? OLW.Multiplayer.mode
              : 'solo',

          mapId:
            OLW.Maps?.currentId ||
            OLW.Multiplayer?.mapId ||
            'frontier',

          score: result.score,
          time: result.time,
          waves: result.waves,
          kills: result.kills,
          perfectWaves:
            result.perfectWaves
        });

      result._leaderboardId =
        response?.id || null;

      result._recorded = true;

      return response;

    } catch (error) {
      console.error(
        'Automatic score recording failed:',
        error
      );

      result._recorded = false;

      return null;
    }
  })();

  return result._recordPromise;
}

  

  function onGameOver(res) {
    lastResult = res;
    res._saved = false;
    res._skipped = false;
    stopMirror();   // the watch is over — stop encoding for the phone
    $('res-time').textContent = res.time + 's';
    $('res-waves').textContent = res.waves;
    $('res-kills').textContent = res.kills;
    $('res-score').textContent = res.score;

    res._recorded = false;
res._leaderboardId = null;
res._signed = false;

/*
 * IMPORTANT:
 * Record every completed game immediately.
 *
 * Do not wait for the player to enter their name.
 */
recordCompletedWatch(res);

    const overTitle = document.querySelector('#screen-over .panel-title');
    if (res.versus) {
      // Versus outcome (this kiosk is the defender): announce the winner + record W/L.
      const defenderWon = res.versusWinner === 'defender';
      if (overTitle) overTitle.textContent = defenderWon ? 'Outpost held!' : 'The wall has fallen';
      const forfeit = res.versusForfeit ? ' (by forfeit)' : '';
      const rec = recordVersusResult(defenderWon ? 'win' : 'loss') || {};
      const tally = (rec.versusWins != null) ? ` · Your record: ${rec.versusWins}W ${rec.versusLosses}L` : '';
      $('res-rank').textContent = (defenderWon
        ? `YOU WIN${forfeit} — defended ${res.survived != null ? Math.round(res.survived) : Math.round(res.time)}s.`
        : `YOU LOSE${forfeit} — the wall fell in ${Math.round(res.time)}s.`) + tally;
    } else {
      if (overTitle) overTitle.textContent = 'The wall has fallen';
      // Placeholder now; the rank is fetched in the background so the game-over
      // screen appears INSTANTLY (previously it awaited a leaderboard fetch that
      // could stall/hang, leaving the battlefield frozen with no modal).
      $('res-rank').textContent = 'Tallying the Watch Roll…';
      const scoreForRank = res.score;
      OLW.Leaderboard.rankOf(scoreForRank)
        .then((rank) => {
          if (lastResult !== res) return;   // a new run started meanwhile
          $('res-rank').textContent = rank <= 10
            ? `Provisional rank #${rank} — sign the roll to claim it.`
            : `You reached rank #${rank}. Another watch could break the top ten.`;
        })
        .catch(() => {
          if (lastResult !== res) return;
          $('res-rank').textContent = 'Sign the roll to record your score.';
        });
    }

    // Name entry + actions are shown together: the score is saved automatically on
    // any exit UNLESS the guard explicitly taps "Continue without saving".
    $('name-entry').classList.remove('hidden');
    $('over-actions').classList.remove('hidden');
    $('save-status').textContent = '';
    $('save-status').className = 'save-status';
    $('btn-save-score').disabled = false;
    $('company-input').value = OLW.Device?.profile?.company || '';
    $('name-input').value = '';
    showScreen('over');            // shows immediately — no awaiting the network
    setTimeout(() => $('company-input').focus(), 100);
  }

  /* ---------- input: aim + strike ---------- */
  function toGame(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    const x = (clientX - r.left) * (C.WIDTH / r.width);
    const y = (clientY - r.top) * (C.HEIGHT / r.height);
    return { x: U.clamp(x, 0, C.WIDTH), y: U.clamp(y, 0, C.HEIGHT) };
  }

  canvas.addEventListener('pointermove', (e) => {
    const p = toGame(e.clientX, e.clientY);
    game.setAim(p.x, p.y);
  });
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    OLW.Audio.resume();
    const p = toGame(e.clientX, e.clientY);
    game.setAim(p.x, p.y);
    game.strike();
  });
  // block context menu / scrolling on the play surface
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.style.touchAction = 'none';


  function visibleScreenName() {
    for (const [name, node] of Object.entries(screenEls)) {
      if (node && !node.classList.contains('hidden')) return name;
    }
    return null;
  }

  function closeTopModal() {
    // Dynamic overlays first.
    const armory = document.querySelector('.ars-shop:not(.hidden)');
    if (armory) {
      if (OLW.Arsenal?.close) OLW.Arsenal.close();
      else armory.classList.add('hidden');
      return true;
    }

    const voiceGuide =
  document.querySelector(
    '.voice-guide-overlay:not(.hidden)'
  );

if (voiceGuide) {
  OLW.Voice?.closeGuide?.();

  return true;
}

    const settings = document.querySelector('.set-overlay:not(.hidden)');
    if (settings) {
      if (OLW.Settings?.close) OLW.Settings.close();
      else settings.classList.add('hidden');
      return true;
    }

    const visible = visibleScreenName();
    if (!visible || visible === 'title') return false;

    if (visible === 'qr') {
      // If a room was already created, cancel it cleanly rather than merely
      // hiding its UI and leaving the server room alive.
      const lobby = $('room-lobby');
      if (lobby && !lobby.classList.contains('hidden')) {
        cancelSharedRoom();
      } else {
        showScreen('title');
      }
      return true;
    }

    // Closing the game-over screen (X / Esc / backdrop) counts as "keep my
    // score" — only "Continue without saving" opts out.
   if (visible === 'over') {
  recordCompletedWatch(lastResult);
}

    showScreen('title');
    return true;
  }

  // ESC closes any modal/screen first. Only when no modal is open does it
  // behave as gameplay pause/resume. P always remains the dedicated pause key.
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (closeTopModal()) {
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      // solo only — game.pause() refuses in any two-player mode
      if (game.state === 'playing') game.pause();
      else if (game.state === 'paused') game.resume();
      return;
    }

    if (e.key === 'p' || e.key === 'P') {
      if (game.state === 'playing') game.pause();
      else if (game.state === 'paused') game.resume();
    } else if (e.code === 'Space' && game.state === 'playing') {
      e.preventDefault();
      game.strike();
    } else if ((e.key === 'q' || e.key === 'Q') && game.state === 'playing') {
      game.useVolley();
    }
  });

  // Click/tap the dark backdrop to close every modal-style screen.
  document.addEventListener('pointerdown', (e) => {
    if (e.target.matches?.('.ars-shop')) {
      OLW.Arsenal?.close?.();
      return;
    }
    if (e.target.matches?.('.set-overlay')) {
      OLW.Settings?.close?.();
      return;
    }
    if (e.target.matches?.('.screen:not(.title-screen)')) {
      closeTopModal();
    }
  });

  // Give every non-title screen a consistent top-right X without duplicating
  // markup in each HTML panel.
  ['how', 'scores', 'qr', 'over'].forEach((name) => {
    const screen = screenEls[name];
    const panel = screen?.querySelector('.panel');
    if (!panel || panel.querySelector('.modal-close')) return;
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'modal-close';
    close.setAttribute('aria-label', 'Close');
    close.title = 'Close';
    close.textContent = '✕';
    close.addEventListener('click', closeTopModal);
    panel.appendChild(close);
  });
document
  .querySelectorAll('.mode-option')
  .forEach((button) => {
    button.addEventListener('click', () => {
      document
        .querySelectorAll('.mode-option')
        .forEach((item) => {
          item.classList.remove('selected');
        });

      button.classList.add('selected');

      selectedRoomMode =
        button.dataset.mode || 'coop';

      // show the defend-time picker only for versus
      const tr = $('versus-time-row');
      if (tr) tr.classList.toggle('hidden', selectedRoomMode !== 'versus');
    });
  });

// defend-time picker (versus)
document.querySelectorAll('.time-opt').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.time-opt').forEach((b) => b.classList.remove('selected'));
    btn.classList.add('selected');
    selectedDefendTime = parseInt(btn.dataset.time, 10) || 60;
  });
});
 /* ---------- menu buttons ---------- */

$('btn-play').addEventListener('click', () => {
  startGameWithLoader();
});

$('btn-how').addEventListener('click', () => {
  briefGo(0);          // always open the manual on the first card
  showScreen('how');
});

/* ---------- briefing carousel (Field Manual) ---------- */
let briefIdx = 0;
function briefGo(i) {
  const track = $('brief-track');
  if (!track) return;
  const slides = track.children;
  briefIdx = Math.max(0, Math.min(slides.length - 1, i));
  track.style.transform = `translateX(${-briefIdx * 100}%)`;
  const dots = $('brief-dots');
  if (dots) [...dots.children].forEach((d, j) => d.classList.toggle('active', j === briefIdx));
  const prev = document.querySelector('.brief-prev');
  const next = document.querySelector('.brief-next');
  if (prev) prev.disabled = briefIdx === 0;
  if (next) next.disabled = briefIdx === slides.length - 1;
}
(function initBrief() {
  const track = $('brief-track');
  const dots = $('brief-dots');
  if (!track || !dots) return;
  const slides = track.children;
  for (let i = 0; i < slides.length; i++) {
    const d = document.createElement('button');
    d.type = 'button';
    d.className = 'brief-dot' + (i === 0 ? ' active' : '');
    d.setAttribute('aria-label', 'Card ' + (i + 1));
    d.addEventListener('click', () => briefGo(i));
    dots.appendChild(d);
  }
  document.querySelector('.brief-prev')?.addEventListener('click', () => briefGo(briefIdx - 1));
  document.querySelector('.brief-next')?.addEventListener('click', () => briefGo(briefIdx + 1));
  document
  .querySelector('.brief-voice-codex')
  ?.addEventListener(
    'click',
    () => {
      OLW.Voice?.openGuide?.();
    }
  );
  // arrow keys while the manual is open
  window.addEventListener('keydown', (e) => {
    const how = document.getElementById('screen-how');
    if (!how || how.classList.contains('hidden')) return;
    if (e.key === 'ArrowLeft') briefGo(briefIdx - 1);
    else if (e.key === 'ArrowRight') briefGo(briefIdx + 1);
  });
  // swipe on touch
  const vp = document.querySelector('.brief-viewport');
  let sx = 0, sw = false;
  vp?.addEventListener('pointerdown', (e) => { sx = e.clientX; sw = true; });
  vp?.addEventListener('pointerup', (e) => {
    if (!sw) return; sw = false;
    const dx = e.clientX - sx;
    if (dx > 40) briefGo(briefIdx - 1);
    else if (dx < -40) briefGo(briefIdx + 1);
  });
  briefGo(0);
})();

$('btn-scores').addEventListener('click', async () => {
  showScreen('scores');
  await renderScores();
});

$('btn-qr').addEventListener('click', () => {
  // normal multiplayer modal: use whatever mode chip is selected (default coop)
  const sel = document.querySelector('.mode-option.selected');
  selectedRoomMode = (sel && sel.dataset.mode) || 'coop';
  resetRoomScreen();
  showScreen('qr');
});

// Quick access: one tap → creates a solo-phone room and shows the QR directly,
// skipping the multiplayer setup form (no flash of the setup modal).
$('btn-phone-solo')?.addEventListener('click', async () => {
  selectedRoomMode = 'solophone';
  resetRoomScreen();
  // jump straight to the lobby/QR view BEFORE the network round-trip so the
  // setup form (mode picker) never flashes on screen
  $('room-setup').classList.add('hidden');
  $('room-lobby').classList.remove('hidden');
  $('room-screen-title').textContent = 'Solo · Phone';
  $('room-code').textContent = '······';
  $('game-qr').innerHTML = '<div class="qr-loading">Generating code…</div>';
  $('room-message').textContent = 'Preparing your controller link…';
  showScreen('qr');
  await createSharedRoom();
});

document
  .querySelectorAll('[data-back]')
  .forEach((button) => {
    button.addEventListener('click', () => {
      showScreen('title');
    });
  });

/* Settings, reachable mid-raid from the bottom-right cluster.
   Opening it pauses the battle behind the panel so you are not being overrun
   while changing your reticle — but only in solo, since game.pause() refuses in
   any two-player mode and freezing the wall there would punish the other
   player. Settings apply the moment they are toggled (OLW.Settings.set calls
   apply()), so there is nothing to commit on close. */
(() => {
  const b = $('settings-btn');
  if (!b || !OLW.Settings) return;
  let pausedByPanel = false;

  /* Watch the panel itself rather than the things that close it. It can be
     dismissed by the Back button, by Esc through closeTopModal(), or by a
     backdrop click — and the Esc path calls stopImmediatePropagation(), so a
     keydown listener here would never run. Observing the class covers all
     three routes with one rule. */
  let watching = null;
  function watchPanel() {
    const panel = document.querySelector('.set-overlay');
    if (!panel || watching === panel) return;
    watching = panel;
    new MutationObserver(() => {
      if (panel.classList.contains('hidden') && pausedByPanel) {
        pausedByPanel = false;
        game.resume();
      }
    }).observe(panel, { attributes: true, attributeFilter: ['class'] });
  }

  b.addEventListener('click', () => {
    if (game.state === 'playing' && game.canPause()) {
      game.pause();
      pausedByPanel = game.state === 'paused';
    }
    OLW.Settings.open();
    watchPanel();          // the overlay is created lazily on first open
  });
})();

// Pause exists again for solo play. The button hides itself in two-player
// modes, where game.pause() would refuse anyway — better to not offer it than
// to offer a button that does nothing.
(() => {
  const b = $('pause-btn');
  if (!b) return;
  b.addEventListener('click', () => {
    if (game.state === 'playing') game.pause();
    else if (game.state === 'paused') game.resume();
  });
  const sync = () => { b.style.display = game.canPause() ? '' : 'none'; };
  sync();
  OLW.Multiplayer.on('matchStarted', sync);
  OLW.Multiplayer.on('roomState', sync);
  OLW.Multiplayer.on('roomCancelled', sync);
})();

$('volley-btn').addEventListener('click', () => {
  game.useVolley();
});

$('mute-btn').addEventListener('click', () => {
  const muted = OLW.Audio.toggle();

  $('mute-btn').textContent = muted ? '🔇' : '🔊';
  $('mute-btn').title = muted ? 'Sound off' : 'Sound on';
});

/* ---------- multiplayer buttons ---------- */

$('btn-create-room').addEventListener(
  'click',
  createSharedRoom
);

$('btn-start-room').addEventListener(
  'click',
  startSharedRoom
);

$('btn-cancel-room').addEventListener(
  'click',
  cancelSharedRoom
);

$('btn-room-back').addEventListener('click', () => {
  // leaving the lobby cancels the room + clears the saved resume so the device
  // is never pulled back into a stale room later
  cancelSharedRoom();
});

/* ---------- game-over buttons ---------- */

$('btn-save-score').addEventListener(
  'click',
  saveScore
);

['company-input', 'name-input'].forEach((id) => {
  $(id).addEventListener('keydown', (event) => {
    if (event.key === 'Enter') saveScore();
  });
});

$('btn-retry').addEventListener(
  'click',
  () => {
    recordCompletedWatch(lastResult);
    startGameWithLoader();
  }
);

$('btn-menu').addEventListener(
  'click',
  () => {
    recordCompletedWatch(lastResult);
    showScreen('title');
  }
);

$('btn-settings-launch')?.addEventListener(
  'click',
  () => OLW.Settings?.open?.()
);

// Explicit opt-out: the ONLY path that discards the score.
$('btn-skip-score')
  ?.addEventListener(
    'click',
    async () => {
      if (!lastResult) return;

      /*
       * The score is NOT discarded.
       * Only the participant identity remains unclaimed.
       */
      await recordCompletedWatch(
        lastResult
      );

      lastResult._signed = false;

      const status =
        $('save-status');

      status.textContent =
        'Score recorded without a name.';

      status.className =
        'save-status muted';

      $('btn-save-score').disabled =
        false;

      /*
       * Continue to menu immediately if desired:
       */
      showScreen('title');
    }
  );

  // Build "[Company] - [Player]" per the event's naming convention. Both parts
  // are optional; falls back sensibly when one or both are blank.
  function buildDisplayName() {
    const company = ($('company-input').value || '').trim().slice(0, 40);
    const player = ($('name-input').value || '').trim().slice(0, 24);
    if (company && player) return `${company} - ${player}`;
    if (company) return `${company} - Guard`;
    if (player) return player;
    return 'Anonymous Guard';
  }

  // Save the run unless it was already saved or the guard opted out. Called on
  // every exit from the game-over screen (retry / menu / close / Esc).
  async function commitScoreIfNeeded() {
    if (!lastResult || lastResult._saved || lastResult._skipped) return;
    await saveScore();
  }

  async function saveScore() {
  if (!lastResult) {
    return;
  }

  if (lastResult._signed) {
    return;
  }

  const company =
    ($('company-input').value || '')
      .trim()
      .slice(0, 40);

  const player =
    ($('name-input').value || '')
      .trim()
      .slice(0, 24);

  const status =
    $('save-status');

  if (!company) {
    status.textContent =
      'Enter your company name.';

    status.className =
      'save-status err';

    $('company-input').focus();

    return;
  }

  if (!player) {
    status.textContent =
      'Enter your player name.';

    status.className =
      'save-status err';

    $('name-input').focus();

    return;
  }

  $('btn-save-score').disabled = true;

  status.textContent =
    'Signing your Watch Roll entry…';

  status.className =
    'save-status muted';

  /*
   * Normally this is already finished because it started
   * immediately at game over.
   */
  await recordCompletedWatch(
    lastResult
  );

  if (!lastResult._leaderboardId) {
    $('btn-save-score').disabled = false;

    status.textContent =
      'Score could not be recorded. Tap again to retry.';

    status.className =
      'save-status err';

    /*
     * Allow recordCompletedWatch() to retry.
     */
    lastResult._recordPromise = null;

    return;
  }

  try {
    await OLW.Leaderboard.signEntry(
      lastResult._leaderboardId,
      {
        company,
        playerName: player
      }
    );

    lastResult._signed = true;

    /*
     * Remember company for the next participant flow
     * only if that is useful on your event kiosk.
     *
     * If many companies share one kiosk, REMOVE this.
     */
    // OLW.Device?.patch?.({ company });

    status.textContent =
      `Signed as ${company} - ${player} ✓`;

    status.className =
      'save-status ok';

  } catch (error) {
    $('btn-save-score').disabled = false;

    status.textContent =
      error?.message ||
      'Unable to sign the Watch Roll.';

    status.className =
      'save-status err';
  }
}

  async function renderScores() {
    const list = $('score-list');
    list.innerHTML = '<li class="score-empty">Loading…</li>';
    const top = await OLW.Leaderboard.top(10, { today: true });
    if (!top.length) {
      list.innerHTML = '<li class="score-empty">No scores yet. Be the first to hold the watch.</li>';
      return;
    }
    list.innerHTML = '';
    top.forEach((e, i) => {
      const li = document.createElement('li');
      li.className = 'score-row' + (i < 3 ? ' top' + (i + 1) : '');
      li.innerHTML =
        `<span class="rank">
  ${
    i === 0
      ? '♛'
      : i === 1
      ? 'Ⅱ'
      : i === 2
      ? 'Ⅲ'
      : i + 1
  }
</span>` +
        `<span class="who">${escapeHtml(e.displayName || e.name || 'Guard')}</span>` +
        `<span class="pts">${e.score}</span>` +
        `<span class="secs">${U.fmtTime(
  Number(e.durationSeconds || 0)
)}s</span>`;
      list.appendChild(li);
    });
  }

async function updateTitleBest() {
  try {
    const top = await OLW.Leaderboard.top(1);

    $('title-best').textContent = top.length
      ? `Best ${top[0].score}`
      : 'Best —';
  } catch (error) {
    console.error('Unable to load title score:', error);
    $('title-best').textContent = 'Best —';
  }
}

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function resetRoomScreen() {
  soloPhoneStarted = false;
  $('room-setup').classList.remove('hidden');
  $('room-lobby').classList.add('hidden');

  $('room-message').classList.remove('error');
$('room-message').textContent =
  selectedRoomMode === 'versus'
    ? 'Waiting for your rival...'
    : selectedRoomMode === 'solophone'
      ? 'Scan the QR with your phone to play.'
      : 'Waiting for Player 2...';

  $('btn-start-room').disabled = true;
  // solo-phone starts automatically on connect, so hide the manual start button
  $('btn-start-room').style.display = selectedRoomMode === 'solophone' ? 'none' : '';

  $('player-two-card').classList.add('waiting');
  $('player-two-card').classList.remove('connected');

  $('controller-player-name').textContent =
    selectedRoomMode === 'solophone' ? 'Waiting for your phone' : 'Waiting for another guard';

  $('controller-player-status').textContent =
    'Scan the QR code to join';

  $('game-qr').innerHTML = '';
  $('qr-url').textContent = '';
  $('room-code').textContent = '------';
}

async function createSharedRoom() {
  if (roomCreationInProgress) {
    return;
  }

  const button = $('btn-create-room');
  const roomMessage = $('room-message');

  roomCreationInProgress = true;

  button.disabled = true;
  button.textContent = 'Creating room...';

  try {
    if (!OLW.Multiplayer) {
      throw new Error(
        'Multiplayer module was not loaded.'
      );
    }

    const playerName =
      $('host-name').value.trim() || 'Warden 1';

    const mapId =
      $('room-map').value || 'frontier';

  const response =
  await OLW.Multiplayer.createRoom({
    playerName,
    mode: selectedRoomMode,
    mapId
  });

    if (!response || !response.ok) {
      throw new Error(
        response?.message ||
        'Unable to create the room.'
      );
    }

    currentJoinUrl = response.joinUrl;
    setRoomUrl(response.room.code);   // host resume path
    $('room-screen-title').textContent =
  selectedRoomMode === 'versus'
    ? 'Rival Watch'
    : selectedRoomMode === 'solophone'
      ? 'Solo · Phone'
      : 'Shared Watch';

    $('room-setup').classList.add('hidden');
    $('room-lobby').classList.remove('hidden');

    $('room-code').textContent =
      response.room.code;

    $('host-player-name').textContent =
      response.room.host.name;

    $('qr-url').textContent =
      response.joinUrl;

    roomMessage.classList.remove('error');
    roomMessage.textContent =
      selectedRoomMode === 'solophone'
        ? 'Scan the QR with your phone to play.'
        : 'Waiting for Player 2...';

    renderRoomQr(response.joinUrl);
  } catch (error) {
    console.error('Room creation failed:', error);

    roomMessage.classList.add('error');
    roomMessage.textContent =
      error.message ||
      'Unable to create the room.';
  } finally {
    roomCreationInProgress = false;

    button.disabled = false;
    button.textContent =
      'Create Shared Watch';
  }
}

function renderRoomQr(joinUrl) {
  const box = $('game-qr');

  box.innerHTML = '';

  if (!window.QRCode) {
    box.textContent =
      'QR library unavailable.';
    return;
  }

  // High contrast (pure black on white) + high error correction = reliably
  // scannable on phones, even in booth lighting.
  new QRCode(box, {
    text: joinUrl,
    width: 200,
    height: 200,
    colorDark: '#000000',
    colorLight: '#ffffff',
    correctLevel: QRCode.CorrectLevel.H
  });
}

async function startSharedRoom() {
  const button = $('btn-start-room');

  button.disabled = true;
  button.textContent = 'Starting...';

  const response =
    await OLW.Multiplayer.startRoom();

  if (!response.ok) {
    button.disabled = false;
    button.textContent =
      'Begin Shared Watch';

    $('room-message').classList.add('error');
    $('room-message').textContent =
      response.message ||
      'Unable to start the match.';
  }
}



async function cancelSharedRoom() {
  await OLW.Multiplayer.cancelRoom();
  clearRoomUrl();
  resetRoomScreen();
  showScreen('title');
}

  // start on the title screen
  showScreen('title');
  // render one idle frame so the canvas isn't blank behind the menu
  game.render();
})();
