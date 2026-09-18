import { z } from 'zod';
export const ROLES=['Administrator','Laboratory Manager','Analyst/Chemist','Storekeeper'];
export const ENTITIES=['chemicals','batches','reagents','consumption','equipment','calibrations','suppliers','procurement','water','waste','sds','settings'];
const perms={
 Administrator:{read:ENTITIES,create:ENTITIES,update:ENTITIES,delete:ENTITIES,audit:true,backup:true,restore:true,users:true,sds:true},
 'Laboratory Manager':{read:ENTITIES,create:ENTITIES,update:ENTITIES,delete:ENTITIES.filter(x=>x!=='settings'),audit:true,backup:true,restore:false,users:false,sds:true},
 'Analyst/Chemist':{read:['chemicals','batches','reagents','consumption','equipment','calibrations','water','waste','sds'],create:['reagents','consumption','water','waste','sds'],update:['reagents','consumption','water','waste','sds'],delete:[],audit:false,backup:false,restore:false,users:false,sds:true},
 Storekeeper:{read:['chemicals','batches','suppliers','procurement'],create:['batches','procurement'],update:['chemicals','batches','procurement'],delete:[],audit:false,backup:false,restore:false,users:false,sds:false}
};
export const can=(role,action,entity)=>Boolean(perms[role]?.[action]?.includes(entity));
export const feature=(role,name)=>Boolean(perms[role]?.[name]);
export const idSchema=z.string().min(1).max(120).regex(/^[A-Za-z0-9._:-]+$/);
export const userSchema=z.object({username:z.string().trim().toLowerCase().min(3).max(100).regex(/^[a-z0-9._-]+$/),password:z.string().min(12).max(200),role:z.enum(ROLES),disabled:z.boolean().optional()});
const cas=z.string().regex(/^\d{2,7}-\d{2}-\d$/);
export function validate(entity,input){const base=z.object({id:idSchema}).passthrough().parse(input);if(entity!=='chemicals')return base;return z.object({id:idSchema,name:z.string().trim().min(1).max(200),quantity:z.coerce.number().finite().nonnegative().optional(),unit:z.enum(['g','kg','mg','mL','L','pcs']).optional(),expiry:z.string().date().optional(),cas:cas.optional()}).passthrough().parse(base);}
