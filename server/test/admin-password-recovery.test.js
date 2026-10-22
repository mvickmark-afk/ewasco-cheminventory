import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import pg from 'pg';
import bcrypt from 'bcryptjs';

const databaseUrl = process.env.TEST_DATABASE_URL;
const root = fileURLToPath(new URL('../', import.meta.url));

const runNode = (script, env = {}) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [script], {
    cwd: root,
    env: {...process.env, ...env},
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => stdout += chunk);
  child.stderr.on('data', chunk => stderr += chunk);
  child.on('error', reject);
  child.on('close', code => resolve({code, stdout, stderr}));
});

test('controlled administrator password recovery', {skip: databaseUrl ? false : 'TEST_DATABASE_URL is not configured', timeout: 30000}, async t => {
  const parsed = new URL(databaseUrl);
  assert.match(parsed.pathname.slice(1), /test/i, 'TEST_DATABASE_URL must reference a dedicated test database');
  const pool = new pg.Pool({connectionString: databaseUrl});
  const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 20);
  const username = `ci_admin_${suffix}`;
  const organizationName = `CI Admin Recovery ${crypto.randomUUID()}`;
  const oldPassword = 'Old-Test-Password-123';
  const newPassword = 'New-Test-Password-456';
  let organizationId, userId;

  try {
    const migrated = await runNode('src/migrate.js', {DATABASE_URL: databaseUrl});
    assert.equal(migrated.code, 0, migrated.stderr || migrated.stdout);

    const org = await pool.query('INSERT INTO organizations(name) VALUES($1) RETURNING id', [organizationName]);
    organizationId = org.rows[0].id;
    const oldHash = await bcrypt.hash(oldPassword, 12);
    const user = await pool.query(
      "INSERT INTO users(organization_id,username,password_hash,role) VALUES($1,$2,$3,'Administrator') RETURNING id",
      [organizationId, username, oldHash]
    );
    userId = user.rows[0].id;
    await pool.query("INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 hour')", [userId, crypto.createHash('sha256').update('ci-session-token').digest('hex')]);
    await pool.query('UPDATE users SET failed_login_attempts=5, locked_until=now()+interval \'15 minutes\' WHERE id=$1', [userId]);

    await t.test('requires explicit confirmation and target account', async () => {
      const result = await runNode('src/reset-admin-password.js', {
        DATABASE_URL: databaseUrl,
        RECOVERY_NEW_PASSWORD: newPassword
      });
      assert.notEqual(result.code, 0);
      assert.match(result.stderr, /CONFIRM_ADMIN_PASSWORD_RESET/);
    });

    await t.test('resets only an existing enabled administrator, clears lockout and revokes sessions', async () => {
      const result = await runNode('src/reset-admin-password.js', {
        DATABASE_URL: databaseUrl,
        RESET_ADMIN_USERNAME: username,
        RECOVERY_NEW_PASSWORD: newPassword,
        CONFIRM_ADMIN_PASSWORD_RESET: 'RESET'
      });
      assert.equal(result.code, 0, result.stderr || result.stdout);
      assert.match(result.stdout, /Existing sessions were revoked/);
      assert.doesNotMatch(result.stdout, new RegExp(newPassword));

      const current = await pool.query('SELECT password_hash, failed_login_attempts, locked_until FROM users WHERE id=$1', [userId]);
      assert.equal(await bcrypt.compare(newPassword, current.rows[0].password_hash), true);
      assert.equal(await bcrypt.compare(oldPassword, current.rows[0].password_hash), false);
      assert.equal(current.rows[0].failed_login_attempts, 0);
      assert.equal(current.rows[0].locked_until, null);
      assert.equal((await pool.query('SELECT count(*)::int count FROM sessions WHERE user_id=$1', [userId])).rows[0].count, 0);
      assert.equal((await pool.query("SELECT count(*)::int count FROM audit_log WHERE user_id=$1 AND action='administrator_password_reset'", [userId])).rows[0].count, 1);
    });

    await t.test('refuses a non-administrator account without changing its password', async () => {
      const chemist = `ci_chemist_${suffix}`;
      const hash = await bcrypt.hash(oldPassword, 12);
      const inserted = await pool.query(
        "INSERT INTO users(organization_id,username,password_hash,role) VALUES($1,$2,$3,'Analyst/Chemist') RETURNING id",
        [organizationId, chemist, hash]
      );
      const result = await runNode('src/reset-admin-password.js', {
        DATABASE_URL: databaseUrl,
        RESET_ADMIN_USERNAME: chemist,
        RECOVERY_NEW_PASSWORD: newPassword,
        CONFIRM_ADMIN_PASSWORD_RESET: 'RESET'
      });
      assert.notEqual(result.code, 0);
      assert.match(result.stderr, /not an Administrator/);
      const row = await pool.query('SELECT password_hash FROM users WHERE id=$1', [inserted.rows[0].id]);
      assert.equal(await bcrypt.compare(oldPassword, row.rows[0].password_hash), true);
    });
  } finally {
    if (organizationId) await pool.query('DELETE FROM organizations WHERE id=$1', [organizationId]);
    await pool.end();
  }
});
