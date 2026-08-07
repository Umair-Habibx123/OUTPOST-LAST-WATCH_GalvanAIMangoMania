// database/setup.js
/* Idempotent schema migration. Applies database/schema.sql statement-by-statement
   (the Neon HTTP driver runs one statement per call). Safe to re-run — every
   statement uses IF NOT EXISTS. Run with: npm run db:setup */
import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL);
const dir = path.dirname(fileURLToPath(import.meta.url));

const raw = await readFile(path.join(dir, 'schema.sql'), 'utf8');

// strip transaction wrappers + comments, then split into individual statements
const statements = raw
  .replace(/BEGIN;|COMMIT;/g, '')
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n')
  .split(';')
  .map((s) => s.trim())
  .filter(Boolean);

let applied = 0;
for (const statement of statements) {
  await sql.query(statement);
  applied += 1;
}

console.log(`Schema applied: ${applied} statements OK.`);
