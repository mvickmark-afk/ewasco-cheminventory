import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { buildBackup, validateBackup } from '../src/backup.js';

const fixture = {
  organizationId: 'org-1',
  records: [{ id: 'chem-1', entity: 'chemicals', name: 'Test' }],
  inventoryBatches: [{ id: 'batch-1', chemical_id: 'chem-1', lot_number: 'LOT-1' }],
  inventoryTransactions: [{ id: 'tx-1', chemical_id: 'chem-1', batch_id: 'batch-1', transaction_type: 'RECEIVE' }]
};

test('versioned backup manifest validates an intact export', () => {
  const backup = buildBackup(fixture);
  assert.equal(backup.format, 'laboratory-inventory-backup');
  assert.equal(backup.version, 1);
  assert.equal(backup.manifest.algorithm, 'sha256');
  assert.deepEqual(validateBackup(backup).counts, backup.counts);
});

test('backup validation rejects tampering', () => {
  const backup = buildBackup(fixture);
  backup.state.inventory_batches[0].lot_number = 'TAMPERED';
  assert.throws(() => validateBackup(backup), /checksum/);
});

test('backup validation rejects broken relationships', () => {
  const backup = buildBackup(fixture);
  backup.state.inventory_batches[0].chemical_id = 'missing';
  backup.manifest.checksum = crypto.createHash('sha256').update(JSON.stringify(backup.state)).digest('hex');
  assert.throws(() => validateBackup(backup), /missing chemical/);
});
