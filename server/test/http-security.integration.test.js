import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import pg from 'pg';
import { spawn } from 'node:child_process';

const databaseUrl = process.env.DATABASE_URL;
const shouldRun = Boolean(databaseUrl);
const pool = databaseUrl ? new pg.Pool({ connectionString: databaseUrl }) : null;

function cookieValue(setCookies, name) {
  const line = setCookies.find(x => x.startsWith(`${name}=`));
  return line ? line.split(';', 1)[0].slice(name.length + 1) : null;
}

function mergeCookies(existing, setCookies) {
  const map = new Map();
  for (const cookie of existing.split(';').map(x => x.trim()).filter(Boolean)) {
    const [name, value] = cookie.split('=', 2);
    if (name && value !== undefined) map.set(name, value);
  }
  for (const line of setCookies) {
    const first = line.split(';', 1)[0];
    const [name, value] = first.split('=', 2);
    if (name && value !== undefined) map.set(name, value);
  }
  return [...map].map(([name, value]) => `${name}=${value}`).join('; ');
}

async function startServer() {
  const port = 34000 + Math.floor(Math.random() * 1000);
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, PORT: String(port), NODE_ENV: 'test', CORS_ORIGIN: `http://127.0.0.1:${port}` },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let output = '';
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Server did not start. Output: ${output}`)), 10000);
    child.stdout.on('data', chunk => {
      output += chunk.toString();
      if (output.includes('"event":"started"')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.stderr.on('data', chunk => { output += chunk.toString(); });
    child.once('exit', code => {
      clearTimeout(timer);
      if (code !== null && !output.includes('"event":"started"')) reject(new Error(`Server exited with ${code}. Output: ${output}`));
    });
  });
  await ready;
  return { child, baseUrl: `http://127.0.0.1:${port}` };
}

test('HTTP authentication and CSRF protection work through the real server', { skip: !shouldRun }, async t => {
  const organizationId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const chemicalId = `HTTP-${crypto.randomUUID().slice(0, 8)}`;
  const username = `http-${crypto.randomUUID().slice(0, 8)}`;
  const password = 'Integration-Test-Password-2026!';
  const passwordHash = await bcrypt.hash(password, 4);
  let server;

  await pool.query('INSERT INTO organizations(id,name) VALUES($1,$2)', [organizationId, `HTTP Test Organisation ${organizationId.slice(0, 8)}`]);
  await pool.query(
    'INSERT INTO users(id,organization_id,username,password_hash,role) VALUES($1,$2,$3,$4,$5)',
    [userId, organizationId, username, passwordHash, 'Administrator']
  );

  try {
    server = await startServer();

    let cookies = '';
    const loginResponse = await fetch(`${server.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    assert.equal(loginResponse.status, 200);
    const loginSetCookies = loginResponse.headers.getSetCookie();
    cookies = mergeCookies(cookies, loginSetCookies);
    const csrfToken = cookieValue(loginSetCookies, 'ewasco_csrf');
    assert.ok(csrfToken);
    const loginBody = await loginResponse.json();
    assert.equal(loginBody.user.organizationName, `HTTP Test Organisation ${organizationId.slice(0, 8)}`);

    const me = await fetch(`${server.baseUrl}/api/auth/me`, { headers: { cookie: cookies } });
    assert.equal(me.status, 200);
    assert.equal((await me.json()).user.organizationName, `HTTP Test Organisation ${organizationId.slice(0, 8)}`);

    const noCsrf = await fetch(`${server.baseUrl}/api/records/chemicals`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: cookies },
      body: JSON.stringify({ id: chemicalId, name: 'HTTP Security Test Chemical', unit: 'L' })
    });
    assert.equal(noCsrf.status, 403);

    const withCsrf = await fetch(`${server.baseUrl}/api/records/chemicals`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: cookies, 'X-CSRF-Token': csrfToken },
      body: JSON.stringify({ id: chemicalId, name: 'HTTP Security Test Chemical', unit: 'L' })
    });
    assert.equal(withCsrf.status, 201);

    const backup = await fetch(`${server.baseUrl}/api/backup`, { headers: { cookie: cookies } });
    assert.equal(backup.status, 200);
    const backupBody = await backup.json();
    assert.equal(backupBody.app, 'laboratory-inventory');
    assert.ok(Array.isArray(backupBody.state.chemicals));
    assert.ok(backupBody.state.chemicals.some(x => x.id === chemicalId));
    assert.ok(Array.isArray(backupBody.state.inventory_batches));
    assert.ok(Array.isArray(backupBody.state.inventory_transactions));

    // Recovery verification: restore the exported domain state into a fresh
    // organisation and verify that records, batches and the transaction ledger
    // survive the round trip without changing quantities or relationships.
    const recoveryOrganizationId = crypto.randomUUID();
    const recoveryUserId = crypto.randomUUID();
    try {
      await pool.query('BEGIN');
      await pool.query('INSERT INTO organizations(id,name) VALUES($1,$2)', [recoveryOrganizationId, \`Recovery Test Organisation \${recoveryOrganizationId.slice(0, 8)}\`]);
      await pool.query(
        'INSERT INTO users(id,organization_id,username,password_hash,role) VALUES($1,$2,$3,$4,$5)',
        [recoveryUserId, recoveryOrganizationId, \`recovery-\${recoveryOrganizationId.slice(0, 8)}\`, passwordHash, 'Administrator']
      );

      for (const record of backupBody.state.chemicals) {
        await pool.query(
          'INSERT INTO records(id,organization_id,entity,data,version,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
          [record.id, recoveryOrganizationId, 'chemicals', record, 1, new Date(), new Date()]
        );
      }

      for (const batch of backupBody.state.inventory_batches) {
        await pool.query(
          \`INSERT INTO inventory_batches(id,organization_id,chemical_id,lot_number,received_at,expiry_date,unit,received_quantity,location,max_quantity,metadata,created_by,created_at)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)\`,
          [batch.id, recoveryOrganizationId, batch.chemical_id, batch.lot_number, batch.received_at, batch.expiry_date, batch.unit, batch.received_quantity, batch.location, batch.max_quantity, batch.metadata ?? {}, recoveryUserId, batch.created_at]
        );
      }

      for (const tx of backupBody.state.inventory_transactions) {
        await pool.query(
          \`INSERT INTO inventory_transactions(id,organization_id,transaction_type,chemical_id,batch_id,quantity,unit,reference,reason,actor_id,created_at,metadata)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)\`,
          [tx.id, recoveryOrganizationId, tx.transaction_type, tx.chemical_id, tx.batch_id, tx.quantity, tx.unit, tx.reference, tx.reason, recoveryUserId, tx.created_at, tx.metadata ?? {}]
        );
      }

      const restoredRecords = await pool.query('SELECT id,data FROM records WHERE organization_id=$1 AND entity=\\'chemicals\\' ORDER BY id', [recoveryOrganizationId]);
      const restoredBatches = await pool.query('SELECT id,chemical_id,lot_number,received_quantity,unit FROM inventory_batches WHERE organization_id=$1 ORDER BY id', [recoveryOrganizationId]);
      const restoredTransactions = await pool.query('SELECT id,transaction_type,chemical_id,batch_id,quantity,unit FROM inventory_transactions WHERE organization_id=$1 ORDER BY id', [recoveryOrganizationId]);

      assert.equal(restoredRecords.rowCount, backupBody.state.chemicals.length);
      assert.equal(restoredBatches.rowCount, backupBody.state.inventory_batches.length);
      assert.equal(restoredTransactions.rowCount, backupBody.state.inventory_transactions.length);
      assert.deepEqual(restoredBatches.rows.map(x => ({...x, received_quantity: String(x.received_quantity)})), backupBody.state.inventory_batches.map(x => ({id:x.id,chemical_id:x.chemical_id,lot_number:x.lot_number,received_quantity:String(x.received_quantity),unit:x.unit})).sort((a,b)=>a.id.localeCompare(b.id)));
      assert.deepEqual(restoredTransactions.rows.map(x => ({...x, quantity: String(x.quantity)})), backupBody.state.inventory_transactions.map(x => ({id:x.id,transaction_type:x.transaction_type,chemical_id:x.chemical_id,batch_id:x.batch_id,quantity:String(x.quantity),unit:x.unit})).sort((a,b)=>a.id.localeCompare(b.id)));
      await pool.query('ROLLBACK');
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
  } finally {
    server?.child.kill('SIGTERM');
    await new Promise(resolve => setTimeout(resolve, 150));
    await pool.query('DELETE FROM organizations WHERE id=$1', [organizationId]);
  }
});

test.after(async () => { if (pool) await pool.end(); });
