// src/multiplayer.js

window.OLW = window.OLW || {};

OLW.Multiplayer = (function () {
  const clientId = (window.OLW && OLW.Device && OLW.Device.id) || null;

  const socket = window.io
    ? window.io({
        transports: ['websocket', 'polling'],
        auth: { clientId },                 // persistent per-device identity
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 500,
        reconnectionDelayMax: 4000,
        timeout: 8000
      })
    : null;

  // survive a browser refresh: remember which room/seat this tab held
  const RESUME_KEY = 'olw_room_resume';
  function saveResume() {
    try { sessionStorage.setItem(RESUME_KEY, JSON.stringify({ roomCode: state.roomCode, role: state.role, mode: state.mode, mapId: state.mapId })); } catch (e) {}
  }
  function clearResume() { try { sessionStorage.removeItem(RESUME_KEY); } catch (e) {} }
  function loadResume() { try { return JSON.parse(sessionStorage.getItem(RESUME_KEY)); } catch (e) { return null; } }

  const listeners = new Map();

  const state = {
    connected: false,
    mode: 'solo',
    mapId: 'frontier',

    roomCode: null,
    role: null,
    room: null,
    playerSlot: 1,

    remoteAim: {
      x: 0.5,
      y: 0.5,
      active: false,
      updatedAt: 0
    }
  };

  function emitLocal(eventName, payload) {
    const handlers = listeners.get(eventName);

    if (!handlers) {
      return;
    }

    handlers.forEach((handler) => {
      try {
        handler(payload);
      } catch (error) {
        console.error(
          `Multiplayer listener failed: ${eventName}`,
          error
        );
      }
    });
  }

  function on(eventName, handler) {
    if (!listeners.has(eventName)) {
      listeners.set(eventName, new Set());
    }

    listeners.get(eventName).add(handler);

    return function unsubscribe() {
      listeners.get(eventName)?.delete(handler);
    };
  }

  function request(eventName, payload) {
    return new Promise((resolve) => {
      if (!socket) {
        resolve({
          ok: false,
          message: 'Multiplayer connection unavailable.'
        });

        return;
      }

      socket.timeout(8000).emit(
        eventName,
        payload,
        (error, response) => {
          if (error) {
            resolve({
              ok: false,
              message: 'The server did not respond.'
            });

            return;
          }

          resolve(response);
        }
      );
    });
  }

  if (socket) {
    socket.on('connect', () => {
      state.connected = true;
      emitLocal('connection', {
        connected: true
      });

      // reclaim our seat after a refresh / dropped connection. Sources, in order:
      // live state → sessionStorage → the ?room= URL param (host resume path).
      let urlRoom = null;
      try { urlRoom = new URLSearchParams(location.search).get('room'); } catch (e) {}
      const saved = state.roomCode ? { roomCode: state.roomCode }
        : (loadResume() || (urlRoom ? { roomCode: urlRoom.toUpperCase() } : null));
      if (saved && saved.roomCode) {
        socket.emit('room:resume', { roomCode: saved.roomCode }, (res) => {
          if (res && res.ok) {
            state.roomCode = res.room.code;
            state.role = res.role;
            state.mode = res.room.mode || state.mode;
            state.mapId = res.room.mapId || state.mapId;
            state.room = res.room;
            saveResume();
            emitLocal('roomState', res.room);
            emitLocal('resumed', { room: res.room, role: res.role });
          } else {
            clearResume();
          }
        });
      }
    });

    socket.on('room:peer-away', (payload) => {
      emitLocal('peerAway', payload);
    });

    socket.on('disconnect', () => {
      state.connected = false;
      emitLocal('connection', {
        connected: false
      });
    });

    socket.on('room:state', (room) => {
      state.room = room;
      emitLocal('roomState', room);
    });

    socket.on('room:player-left', (payload) => {
      state.room = payload.room;
      emitLocal('playerLeft', payload);
    });

    socket.on('match:started', (payload) => {
      state.room = payload.room;
      emitLocal('matchStarted', payload);
    });

    socket.on('room:cancelled', (payload) => {
      const info = {
        role: state.role,
        winnerRole: payload && payload.winnerRole,
        mode: (payload && payload.mode) || state.mode,
        reason: payload && payload.reason
      };
      state.room = null;
      state.roomCode = null;
      state.role = null;
      state.mode = 'solo';
      clearResume();

      emitLocal('roomCancelled', info);
    });

    socket.on('player2:aim', (payload) => {
      state.remoteAim = {
        x: payload.x,
        y: payload.y,
        active: true,
        updatedAt: performance.now()
      };

      emitLocal('player2Aim', payload);
    });

    socket.on('player2:strike', (payload) => {
      emitLocal('player2Strike', payload);
    });

    socket.on('player2:volley', (payload) => {
      emitLocal('player2Volley', payload);
    });

    // versus: attacker asked the host to spawn a raider
    socket.on('player2:spawn', (payload) => {
      emitLocal('player2Spawn', payload);
    });
  }

  return {
    state,

    get socket() {
      return socket;
    },

    get connected() {
      return state.connected;
    },

    get mode() {
      return state.mode;
    },

    get mapId() {
      return state.mapId;
    },

    get roomCode() {
      return state.roomCode;
    },

    on,

    async createRoom({
      playerName,
      mode = 'coop',
      mapId = 'frontier'
    }) {
      const response = await request('room:create', {
        playerName,
        mode,
        mapId
      });

      if (response.ok) {
        state.mode = mode;
        state.mapId = mapId;
        state.roomCode = response.room.code;
        state.role = 'host';
        state.room = response.room;
        state.playerSlot = 1;
        saveResume();
      }

      return response;
    },

    async startRoom() {
      if (!state.roomCode) {
        return {
          ok: false,
          message: 'No room has been created.'
        };
      }

      return request('room:start', {
        roomCode: state.roomCode
      });
    },

    async cancelRoom() {
      if (!state.roomCode) {
        return {
          ok: false,
          message: 'No room has been created.'
        };
      }

      return request('room:cancel', {
        roomCode: state.roomCode
      });
    },

    sendMatchStats(stats) {
      if (
        !socket ||
        !state.roomCode ||
        state.mode === 'solo'
      ) {
        return;
      }

      socket.volatile.emit('match:stats', {
        roomCode: state.roomCode,
        stats
      });
    },

    sendMatchPreview(image) {
  if (
    !socket ||
    !state.roomCode ||
    state.mode === 'solo' ||
    !image
  ) {
    return;
  }

  socket.volatile.emit(
    'match:preview',
    {
      roomCode:
        state.roomCode,

      image
    }
  );
},

    notifyMatchEnded(result) {
      if (
        !socket ||
        !state.roomCode ||
        state.mode === 'solo'
      ) {
        return;
      }

      socket.emit('match:ended', {
        roomCode: state.roomCode,
        result
      });
      clearResume();
    }
  };
})();