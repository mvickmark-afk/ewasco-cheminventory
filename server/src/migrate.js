import 'dotenv/config';
import fs from 'node:fs/promises';
import pg from 'pg';
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
const sql=await fs.readFile(new URL('../sql/schema.sql',import.meta.url),'utf8');
try{await pool.query('BEGIN');await pool.query(sql);const required=['schema_migrations','organizations','users','sessions','records','audit_log'];const q=await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name=ANY($1)",[required]);const found=new Set(q.rows.map(x=>x.table_name));const missing=required.filter(x=>!found.has(x));if(missing.length)throw Error(`Migration verification failed: ${missing.join(',')}`);await pool.query("INSERT INTO schema_migrations(version) VALUES('001-initial') ON CONFLICT DO NOTHING");await pool.query('COMMIT');console.log('Migration verified');}catch(e){await pool.query('ROLLBACK');throw e}finally{await pool.end()}
