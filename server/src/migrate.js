import 'dotenv/config';
import fs from 'node:fs/promises';
import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const sql = await fs.readFile(new URL('../sql/schema.sql', import.meta.url), 'utf8');
await pool.query(sql);
await pool.end();
console.log('Database migration complete');
