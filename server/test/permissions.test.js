const { test } = await import('node:test');
const assert = await import('node:assert/strict');
const { can, canManageUsers } = await import('../src/permissions.js');
test('roles restrict mutations', () => { assert.equal(can('Storekeeper','delete','chemicals'), false); assert.equal(can('Storekeeper','update','chemicals'), true); assert.equal(can('Analyst/Chemist','create','consumption'), true); assert.equal(can('Analyst/Chemist','create','chemicals'), false); });
test('only administrators manage users', () => { assert.equal(canManageUsers('Administrator'), true); assert.equal(canManageUsers('Laboratory Manager'), false); });
