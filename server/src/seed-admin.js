import 'dotenv/config';
import bcrypt from 'bcryptjs';import pg from 'pg';
const username=(process.env.ADMIN_USERNAME||'admin').trim().toLowerCase(),password=process.env.ADMIN_PASSWORD;
if(!password||password.length<12||password.startsWith('SET_'))throw Error('Set a unique ADMIN_PASSWORD of at least 12 characters');
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
try{await pool.query('BEGIN');const org=await pool.query('INSERT INTO organizations(name) VALUES($1) ON CONFLICT(name) DO UPDATE SET name=EXCLUDED.name RETURNING id',[process.env.ORG_NAME||'EWASCO']);const hash=await bcrypt.hash(password,12);await pool.query('INSERT INTO users(organization_id,username,password_hash,role) VALUES($1,$2,$3,$4) ON CONFLICT(organization_id,username) DO NOTHING',[org.rows[0].id,username,hash,'Administrator']);await pool.query('COMMIT');console.log(`Administrator ensured: ${username}`)}catch(e){await pool.query('ROLLBACK');throw e}finally{await pool.end()}
