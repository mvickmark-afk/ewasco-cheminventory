import { z } from 'zod';

export const ROLES = ['Administrator', 'Laboratory Manager', 'Analyst/Chemist', 'Storekeeper'];
export const ENTITIES = ['chemicals','batches','reagents','consumption','equipment','calibrations','suppliers','procurement','water','waste','sds','settings'];

const permissions = {
  Administrator: { read: ENTITIES, create: ENTITIES, update: ENTITIES, delete: ENTITIES },
  'Laboratory Manager': { read: ENTITIES, create: ENTITIES, update: ENTITIES, delete: ['chemicals','batches','reagents','consumption','equipment','calibrations','suppliers','procurement','water','waste','sds'] },
  'Analyst/Chemist': { read: ['chemicals','batches','reagents','consumption','equipment','calibrations','water','waste','sds'], create: ['reagents','consumption','water','waste','sds'], update: ['reagents','consumption','water','waste','sds'], delete: [] },
  Storekeeper: { read: ['chemicals','batches','suppliers','procurement'], create: ['batches','procurement'], update: ['chemicals','batches','procurement'], delete: [] }
};

export function can(role, action, entity) { return Boolean(permissions[role]?.[action]?.includes(entity)); }
export function canManageUsers(role) { return role === 'Administrator'; }
export const idSchema = z.string().min(1).max(120).regex(/^[A-Za-z0-9._:-]+$/);
export const recordSchema = z.object({ id: idSchema }).passthrough();
export const userCreateSchema = z.object({ username: z.string().trim().toLowerCase().min(3).max(100).regex(/^[a-z0-9._-]+$/), password: z.string().min(12).max(200), role: z.enum(ROLES), disabled: z.boolean().optional() });
