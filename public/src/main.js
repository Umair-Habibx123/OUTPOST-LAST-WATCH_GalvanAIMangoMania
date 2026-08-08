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
  $('room-message').textContent =
    'Both guards are ready. Begin the watch.';

  $('btn-start-room').disabled = false;
});

OLW.Multiplayer.on('matchStarted', () => {
  enterGameUI();
  game.start();
});

OLW.Multiplayer.on('player2Aim', (payload) => {
  game.setPlayer2Aim(
    payload.x * C.WIDTH,
    payload.y * C.HEIGHT
  );
});

OLW.Multiplayer.on('player2Strike', (payload) => {
  game.strikePlayer2(
    payload.x * C.WIDTH,
    payload.y * C.HEIGHT
  );
});

OLW.Multiplayer.on('player2Volley', () => {
  game.usePlayer2Volley();
});

OLW.Multiplayer.on('playerLeft', (payload) => {
  if (payload.role !== 'controller') {
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
  window.OLW_GAME = game; // exposed for debugging / QA

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
    $('wave-tag').textContent = s.wave > 0 ? ('Wave ' + s.wave) : 'Standing by';
    $('wave-sub').textContent = s.breather > 0.05
      ? ('Next wave in ' + Math.ceil(s.breather) + 's')
      : '';
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
    player2Charge: s.player2Charge
  });
}
  }

  async function onGameOver(res) {
    lastResult = res;
    $('res-time').textContent = res.time + 's';
    $('res-waves').textContent = res.waves;
    $('res-kills').textContent = res.kills;
    $('res-score').textContent = res.score;
    const rank = await OLW.Leaderboard.rankOf(res.score);
    $('res-rank').textContent = rank <= 10 ? `Provisional rank #${rank} — sign the roll to claim it.` : `You reached rank #${rank}. Another watch could break the top ten.`;
    $('name-entry').classList.remove('hidden');
    $('over-actions').classList.add('hidden');
    $('name-input').value = '';
    showScreen('over');
    setTimeout(() => $('name-input').focus(), 100);
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
    });
  });
 /* ---------- menu buttons ---------- */

$('btn-play').addEventListener('click', () => {
  enterGameUI();
  game.start();
});

$('btn-how').addEventListener('click', () => {
  showScreen('how');
});

$('btn-scores').addEventListener('click', async () => {
  showScreen('scores');
  await renderScores();
});

$('btn-qr').addEventListener('click', () => {
  resetRoomScreen();
  showScreen('qr');
});

document
  .querySelectorAll('[data-back]')
  .forEach((button) => {
    button.addEventListener('click', () => {
      showScreen('title');
    });
  });

$('pause-btn').addEventListener('click', () => {
  if (game.state === 'playing') {
    game.pause();
  } else if (game.state === 'paused') {
    game.resume();
  }
});

$('volley-btn').addEventListener('click', () => {
  game.useVolley();
});

$('mute-btn').addEventListener('click', () => {
  const muted = OLW.Audio.toggle();

  $('mute-btn').textContent = muted
    ? 'SOUND OFF'
    : 'SOUND ON';
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
  showScreen('title');
});

/* ---------- game-over buttons ---------- */

$('btn-save-score').addEventListener(
  'click',
  saveScore
);

$('name-input').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    saveScore();
  }
});

$('btn-retry').addEventListener('click', () => {
  enterGameUI();
  game.start();
});

$('btn-menu').addEventListener('click', () => {
  showScreen('title');
});

$('btn-settings-launch')?.addEventListener(
  'click',
  () => OLW.Settings?.open?.()
);

$('btn-skip-score')
  ?.addEventListener(
    'click',
    () => {
      $('name-entry')
        .classList.add('hidden');

      $('over-actions')
        .classList.remove('hidden');
    }
  );

  async function saveScore() {
    if (!lastResult) return;
    const name =
  ($('name-input').value || '')
    .trim() ||
  'Anonymous Guard';
    await OLW.Leaderboard.submit({
  name,
  mode: OLW.Multiplayer?.mode || 'solo',
  mapId: OLW.Multiplayer?.mapId || 'frontier',

  score: lastResult.score,
  time: lastResult.time,
  waves: lastResult.waves,
  kills: lastResult.kills,
  perfectWaves: lastResult.perfectWaves
});
    $('name-entry').classList.add('hidden');
    $('over-actions').classList.remove('hidden');
    lastResult._saved = true;
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
  $('room-setup').classList.remove('hidden');
  $('room-lobby').classList.add('hidden');

  $('room-message').classList.remove('error');
$('room-message').textContent =
  selectedRoomMode === 'versus'
    ? 'Waiting for your rival...'
    : 'Waiting for Player 2...';

  $('btn-start-room').disabled = true;

  $('player-two-card').classList.add('waiting');
  $('player-two-card').classList.remove('connected');

  $('controller-player-name').textContent =
    'Waiting for another guard';

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
    $('room-screen-title').textContent =
  selectedRoomMode === 'versus'
    ? 'Rival Watch'
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
      'Waiting for Player 2...';

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

  new QRCode(box, {
    text: joinUrl,
    width: 190,
    height: 190,
    colorDark: '#15110c',
    colorLight: '#f1dfbd',
    correctLevel: QRCode.CorrectLevel.M
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
  resetRoomScreen();
  showScreen('title');
}

  // start on the title screen
  showScreen('title');
  // render one idle frame so the canvas isn't blank behind the menu
  game.render();
})();
