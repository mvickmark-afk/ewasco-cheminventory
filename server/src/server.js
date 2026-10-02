import 'dotenv/config';import crypto from 'node:crypto';import fs from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';import express from 'express';import bcrypt from 'bcryptjs';import cookieParser from 'cookie-parser';import cors from 'cors';import helmet from 'helmet';import jwt from 'jsonwebtoken';import rateLimit from 'express-rate-limit';import multer from 'multer';import pg from 'pg';import {z} from 'zod';
import {ENTITIES,ROLES,can,feature,validate,passwordSchema,userSchema} from './permissions.js';
import {registerLimsRoutes} from './lims.js';import {registerLimsPhaseRoutes} from './lims-phases.js';
import {registerSdsRoutes} from './sds.js';
const required=n=>{if(!process.env[n])throw Error(`${n} is required`);return process.env[n]};const db=required('DATABASE_URL'),secret=required('JWT_SECRET');const prod=process.env.NODE_ENV==='production';if(secret.length<32||/change|replace|generate/i.test(secret))throw Error('JWT_SECRET is unsafe');if(!process.env.CORS_ORIGIN||process.env.CORS_ORIGIN==='*')throw Error('CORS_ORIGIN must be explicit');if(prod&&process.env.COOKIE_SECURE!=='true')throw Error('COOKIE_SECURE=true required');
const pool=new pg.Pool({connectionString:db,max:+(process.env.DB_POOL_MAX||10),idleTimeoutMillis:30000});const app=express();app.set('trust proxy',1);const port=+(process.env.PORT||3000),cookie='ewasco_session',csrfCookie='ewasco_csrf',dir=path.resolve(process.env.UPLOAD_DIR||'./uploads');await fs.mkdir(dir,{recursive:true});
const upload=multer({storage:multer.diskStorage({destination:dir,filename:(_r,f,cb)=>cb(null,`${crypto.randomUUID()}-${path.basename(f.originalname).replace(/[^A-Za-z0-9._-]/g,'_')}`)}),limits:{fileSize:10*1024*1024}});app.disable('x-powered-by');
app.use(helmet({
  referrerPolicy:{policy:'no-referrer'},
  crossOriginEmbedderPolicy:false,
  contentSecurityPolicy:{
    directives:{
      defaultSrc:["'self'"],
      scriptSrc:["'self'"],
      connectSrc:["'self'"],
      styleSrc:["'self'","'unsafe-inline'"],
      imgSrc:["'self'","data:"],
      fontSrc:["'self'"],
      objectSrc:["'none'"],
      upgradeInsecureRequests:[]
    }
  }
}));
app.use(cors({origin:process.env.CORS_ORIGIN,credentials:true,methods:['GET','HEAD','POST','PUT','PATCH','DELETE'],allowedHeaders:['Content-Type','X-CSRF-Token','If-Match']}));
app.use(express.json({limit:'1mb',strict:true}));app.use(cookieParser());
app.use('/api',rateLimit({windowMs:60000,limit:300,standardHeaders:true,legacyHeaders:false}));
app.use('/api/auth/login',rateLimit({windowMs:900000,limit:10,standardHeaders:true,legacyHeaders:false}));
app.use('/api',(req,res,next)=>{res.set('Cache-Control','no-store');next()});
const hash=x=>crypto.createHash('sha256').update(x).digest('hex'),token=()=>crypto.randomBytes(32).toString('hex'),sign=u=>jwt.sign({sub:u.id,jti:crypto.randomUUID()},secret,{issuer:'ewasco',audience:'ewasco-web',expiresIn:'8h'});const setCsrf=res=>{const t=token();res.cookie(csrfCookie,t,{sameSite:'strict',secure:process.env.COOKIE_SECURE==='true',maxAge:28800000});return t};
function csrf(req,res,next){if(!['POST','PUT','PATCH','DELETE'].includes(req.method)||req.path==='/auth/login')return next();const expected=req.cookies[csrfCookie],provided=req.get('X-CSRF-Token'),reject=()=>res.status(403).json({error:'CSRF validation failed'});if(typeof expected!=='string'||expected===''||typeof provided!=='string'||provided==='')return reject();const a=Buffer.from(expected),b=Buffer.from(provided);if(a.length!==b.length||!crypto.timingSafeEqual(a,b))return reject();next()};async function auth(req,res,next){try{const t=req.cookies[cookie],c=jwt.verify(t,secret,{issuer:'ewasco',audience:'ewasco-web'}),q=await pool.query('SELECT u.id,u.organization_id,u.username,u.role FROM users u JOIN sessions s ON s.user_id=u.id WHERE u.id=$1 AND u.disabled=false AND s.token_hash=$2 AND s.expires_at>now()',[c.sub,hash(t)]);if(!q.rowCount)throw Error();req.user=q.rows[0];next()}catch{res.status(401).json({error:'Invalid or expired session'})}};
const ent=(req,res,next)=>ENTITIES.includes(req.params.entity)?next():res.status(404).json({error:'Unknown entity'}),perm=a=>(req,res,next)=>can(req.user.role,a,req.params.entity)?next():res.status(403).json({error:'Forbidden'}),feat=n=>(req,res,next)=>feature(req.user.role,n)?next():res.status(403).json({error:'Forbidden'});async function audit(c,u,a,e,id,d){await c.query('INSERT INTO audit_log(organization_id,user_id,action,entity,record_id,data) VALUES($1,$2,$3,$4,$5,$6)',[u.organization_id,u.id,a,e,id||null,d||null])};const out=r=>({...r.data,id:r.id,_version:r.version,_updatedAt:r.updated_at});
const allowedDocumentTypes={
  '.pdf':{mime:'application/pdf'},
  '.docx':{mime:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'},
  '.xlsx':{mime:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}
};
async function inspect(file){
  const b=await fs.readFile(file.path);
  const ext=path.extname(file.originalname).toLowerCase();
  let type=allowedDocumentTypes[ext];
  if(!type){
    const mime=String(file.mimetype||'').toLowerCase();
    const mimeExt={'application/pdf':'.pdf','application/x-pdf':'.pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document':'.docx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'.xlsx'}[mime];
    if(mimeExt)type=allowedDocumentTypes[mimeExt];
  }
  if(!type){await fs.unlink(file.path).catch(()=>{});throw Object.assign(new Error('Only Word (.docx), PDF (.pdf), and Excel (.xlsx) SDS documents are accepted'),{statusCode:415})}
  const isPdf=b.subarray(0,5).toString()==='%PDF-';
  const isZip=b[0]===0x50&&b[1]===0x4b;
  if((type.mime==='application/pdf'&&!isPdf)||(type.mime!=='application/pdf'&&!isZip)){
    await fs.unlink(file.path).catch(()=>{});
    throw Object.assign(new Error('The uploaded file content does not match the selected SDS document type'),{statusCode:415});
  }
  if(file.mimetype&&file.mimetype!=='application/octet-stream'&&file.mimetype!==type.mime){
    const browserMimeAllowed=ext==='.pdf'&&file.mimetype==='application/x-pdf'||ext==='.docx'&&file.mimetype==='application/zip'||ext==='.xlsx'&&file.mimetype==='application/zip';
    if(!browserMimeAllowed)file.mimetype=type.mime;
  }
  return{mime:type.mime,sha256:crypto.createHash('sha256').update(b).digest('hex')};
}
app.use('/api',csrf);app.get('/healthz',(_q,r)=>r.json({status:'ok'}));app.get('/readyz',async(_q,r)=>{try{await pool.query('SELECT 1');r.json({status:'ready'})}catch{r.status(503).json({status:'not-ready'})}});app.get('/api/auth/csrf',(_q,r)=>r.json({token:setCsrf(r)}));
app.post('/api/auth/login',async(req,res,next)=>{try{
 const i=z.object({username:z.string().trim().toLowerCase().min(1).max(100),password:z.string().min(1).max(200)}).parse(req.body);
 const q=await pool.query('SELECT * FROM users WHERE username=$1 LIMIT 1',[i.username]);const u=q.rows[0];
 const locked=u?.locked_until&&new Date(u.locked_until)>new Date();
 if(!u||u.disabled||locked){if(u)await pool.query('INSERT INTO audit_log(organization_id,user_id,action,entity,record_id,data) VALUES($1,$2,$3,$4,$5,$6)',[u.organization_id,u.id,'login_denied','auth',u.id,{reason:u.disabled?'disabled':locked?'locked':'invalid_credentials'}]);return res.status(401).json({error:'Invalid username or password'})}
 const ok=await bcrypt.compare(i.password,u.password_hash);
 if(!ok){const attempts=Math.min((u.failed_login_attempts||0)+1,20),lockedUntil=attempts>=5?new Date(Date.now()+15*60*1000):null;
   await pool.query('UPDATE users SET failed_login_attempts=$1,locked_until=$2 WHERE id=$3',[attempts,lockedUntil,u.id]);
   await pool.query('INSERT INTO audit_log(organization_id,user_id,action,entity,record_id,data) VALUES($1,$2,$3,$4,$5,$6)',[u.organization_id,u.id,'login_denied','auth',u.id,{reason:'invalid_credentials',attempts,locked:attempts>=5}]);
   return res.status(401).json({error:'Invalid username or password'});
 }
 const t=sign(u);await pool.query("INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '8 hours')",[u.id,hash(t)]);
 await pool.query('UPDATE users SET failed_login_attempts=0,locked_until=NULL,last_login_at=now() WHERE id=$1',[u.id]);
 res.cookie(cookie,t,{httpOnly:true,sameSite:'strict',secure:process.env.COOKIE_SECURE==='true',maxAge:28800000,path:'/'});setCsrf(res);
 await pool.query('INSERT INTO audit_log(organization_id,user_id,action,entity,record_id,data) VALUES($1,$2,$3,$4,$5,$6)',[u.organization_id,u.id,'login_success','auth',u.id,{role:u.role}]);
 res.json({user:{name:u.username,role:u.role}});
}catch(e){next(e)}});app.post('/api/auth/logout',auth,async(req,res)=>{await pool.query('DELETE FROM sessions WHERE token_hash=$1',[hash(req.cookies[cookie])]);res.clearCookie(cookie);res.clearCookie(csrfCookie);res.status(204).end()});app.get('/api/auth/me',auth,(req,res)=>res.json({user:{name:req.user.username,role:req.user.role}}));
app.get('/api/users',auth,(req,res,next)=>{if(!feature(req.user.role,'users'))return res.status(403).json({error:'Forbidden'});pool.query("SELECT id,username,role,disabled,failed_login_attempts,locked_until,password_changed_at,last_login_at,created_at FROM users WHERE organization_id=$1 ORDER BY username",[req.user.organization_id]).then(q=>res.json(q.rows)).catch(next)});
app.post('/api/users',auth,async(req,res,next)=>{if(!feature(req.user.role,'users'))return res.status(403).json({error:'Forbidden'});const c=await pool.connect();let committed=false,inTransaction=false;try{
 const d=userSchema.parse(req.body);await c.query('BEGIN');inTransaction=true;
 const exists=await c.query("SELECT 1 FROM users WHERE organization_id=$1 AND username=$2 FOR SHARE",[req.user.organization_id,d.username]);if(exists.rowCount)return res.status(409).json({error:'Username already exists'});
 const ph=await bcrypt.hash(d.password,12),q=await c.query("INSERT INTO users(organization_id,username,password_hash,role,disabled,password_changed_at) VALUES($1,$2,$3,$4,$5,now()) RETURNING id,username,role,disabled,created_at",[req.user.organization_id,d.username,ph,d.role,d.disabled??false]);
 await audit(c,req.user,'user_create','users',q.rows[0].id,{username:d.username,role:d.role,disabled:d.disabled??false});await c.query('COMMIT');inTransaction=false;committed=true;res.status(201).json(q.rows[0]);
}catch(e){if(inTransaction)await c.query('ROLLBACK').catch(()=>{});next(e)}finally{if(inTransaction)await c.query('ROLLBACK').catch(()=>{});c.release()}});
app.patch('/api/users/:id',auth,async(req,res,next)=>{if(!feature(req.user.role,'users'))return res.status(403).json({error:'Forbidden'});const c=await pool.connect();let committed=false,inTransaction=false;try{
 const d=z.object({role:z.enum(ROLES).optional(),disabled:z.boolean().optional(),password:passwordSchema.optional()}).parse(req.body);await c.query('BEGIN');inTransaction=true;
 if(req.params.id===req.user.id&&d.disabled===true)return res.status(409).json({error:'You cannot disable your own account'});
 const q0=await c.query("SELECT * FROM users WHERE organization_id=$1 AND id=$2 FOR UPDATE",[req.user.organization_id,req.params.id]);if(!q0.rowCount)return res.status(404).json({error:'User not found'});const target=q0.rows[0];
 const newRole=d.role??target.role,newDisabled=d.disabled??target.disabled;
 if(target.role==='Administrator'&&(newRole!=='Administrator'||newDisabled)){const admins=await c.query("SELECT count(*)::int count FROM users WHERE organization_id=$1 AND role='Administrator' AND disabled=false AND id<>$2",[req.user.organization_id,target.id]);if(admins.rows[0].count<1)return res.status(409).json({error:'At least one active Administrator must remain'});}
 const ph=d.password?await bcrypt.hash(d.password,12):target.password_hash;
 const q=await c.query("UPDATE users SET role=$1,disabled=$2,password_hash=$3,password_changed_at=CASE WHEN $4::boolean THEN now() ELSE password_changed_at END,failed_login_attempts=0,locked_until=NULL WHERE organization_id=$5 AND id=$6 RETURNING id,username,role,disabled,created_at",[newRole,newDisabled,ph,Boolean(d.password),req.user.organization_id,req.params.id]);
 if(d.password)await c.query("DELETE FROM sessions WHERE user_id=$1 AND token_hash<>$2",[target.id,hash(req.cookies[cookie]||'')]);
 await audit(c,req.user,'user_update','users',target.id,{username:target.username,role:{from:target.role,to:newRole},disabled:{from:target.disabled,to:newDisabled},passwordReset:Boolean(d.password)});await c.query('COMMIT');inTransaction=false;committed=true;res.json(q.rows[0]);
}catch(e){if(inTransaction)await c.query('ROLLBACK').catch(()=>{});next(e)}finally{if(inTransaction)await c.query('ROLLBACK').catch(()=>{});c.release()}});
app.post('/api/auth/change-password',auth,async(req,res,next)=>{const c=await pool.connect();let inTransaction=false;try{
 const d=z.object({currentPassword:z.string().min(1).max(200),newPassword:passwordSchema}).parse(req.body);
 const q=await pool.query("SELECT password_hash FROM users WHERE organization_id=$1 AND id=$2 AND disabled=false",[req.user.organization_id,req.user.id]);if(!q.rowCount||!(await bcrypt.compare(d.currentPassword,q.rows[0].password_hash)))return res.status(403).json({error:'Current password is incorrect'});
 const ph=await bcrypt.hash(d.newPassword,12);await c.query('BEGIN');inTransaction=true;await c.query("UPDATE users SET password_hash=$1,password_changed_at=now(),failed_login_attempts=0,locked_until=NULL WHERE id=$2",[ph,req.user.id]);
 const currentHash=hash(req.cookies[cookie]||'');await c.query("DELETE FROM sessions WHERE user_id=$1 AND token_hash<>$2",[req.user.id,currentHash]);
 await audit(c,req.user,'password_change','users',req.user.id,{otherSessionsRevoked:true});await c.query('COMMIT');inTransaction=false;res.status(204).end();
}catch(e){if(inTransaction)await c.query('ROLLBACK').catch(()=>{});next(e)}finally{if(inTransaction)await c.query('ROLLBACK').catch(()=>{});c.release()}});

app.get('/api/records/:entity',auth,ent,perm('read'),async(req,res,next)=>{try{const l=Math.min(Math.max(+(req.query.limit||100),1),500),o=Math.max(+(req.query.offset||0),0),q=await pool.query('SELECT id,data,version,updated_at FROM records WHERE organization_id=$1 AND entity=$2 ORDER BY updated_at DESC LIMIT $3 OFFSET $4',[req.user.organization_id,req.params.entity,l,o]);res.json(q.rows.map(out))}catch(e){next(e)}});
for(const method of ['post','put','delete'])app[method]('/api/records/:entity'+(method==='put'||method==='delete'? '/:id':''),auth,ent,perm(method==='post'?'create':method==='put'?'update':'delete'),async(req,res,next)=>{const c=await pool.connect();try{if(method==='post'){const d=validate(req.params.entity,req.body);await c.query('BEGIN');const q=await c.query('INSERT INTO records(id,organization_id,entity,data) VALUES($1,$2,$3,$4) RETURNING id,data,version,updated_at',[d.id,req.user.organization_id,req.params.entity,d]);await audit(c,req.user,'create',req.params.entity,d.id,d);await c.query('COMMIT');return res.status(201).json(out(q.rows[0]))}if(method==='delete'){await c.query('BEGIN');const q=await c.query('DELETE FROM records WHERE organization_id=$1 AND entity=$2 AND id=$3 RETURNING data',[req.user.organization_id,req.params.entity,req.params.id]);if(!q.rowCount){await c.query('ROLLBACK');return res.status(404).json({error:'Not found'})}await audit(c,req.user,'delete',req.params.entity,req.params.id,q.rows[0].data);await c.query('COMMIT');return res.status(204).end()}const d=validate(req.params.entity,{...req.body,id:req.params.id}),im=req.get('If-Match'),raw=im!=null?im.trim().replace(/^W\//i,'').replace(/^"(.*)"$/,'$1'):(d._version!=null?String(d._version):''),v=raw===''?0:Number(raw);if(!Number.isInteger(v)||v<0)throw Object.assign(new Error('If-Match must be a non-negative integer version'),{statusCode:400});await c.query('BEGIN');const q=await c.query('UPDATE records SET data=$1,version=version+1,updated_at=now() WHERE organization_id=$2 AND entity=$3 AND id=$4 AND ($5=0 OR version=$5) RETURNING id,data,version,updated_at',[d,req.user.organization_id,req.params.entity,req.params.id,v]);if(!q.rowCount){await c.query('ROLLBACK');return res.status(v?409:404).json({error:v?'Conflict':'Not found'})}const action=req.params.entity==='sds'&&d.status==='ACTIVE'?'sds_activate':'update';await audit(c,req.user,action,req.params.entity,req.params.id,d);await c.query('COMMIT');res.json(out(q.rows[0]))}catch(e){await c.query('ROLLBACK').catch(()=>{});next(e)}finally{c.release()}});
app.get('/api/audit',auth,feat('audit'),async(req,res)=>res.json((await pool.query('SELECT a.*,u.username FROM audit_log a LEFT JOIN users u ON u.id=a.user_id WHERE a.organization_id=$1 ORDER BY a.created_at DESC LIMIT 1000',[req.user.organization_id])).rows));app.get('/api/backup',auth,feat('backup'),async(req,res)=>{const q=await pool.query('SELECT entity,id,data FROM records WHERE organization_id=$1',[req.user.organization_id]),state={};for(const x of q.rows)(state[x.entity]??=[]).push({...x.data,id:x.id});res.json({app:'vick_EWASCO_v2',exported:new Date().toISOString(),state})});
app.get('/api/sds/:id/history',auth,feat('sds'),async(req,res)=>res.json((await pool.query('SELECT version,file_name,mime,size,sha256,revision_date,created_at FROM sds_versions WHERE organization_id=$1 AND sds_id=$2 ORDER BY version DESC',[req.user.organization_id,req.params.id])).rows));
app.post('/api/sds/:id/file',auth,feat('sds'),upload.single('file'),async(req,res,next)=>{const c=await pool.connect();let inTransaction=false;try{if(!req.file)return res.status(400).json({error:'File required'});const i=await inspect(req.file);await c.query('BEGIN');inTransaction=true;const q=await c.query('SELECT COALESCE(max(version),0)+1 version FROM sds_versions WHERE organization_id=$1 AND sds_id=$2',[req.user.organization_id,req.params.id]);const v=q.rows[0].version;await c.query('INSERT INTO sds_versions(organization_id,sds_id,version,file_name,mime,size,stored_name,sha256,revision_date,uploaded_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[req.user.organization_id,req.params.id,v,req.file.originalname,i.mime,req.file.size,req.file.filename,i.sha256,req.body.revisionDate||null,req.user.id]);await audit(c,req.user,'sds_upload', 'sds',req.params.id,{version:v,name:req.file.originalname,size:req.file.size,sha256:i.sha256});await c.query('COMMIT');inTransaction=false;res.status(201).json({version:v,name:req.file.originalname,mime:i.mime,size:req.file.size})}catch(e){if(inTransaction)await c.query('ROLLBACK').catch(()=>{});if(req.file)await fs.unlink(req.file.path).catch(()=>{});next(e)}finally{c.release()}});
app.get('/api/sds/:id/file/:version',auth,feat('sds'),async(req,res,next)=>{try{const q=await pool.query('SELECT * FROM sds_versions WHERE organization_id=$1 AND sds_id=$2 AND version=$3',[req.user.organization_id,req.params.id,req.params.version]),f=q.rows[0];if(!f)return res.status(404).json({error:'Not found'});await audit(pool,req.user,'sds_download','sds',req.params.id,{version:f.version,name:f.file_name});const file=path.resolve(dir,f.stored_name);if(!file.startsWith(`${dir}${path.sep}`))return res.status(400).json({error:'Invalid path'});res.type(f.mime).download(file,f.file_name)}catch(e){next(e)}});
app.delete('/api/sds/:id/file/:version',auth,feat('sds'),async(req,res,next)=>{const c=await pool.connect();try{await c.query('BEGIN');const q=await c.query('DELETE FROM sds_versions WHERE organization_id=$1 AND sds_id=$2 AND version=$3 RETURNING *',[req.user.organization_id,req.params.id,req.params.version]);if(!q.rowCount){await c.query('ROLLBACK');return res.status(404).json({error:'Not found'})}await audit(c,req.user,'sds_delete','sds',req.params.id,{version:q.rows[0].version,name:q.rows[0].file_name});await c.query('COMMIT');await fs.unlink(path.join(dir,q.rows[0].stored_name)).catch(()=>{});res.status(204).end()}catch(e){await c.query('ROLLBACK').catch(()=>{});next(e)}finally{c.release()}});
registerSdsRoutes({app,pool,auth,upload,inspect,audit,dir});
registerLimsRoutes({app,pool,auth,audit});registerLimsPhaseRoutes({app,pool,audit});
app.use(express.static(fileURLToPath(new URL('../public',import.meta.url))));
app.use((err,req,res,next)=>{if(res.headersSent)return next(err);const isMulter=err instanceof multer.MulterError;const isZod=err?.name==='ZodError'||err?.issues;const status=Number.isInteger(err?.statusCode)?err.statusCode:(isMulter&&err.code==='LIMIT_FILE_SIZE'?413:(isZod?400:500));if(status>=500)console.error(JSON.stringify({event:'api_error',method:req.method,path:req.path,message:err?.message||'internal error'}));const message=status===413?'File is larger than the 10 MB limit':(isZod?'Invalid request':err.message||'Request failed');res.status(status).json({error:status>=500?'Internal server error':message});});
setInterval(()=>pool.query('DELETE FROM sessions WHERE expires_at<=now()').catch(e=>console.error(JSON.stringify({event:'cleanup_error',message:e.message}))),3600000).unref();const server=app.listen(port,()=>console.log(JSON.stringify({event:'started',port})));const stop=async()=>{server.close(()=>pool.end().then(()=>process.exit(0)));setTimeout(()=>process.exit(1),10000).unref()};process.on('SIGTERM',stop);process.on('SIGINT',stop);
