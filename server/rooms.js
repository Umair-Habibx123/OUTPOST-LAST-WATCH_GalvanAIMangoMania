import crypto from 'node:crypto';
import { sql } from './database.js';

const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_CODE_LENGTH = 6;

// Hot cache for active rooms. Neon remains the recovery source of truth.
const activeRooms = new Map();

function generateRoomCode() {
  let output = '';
  for (let index = 0; index < ROOM_CODE_LENGTH; index += 1) {
    output += ROOM_ALPHABET[crypto.randomInt(0, ROOM_ALPHABET.length)];
  }
  return output;
}

function publicRoom(room) {
  if (!room) return null;

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

function rowToRoom(row) {
  if (!row) return null;

  return {
    id: row.id,
    code: row.room_code,
    mode: row.mode,
    status: row.status,
    mapId: row.map_id,

    hostSocketId: row.host_socket_id || null,
    controllerSocketId: row.controller_socket_id || null,

    hostClientId: row.host_client_id || null,
    controllerClientId: row.controller_client_id || null,

    hostName: row.host_name,
    controllerName: row.controller_name || null,

    hostReady: Boolean(row.host_ready),
    controllerReady: Boolean(row.controller_ready),

    createdAt: row.created_at,
    startedAt: row.started_at || null
  };
}

async function loadRoomFromDatabase(roomCode) {
  const rows = await sql`
    SELECT
      id,
      room_code,
      mode,
      status,
      map_id,
      host_socket_id,
      controller_socket_id,
      host_client_id,
      controller_client_id,
      host_name,
      controller_name,
      host_ready,
      controller_ready,
      created_at,
      started_at
    FROM game_rooms
    WHERE room_code = ${roomCode}
      AND expires_at > NOW()
      AND status NOT IN ('finished', 'cancelled')
    LIMIT 1
  `;

  if (!rows.length) return null;

  const room = rowToRoom(rows[0]);

  // Socket IDs do not survive a process restart. A recovered room must wait for
  // each device to resume and attach a fresh socket before being marked online.
  room.hostSocketId = null;
  room.controllerSocketId = null;
  room.hostReady = false;
  room.controllerReady = false;

  activeRooms.set(room.code, room);
  return room;
}

async function getOrHydrateRoom(roomCode) {
  const normalized = String(roomCode || '').trim().toUpperCase();
  if (!normalized) return null;

  const cached = activeRooms.get(normalized);
  if (cached) return cached;

  return loadRoomFromDatabase(normalized);
}

async function roomCodeExists(roomCode) {
  if (activeRooms.has(roomCode)) return true;

  const result = await sql`
    SELECT id
    FROM game_rooms
    WHERE room_code = ${roomCode}
      AND expires_at > NOW()
      AND status NOT IN ('finished', 'cancelled')
    LIMIT 1
  `;

  return result.length > 0;
}

async function uniqueRoomCode() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const code = generateRoomCode();
    if (!(await roomCodeExists(code))) return code;
  }
  throw new Error('Unable to generate a unique room code.');
}

export async function createRoom({ hostSocketId, clientId, mode, mapId, playerName }) {
  const id = crypto.randomUUID();
  const code = await uniqueRoomCode();
  const expiryMinutes = Number.parseInt(process.env.ROOM_EXPIRY_MINUTES || '60', 10);

  const room = {
    id,
    code,
    mode,
    mapId,
    status: 'waiting',

    hostSocketId,
    controllerSocketId: null,

    hostClientId: clientId || null,
    controllerClientId: null,

    hostName: playerName,
    controllerName: null,

    hostReady: true,
    controllerReady: false,

    createdAt: new Date().toISOString(),
    startedAt: null
  };

  await sql`
    INSERT INTO game_rooms (
      id,
      room_code,
      mode,
      status,
      map_id,
      host_socket_id,
      host_client_id,
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
      ${clientId || null},
      ${playerName},
      TRUE,
      NOW() + (${expiryMinutes} * INTERVAL '1 minute')
    )
  `;

  activeRooms.set(code, room);
  return publicRoom(room);
}

export async function joinRoom({ roomCode, socketId, clientId, playerName }) {
  const normalized = String(roomCode || '').trim().toUpperCase();
  const room = await getOrHydrateRoom(normalized);

  if (!room) {
    return { ok: false, message: 'Room not found or no longer active.' };
  }

  // Returning controller reclaims the same seat.
  if (room.controllerClientId && clientId && room.controllerClientId === clientId) {
    room.controllerSocketId = socketId;
    room.controllerName = playerName || room.controllerName;
    room.controllerReady = true;
    if (room.status === 'waiting') room.status = 'ready';

    await sql`
      UPDATE game_rooms
      SET
        controller_socket_id = ${socketId},
        controller_client_id = ${clientId},
        controller_name = ${room.controllerName},
        controller_ready = TRUE,
        status = CASE WHEN status = 'waiting' THEN 'ready' ELSE status END
      WHERE room_code = ${normalized}
    `;

    return { ok: true, playerSlot: 2, room: publicRoom(room) };
  }

  if (room.status === 'active') {
    return { ok: false, message: 'This match has already started.' };
  }

  if (room.controllerClientId && room.controllerClientId !== clientId) {
    return { ok: false, message: 'This room already has two players.' };
  }

  // Claim the controller seat atomically in Neon. This prevents two phones from
  // racing into the same room at the event.
  const claimed = await sql`
    UPDATE game_rooms
    SET
      controller_socket_id = ${socketId},
      controller_client_id = ${clientId || null},
      controller_name = ${playerName},
      controller_ready = TRUE,
      status = 'ready'
    WHERE room_code = ${normalized}
      AND expires_at > NOW()
      AND status IN ('waiting', 'ready')
      AND (
        controller_client_id IS NULL
        OR controller_client_id = ${clientId || null}
      )
    RETURNING id
  `;

  if (!claimed.length) {
    return { ok: false, message: 'This room already has two players or is no longer available.' };
  }

  room.controllerSocketId = socketId;
  room.controllerClientId = clientId || null;
  room.controllerName = playerName;
  room.controllerReady = true;
  room.status = 'ready';

  return { ok: true, playerSlot: 2, room: publicRoom(room) };
}

export async function startRoom({ roomCode, socketId }) {
  const room = await getOrHydrateRoom(roomCode);

  if (!room) return { ok: false, message: 'Room not found.' };
  if (room.hostSocketId !== socketId) return { ok: false, message: 'Only the host can start the match.' };
  if (!room.controllerSocketId) return { ok: false, message: 'A second player has not joined yet.' };

  room.status = 'active';
  room.startedAt = new Date().toISOString();

  await sql`
    UPDATE game_rooms
    SET status = 'active', started_at = NOW()
    WHERE room_code = ${room.code}
  `;

  return { ok: true, room: publicRoom(room) };
}

export async function finishRoom(roomCode) {
  const room = await getOrHydrateRoom(roomCode);
  if (!room) return;

  room.status = 'finished';

  await sql`
    UPDATE game_rooms
    SET status = 'finished', finished_at = NOW()
    WHERE room_code = ${room.code}
  `;

  activeRooms.delete(room.code);
}

export async function cancelRoom({ roomCode, socketId }) {
  const room = await getOrHydrateRoom(roomCode);

  if (!room) return { ok: false, message: 'Room not found.' };
  if (room.hostSocketId !== socketId) return { ok: false, message: 'Only the host can cancel the room.' };

  room.status = 'cancelled';

  await sql`
    UPDATE game_rooms
    SET status = 'cancelled', finished_at = NOW()
    WHERE room_code = ${room.code}
  `;

  activeRooms.delete(room.code);
  return { ok: true };
}

export async function getRoom(roomCode) {
  return publicRoom(await getOrHydrateRoom(roomCode));
}

export function getInternalRoom(roomCode) {
  return activeRooms.get(String(roomCode || '').trim().toUpperCase()) || null;
}

export function findRoomByClient(clientId) {
  if (!clientId) return null;
  for (const room of activeRooms.values()) {
    if (room.hostClientId === clientId || room.controllerClientId === clientId) return room;
  }
  return null;
}

async function findPersistedRoomByClient(clientId) {
  if (!clientId) return null;

  const rows = await sql`
    SELECT
      id,
      room_code,
      mode,
      status,
      map_id,
      host_socket_id,
      controller_socket_id,
      host_client_id,
      controller_client_id,
      host_name,
      controller_name,
      host_ready,
      controller_ready,
      created_at,
      started_at
    FROM game_rooms
    WHERE expires_at > NOW()
      AND status NOT IN ('finished', 'cancelled')
      AND (
        host_client_id = ${clientId}
        OR controller_client_id = ${clientId}
      )
    ORDER BY created_at DESC
    LIMIT 1
  `;

  if (!rows.length) return null;

  const room = rowToRoom(rows[0]);
  room.hostSocketId = null;
  room.controllerSocketId = null;
  room.hostReady = false;
  room.controllerReady = false;
  activeRooms.set(room.code, room);
  return room;
}

export async function resumeRoom({ roomCode, clientId, socketId }) {
  let room = null;

  if (roomCode) {
    room = await getOrHydrateRoom(roomCode);
  } else {
    room = findRoomByClient(clientId) || await findPersistedRoomByClient(clientId);
  }

  if (!room) return { ok: false, message: 'Room no longer active.' };

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
      SET
        controller_socket_id = ${socketId},
        controller_ready = TRUE,
        status = CASE WHEN status = 'waiting' THEN 'ready' ELSE status END
      WHERE room_code = ${room.code}
    `;
  } else {
    return { ok: false, message: 'This device has no seat in that room.' };
  }

  return { ok: true, role, room: publicRoom(room) };
}

export function findRoomBySocket(socketId) {
  for (const room of activeRooms.values()) {
    if (room.hostSocketId === socketId || room.controllerSocketId === socketId) return room;
  }
  return null;
}

export async function handleDisconnect(socketId) {
  const room = findRoomBySocket(socketId);
  if (!room) return null;

  const isHost = room.hostSocketId === socketId;
  const isController = room.controllerSocketId === socketId;
  const role = isHost ? 'host' : (isController ? 'controller' : null);
  if (!role) return null;

  const wasActive = room.status === 'active';

  /* CO-OP EXCEPTION.
     Co-op is a shared watch, not a duel: the host IS the game. If Player 2's
     phone drops mid-match the wall is still standing and the host must keep
     playing, so the room stays alive (the host's backup controls take over
     P2, and the phone can resume straight back into its seat). Closing the
     room here was what made a P2 dropout end the host's run too.

     The host leaving still ends it for both — without the host there is no
     game left to play. Versus keeps its duel semantics: whoever is still
     connected wins by forfeit. */
  if (wasActive && isController && room.mode === 'coop') {
    room.controllerSocketId = null;
    room.controllerReady = false;
    await sql`
      UPDATE game_rooms
      SET controller_socket_id = NULL, controller_ready = FALSE
      WHERE room_code = ${room.code}
    `;
    return {
      roomCode: room.code,
      disconnectedRole: role,
      room: publicRoom(room),
      closed: false,
      matchLive: true
    };
  }

  // A dropped socket (grace already expired) ends the room when EITHER the match
  // was live, OR the HOST left the lobby (no game without a host). The peer who
  // is still connected is the winner of a live match.
  if (wasActive || isHost) {
    const winnerRole = wasActive ? (isHost ? 'controller' : 'host') : null;
    room.status = 'finished';
    if (isHost) { room.hostSocketId = null; room.hostReady = false; }
    if (isController) { room.controllerSocketId = null; room.controllerReady = false; }

    await sql`
      UPDATE game_rooms
      SET status = 'finished', finished_at = NOW(),
          host_socket_id = CASE WHEN ${isHost} THEN NULL ELSE host_socket_id END,
          controller_socket_id = CASE WHEN ${isController} THEN NULL ELSE controller_socket_id END
      WHERE room_code = ${room.code}
    `;
    activeRooms.delete(room.code);

    return { roomCode: room.code, disconnectedRole: role, room: publicRoom(room), closed: true, winnerRole, mode: room.mode };
  }

  // lobby + controller left → free the seat, keep the room open for a new joiner
  room.controllerSocketId = null;
  room.controllerReady = false;
  room.status = 'waiting';
  await sql`
    UPDATE game_rooms
    SET controller_socket_id = NULL, controller_ready = FALSE, status = 'waiting'
    WHERE room_code = ${room.code}
  `;

  return { roomCode: room.code, disconnectedRole: role, room: publicRoom(room), closed: false };
}
