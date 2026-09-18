import 'dotenv/config';
import crypto from 'node:crypto';
import express from 'express';
import bcrypt from 'bcryptjs';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import pg from 'pg';
import { z } from 'zod';

const app = express();
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const PORT = Number(process.env.PORT || 3000);
const COOKIE = 'ewasco_session';
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) throw new Error('JWT_SECRET must contain at least 32 characters');
const entities = new Set(['chemicals','batches','reagents','consumption','equipment','calibrations','suppliers','procurement','water','waste','sds','settings']);
const idSchema = z.string().min(1).max(120).regex(/^[A-Za-z0-9._:-]+$/);
const recordSchema = z.object({ id: idSchema }).passthrough();

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.CORS_ORIGIN || false, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use('/api/auth/login', rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false }));

function tokenHash(token) { return crypto.createHash('sha256').update(token).digest('hex'); }
function sign(user) { return jwt.sign({ sub: user.id, org: user.organization_id, role: user.role }, JWT_SECRET, { expiresIn: '8h' }); }
async function auth(req, res, next) {
  try {
    const token = req.cookies[COOKIE];
    if (!token) return res.status(401).json({ error: 'Authentication required' });
    const claims = jwt.verify(token, JWT_SECRET);
    const result = await pool.query('SELECT id, organization_id, username, role FROM users WHERE id=$1 AND disabled=false', [claims.sub]);
    if (!result.rowCount) return res.status(401).json({ error: 'Invalid session' });
    req.user = result.rows[0];
    next();
  } catch { res.status(401).json({ error: 'Invalid or expired session' }); }
}
function validEntity(entity) { return entities.has(entity); }
async function audit(user, action, entity, recordId, data) {
  await pool.query('INSERT INTO audit_log(organization_id,user_id,action,entity,record_id,data) VALUES($1,$2,$3,$4,$5,$6)', [user.organization_id, user.id, action, entity, recordId || null, data || null]);
}

app.post('/api/auth/login', async (req, res, next) => {
  try {
    const input = z.object({ username: z.string().min(1).max(100), password: z.string().min(1).max(200) }).parse(req.body);
    const result = await pool.query('SELECT * FROM users WHERE username=$1 AND disabled=false', [input.username.trim().toLowerCase()]);
    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(input.password, user.password_hash))) return res.status(401).json({ error: 'Invalid username or password' });
    const token = sign(user);
    await pool.query('INSERT INTO sessions(user_id, token_hash, expires_at) VALUES($1,$2,now()+interval \'8 hours\')', [user.id, tokenHash(token)]);
    res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: process.env.COOKIE_SECURE === 'true', maxAge: 8 * 60 * 60 * 1000 });
    res.json({ user: { name: user.username, role: user.role } });
  } catch (e) { next(e); }
});
app.post('/api/auth/logout', auth, async (req, res, next) => { try { const token = req.cookies[COOKIE]; await pool.query('DELETE FROM sessions WHERE token_hash=$1', [tokenHash(token)]); res.clearCookie(COOKIE); res.status(204).end(); } catch (e) { next(e); } });
app.get('/api/auth/me', auth, (req, res) => res.json({ user: { name: req.user.username, role: req.user.role } }));

app.get('/api/records/:entity', auth, async (req, res, next) => {
  try {
    if (!validEntity(req.params.entity)) return res.status(404).json({ error: 'Unknown entity' });
    const result = await pool.query('SELECT id, data, version, created_at, updated_at FROM records WHERE organization_id=$1 AND entity=$2 ORDER BY updated_at DESC', [req.user.organization_id, req.params.entity]);
    res.json(result.rows.map(row => ({ ...row.data, id: row.id, _version: row.version, _updatedAt: row.updated_at })));
  } catch (e) { next(e); }
});
app.post('/api/records/:entity', auth, async (req, res, next) => {
  try {
    if (!validEntity(req.params.entity)) return res.status(404).json({ error: 'Unknown entity' });
    const data = recordSchema.parse(req.body);
    const result = await pool.query('INSERT INTO records(id,organization_id,entity,data) VALUES($1,$2,$3,$4) RETURNING id,data,version,updated_at', [data.id, req.user.organization_id, req.params.entity, data]);
    await audit(req.user, 'create', req.params.entity, data.id, data);
    res.status(201).json({ ...result.rows[0].data, id: result.rows[0].id, _version: result.rows[0].version, _updatedAt: result.rows[0].updated_at });
  } catch (e) { if (e.code === '23505') return res.status(409).json({ error: 'Record already exists' }); next(e); }
});
app.put('/api/records/:entity/:id', auth, async (req, res, next) => {
  try {
    if (!validEntity(req.params.entity)) return res.status(404).json({ error: 'Unknown entity' });
    const data = recordSchema.parse({ ...req.body, id: req.params.id });
    const expected = Number(req.headers['if-match'] || data._version || 0);
    const result = await pool.query('UPDATE records SET data=$1, version=version+1, updated_at=now() WHERE organization_id=$2 AND entity=$3 AND id=$4 AND ($5=0 OR version=$5) RETURNING id,data,version,updated_at', [data, req.user.organization_id, req.params.entity, req.params.id, expected]);
    if (!result.rowCount) return res.status(expected ? 409 : 404).json({ error: expected ? 'Conflict: record changed by another user' : 'Record not found' });
    await audit(req.user, 'update', req.params.entity, req.params.id, data);
    res.json({ ...result.rows[0].data, id: result.rows[0].id, _version: result.rows[0].version, _updatedAt: result.rows[0].updated_at });
  } catch (e) { next(e); }
});
app.delete('/api/records/:entity/:id', auth, async (req, res, next) => { try { if (!validEntity(req.params.entity)) return res.status(404).json({ error: 'Unknown entity' }); const r = await pool.query('DELETE FROM records WHERE organization_id=$1 AND entity=$2 AND id=$3 RETURNING data', [req.user.organization_id, req.params.entity, req.params.id]); if (!r.rowCount) return res.status(404).json({ error: 'Record not found' }); await audit(req.user, 'delete', req.params.entity, req.params.id, r.rows[0].data); res.status(204).end(); } catch (e) { next(e); } });
app.get('/api/backup', auth, async (req, res, next) => { try { const r = await pool.query('SELECT entity,id,data FROM records WHERE organization_id=$1 ORDER BY entity,id', [req.user.organization_id]); const backup = {}; for (const row of r.rows) (backup[row.entity] ||= []).push({ ...row.data, id: row.id }); res.json({ app: 'vick_EWASCO_v2', exported: new Date().toISOString(), state: backup }); } catch (e) { next(e); } });

app.use(express.static(new URL('../public', import.meta.url).pathname));
app.use((err, req, res, next) => { console.error(err); res.status(err.name === 'ZodError' ? 400 : 500).json({ error: err.name === 'ZodError' ? 'Invalid request' : 'Internal server error' }); });
app.listen(PORT, () => console.log(`EWASCO API listening on http://localhost:${PORT}`));
