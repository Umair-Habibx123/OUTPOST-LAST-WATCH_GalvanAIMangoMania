// server/database .js

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