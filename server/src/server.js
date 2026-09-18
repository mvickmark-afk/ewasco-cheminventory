import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import bcrypt from 'bcryptjs';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import pg from 'pg';
import { z } from 'zod';
import { ENTITIES, can, canManageUsers, idSchema, recordSchema, userCreateSchema } from './permissions.js';

const app = express();
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: Number(process.env.DB_POOL_MAX || 10) });
const PORT = Number(process.env.PORT || 3000), COOKIE = 'ewasco_session', CSRF = 'ewasco_csrf';
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) throw new Error('JWT_SECRET must contain at least 32 characters');
const uploadDir = path.resolve(process.env.UPLOAD_DIR || './uploads');
await fs.mkdir(uploadDir, { recursive: true });
const upload = multer({ storage: multer.diskStorage({ destination: uploadDir, filename: (_r, file, cb) => cb(null, `${crypto.randomUUID()}-${path.basename(file.originalname).replace(/[^A-Za-z0-9._-]/g, '_')}`) }), limits: { fileSize: 10 * 1024 * 1024 }, fileFilter: (_r, file, cb) => cb(null, ['application/pdf','image/png','image/jpeg'].includes(file.mimetype)) });

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.CORS_ORIGIN || false, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use('/api/auth/login', rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false }));

const tokenHash = token => crypto.createHash('sha256').update(token).digest('hex');
const csrfToken = () => crypto.randomBytes(32).toString('hex');
const sign = user => jwt.sign({ sub: user.id, org: user.organization_id, role: user.role }, JWT_SECRET, { expiresIn: '8h' });
function setCsrf(res) { const token = csrfToken(); res.cookie(CSRF, token, { httpOnly: false, sameSite: 'strict', secure: process.env.COOKIE_SECURE === 'true', maxAge: 8 * 60 * 60 * 1000 }); return token; }
function requireCsrf(req, res, next) { if (['GET','HEAD','OPTIONS'].includes(req.method) || req.path === '/auth/login') return next(); if (!req.cookies[CSRF] || req.cookies[CSRF] !== req.get('X-CSRF-Token')) return res.status(403).json({ error: 'CSRF validation failed' }); next(); }
async function auth(req, res, next) {
  try {
    const token = req.cookies[COOKIE]; if (!token) return res.status(401).json({ error: 'Authentication required' });
    const claims = jwt.verify(token, JWT_SECRET);
    const result = await pool.query('SELECT u.id,u.organization_id,u.username,u.role FROM users u JOIN sessions s ON s.user_id=u.id WHERE u.id=$1 AND u.disabled=false AND s.token_hash=$2 AND s.expires_at>now()', [claims.sub, tokenHash(token)]);
    if (!result.rowCount) return res.status(401).json({ error: 'Invalid or expired session' }); req.user = result.rows[0]; next();
  } catch { res.status(401).json({ error: 'Invalid or expired session' }); }
}
function entity(req, res, next) { if (!ENTITIES.includes(req.params.entity)) return res.status(404).json({ error: 'Unknown entity' }); next(); }
function permission(action) { return (req, res, next) => can(req.user.role, action, req.params.entity) ? next() : res.status(403).json({ error: `Your role cannot ${action} ${req.params.entity}` }); }
async function audit(client, user, action, entityName, recordId, data) { await client.query('INSERT INTO audit_log(organization_id,user_id,action,entity,record_id,data) VALUES($1,$2,$3,$4,$5,$6)', [user.organization_id,user.id,action,entityName,recordId || null, data || null]); }
function output(row) { return { ...row.data, id: row.id, _version: row.version, _updatedAt: row.updated_at }; }

app.get('/api/auth/csrf', (_req, res) => res.json({ token: setCsrf(res) }));
app.post('/api/auth/login', async (req, res, next) => { try { const input=z.object({username:z.string().min(1).max(100),password:z.string().min(1).max(200)}).parse(req.body); const q=await pool.query('SELECT * FROM users WHERE username=$1 AND disabled=false',[input.username.trim().toLowerCase()]); const user=q.rows[0]; if(!user || !(await bcrypt.compare(input.password,user.password_hash))) return res.status(401).json({error:'Invalid username or password'}); const token=sign(user); await pool.query("INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '8 hours')",[user.id,tokenHash(token)]); res.cookie(COOKIE,token,{httpOnly:true,sameSite:'strict',secure:process.env.COOKIE_SECURE==='true',maxAge:8*60*60*1000}); setCsrf(res); res.json({user:{name:user.username,role:user.role}}); } catch(e){next(e);} });
app.post('/api/auth/logout', auth, async (req,res,next) => { try { await pool.query('DELETE FROM sessions WHERE token_hash=$1',[tokenHash(req.cookies[COOKIE])]); res.clearCookie(COOKIE); res.clearCookie(CSRF); res.status(204).end(); } catch(e){next(e);} });
app.get('/api/auth/me', auth, (req,res) => res.json({user:{name:req.user.username,role:req.user.role}}));

app.get('/api/records/:entity', auth, entity, permission('read'), async (req,res,next) => { try { const q=await pool.query('SELECT id,data,version,updated_at FROM records WHERE organization_id=$1 AND entity=$2 ORDER BY updated_at DESC',[req.user.organization_id,req.params.entity]); res.json(q.rows.map(output)); } catch(e){next(e);} });
app.post('/api/records/:entity', auth, entity, permission('create'), async (req,res,next) => { const client=await pool.connect(); try { const data=recordSchema.parse(req.body); await client.query('BEGIN'); const q=await client.query('INSERT INTO records(id,organization_id,entity,data) VALUES($1,$2,$3,$4) RETURNING id,data,version,updated_at',[data.id,req.user.organization_id,req.params.entity,data]); await audit(client,req.user,'create',req.params.entity,data.id,data); await client.query('COMMIT'); res.status(201).json(output(q.rows[0])); } catch(e){await client.query('ROLLBACK'); if(e.code==='23505') return res.status(409).json({error:'Record already exists'}); next(e);} finally{client.release();} });
app.put('/api/records/:entity/:id', auth, entity, permission('update'), async (req,res,next) => { const client=await pool.connect(); try { const data=recordSchema.parse({...req.body,id:req.params.id}); const expected=Number(req.headers['if-match']||data._version||0); await client.query('BEGIN'); const q=await client.query('UPDATE records SET data=$1,version=version+1,updated_at=now() WHERE organization_id=$2 AND entity=$3 AND id=$4 AND ($5=0 OR version=$5) RETURNING id,data,version,updated_at',[data,req.user.organization_id,req.params.entity,req.params.id,expected]); if(!q.rowCount){await client.query('ROLLBACK');return res.status(expected?409:404).json({error:expected?'Conflict: record changed by another user':'Record not found'});} await audit(client,req.user,'update',req.params.entity,req.params.id,data); await client.query('COMMIT'); res.json(output(q.rows[0])); } catch(e){await client.query('ROLLBACK');next(e);} finally{client.release();} });
app.delete('/api/records/:entity/:id', auth, entity, permission('delete'), async (req,res,next) => { const client=await pool.connect(); try { await client.query('BEGIN'); const q=await client.query('DELETE FROM records WHERE organization_id=$1 AND entity=$2 AND id=$3 RETURNING data',[req.user.organization_id,req.params.entity,req.params.id]); if(!q.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'Record not found'});} await audit(client,req.user,'delete',req.params.entity,req.params.id,q.rows[0].data); await client.query('COMMIT'); res.status(204).end(); } catch(e){await client.query('ROLLBACK');next(e);} finally{client.release();} });

app.get('/api/users', auth, (req,res,next) => canManageUsers(req.user.role) ? pool.query('SELECT id,username,role,disabled,created_at FROM users WHERE organization_id=$1 ORDER BY username',[req.user.organization_id]).then(q=>res.json(q.rows)).catch(next) : res.status(403).json({error:'Administrator role required'}));
app.post('/api/users', auth, async (req,res,next) => { if(!canManageUsers(req.user.role)) return res.status(403).json({error:'Administrator role required'}); try { const input=userCreateSchema.parse(req.body); const hash=await bcrypt.hash(input.password,12); const q=await pool.query('INSERT INTO users(organization_id,username,password_hash,role,disabled) VALUES($1,$2,$3,$4,$5) RETURNING id,username,role,disabled,created_at',[req.user.organization_id,input.username,hash,input.role,input.disabled||false]); await pool.query('INSERT INTO audit_log(organization_id,user_id,action,entity,record_id,data) VALUES($1,$2,$3,$4,$5,$6)',[req.user.organization_id,req.user.id,'create','users',q.rows[0].id,{username:input.username,role:input.role}]); res.status(201).json(q.rows[0]); } catch(e){if(e.code==='23505')return res.status(409).json({error:'Username already exists'});next(e);} });
app.patch('/api/users/:id', auth, async (req,res,next) => { if(!canManageUsers(req.user.role)) return res.status(403).json({error:'Administrator role required'}); try { const input=z.object({role:z.enum(['Administrator','Laboratory Manager','Analyst/Chemist','Storekeeper']).optional(),disabled:z.boolean().optional(),password:z.string().min(12).max(200).optional()}).parse(req.body); const fields=[],values=[]; if(input.role){fields.push(`role=$${values.length+1}`);values.push(input.role);} if(input.disabled!==undefined){fields.push(`disabled=$${values.length+1}`);values.push(input.disabled);} if(input.password){fields.push(`password_hash=$${values.length+1}`);values.push(await bcrypt.hash(input.password,12));} if(!fields.length)return res.status(400).json({error:'No changes supplied'}); values.push(req.user.organization_id,req.params.id); const q=await pool.query(`UPDATE users SET ${fields.join(',')} WHERE organization_id=$${values.length-1} AND id=$${values.length} RETURNING id,username,role,disabled,created_at`,values); if(!q.rowCount)return res.status(404).json({error:'User not found'}); res.json(q.rows[0]); } catch(e){next(e);} });

app.get('/api/audit', auth, async (req,res,next) => { try { const q=await pool.query('SELECT a.id,a.action,a.entity,a.record_id,a.data,a.created_at,u.username FROM audit_log a LEFT JOIN users u ON u.id=a.user_id WHERE a.organization_id=$1 ORDER BY a.created_at DESC LIMIT 1000',[req.user.organization_id]); res.json(q.rows); } catch(e){next(e);} });
app.post('/api/sds/:id/file', auth, upload.single('file'), async (req,res,next) => { try { if(!req.file)return res.status(400).json({error:'PDF, PNG, or JPEG file required'}); const q=await pool.query("UPDATE records SET data=data||jsonb_build_object('file',{\"name\":$1,\"mime\":$2,\"size\":$3}),updated_at=now(),version=version+1 WHERE organization_id=$4 AND entity='sds' AND id=$5 RETURNING id",[req.file.originalname,req.file.mimetype,req.file.size,req.user.organization_id,req.params.id]); if(!q.rowCount){await fs.unlink(req.file.path).catch(()=>{});return res.status(404).json({error:'SDS record not found'});} res.status(201).json({name:req.file.originalname,mime:req.file.mimetype,size:req.file.size}); } catch(e){next(e);} });
app.get('/api/backup', auth, async (req,res,next) => { try { const q=await pool.query('SELECT entity,id,data FROM records WHERE organization_id=$1 ORDER BY entity,id',[req.user.organization_id]); const state={}; for(const row of q.rows)(state[row.entity]??=[]).push({...row.data,id:row.id}); res.json({app:'vick_EWASCO_v2',exported:new Date().toISOString(),state}); } catch(e){next(e);} });

app.use(requireCsrf); app.use(express.static(path.resolve(new URL('../public',import.meta.url).pathname)));
app.use((err,req,res,_next) => { console.error(err); res.status(err.name==='ZodError'||err instanceof multer.MulterError?400:500).json({error:err.name==='ZodError'||err instanceof multer.MulterError?'Invalid request':'Internal server error'}); });
app.listen(PORT,()=>console.log(`EWASCO API listening on http://localhost:${PORT}`));
