// server/validation.js

import { z } from 'zod';

const mapSchema =
  z.enum([
    'frontier',
    'orchard',
    'frost'
  ]);

export const createRoomSchema =
  z.object({
    mode:
      z.enum([
        'coop',
        'versus',
        'solophone'   // one player, phone is the controller (booth walk-up)
      ])
      .default('coop'),

    mapId:
      mapSchema
      .default('frontier'),

    playerName:
      z.string()
      .trim()
      .min(1)
      .max(20)
      .default('Warden 1')
  });

export const joinRoomSchema = z.object({
  roomCode: z
    .string()
    .trim()
    .length(6)
    .regex(/^[A-Z0-9]+$/i)
    .transform((value) => value.toUpperCase()),

  playerName: z
    .string()
    .trim()
    .min(1)
    .max(20)
});

export const controllerAimSchema = z.object({
  roomCode: z
    .string()
    .trim()
    .length(6)
    .transform((value) => value.toUpperCase()),

  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1)
});

export const controllerStrikeSchema = z.object({
  roomCode: z
    .string()
    .trim()
    .length(6)
    .transform((value) => value.toUpperCase()),

  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),

  clientShotId: z
    .string()
    .max(80)
    .optional()
});

// Versus: the phone attacker asks the host to spawn a raider from a lane.
export const controllerSpawnSchema = z.object({
  roomCode: z
    .string()
    .trim()
    .length(6)
    .transform((value) => value.toUpperCase()),

  lane: z.number().min(0).max(1),

  raiderType: z.enum(['basic', 'fast', 'tough']).default('basic')
});

export const leaderboardSubmissionSchema = z.object({
  // "[Company] - [Player]" — combined label shown on the board.
  displayName: z
    .string()
    .trim()
    .min(1)
    .max(100),

  company: z
    .string()
    .trim()
    .max(40)
    .optional(),

  playerName: z
    .string()
    .trim()
    .max(40)
    .optional(),

  mode: z.enum(['solo', 'coop', 'versus']),

 mapId: mapSchema,

  score: z
    .number()
    .int()
    .min(0)
    .max(100000000),

  durationSeconds: z
    .number()
    .min(0)
    .max(3600),

  wavesCleared: z
    .number()
    .int()
    .min(0)
    .max(10000),

  kills: z
    .number()
    .int()
    .min(0)
    .max(100000),

  perfectWaves: z
    .number()
    .int()
    .min(0)
    .max(10000),

  deviceId: z
    .string()
    .trim()
    .max(128)
    .optional()
});

export const profileSyncSchema = z.object({
  deviceId: z
    .string()
    .trim()
    .min(1)
    .max(128),

  // Only non-economy fields (settings/name/loadout/map) are honoured server-side;
  // economy fields in here are ignored. Accept a loose blob and filter later.
  profile: z
    .object({})
    .passthrough()
    .default({})
});

// A single validated purchase — the server decides if it's affordable/allowed.
export const purchaseSchema = z.object({
  deviceId: z.string().trim().min(1).max(128),
  kind: z.enum(['unlock', 'ammo', 'item', 'upgrade', 'weaponUpgrade']),
  id: z.string().trim().min(1).max(40)
});

// End-of-run report; the server derives coins/xp from these (capped).
export const runSchema = z.object({
  deviceId: z.string().trim().min(1).max(128),
  stats: z.object({
    score: z.number().min(0).max(1e8).optional(),
    time: z.number().min(0).max(36000).optional(),
    kills: z.number().int().min(0).max(1e5).optional(),
    waves: z.number().int().min(0).max(1e4).optional(),
    perfectWaves: z.number().int().min(0).max(1e4).optional(),
    mango: z.number().int().min(0).max(1e4).optional(),
    ammo: z.object({}).passthrough().optional(),
    items: z.object({}).passthrough().optional(),
    loadout: z.string().max(40).optional()
  }).default({})
});

export function parsePayload(schema, payload) {
  const result = schema.safeParse(payload);

  if (!result.success) {
    return {
      ok: false,
      message: 'Invalid request.',
      errors: result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message
      }))
    };
  }

  return {
    ok: true,
    data: result.data
  };
}