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
        'versus'
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

export const leaderboardSubmissionSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(1)
    .max(20),

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

  // the whole evolving profile blob; stored as JSONB. Size is capped by the
  // express.json body limit, so we accept arbitrary known/unknown fields.
  profile: z
    .object({})
    .passthrough()
    .default({})
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