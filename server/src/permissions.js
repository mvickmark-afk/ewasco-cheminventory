import { z } from 'zod';

export const ROLES=['Administrator','Laboratory Manager','Analyst/Chemist','Storekeeper'];
export const ENTITIES=['chemicals','batches','reagents','consumption','equipment','calibrations','suppliers','procurement','water','waste','sds','settings'];

const p={
  Administrator:{read:ENTITIES,create:ENTITIES,update:ENTITIES,delete:ENTITIES,audit:true,backup:true,restore:true,users:true,sds:true,
    limsRead:true,limsSampleCreate:true,limsResultEntry:true,limsReview:true,limsApprove:true,limsSetup:true},
  'Laboratory Manager':{read:ENTITIES,create:ENTITIES,update:ENTITIES,delete:ENTITIES.filter(x=>x!=='settings'),audit:true,backup:true,restore:false,users:false,sds:true,
    limsRead:true,limsSampleCreate:true,limsResultEntry:true,limsReview:true,limsApprove:true,limsSetup:true},
  'Analyst/Chemist':{read:['chemicals','batches','reagents','consumption','equipment','calibrations','water','waste','sds'],create:['reagents','consumption','water','waste','sds'],update:['reagents','consumption','water','waste','sds'],delete:[],audit:false,backup:false,restore:false,users:false,sds:true,
    limsRead:true,limsSampleCreate:true,limsResultEntry:true,limsReview:false,limsApprove:false,limsSetup:false},
  Storekeeper:{read:['chemicals','batches','suppliers','procurement'],create:['batches','procurement'],update:['chemicals','batches','procurement'],delete:[],audit:false,backup:false,restore:false,users:false,sds:false,
    limsRead:false,limsSampleCreate:false,limsResultEntry:false,limsReview:false,limsApprove:false,limsSetup:false}
};

export const can=(role,a,e)=>Boolean(p[role]?.[a]?.includes(e));
export const feature=(role,n)=>Boolean(p[role]?.[n]);
export const idSchema=z.string().min(1).max(120).regex(/^[A-Za-z0-9._:-]+$/);
export const userSchema=z.object({
  username:z.string().trim().toLowerCase().min(3).max(100).regex(/^[a-z0-9._-]+$/),
  password:z.string().min(12).max(200),
  role:z.enum(ROLES),
  disabled:z.boolean().optional()
});
const cas=z.string().regex(/^\d{2,7}-\d{2}-\d$/);
const units=z.enum(['g','kg','mg','mL','L','pcs']);
export function validate(entity,input){
  const base=z.object({id:idSchema}).passthrough().parse(input);
  if(entity==='chemicals')return z.object({id:idSchema,name:z.string().trim().min(1).max(200),quantity:z.coerce.number().finite().nonnegative().optional(),unit:units.optional(),expiry:z.string().date().optional(),cas:cas.optional()}).passthrough().parse(base);
  if(entity==='water')return z.object({id:idSchema,qty:z.coerce.number().finite().nonnegative(),plantVolume:z.coerce.number().finite().positive(),date:z.string().date()}).passthrough().parse(base);
  if(entity==='equipment')return z.object({id:idSchema,name:z.string().trim().min(1).max(200)}).passthrough().parse(base);
  if(entity==='sds')return z.object({id:idSchema,chemicalId:idSchema.optional(),revisionDate:z.string().date().optional()}).passthrough().parse(base);
  return base;
}

export const passwordSchema=z.string().min(12).max(200).refine(v=>/[A-Z]/.test(v),'Password must contain an uppercase letter').refine(v=>/[a-z]/.test(v),'Password must contain a lowercase letter').refine(v=>/\d/.test(v),'Password must contain a number');
