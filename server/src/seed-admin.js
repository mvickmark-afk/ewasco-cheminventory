import 'dotenv/config';
import bcrypt from 'bcryptjs';
import pg from 'pg';

const username = (process.env.ADMIN_USERNAME || 'admin').trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD;
if (!password || password.length < 12) throw new Error('Set ADMIN_PASSWORD to at least 12 characters');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();
try {
  await client.query('BEGIN');
  const org = await client.query('INSERT INTO organizations(name) VALUES($1) RETURNING id', [process.env.ORG_NAME || 'EWASCO']);
  const hash = await bcrypt.hash(password, 12);
  await client.query('INSERT INTO users(organization_id, username, password_hash, role) VALUES($1,$2,$3,$4)', [org.rows[0].id, username, hash, 'Administrator']);
  await client.query('COMMIT');
  console.log(`Created administrator ${username}`);
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await pool.end();
}
