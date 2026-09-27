import 'dotenv/config';
import fs from 'node:fs/promises';
import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const sql = await fs.readFile(new URL('../sql/schema.sql', import.meta.url), 'utf8');

const requiredTables = [
  'schema_migrations',
  'organizations',
  'users',
  'sessions',
  'records',
  'inventory_batches',
  'inventory_transactions',
  'sds_versions',
  'audit_log'
];

try {
  await pool.query('BEGIN');
  await pool.query(sql);

  const q = await pool.query(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name = ANY($1)`,
    [requiredTables]
  );

  const found = new Set(q.rows.map(row => row.table_name));
  const missing = requiredTables.filter(table => !found.has(table));

  if (missing.length) {
    throw new Error(`Migration verification failed; missing tables: ${missing.join(', ')}`);
  }

  await pool.query(
    "INSERT INTO schema_migrations(version) VALUES('003-inventory-engine') ON CONFLICT DO NOTHING"
  );

  await pool.query('COMMIT');
  console.log(`Migration verified: ${requiredTables.length} required tables present`);
} catch (error) {
  await pool.query('ROLLBACK');
  throw error;
} finally {
  await pool.end();
}
