// server.js

import 'dotenv/config';

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

import compression from 'compression';
import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { createServer } from 'node:http';
import { Server } from 'socket.io';

import {
  removeExpiredRooms,
  sql,
  verifyDatabaseConnection
} from './server/database.js';

import {
  leaderboardSubmissionSchema,
  profileSyncSchema,
  purchaseSchema,
  runSchema,
  parsePayload
} from './server/validation.js';

import {
  applyPurchase,
  applyRun,
  sanitize
} from './server/economy.js';

import { configureSockets } from './server/socket.js';

const currentFile = fileURLToPath(import.meta.url);
const currentDirectory = path.dirname(currentFile);

const port = Number.parseInt(process.env.PORT || '3000', 10);
const publicDirectory = path.join(currentDirectory, 'public');

const app = express();
const httpServer = createServer(app);

const allowedOrigin =
  process.env.ALLOWED_ORIGIN ||
  process.env.PUBLIC_URL ||
  `http://localhost:${port}`;

const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigin,
    methods: ['GET', 'POST']
  },
  transports: ['websocket', 'polling'],
  pingInterval: 10000,
  pingTimeout: 10000
});

app.disable('x-powered-by');

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
  })
);

app.use(compression());

app.use(
  cors({
    origin: allowedOrigin
  })
);

app.use(
  express.json({
    limit: '100kb'
  })
);

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false
});

const scoreLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 12,
  standardHeaders: true,
  legacyHeaders: false
});

app.use('/api', apiLimiter);

app.get('/api/health', async (request, response) => {
  try {
    const result = await sql`
      SELECT NOW() AS database_time
    `;

    response.json({
      ok: true,
      service: 'Outpost: Last Watch',
      databaseTime: result[0].database_time
    });
  } catch (error) {
    console.error(error);

    response.status(503).json({
      ok: false,
      message: 'Database connection unavailable.'
    });
  }
});

app.get('/api/leaderboard', async (request, response) => {
  try {
    const rawLimit = Number.parseInt(
      String(request.query.limit || '10'),
      10
    );

    const limit = Math.max(1, Math.min(rawLimit, 50));

    const mode =
      typeof request.query.mode === 'string'
        ? request.query.mode
        : null;

    const mapId =
      typeof request.query.map === 'string'
        ? request.query.map
        : null;

    const entries = await sql`
      SELECT
        id,
        display_name AS "displayName",
        mode,
        map_id AS "mapId",
        score,
        duration_seconds AS "durationSeconds",
        waves_cleared AS "wavesCleared",
        kills,
        event_day AS "eventDay",
        created_at AS "createdAt"
      FROM leaderboard_entries
      WHERE event_day = CURRENT_DATE
        AND (${mode}::text IS NULL OR mode = ${mode})
        AND (${mapId}::text IS NULL OR map_id = ${mapId})
      ORDER BY
        score DESC,
        duration_seconds DESC,
        created_at ASC
      LIMIT ${limit}
    `;

    response.json(entries);
  } catch (error) {
    console.error('Leaderboard fetch failed', error);

    response.status(500).json({
      ok: false,
      message: 'Unable to load the leaderboard.'
    });
  }
});

app.post(
  '/api/leaderboard',
  scoreLimiter,
  async (request, response) => {
    try {
      const parsed = parsePayload(
        leaderboardSubmissionSchema,
        request.body
      );

      if (!parsed.ok) {
        response.status(400).json(parsed);
        return;
      }

      const entry = parsed.data;
      const matchId = crypto.randomUUID();
      const leaderboardId = crypto.randomUUID();

      await sql.transaction([
        sql`
          INSERT INTO match_results (
            id,
            mode,
            map_id,
            duration_seconds,
            waves_cleared,
            kills,
            perfect_waves,
            total_score
          )
          VALUES (
            ${matchId},
            ${entry.mode},
            ${entry.mapId},
            ${entry.durationSeconds},
            ${entry.wavesCleared},
            ${entry.kills},
            ${entry.perfectWaves},
            ${entry.score}
          )
        `,

        sql`
          INSERT INTO leaderboard_entries (
            id,
            match_id,
            display_name,
            mode,
            map_id,
            score,
            duration_seconds,
            waves_cleared,
            kills,
            device_id
          )
          VALUES (
            ${leaderboardId},
            ${matchId},
            ${entry.displayName},
            ${entry.mode},
            ${entry.mapId},
            ${entry.score},
            ${entry.durationSeconds},
            ${entry.wavesCleared},
            ${entry.kills},
            ${entry.deviceId || null}
          )
        `
      ]);

      response.status(201).json({
        ok: true,
        id: leaderboardId
      });
    } catch (error) {
      console.error('Leaderboard submission failed', error);

      response.status(500).json({
        ok: false,
        message: 'Unable to save the score.'
      });
    }
  }
);

app.delete('/api/admin/leaderboard', async (request, response) => {
  const providedSecret = request.header('x-admin-secret');
  const expectedSecret = process.env.ADMIN_SECRET;

  if (
    !expectedSecret ||
    !providedSecret ||
    providedSecret !== expectedSecret
  ) {
    response.status(403).json({
      ok: false,
      message: 'Forbidden.'
    });

    return;
  }

  try {
    await sql`
      DELETE FROM leaderboard_entries
      WHERE event_day = CURRENT_DATE
    `;

    response.json({
      ok: true
    });
  } catch (error) {
    console.error('Leaderboard reset failed', error);

    response.status(500).json({
      ok: false,
      message: 'Unable to reset the leaderboard.'
    });
  }
});

// ================= per-device player profile (SERVER-AUTHORITATIVE) =================
// The browser holds ONLY its device id. All coins/unlocks/ammo/upgrades live here
// and are mutated only through validated endpoints, so a tampered client can't
// grant itself anything.

async function loadProfile(deviceId) {
  const rows = await sql`SELECT data FROM player_profiles WHERE device_id = ${deviceId}`;
  return sanitize(rows.length ? rows[0].data : null);
}

async function saveProfile(deviceId, profile) {
  const json = JSON.stringify(profile);
  const bestScore = Math.max(0, Math.round(Number(profile.bestScore) || 0));
  const displayName = (profile.name ? String(profile.name) : '').slice(0, 40) || null;
  await sql`
    INSERT INTO player_profiles (device_id, data, best_score, display_name, updated_at)
    VALUES (${deviceId}, ${json}::jsonb, ${bestScore}, ${displayName}, NOW())
    ON CONFLICT (device_id) DO UPDATE
      SET data = ${json}::jsonb, best_score = ${bestScore},
          display_name = ${displayName}, updated_at = NOW()
  `;
}

app.get('/api/profile', async (request, response) => {
  const deviceId = String(request.query.deviceId || '').slice(0, 128);
  if (!deviceId) {
    response.status(400).json({ ok: false, message: 'deviceId is required.' });
    return;
  }
  try {
    response.json({ ok: true, profile: await loadProfile(deviceId) });
  } catch (error) {
    console.error('Profile fetch failed', error);
    response.status(500).json({ ok: false, message: 'Unable to load profile.' });
  }
});

// Only NON-economy fields (settings / name / loadout / map) are accepted here.
app.post('/api/profile', async (request, response) => {
  const parsed = parsePayload(profileSyncSchema, request.body);
  if (!parsed.ok) { response.status(400).json(parsed); return; }

  const { deviceId, profile: incoming } = parsed.data;
  try {
    const profile = await loadProfile(deviceId);
    if (incoming.settings && typeof incoming.settings === 'object') profile.settings = incoming.settings;
    if (typeof incoming.name === 'string') profile.name = incoming.name.slice(0, 40);
    if (typeof incoming.loadout === 'string') profile.loadout = incoming.loadout;
    if (typeof incoming.map === 'string') profile.map = incoming.map;
    await saveProfile(deviceId, profile);
    response.json({ ok: true, profile });
  } catch (error) {
    console.error('Profile settings save failed', error);
    response.status(500).json({ ok: false, message: 'Unable to save settings.' });
  }
});

// Buy a weapon unlock / ammo clip / consumable / upgrade — validated + priced here.
app.post('/api/purchase', async (request, response) => {
  const parsed = parsePayload(purchaseSchema, request.body);
  if (!parsed.ok) { response.status(400).json(parsed); return; }

  const { deviceId, kind, id } = parsed.data;
  try {
    const profile = await loadProfile(deviceId);
    const result = applyPurchase(profile, kind, id);
    if (!result.ok) { response.status(400).json(result); return; }
    await saveProfile(deviceId, result.profile);
    response.json({ ok: true, profile: result.profile });
  } catch (error) {
    console.error('Purchase failed', error);
    response.status(500).json({ ok: false, message: 'Purchase failed.' });
  }
});

// End-of-run reward: server derives coins/xp from stats (capped) and persists.
app.post('/api/run', async (request, response) => {
  const parsed = parsePayload(runSchema, request.body);
  if (!parsed.ok) { response.status(400).json(parsed); return; }

  const { deviceId, stats } = parsed.data;
  try {
    const profile = await loadProfile(deviceId);
    const result = applyRun(profile, stats);
    await saveProfile(deviceId, result.profile);
    response.json({ ok: true, profile: result.profile, earned: result.earned, xpGain: result.xpGain });
  } catch (error) {
    console.error('Run reward failed', error);
    response.status(500).json({ ok: false, message: 'Unable to save run.' });
  }
});

app.use(
  express.static(publicDirectory, {
    extensions: ['html'],
    maxAge:
      process.env.NODE_ENV === 'production'
        ? '1h'
        : 0
  })
);

app.get('/{*splat}', (request, response) => {
  response.sendFile(
    path.join(publicDirectory, 'index.html')
  );
});

configureSockets(io);

async function initializeServer() {
  try {
    const database = await verifyDatabaseConnection();

    console.log(
      `Connected to Neon database: ${database.database_name}`
    );

    await removeExpiredRooms();
  } catch (error) {
    console.error('Server initialization failed', error);
  }
}

initializeServer();

/*
 * Local development
 */
if (!process.env.VERCEL) {
  httpServer.listen(port, () => {
    console.log(
      `Outpost: Last Watch running at http://localhost:${port}`
    );
  });
}

/*
 * Vercel entry point
 */
export default httpServer;