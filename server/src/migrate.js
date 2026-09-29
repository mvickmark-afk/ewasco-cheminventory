import 'dotenv/config';
import fs from 'node:fs/promises';
import pg from 'pg';

const required=n=>{if(!process.env[n])throw Error(`${n} is required`);return process.env[n]};
const pool=new pg.Pool({connectionString:required('DATABASE_URL')});
const sql=await fs.readFile(new URL('../sql/schema.sql',import.meta.url),'utf8');
const requiredTables=['schema_migrations','organizations','users','sessions','records','sds_versions','audit_log','sampling_points','test_methods','specifications','samples','sample_tests','results'];
try{
  await pool.query('BEGIN');
  await pool.query(sql);
  const q=await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name=ANY($1)",[requiredTables]);
  const found=new Set(q.rows.map(x=>x.table_name));
  if(requiredTables.some(x=>!found.has(x)))throw Error('Migration verification failed');
  await pool.query("SELECT 1 FROM pg_class WHERE relkind='S' AND relname='lims_sample_number_seq'");
  await pool.query("INSERT INTO schema_migrations(version) VALUES('002-sds-lifecycle') ON CONFLICT DO NOTHING");
  await pool.query("INSERT INTO records(id,organization_id,entity,data) SELECT 'SETTINGS-BASELINE',o.id,'settings',jsonb_build_object('id','SETTINGS-BASELINE','systemName','EWASCO Chemical Inventory','applicationVersion','v2','organizationName',o.name,'baselineInitialized',true) FROM organizations o ON CONFLICT(organization_id,entity,id) DO NOTHING");
  await pool.query("INSERT INTO schema_migrations(version) VALUES('003-baseline-settings') ON CONFLICT DO NOTHING");
  await pool.query("INSERT INTO schema_migrations(version) VALUES('004-lims-security-core') ON CONFLICT DO NOTHING");
  await pool.query('COMMIT');
  console.log(JSON.stringify({event:'migration_verified',tables:requiredTables,lims:true}));
}catch(e){await pool.query('ROLLBACK').catch(()=>{});throw e}finally{await pool.end()}
