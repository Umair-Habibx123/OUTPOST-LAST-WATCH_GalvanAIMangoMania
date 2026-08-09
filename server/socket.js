// server/socket.js

import {
  cancelRoom,
  createRoom,
  finishRoom,
  getInternalRoom,
  getRoom,
  handleDisconnect,
  joinRoom,
  resumeRoom,
  startRoom
} from './rooms.js';

// How long a seat is held after a socket drops, so a browser refresh /
// flaky-network reconnect can reclaim it instead of being marked "left".
const GRACE_MS = Number.parseInt(process.env.WS_GRACE_MS || '20000', 10);

// pending "seat empty" timers, keyed by persistent clientId
const graceTimers = new Map();

import {
  controllerAimSchema,
  controllerStrikeSchema,
  controllerSpawnSchema,
  createRoomSchema,
  joinRoomSchema,
  parsePayload
} from './validation.js';

function safeReply(reply, payload) {
  if (typeof reply === 'function') {
    reply(payload);
  }
}

export function configureSockets(io) {
  io.on('connection', (socket) => {
    // persistent per-device id carried in the handshake auth
    socket.data.clientId =
      (socket.handshake.auth && socket.handshake.auth.clientId) || null;

    console.log(`Socket connected: ${socket.id} (client ${socket.data.clientId || 'anon'})`);

    // Reclaim a seat after a refresh / reconnect (same device, new socket).
    socket.on('room:resume', async ({ roomCode }, reply) => {
      const clientId = socket.data.clientId;
      const result = await resumeRoom({
        roomCode: String(roomCode || '').trim().toUpperCase() || null,
        clientId,
        socketId: socket.id
      });

      if (result.ok) {
        if (graceTimers.has(clientId)) {
          clearTimeout(graceTimers.get(clientId));
          graceTimers.delete(clientId);
        }
        socket.join(result.room.code);
        socket.data.roomCode = result.room.code;
        socket.data.role = result.role;
        io.to(result.room.code).emit('room:state', result.room);
      }

      safeReply(reply, result);
    });

    socket.on('room:create', async (payload, reply) => {
      try {
        const parsed = parsePayload(createRoomSchema, payload);

        if (!parsed.ok) {
          safeReply(reply, parsed);
          return;
        }

        const room = await createRoom({
          hostSocketId: socket.id,
          clientId: socket.data.clientId,
          mode: parsed.data.mode,
          mapId: parsed.data.mapId,
          playerName: parsed.data.playerName
        });

        socket.data.roomCode = room.code;
        socket.data.role = 'host';
        socket.join(room.code);

        const publicUrl =
          process.env.PUBLIC_URL || 'http://localhost:3000';

        safeReply(reply, {
          ok: true,
          room,
          joinUrl:
            `${publicUrl}/controller.html?room=` +
            encodeURIComponent(room.code)
        });
      } catch (error) {
        console.error('room:create failed', error);

        safeReply(reply, {
          ok: false,
          message: 'Unable to create the room.'
        });
      }
    });

    socket.on('room:join', async (payload, reply) => {
      try {
        const parsed = parsePayload(joinRoomSchema, payload);

        if (!parsed.ok) {
          safeReply(reply, parsed);
          return;
        }

        const result = await joinRoom({
          roomCode: parsed.data.roomCode,
          socketId: socket.id,
          clientId: socket.data.clientId,
          playerName: parsed.data.playerName
        });

        if (!result.ok) {
          safeReply(reply, result);
          return;
        }

        socket.data.roomCode = parsed.data.roomCode;
        socket.data.role = 'controller';
        socket.join(parsed.data.roomCode);

        io.to(parsed.data.roomCode).emit(
          'room:state',
          result.room
        );

        safeReply(reply, result);
      } catch (error) {
        console.error('room:join failed', error);

        safeReply(reply, {
          ok: false,
          message: 'Unable to join the room.'
        });
      }
    });

    socket.on(
  'room:get',
  async (
    { roomCode },
    reply
  ) => {
    try {
      const normalized =
        String(roomCode || '')
          .trim()
          .toUpperCase();

      const room =
        await getRoom(
          normalized
        );

      safeReply(reply, {
        ok: Boolean(room),

        room,

        message:
          room
            ? undefined
            : 'Room not found.'
      });
    } catch (error) {
      console.error(
        'room:get failed',
        error
      );

      safeReply(reply, {
        ok: false,

        room: null,

        message:
          'Unable to load the room.'
      });
    }
  }
);

    socket.on('room:start', async ({ roomCode }, reply) => {
      try {
        const normalized = String(roomCode || '')
          .trim()
          .toUpperCase();

        const result = await startRoom({
          roomCode: normalized,
          socketId: socket.id
        });

        if (result.ok) {
          io.to(normalized).emit('match:started', {
            room: result.room,
            startedAt: Date.now()
          });
        }

        safeReply(reply, result);
      } catch (error) {
        console.error('room:start failed', error);

        safeReply(reply, {
          ok: false,
          message: 'Unable to start the room.'
        });
      }
    });

    socket.on('room:cancel', async ({ roomCode }, reply) => {
      try {
        const normalized = String(roomCode || '')
          .trim()
          .toUpperCase();

        const result = await cancelRoom({
          roomCode: normalized,
          socketId: socket.id
        });

        if (result.ok) {
          io.to(normalized).emit('room:cancelled');
          io.in(normalized).socketsLeave(normalized);
        }

        safeReply(reply, result);
      } catch (error) {
        console.error('room:cancel failed', error);

        safeReply(reply, {
          ok: false,
          message: 'Unable to cancel the room.'
        });
      }
    });

    /*
     * Player two sends normalized coordinates from 0 to 1.
     * The host converts them into the canvas's 960 × 600 coordinates.
     */
    socket.on('controller:aim', (payload) => {
      const parsed = parsePayload(controllerAimSchema, payload);

      if (!parsed.ok) {
        return;
      }

      const room = getInternalRoom(parsed.data.roomCode);

      if (!room || room.controllerSocketId !== socket.id) {
        return;
      }

      socket.to(parsed.data.roomCode).emit('player2:aim', {
        x: parsed.data.x,
        y: parsed.data.y,
        sentAt: Date.now()
      });
    });

    socket.on('controller:strike', (payload, reply) => {
      const parsed = parsePayload(controllerStrikeSchema, payload);

      if (!parsed.ok) {
        safeReply(reply, parsed);
        return;
      }

      const room = getInternalRoom(parsed.data.roomCode);

      if (!room || room.controllerSocketId !== socket.id) {
        safeReply(reply, {
          ok: false,
          message: 'You are not the controller for this room.'
        });
        return;
      }

      if (room.status !== 'active') {
        safeReply(reply, {
          ok: false,
          message: 'The match has not started.'
        });
        return;
      }

      socket.to(parsed.data.roomCode).emit('player2:strike', {
        x: parsed.data.x,
        y: parsed.data.y,
        clientShotId: parsed.data.clientShotId,
        sentAt: Date.now()
      });

      safeReply(reply, {
        ok: true
      });
    });

    // Versus: attacker (controller) requests a raider spawn; host is authoritative.
    socket.on('controller:spawn', (payload) => {
      const parsed = parsePayload(controllerSpawnSchema, payload);
      if (!parsed.ok) return;

      const room = getInternalRoom(parsed.data.roomCode);
      if (!room || room.controllerSocketId !== socket.id) return;
      if (room.status !== 'active' || room.mode !== 'versus') return;

      socket.to(parsed.data.roomCode).emit('player2:spawn', {
        lane: parsed.data.lane,
        raiderType: parsed.data.raiderType,
        sentAt: Date.now()
      });
    });

    socket.on('controller:volley', ({ roomCode }) => {
      const normalized = String(roomCode || '')
        .trim()
        .toUpperCase();

      const room = getInternalRoom(normalized);

      if (!room || room.controllerSocketId !== socket.id) {
        return;
      }

      socket.to(normalized).emit('player2:volley', {
        sentAt: Date.now()
      });
    });

    socket.on('match:stats', ({ roomCode, stats }) => {
      const normalized = String(roomCode || '')
        .trim()
        .toUpperCase();

      const room = getInternalRoom(normalized);

      if (!room || room.hostSocketId !== socket.id) {
        return;
      }

      /*
       * The phone only receives display information.
       * It does not decide score, health, hits or enemy deaths.
       */
      socket.to(normalized).emit('match:stats', {
        integrity: stats?.integrity,
        integrityMax: stats?.integrityMax,
        score: stats?.score,
        time: stats?.time,
        wave: stats?.wave,
        versus: stats?.versus,
        versusTimeLeft: stats?.versusTimeLeft,
        player2Charge: stats?.player2Charge
      });
    });

    socket.on('match:ended', async ({ roomCode, result }) => {
      const normalized = String(roomCode || '')
        .trim()
        .toUpperCase();

      const room = getInternalRoom(normalized);

      if (!room || room.hostSocketId !== socket.id) {
        return;
      }

      io.to(normalized).emit('match:ended', {
        result
      });

      await finishRoom(normalized);
    });

    socket.on('disconnect', async () => {
      console.log(`Socket disconnected: ${socket.id}`);

      const clientId = socket.data.clientId;
      const roomCode = socket.data.roomCode;

      const finalize = async () => {
        graceTimers.delete(clientId);
        try {
          // only nulls the seat if the room still points at THIS dead socket
          const result = await handleDisconnect(socket.id);
          if (result) {
            io.to(result.roomCode).emit('room:player-left', {
              role: result.disconnectedRole,
              room: result.room
            });
          }
        } catch (error) {
          console.error('Disconnect cleanup failed', error);
        }
      };

      // With a known client + room, hold the seat briefly for a reconnect.
      if (clientId && roomCode) {
        socket.to(roomCode).emit('room:peer-away', { role: socket.data.role });
        if (graceTimers.has(clientId)) clearTimeout(graceTimers.get(clientId));
        graceTimers.set(clientId, setTimeout(finalize, GRACE_MS));
      } else {
        await finalize();
      }
    });
  });
}