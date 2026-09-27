import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import express from 'express';
import pg from 'pg';
import { registerInventoryRoutes } from '../src/inventory.js';

const databaseUrl = process.env.DATABASE_URL;
const shouldRun = Boolean(databaseUrl);
const pool = databaseUrl ? new pg.Pool({ connectionString: databaseUrl, max: 10 }) : null;
const organisationId = crypto.randomUUID();
const userId = crypto.randomUUID();
const otherOrganisationId = crypto.randomUUID();
const otherUserId = crypto.randomUUID();
const chemicalId = `IT-${crypto.randomUUID().slice(0, 8)}`;
const concurrentChemicalId = `IT-CONC-${crypto.randomUUID().slice(0, 8)}`;

let server;
let baseUrl;

async function audit(client, user, action, entity, recordId, data) {
  await client.query(
    'INSERT INTO audit_log(organization_id,user_id,action,entity,record_id,data) VALUES($1,$2,$3,$4,$5,$6)',
    [user.organization_id, user.id, action, entity, recordId || null, data || null]
  );
}

function buildApp(user) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = user;
    next();
  });
  registerInventoryRoutes({ app, pool, auth: (_req, _res, next) => next(), audit });
  return app;
}

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) }
  });
  const text = await response.text();
  return { response, body: text ? JSON.parse(text) : null };
}

async function insertChemical(orgId) {
  await pool.query(
    'INSERT INTO records(id,organization_id,entity,data) VALUES($1,$2,$3,$4)',
    [chemicalId, orgId, 'chemicals', JSON.stringify({ id: chemicalId, name: 'Integration Test Chemical', unit: 'L' })]
  );
}

before(async () => {
  if (!shouldRun) return;
  const schema = await fs.readFile(new URL('../sql/schema.sql', import.meta.url), 'utf8');
  await pool.query(schema);

  await pool.query(
    'INSERT INTO organizations(id,name) VALUES($1,$2),($3,$4)',
    [organisationId, `integration-${organisationId}`, otherOrganisationId, `integration-other-${otherOrganisationId}`]
  );
  await pool.query(
    'INSERT INTO users(id,organization_id,username,password_hash,role) VALUES($1,$2,$3,$4,$5),($6,$7,$8,$9,$10)',
    [
      userId, organisationId, `integration-${userId}`, 'not-used', 'Administrator',
      otherUserId, otherOrganisationId, `integration-${otherUserId}`, 'not-used', 'Administrator'
    ]
  );
  await insertChemical(organisationId);
  await pool.query(
    'INSERT INTO records(id,organization_id,entity,data) VALUES($1,$2,$3,$4)',
    [concurrentChemicalId, organisationId, 'chemicals', JSON.stringify({ id: concurrentChemicalId, name: 'Concurrent Test Chemical', unit: 'L' })]
  );

  const app = buildApp({ id: userId, organization_id: organisationId, username: 'integration', role: 'Administrator' });
  await new Promise(resolve => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (!shouldRun) return;
  await new Promise(resolve => server.close(resolve));
  await pool.query('DELETE FROM organizations WHERE id IN ($1,$2)', [organisationId, otherOrganisationId]);
  await pool.end();
});

test('PostgreSQL integration foundation: receive and stock are ledger-backed', { skip: !shouldRun }, async () => {
  const received = await request('/api/inventory/receive', {
    method: 'POST',
    body: JSON.stringify({
      chemicalId, lotNumber: 'IT-LOT-001', quantity: 10, unit: 'L', location: 'Integration Cabinet'
    })
  });
  assert.equal(received.response.status, 201);

  const stock = await request(`/api/inventory/stock/${chemicalId}`);
  assert.equal(stock.response.status, 200);
  assert.equal(stock.body.length, 1);
  assert.equal(stock.body[0].availableQuantity, 10);
});

test('duplicate lot is rejected and does not create another batch', { skip: !shouldRun }, async () => {
  const duplicate = await request('/api/inventory/receive', {
    method: 'POST',
    body: JSON.stringify({ chemicalId, lotNumber: 'IT-LOT-001', quantity: 5, unit: 'L' })
  });
  assert.equal(duplicate.response.status, 409);
});

test('FIFO issue spans batches and preserves ledger balance', { skip: !shouldRun }, async () => {
  const received = await request('/api/inventory/receive', {
    method: 'POST',
    body: JSON.stringify({ chemicalId, lotNumber: 'IT-LOT-002', quantity: 4, unit: 'L' })
  });
  assert.equal(received.response.status, 201);

  const issued = await request('/api/inventory/issue', {
    method: 'POST',
    body: JSON.stringify({ chemicalId, quantity: 12, unit: 'L', reason: 'Integration issue' })
  });
  assert.equal(issued.response.status, 201);
  assert.equal(issued.body.allocations.length, 2);
  assert.equal(issued.body.allocations[0].quantity, 10);
  assert.equal(issued.body.allocations[1].quantity, 2);

  const stock = await request(`/api/inventory/stock/${chemicalId}`);
  assert.deepEqual(stock.body.map(x => x.availableQuantity), [0, 2]);
});

test('insufficient issue rolls back all allocations', { skip: !shouldRun }, async () => {
  const before = await request(`/api/inventory/stock/${chemicalId}`);
  const issue = await request('/api/inventory/issue', {
    method: 'POST',
    body: JSON.stringify({ chemicalId, quantity: 100, unit: 'L' })
  });
  assert.equal(issue.response.status, 409);

  const afterStock = await request(`/api/inventory/stock/${chemicalId}`);
  assert.deepEqual(afterStock.body, before.body);
});

test('organisation isolation prevents cross-tenant chemical access', { skip: !shouldRun }, async () => {
  const otherChemicalId = `OTHER-${crypto.randomUUID().slice(0, 8)}`;
  await pool.query(
    'INSERT INTO records(id,organization_id,entity,data) VALUES($1,$2,$3,$4)',
    [otherChemicalId, otherOrganisationId, 'chemicals', JSON.stringify({ id: otherChemicalId, name: 'Other Organisation Chemical', unit: 'L' })]
  );

  const result = await request('/api/inventory/receive', {
    method: 'POST',
    body: JSON.stringify({ chemicalId: otherChemicalId, lotNumber: 'OTHER-LOT', quantity: 1, unit: 'L' })
  });
  assert.equal(result.response.status, 404);

  await pool.query('DELETE FROM records WHERE organization_id=$1 AND id=$2', [otherOrganisationId, otherChemicalId]);
});

test('concurrent issues cannot oversell a batch', { skip: !shouldRun }, async () => {
  const received = await request('/api/inventory/receive', {
    method: 'POST',
    body: JSON.stringify({ chemicalId: concurrentChemicalId, lotNumber: 'IT-LOT-CONCURRENT', quantity: 10, unit: 'L' })
  });
  assert.equal(received.response.status, 201);

  const [a, b] = await Promise.all([
    request('/api/inventory/issue', {
      method: 'POST',
      body: JSON.stringify({ chemicalId: concurrentChemicalId, quantity: 7, unit: 'L', reason: 'Concurrent A' })
    }),
    request('/api/inventory/issue', {
      method: 'POST',
      body: JSON.stringify({ chemicalId: concurrentChemicalId, quantity: 7, unit: 'L', reason: 'Concurrent B' })
    })
  ]);

  assert.deepEqual([a.response.status, b.response.status].sort(), [201, 409]);

  const stock = await request(`/api/inventory/stock/${concurrentChemicalId}`);
  const concurrentBatch = stock.body.find(x => x.lotNumber === 'IT-LOT-CONCURRENT');
  assert.equal(concurrentBatch.availableQuantity, 3);
});
