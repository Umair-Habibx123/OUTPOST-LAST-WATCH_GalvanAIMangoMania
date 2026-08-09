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
  function applyControllerMode(room) {
    attackerMode = (room && room.mode === 'versus');
    if (attackerPanel) attackerPanel.classList.toggle('hidden', !attackerMode);
    if (aimControls) aimControls.classList.toggle('hidden', attackerMode);
    if (defenderActions) defenderActions.classList.toggle('hidden', attackerMode);
    const wl = document.querySelector('.controller-stat:nth-child(2) span');
    if (wl && attackerMode) wl.textContent = 'Hold';
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

  socket.on('match:ended', () => {
    matchActive = false;
    fireButton.disabled = true;
    volleyButton.disabled = true;
    connectionPill.textContent = 'Watch ended';
    clearRoom();
  });

  socket.on('room:cancelled', () => {
    joined = false;
    matchActive = false;
    clearRoom();

    waitingScreen.classList.add('hidden');
    gameScreen.classList.add('hidden');
    joinScreen.classList.remove('hidden');

    joinError.textContent =
      'The host cancelled this room.';
  });

  socket.on('room:player-left', (payload) => {
    if (payload.role === 'host') {
      matchActive = false;
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

  aimPad.addEventListener('pointerdown', (event) => {
    event.preventDefault();

    aimPad.setPointerCapture?.(event.pointerId);
    positionAim(event.clientX, event.clientY);
  });

  aimPad.addEventListener('pointermove', (event) => {
    if (event.buttons === 0 && event.pointerType === 'mouse') {
      return;
    }

    event.preventDefault();
    positionAim(event.clientX, event.clientY);
  });

  fireButton.addEventListener('pointerdown', (event) => {
    event.preventDefault();

    if (!matchActive || !roomCode) {
      return;
    }

    shotCounter += 1;

    socket.emit(
      'controller:strike',
      {
        roomCode,
        x: aim.x,
        y: aim.y,
        clientShotId:
          `${socket.id || 'phone'}-${shotCounter}`
      },
      (response) => {
        if (response && response.ok === false) {
          console.warn(response.message);
        }
      }
    );

    if (navigator.vibrate) {
      navigator.vibrate(18);
    }
  });

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