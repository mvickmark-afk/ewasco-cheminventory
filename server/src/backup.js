import crypto from 'node:crypto';

export const BACKUP_VERSION = 1;
const checksum = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function buildBackup({ organizationId, records, inventoryBatches, inventoryTransactions }) {
  const state = { records, inventory_batches: inventoryBatches, inventory_transactions: inventoryTransactions };
  const counts = Object.fromEntries(Object.entries(state).map(([k, v]) => [k, v.length]));
  return {
    app: 'laboratory-inventory',
    format: 'laboratory-inventory-backup',
    version: BACKUP_VERSION,
    exported: new Date().toISOString(),
    organizationId,
    counts,
    state,
    manifest: { algorithm: 'sha256', checksum: checksum(state) }
  };
}

export function validateBackup(input) {
  if (!input || input.app !== 'laboratory-inventory' || input.format !== 'laboratory-inventory-backup' || input.version !== BACKUP_VERSION) throw new Error('Unsupported backup format or version');
  if (!input.organizationId || !input.state || !input.manifest || input.manifest.algorithm !== 'sha256') throw new Error('Invalid backup manifest');
  for (const key of ['records', 'inventory_batches', 'inventory_transactions']) {
    if (!Array.isArray(input.state[key])) throw new Error(`Invalid backup state: ${key}`);
    if (input.counts?.[key] !== input.state[key].length) throw new Error(`Backup count mismatch: ${key}`);
  }
  if (input.manifest.checksum !== checksum(input.state)) throw new Error('Backup checksum mismatch');
  const batchIds = new Set(input.state.inventory_batches.map(b => b.id));
  const chemicalIds = new Set(input.state.records.filter(r => r.entity === 'chemicals').map(r => r.id));
  for (const b of input.state.inventory_batches) if (!chemicalIds.has(b.chemical_id)) throw new Error(`Batch references missing chemical: ${b.chemical_id}`);
  for (const t of input.state.inventory_transactions) {
    if (t.batch_id && !batchIds.has(t.batch_id)) throw new Error(`Transaction references missing batch: ${t.batch_id}`);
    if (!chemicalIds.has(t.chemical_id)) throw new Error(`Transaction references missing chemical: ${t.chemical_id}`);
  }
  return { valid: true, counts: input.counts, version: input.version };
}
