// server/rooms.js

import crypto from 'node:crypto';
import { sql } from './database.js';

const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_CODE_LENGTH = 6;

const activeRooms = new Map();

/**
 * Generate codes without easily confused characters such as O/0 and I/1.
 */
function generateRoomCode() {
  let output = '';

  for (let index = 0; index < ROOM_CODE_LENGTH; index += 1) {
    const randomIndex = crypto.randomInt(0, ROOM_ALPHABET.length);
    output += ROOM_ALPHABET[randomIndex];
  }

  return output;
}

function publicRoom(room) {
  if (!room) {
    return null;
  }

  return {
    id: room.id,
    code: room.code,
    mode: room.mode,
    status: room.status,
    mapId: room.mapId,

    host: {
      name: room.hostName,
      connected: Boolean(room.hostSocketId),
      ready: room.hostReady
    },

    controller: {
      name: room.controllerName,
      connected: Boolean(room.controllerSocketId),
      ready: room.controllerReady
    },

    createdAt: room.createdAt,
    startedAt: room.startedAt
  };
}

async function roomCodeExists(roomCode) {
  if (activeRooms.has(roomCode)) {
    return true;
  }

  const result = await sql`
    SELECT id
    FROM game_rooms
    WHERE room_code = ${roomCode}
    LIMIT 1
  `;

  return result.length > 0;
}

async function uniqueRoomCode() {
  for (let attempt = 0; attempt < 15; attempt += 1) {
    const code = generateRoomCode();

    if (!(await roomCodeExists(code))) {
      return code;
    }
  }

  throw new Error('Unable to generate a unique room code.');
}

export async function createRoom({
  hostSocketId,
  clientId,
  mode,
  mapId,
  playerName
}) {
  const id = crypto.randomUUID();
  const code = await uniqueRoomCode();

  const expiryMinutes = Number.parseInt(
    process.env.ROOM_EXPIRY_MINUTES || '60',
    10
  );

  const room = {
    id,
    code,
    mode,
    mapId,

    status: 'waiting',

    hostSocketId,
    controllerSocketId: null,

    // persistent per-device ids so a refresh/reconnect can reclaim its seat
    hostClientId: clientId || null,
    controllerClientId: null,

    hostName: playerName,
    controllerName: null,

    hostReady: true,
    controllerReady: false,

    createdAt: new Date().toISOString(),
    startedAt: null
  };

  activeRooms.set(code, room);

  await sql`
    INSERT INTO game_rooms (
      id,
      room_code,
      mode,
      status,
      map_id,
      host_socket_id,
      host_name,
      host_ready,
      expires_at
    )
    VALUES (
      ${id},
      ${code},
      ${mode},
      'waiting',
      ${mapId},
      ${hostSocketId},
      ${playerName},
      TRUE,
      NOW() + (${expiryMinutes} * INTERVAL '1 minute')
    )
  `;

  return publicRoom(room);
}

export async function joinRoom({
  roomCode,
  socketId,
  clientId,
  playerName
}) {
  const room = activeRooms.get(roomCode);

  if (!room) {
    return {
      ok: false,
      message: 'Room not found or no longer active.'
    };
  }

  // a returning controller (same device) reclaims its own seat
  if (
    room.controllerClientId &&
    clientId &&
    room.controllerClientId === clientId
  ) {
    room.controllerSocketId = socketId;
    room.controllerName = playerName || room.controllerName;
    room.controllerReady = true;
    if (room.status === 'waiting') room.status = 'ready';
    return { ok: true, playerSlot: 2, room: publicRoom(room) };
  }

  if (room.status === 'active') {
    return {
      ok: false,
      message: 'This match has already started.'
    };
  }

  if (room.status === 'finished' || room.status === 'cancelled') {
    return {
      ok: false,
      message: 'This room is no longer available.'
    };
  }

  if (
    room.controllerSocketId &&
    room.controllerSocketId !== socketId
  ) {
    return {
      ok: false,
      message: 'This room already has two players.'
    };
  }

  room.controllerSocketId = socketId;
  room.controllerClientId = clientId || room.controllerClientId;
  room.controllerName = playerName;
  room.controllerReady = true;
  room.status = 'ready';

  await sql`
    UPDATE game_rooms
    SET
      controller_socket_id = ${socketId},
      controller_name = ${playerName},
      controller_ready = TRUE,
      status = 'ready'
    WHERE room_code = ${roomCode}
  `;

  return {
    ok: true,
    playerSlot: 2,
    room: publicRoom(room)
  };
}

export async function startRoom({
  roomCode,
  socketId
}) {
  const room = activeRooms.get(roomCode);

  if (!room) {
    return {
      ok: false,
      message: 'Room not found.'
    };
  }

  if (room.hostSocketId !== socketId) {
    return {
      ok: false,
      message: 'Only the host can start the match.'
    };
  }

  if (!room.controllerSocketId) {
    return {
      ok: false,
      message: 'A second player has not joined yet.'
    };
  }

  room.status = 'active';
  room.startedAt = new Date().toISOString();

  await sql`
    UPDATE game_rooms
    SET
      status = 'active',
      started_at = NOW()
    WHERE room_code = ${roomCode}
  `;

  return {
    ok: true,
    room: publicRoom(room)
  };
}

export async function finishRoom(roomCode) {
  const room = activeRooms.get(roomCode);

  if (!room) {
    return;
  }

  room.status = 'finished';

  await sql`
    UPDATE game_rooms
    SET
      status = 'finished',
      finished_at = NOW()
    WHERE room_code = ${roomCode}
  `;

  activeRooms.delete(roomCode);
}

export async function cancelRoom({
  roomCode,
  socketId
}) {
  const room = activeRooms.get(roomCode);

  if (!room) {
    return {
      ok: false,
      message: 'Room not found.'
    };
  }

  if (room.hostSocketId !== socketId) {
    return {
      ok: false,
      message: 'Only the host can cancel the room.'
    };
  }

  room.status = 'cancelled';

  await sql`
    UPDATE game_rooms
    SET
      status = 'cancelled',
      finished_at = NOW()
    WHERE room_code = ${roomCode}
  `;

  activeRooms.delete(roomCode);

  return {
    ok: true
  };
}

export function getRoom(roomCode) {
  return publicRoom(activeRooms.get(roomCode));
}

export function getInternalRoom(roomCode) {
  return activeRooms.get(roomCode) || null;
}

export function findRoomByClient(clientId) {
  if (!clientId) return null;
  for (const room of activeRooms.values()) {
    if (room.hostClientId === clientId || room.controllerClientId === clientId) {
      return room;
    }
  }
  return null;
}

/**
 * Reattach a returning device (same clientId) to its seat with a fresh socket.
 * This is what makes a browser refresh seamless instead of spawning a new id.
 */
export async function resumeRoom({ roomCode, clientId, socketId }) {
  const room = roomCode ? activeRooms.get(roomCode) : findRoomByClient(clientId);

  if (!room) {
    return { ok: false, message: 'Room no longer active.' };
  }

  let role = null;

  if (room.hostClientId && room.hostClientId === clientId) {
    room.hostSocketId = socketId;
    room.hostReady = true;
    role = 'host';
    await sql`
      UPDATE game_rooms
      SET host_socket_id = ${socketId}, host_ready = TRUE
      WHERE room_code = ${room.code}
    `;
  } else if (room.controllerClientId && room.controllerClientId === clientId) {
    room.controllerSocketId = socketId;
    room.controllerReady = true;
    if (room.status === 'waiting') room.status = 'ready';
    role = 'controller';
    await sql`
      UPDATE game_rooms
      SET controller_socket_id = ${socketId}, controller_ready = TRUE
      WHERE room_code = ${room.code}
    `;
  } else {
    return { ok: false, message: 'This device has no seat in that room.' };
  }

  return { ok: true, role, room: publicRoom(room) };
}

export function findRoomBySocket(socketId) {
  for (const room of activeRooms.values()) {
    if (
      room.hostSocketId === socketId ||
      room.controllerSocketId === socketId
    ) {
      return room;
    }
  }

  return null;
}

export async function handleDisconnect(socketId) {
  const room = findRoomBySocket(socketId);

  if (!room) {
    return null;
  }

  let disconnectedRole = null;

  if (room.hostSocketId === socketId) {
    room.hostSocketId = null;
    room.hostReady = false;
    disconnectedRole = 'host';

    await sql`
      UPDATE game_rooms
      SET
        host_socket_id = NULL,
        host_ready = FALSE
      WHERE room_code = ${room.code}
    `;
  }

  if (room.controllerSocketId === socketId) {
    room.controllerSocketId = null;
    room.controllerReady = false;
    disconnectedRole = 'controller';

    if (room.status !== 'active') {
      room.status = 'waiting';
    }

    await sql`
      UPDATE game_rooms
      SET
        controller_socket_id = NULL,
        controller_ready = FALSE,
        status = CASE
          WHEN status = 'active' THEN status
          ELSE 'waiting'
        END
      WHERE room_code = ${room.code}
    `;
  }

  return {
    roomCode: room.code,
    disconnectedRole,
    room: publicRoom(room)
  };
}