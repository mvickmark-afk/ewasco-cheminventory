import { z } from 'zod';

export const ROLES = ['Administrator', 'Laboratory Manager', 'Analyst/Chemist', 'Storekeeper'];
export const ENTITIES = ['chemicals', 'batches', 'reagents', 'consumption', 'equipment', 'calibrations', 'suppliers', 'procurement', 'water', 'waste', 'sds', 'settings'];

const permissions = {
  Administrator: { read: ENTITIES, create: ENTITIES, update: ENTITIES, delete: ENTITIES, audit: true, backup: true, restore: true, users: true, sds: true },
  'Laboratory Manager': { read: ENTITIES, create: ENTITIES, update: ENTITIES, delete: ENTITIES.filter(x => x !== 'settings'), audit: true, backup: true, restore: false, users: false, sds: true },
  'Analyst/Chemist': { read: ['chemicals', 'batches', 'reagents', 'consumption', 'equipment', 'calibrations', 'water', 'waste', 'sds'], create: ['reagents', 'consumption', 'water', 'waste', 'sds'], update: ['reagents', 'consumption', 'water', 'waste', 'sds'], delete: [], audit: false, backup: false, restore: false, users: false, sds: true },
  Storekeeper: { read: ['chemicals', 'batches', 'suppliers', 'procurement'], create: ['batches', 'procurement'], update: ['chemicals', 'batches', 'procurement'], delete: [], audit: false, backup: false, restore: false, users: false, sds: false }
};

export const can = (role, action, entity) => Boolean(permissions[role]?.[action]?.includes(entity));
export const feature = (role, name) => Boolean(permissions[role]?.[name]);
export const idSchema = z.string().min(1).max(120).regex(/^[A-Za-z0-9._:-]+$/);
export const userSchema = z.object({ username: z.string().trim().toLowerCase().min(3).max(100).regex(/^[a-z0-9._-]+$/), password: z.string().min(12).max(200), role: z.enum(ROLES), disabled: z.boolean().optional() });

const cas = z.string().regex(/^\d{2,7}-\d{2}-\d$/);
const units = z.enum(['g', 'kg', 'mg', 'mL', 'L', 'pcs']);
// Keep this compatible with the repository's supported Zod versions.
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected an ISO date (YYYY-MM-DD)');
const optionalText = (max = 200) => z.string().trim().max(max).optional();

export function validate(entity, input) {
  const base = z.object({ id: idSchema }).passthrough().parse(input);
  if (entity === 'chemicals') return z.object({
    id: idSchema,
    name: z.string().trim().min(1).max(200),
    cas: cas.optional(),
    quantity: z.coerce.number().finite().nonnegative().default(0),
    minimumQuantity: z.coerce.number().finite().nonnegative().default(0),
    unit: units.default('pcs'),
    location: optionalText(120),
    supplier: optionalText(200),
    lotNumber: optionalText(120),
    hazardClass: optionalText(120),
    expiry: date.optional(),
    notes: optionalText(1000)
  }).passthrough().parse(base);
  if (entity === 'water') return z.object({ id: idSchema, qty: z.coerce.number().finite().nonnegative(), plantVolume: z.coerce.number().finite().positive(), date }).passthrough().parse(base);
  if (entity === 'equipment') return z.object({ id: idSchema, name: z.string().trim().min(1).max(200) }).passthrough().parse(base);
  if (entity === 'sds') return z.object({ id: idSchema, chemicalId: idSchema, revisionDate: date.optional() }).passthrough().parse(base);
  return base;
}
