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

  let roomCode = '';
  let joined = false;
  let matchActive = false;

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
            waitingScreen.classList.add('hidden');
            gameScreen.classList.remove('hidden');
            sendAim(true);
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

  socket.on('match:started', (payload) => {
    if (
      !joined ||
      payload?.room?.code !== roomCode
    ) {
      return;
    }

    matchActive = true;

    waitingScreen.classList.add('hidden');
    gameScreen.classList.remove('hidden');

    sendAim(true);
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

    $('mobile-wave').textContent =
      String(stats.wave || 0);

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
     * Approximately 30 aim messages per second.
     * volatile means old aim packets may be dropped rather than queued.
     */
    if (!force && now - lastAimSentAt < 33) {
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
})();