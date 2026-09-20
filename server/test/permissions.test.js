import assert from 'node:assert/strict';
import test from 'node:test';
import { can, feature, validate } from '../src/permissions.js';

test('least privilege and feature permissions', () => {
  assert.equal(can('Storekeeper', 'delete', 'chemicals'), false);
  assert.equal(feature('Administrator', 'backup'), true);
  assert.equal(feature('Storekeeper', 'backup'), false);
});

test('chemical inventory validation', () => {
  assert.throws(() => validate('chemicals', { id: 'x', name: '', quantity: -1 }));
  assert.throws(() => validate('chemicals', { id: 'x', name: 'Acetone', cas: 'bad' }));
  assert.throws(() => validate('chemicals', { id: 'x', name: 'Acetone', unit: 'barrels' }));
  const chemical = validate('chemicals', {
    id: 'CHEM-001', name: 'Acetone', cas: '67-64-1', quantity: 4,
    minimumQuantity: 2, unit: 'L', location: 'Flammable cabinet',
    supplier: 'Example Supplier', lotNumber: 'LOT-1', expiry: '2030-01-01'
  });
  assert.equal(chemical.name, 'Acetone');
  assert.equal(chemical.minimumQuantity, 2);
  assert.equal(chemical.unit, 'L');
});

test('domain validation', () => {
  assert.doesNotThrow(() => validate('water', { id: 'w1', qty: 1, plantVolume: 2, date: '2026-01-01' }));
});
