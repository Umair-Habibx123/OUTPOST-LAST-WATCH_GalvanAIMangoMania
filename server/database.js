// server/database.js

import { neon } from '@neondatabase/serverless';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    'DATABASE_URL is missing. Add it to your .env file.'
  );
}

export const sql = neon(databaseUrl);

/**
 * Test the database connection during server startup.
 */
export async function verifyDatabaseConnection() {
  const result = await sql`
    SELECT
      current_database() AS database_name,
      NOW() AS server_time
  `;

  return result[0];
}

/**
 * Idempotent schema top-ups applied on startup, so a live database gains new
 * columns without a manual migration. Safe to run repeatedly.
 */
export async function applyMigrations() {
  await sql`ALTER TABLE leaderboard_entries ALTER COLUMN display_name TYPE VARCHAR(120)`;
  await sql`ALTER TABLE leaderboard_entries ADD COLUMN IF NOT EXISTS company VARCHAR(60)`;
  await sql`ALTER TABLE leaderboard_entries ADD COLUMN IF NOT EXISTS player_name VARCHAR(60)`;
  // allow the 'solophone' room mode (booth solo play via phone controller)
  await sql`ALTER TABLE game_rooms DROP CONSTRAINT IF EXISTS game_rooms_mode_check`;
  await sql`ALTER TABLE game_rooms ADD CONSTRAINT game_rooms_mode_check CHECK (mode IN ('coop','versus','solophone'))`;
}

/**
 * Delete rooms that expired before the current time.
 */
export async function removeExpiredRooms() {
  await sql`
    DELETE FROM game_rooms
    WHERE expires_at < NOW()
       OR (
         status IN ('finished', 'cancelled')
         AND finished_at < NOW() - INTERVAL '2 hours'
       )
  `;
}