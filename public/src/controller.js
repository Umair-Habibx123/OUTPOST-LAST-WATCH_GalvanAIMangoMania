// src/controller.js

(function () {
  // stable per-phone id so a refresh reclaims the same seat
  let clientId = null;
  try { clientId = localStorage.getItem('olw_ctrl_id'); } catch (e) {}
  if (!clientId) {
    clientId = (window.crypto && crypto.randomUUID)
      ? crypto.randomUUID()
      : 'ctrl-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    try { localStorage.setItem('olw_ctrl_id', clientId); } catch (e) {}
  }

  const socket = io({
    transports: ['websocket', 'polling'],
    auth: { clientId },
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 500,
    reconnectionDelayMax: 4000
  });

  const RESUME_KEY = 'olw_ctrl_room';
  const saveRoom = (code) => { try { sessionStorage.setItem(RESUME_KEY, code); } catch (e) {} };
  const clearRoom = () => { try { sessionStorage.removeItem(RESUME_KEY); } catch (e) {} };
  const loadRoom = () => { try { return sessionStorage.getItem(RESUME_KEY); } catch (e) { return null; } };

  const $ = (id) => document.getElementById(id);

  const joinScreen = $('join-screen');
  const waitingScreen = $('waiting-screen');
  const gameScreen = $('game-screen');

  const roomInput = $('controller-room');
  const nameInput = $('controller-name');
  const joinButton = $('controller-join');
  const joinError = $('join-error');

  const aimPad = $('aim-pad');
  const reticle = $('mobile-reticle');

  const fireButton = $('mobile-fire');
  const volleyButton = $('mobile-volley');

  const connectionPill = $('connection-pill');

  // versus attacker UI
  const attackerPanel = $('attacker-panel');
  const spawnPad = $('spawn-pad');
  const spawnArrow = $('spawn-arrow');
  const atkTimer = $('atk-timer');
  const aimControls = $('aim-pad');
  const defenderActions = document.querySelector('.controller-actions');

  let roomCode = '';
  let roomMode = 'coop';
  let joined = false;
  let matchActive = false;
  let attackerMode = false;     // true when this room is versus (phone = attacker)
  let raiderType = 'basic';
  let lastSpawnAt = 0;

  let aim = {
    x: 0.5,
    y: 0.5
  };

  let lastAimSentAt = 0;
  let shotCounter = 0;

  const query = new URLSearchParams(location.search);
  const roomFromUrl = query.get('room');

  if (roomFromUrl) {
    roomInput.value = roomFromUrl
      .trim()
      .toUpperCase()
      .slice(0, 6);
  }

  socket.on('connect', () => {
    connectionPill.textContent = 'Connected';
    connectionPill.classList.add('online');

    // reclaim our seat after a phone refresh / dropped signal
    const saved = roomCode || loadRoom();
    if (saved) {
      socket.emit('room:resume', { roomCode: saved }, (res) => {
        if (res && res.ok) {
          joined = true;
          roomCode = res.room.code;
          $('joined-room-code').textContent = roomCode;
          joinScreen.classList.add('hidden');
          if (res.room.status === 'active') {
            matchActive = true;
            applyControllerMode(res.room);
            waitingScreen.classList.add('hidden');
            gameScreen.classList.remove('hidden');
            if (!attackerMode) sendAim(true);
            requestRtc();      // rejoined a live match — pull the mirror back up
          } else {
            waitingScreen.classList.remove('hidden');
            gameScreen.classList.add('hidden');
          }
        } else {
          clearRoom();
        }
      });
    }
  });

  socket.on('disconnect', () => {
    connectionPill.textContent = 'Disconnected';
    connectionPill.classList.remove('online');
  });

  socket.on('room:state', (room) => {
    if (!joined || room.code !== roomCode) {
      return;
    }

    $('joined-room-code').textContent = room.code;
  });

  // versus → this phone is the ATTACKER: swap the aim/fire controls for the
  // spawn ring. Any other mode keeps the defender/co-op aim controls.
 function applyControllerMode(
  room
) {
  const mode =
    room?.mode ||
    'coop';

  roomMode = mode;

  attackerMode =
    mode === 'versus';

  const soloPhone =
    mode === 'solophone';

  /*
   * VERSUS
   * Phone becomes attacker.
   */
  attackerPanel?.classList.toggle(
    'hidden',
    !attackerMode
  );

  /*
   * COOP + SOLOPHONE
   * Phone aims and fires.
   */
  aimControls?.classList.toggle(
    'hidden',
    attackerMode
  );

  defenderActions?.classList.toggle(
    'hidden',
    attackerMode
  );

  const waveLabel =
    document.querySelector(
      '.controller-stat:nth-child(2) span'
    );

  if (waveLabel) {
    waveLabel.textContent =
      attackerMode
        ? 'Hold'
        : 'Wave';
  }

  /*
   * Useful body classes for CSS.
   */
  document.body.classList.toggle(
    'controller-versus',
    attackerMode
  );

  document.body.classList.toggle(
    'controller-solo-phone',
    soloPhone
  );

  document.body.classList.toggle(
    'controller-coop',
    mode === 'coop'
  );

  // co-op and versus show the mirror in different containers — if the stream
  // is already live, move it into whichever one this mode uses.
  if (window.OLW_MIRROR_RX && OLW_MIRROR_RX.isLive()) showVideo();
}

  socket.on('match:started', (payload) => {
    if (
      !joined ||
      payload?.room?.code !== roomCode
    ) {
      return;
    }

    matchActive = true;
    applyControllerMode(payload.room);

    waitingScreen.classList.add('hidden');
    gameScreen.classList.remove('hidden');

    if (!attackerMode) sendAim(true);
    requestRtc();          // ask the kiosk to start the HD mirror
  });

  socket.on('match:stats', (stats) => {
    if (!joined) {
      return;
    }

    const integrity = Math.max(
      0,
      Math.min(
        100,
        (Number(stats.integrity || 0) /
          Number(stats.integrityMax || 100)) *
          100
      )
    );

    $('mobile-integrity').textContent =
      Math.ceil(integrity) + '%';

    if (stats.versus) {
      const left = stats.versusTimeLeft != null ? stats.versusTimeLeft : 0;
      $('mobile-wave').textContent = left + 's';
      if (atkTimer) atkTimer.textContent = 'Wall holds ' + left + 's';
    } else {
      $('mobile-wave').textContent = String(stats.wave || 0);
    }

    $('mobile-time').textContent =
      Number(stats.time || 0).toFixed(1);

    $('mobile-score').textContent =
      String(Math.round(Number(stats.score || 0)));

    const charge = Number(stats.player2Charge || 0);

    volleyButton.disabled = charge < 12;

    volleyButton.textContent =
      charge >= 12
        ? 'Volley Ready'
        : `Volley ${charge}/12`;
  });

  socket.on(
  'match:preview',
  payload => {
    if (!payload || !payload.image) return;
    // feed both live views (co-op aim-pad + versus attacker strip)
    const a = document.getElementById('remote-game-preview');
    const b = document.getElementById('remote-preview-atk');
    if (a) a.src = payload.image;
    if (b) b.src = payload.image;
  }
);

  /* ---------------- HD adaptive video mirror (receiver) ----------------
     Pulls a live Full-HD stream of the host canvas and runs the ABR control
     loop against it: throughput + playout-buffer occupancy decide which
     rendition to pull next, and the host is asked for it. Falls back to the
     webp frames if WebRTC can't connect at all. */

  function activeSurface() {
    return attackerMode ? document.querySelector('.atk-live-wrap') : document.getElementById('aim-pad');
  }
  function showVideo() {
    const v = document.getElementById('remote-video');
    const s = activeSurface();
    if (v && s) { if (v.parentElement !== s) s.appendChild(v); v.style.display = 'block'; }
    const i1 = document.getElementById('remote-game-preview');
    const i2 = document.getElementById('remote-preview-atk');
    if (i1) i1.style.visibility = 'hidden';
    if (i2) i2.style.visibility = 'hidden';
  }
  function hideVideo() {
    const v = document.getElementById('remote-video');
    if (v) v.style.display = 'none';
    const i1 = document.getElementById('remote-game-preview');
    const i2 = document.getElementById('remote-preview-atk');
    if (i1) i1.style.visibility = 'visible';
    if (i2) i2.style.visibility = 'visible';
  }
  /* A small badge so the player can see the mirror is live and which rung
     the ABR loop settled on — the "1080p60" readout, essentially. */
  function qualityBadge() {
    let el = document.getElementById('stream-quality');
    if (!el) {
      el = document.createElement('div');
      el.id = 'stream-quality';
      el.className = 'stream-quality';
      document.body.appendChild(el);
    }
    return el;
  }
  function showQuality(rung, why, isDown) {
    const el = qualityBadge();
    el.textContent = rung.label + (rung.fps >= 60 ? '60' : '');
    el.classList.toggle('degraded', rung.h < 720);
    el.classList.add('visible');
    clearTimeout(el._hide);
    el._hide = setTimeout(() => el.classList.remove('visible'), isDown ? 2600 : 1600);
  }

  const rtcReceiver = (window.OLW && OLW.Stream) ? OLW.Stream.createReceiver({
    socket: socket,
    getRoomCode: () => roomCode,
    video: document.getElementById('remote-video'),
    onLive: (up) => {
      if (up) { showVideo(); showQuality(rtcReceiver.level(), 'connected', false); }
      else hideVideo();
    },
    onLevel: (rung, why, isDown) => showQuality(rung, why, isDown)
  }) : null;

  window.OLW_MIRROR_RX = rtcReceiver;   // exposed for debugging / QA

  function stopRtc() {
    if (rtcReceiver) rtcReceiver.stop();
    hideVideo();
  }
  function requestRtc() {
    if (rtcReceiver && roomCode && window.RTCPeerConnection) rtcReceiver.request();
  }

  socket.on('rtc:offer', (p) => { if (rtcReceiver) rtcReceiver.onOffer(p); });
  socket.on('rtc:ice', (p) => { if (rtcReceiver) rtcReceiver.onIce(p); });
  socket.on('stream:cap', (p) => { if (rtcReceiver) rtcReceiver.onCap(p); });

  /* Mirror of the kiosk's announcement: a toast plus the same spoken line, so
     Player 2 is told what happened instead of just seeing the screen freeze. */
  function notify(text, tone, speech) {
    let el = document.getElementById('ctrl-announce');
    if (!el) {
      const css = document.createElement('style');
      css.textContent =
        '#ctrl-announce{position:fixed;left:50%;top:12px;transform:translateX(-50%) translateY(-8px);' +
        'z-index:60;max-width:92vw;text-align:center;padding:10px 16px;border-radius:4px;' +
        'background:rgba(18,13,9,.94);border:1px solid #7a5a2a;color:#f5c36b;' +
        'font:800 13px/1.45 "Segoe UI",system-ui,sans-serif;pointer-events:none;opacity:0;' +
        'transition:opacity .28s ease,transform .28s ease}' +
        '#ctrl-announce.show{opacity:1;transform:translateX(-50%) translateY(0)}' +
        '#ctrl-announce.bad{color:#e8907a;border-color:#8c4433}';
      document.head.appendChild(css);
      el = document.createElement('div');
      el.id = 'ctrl-announce';
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.classList.toggle('bad', tone === 'bad');
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('show'), 6000);

    if (speech && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(speech);
        u.rate = 0.9; u.pitch = 0.72;
        window.speechSynthesis.speak(u);
      } catch (e) { /* the toast already carried the message */ }
    }
  }

  socket.on('match:ended', (payload) => {
    matchActive = false;
    fireButton.disabled = true;
    volleyButton.disabled = true;
    connectionPill.textContent = 'Watch ended';

    // Co-op is a shared, endless watch — it only ends when the wall falls, and
    // when it does BOTH wardens lost it.
    if (roomMode === 'coop') {
      const r = payload && payload.result;
      notify(
        'THE OUTPOST HAS FALLEN — you both lost the watch.' +
          (r ? ` Score ${r.score} · ${r.kills} kills.` : ''),
        'bad',
        'The outpost has fallen. You both lost the watch.'
      );
    }

    stopRtc();
    clearRoom();
  });

  socket.on('room:cancelled', (payload) => {
    joined = false;
    matchActive = false;
    stopRtc();
    clearRoom();   // wipes the saved room binding so we don't rejoin a dead room

    waitingScreen.classList.add('hidden');
    gameScreen.classList.add('hidden');
    joinScreen.classList.remove('hidden');

    const ended = payload && payload.reason === 'opponent-left';
    const mode = (payload && payload.mode) || roomMode;

    // Co-op has no forfeit win: Player 1 IS the outpost, so if they drop out
    // the watch is lost for both of us.
    if (mode === 'coop' && ended) {
      joinError.textContent =
        'Player 1 left the watch — the outpost is lost. You both lost this run.';
      notify(
        'PLAYER 1 LEFT THE WATCH — the outpost is lost.',
        'bad',
        'Player one left the watch. The outpost is lost.'
      );
      return;
    }

    // versus: whoever is still connected wins by forfeit
    const won = payload && payload.winnerRole === 'controller';
    joinError.textContent = won
      ? '🏆 You win — the opponent left the match.'
      : ended
        ? 'The match ended (a player left).'
        : 'The host closed this room.';
  });

  socket.on('room:player-left', (payload) => {
    if (payload.role === 'host') {
      matchActive = false;
      stopRtc();
      connectionPill.textContent = 'Host disconnected';
      connectionPill.classList.remove('online');
    }
  });

  joinButton.addEventListener('click', joinRoom);

  roomInput.addEventListener('input', () => {
    roomInput.value = roomInput.value
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 6);
  });

  nameInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      joinRoom();
    }
  });

  function joinRoom() {
    joinError.textContent = '';

    const requestedRoom = roomInput.value
      .trim()
      .toUpperCase();

    const playerName =
      nameInput.value.trim() || 'Warden 2';

    if (requestedRoom.length !== 6) {
      joinError.textContent =
        'Enter the six-character room code.';
      return;
    }

    joinButton.disabled = true;
    joinButton.textContent = 'Joining...';

    socket.timeout(8000).emit(
      'room:join',
      {
        roomCode: requestedRoom,
        playerName
      },
      (error, response) => {
        joinButton.disabled = false;
        joinButton.textContent = 'Join Shared Watch';

        if (error) {
          joinError.textContent =
            'The room server did not respond.';
          return;
        }

        if (!response?.ok) {
          joinError.textContent =
            response?.message || 'Unable to join room.';
          return;
        }

        joined = true;
        roomCode = requestedRoom;
        saveRoom(roomCode);

        $('joined-room-code').textContent = roomCode;

        joinScreen.classList.add('hidden');
        waitingScreen.classList.remove('hidden');
      }
    );
  }

  function positionAim(clientX, clientY) {
    const bounds = aimPad.getBoundingClientRect();

    const x = Math.max(
      0,
      Math.min(1, (clientX - bounds.left) / bounds.width)
    );

    const y = Math.max(
      0,
      Math.min(1, (clientY - bounds.top) / bounds.height)
    );

    aim.x = x;
    aim.y = y;

    reticle.style.left = `${x * 100}%`;
    reticle.style.top = `${y * 100}%`;

    sendAim(false);
  }

  function sendAim(force) {
    if (!joined || !roomCode) {
      return;
    }

    const now = performance.now();

    /*
     * ~50 aim messages per second (tiny payloads). volatile means stale aim
     * packets are dropped rather than queued, and the host smooths between them,
     * so this stays responsive without flooding a laggy connection.
     */
    if (!force && now - lastAimSentAt < 20) {
      return;
    }

    lastAimSentAt = now;

    socket.volatile.emit('controller:aim', {
      roomCode,
      x: aim.x,
      y: aim.y
    });
  }

  // Fire the current aim at the host. Shared by touch (Fire button), mouse
  // (click on the live view), keyboard (Space) and gamepad — so ANY controller
  // works, matching the desktop game's aim + fire feel.
  function sendStrike() {
    if (!matchActive || !roomCode || attackerMode) return;
    shotCounter += 1;
    socket.emit(
      'controller:strike',
      { roomCode, x: aim.x, y: aim.y, clientShotId: `${socket.id || 'phone'}-${shotCounter}` },
      (response) => { if (response && response.ok === false) console.warn(response.message); }
    );
    if (navigator.vibrate) navigator.vibrate(18);
  }

  aimPad.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    aimPad.setPointerCapture?.(event.pointerId);
    positionAim(event.clientX, event.clientY);
    // a mouse click on the view also fires (desktop controller = aim + click)
    if (event.pointerType === 'mouse') sendStrike();
  });

  aimPad.addEventListener('pointermove', (event) => {
    // aim on touch-drag OR mouse move (a desktop controller aims by moving the mouse)
    event.preventDefault();
    positionAim(event.clientX, event.clientY);
  });

  fireButton.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    sendStrike();
  });

  // keyboard: Space fires (device controls, e.g. a laptop as the controller)
  window.addEventListener('keydown', (event) => {
    if (event.code === 'Space' && matchActive && !attackerMode) {
      event.preventDefault();
      sendStrike();
    }
  });

  // basic gamepad (e.g. PlayStation pad): left stick aims, X / R1 / R2 fires
  function gamepadLoop() {
    requestAnimationFrame(gamepadLoop);
    if (!matchActive || attackerMode) return;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let gp = null;
    for (const p of pads) { if (p) { gp = p; break; } }
    if (!gp) return;
    const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
    if (Math.hypot(ax, ay) > 0.14) {                 // stick deadzone
      aim.x = Math.max(0, Math.min(1, 0.5 + ax * 0.55));
      aim.y = Math.max(0, Math.min(1, 0.5 + ay * 0.55));
      reticle.style.left = (aim.x * 100) + '%';
      reticle.style.top = (aim.y * 100) + '%';
      sendAim(false);
    }
    const b = gp.buttons;
    if ((b[0] && b[0].pressed) || (b[5] && b[5].pressed) || (b[7] && b[7].pressed)) sendStrike();
  }
  requestAnimationFrame(gamepadLoop);

  volleyButton.addEventListener('click', () => {
    if (
      !matchActive ||
      !roomCode ||
      volleyButton.disabled
    ) {
      return;
    }

    socket.emit('controller:volley', {
      roomCode
    });

    if (navigator.vibrate) {
      navigator.vibrate([25, 25, 45]);
    }
  });

  /* ---------- versus attacker: tap the ring to send raiders ---------- */
  const TAU = Math.PI * 2;

  function sendSpawn(clientX, clientY) {
    if (!attackerMode || !matchActive || !roomCode) return;
    const now = performance.now();
    if (now - lastSpawnAt < 160) return;   // light client throttle; host cooldown is authoritative
    lastSpawnAt = now;

    const b = spawnPad.getBoundingClientRect();
    const dx = clientX - (b.left + b.width / 2);
    const dy = clientY - (b.top + b.height / 2);
    let lane = (Math.atan2(dy, dx) / TAU) + 1;
    lane -= Math.floor(lane);              // normalise to 0..1

    socket.emit('controller:spawn', { roomCode, lane, raiderType });

    if (spawnArrow) {
      spawnArrow.style.opacity = '1';
      spawnArrow.style.transform =
        `translate(-50%,-100%) rotate(${Math.atan2(dy, dx) + Math.PI / 2}rad)`;
      clearTimeout(spawnArrow._t);
      spawnArrow._t = setTimeout(() => { spawnArrow.style.opacity = '0'; }, 260);
    }
    if (navigator.vibrate) navigator.vibrate(14);
  }

  if (spawnPad) {
    spawnPad.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      sendSpawn(event.clientX, event.clientY);
    });
  }

  document.querySelectorAll('.atk-type').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.atk-type').forEach((b) => b.classList.remove('selected'));
      btn.classList.add('selected');
      raiderType = btn.dataset.type || 'basic';
    });
  });
})();