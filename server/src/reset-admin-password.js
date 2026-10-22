import 'dotenv/config';
import bcrypt from 'bcryptjs';
import pg from 'pg';

const username = (process.env.RESET_ADMIN_USERNAME || '').trim().toLowerCase();
const password = process.env.RECOVERY_NEW_PASSWORD;
const confirmation = process.env.CONFIRM_ADMIN_PASSWORD_RESET;

if (confirmation !== 'RESET') throw Error('Set CONFIRM_ADMIN_PASSWORD_RESET=RESET to authorise this one-time operation');
if (!username) throw Error('RESET_ADMIN_USERNAME is required');
if (!password || password.length < 12 || password.startsWith('SET_')) {
  throw Error('RECOVERY_NEW_PASSWORD must be a unique password of at least 12 characters');
}
if (!process.env.DATABASE_URL) throw Error('DATABASE_URL is required');

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const client = await pool.connect();

try {
  await client.query('BEGIN');
  const result = await client.query(
    "SELECT id, organization_id, username, role, disabled FROM users WHERE lower(username)=lower($1) FOR UPDATE",
    [username]
  );

  if (result.rowCount !== 1) {
    throw Error(result.rowCount === 0
      ? 'No account matches RESET_ADMIN_USERNAME; no changes were made'
      : 'More than one account matches RESET_ADMIN_USERNAME; no changes were made');
  }

  const user = result.rows[0];
  if (user.role !== 'Administrator') throw Error('Target account is not an Administrator; no changes were made');
  if (user.disabled) throw Error('Target Administrator account is disabled; no changes were made');

  const passwordHash = await bcrypt.hash(password, 12);
  await client.query(
    'UPDATE users SET password_hash=$1, password_changed_at=now(), failed_login_attempts=0, locked_until=NULL WHERE id=$2',
    [passwordHash, user.id]
  );
  await client.query('DELETE FROM sessions WHERE user_id=$1', [user.id]);
  await client.query(
    "INSERT INTO audit_log(organization_id,user_id,action,entity,record_id,data) VALUES($1,$2,'administrator_password_reset','auth',$3,$4)",
    [user.organization_id, user.id, user.id, { method: 'controlled_one_time_cli', sessions_revoked: true }]
  );
  await client.query('COMMIT');
  console.log(`Administrator password reset completed for ${user.username}. Existing sessions were revoked. No password was printed.`);
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  throw error;
} finally {
  client.release();
  await pool.end();
}
