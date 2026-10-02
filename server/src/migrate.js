import 'dotenv/config';
import fs from 'node:fs/promises';
import pg from 'pg';

const required=n=>{if(!process.env[n])throw Error(`${n} is required`);return process.env[n]};
const pool=new pg.Pool({connectionString:required('DATABASE_URL')});
const sql=await fs.readFile(new URL('../sql/schema.sql',import.meta.url),'utf8');
const requiredTables=['schema_migrations','organizations','users','sessions','records','sds_versions','audit_log','sampling_points','test_methods','specifications','samples','sample_tests','results','sampling_schedules','sample_containers','chain_of_custody','custody_events','analytical_batches','batch_members','qc_results','hold_time_rules','calculations','instruments','instrument_interfaces','instrument_files','calibration_records','controlled_documents','document_versions','training_records','deviations','capa_actions','audit_plans','change_controls','reports','notifications','integration_events','quality_events','instrument_maintenance','instrument_qualifications','qms_findings','competency_assessments','document_approvals'];
// A single pooled client is required: pool.query() checks a connection out and
// returns it per statement, so BEGIN/COMMIT on the pool are not atomic.
const client=await pool.connect();
try{
  await client.query('BEGIN');
  await client.query(sql);
  const q=await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name=ANY($1)",[requiredTables]);
  const found=new Set(q.rows.map(x=>x.table_name));
  const missing=requiredTables.filter(x=>!found.has(x));
  if(missing.length)throw Error(`Migration verification failed; missing tables: ${missing.join(', ')}`);
  const seq=await client.query("SELECT 1 FROM pg_class WHERE relkind='S' AND relname='lims_sample_number_seq'");
  if(!seq.rowCount)throw Error('Migration verification failed; missing sequence: lims_sample_number_seq');
  await client.query("INSERT INTO schema_migrations(version) VALUES('002-sds-lifecycle') ON CONFLICT DO NOTHING");
  await client.query("INSERT INTO records(id,organization_id,entity,data) SELECT 'SETTINGS-BASELINE',o.id,'settings',jsonb_build_object('id','SETTINGS-BASELINE','systemName','EWASCO Chemical Inventory','applicationVersion','v2','organizationName',o.name,'baselineInitialized',true) FROM organizations o ON CONFLICT(organization_id,entity,id) DO NOTHING");
  await client.query("INSERT INTO schema_migrations(version) VALUES('003-baseline-settings') ON CONFLICT DO NOTHING");
  await client.query("INSERT INTO schema_migrations(version) VALUES('004-lims-security-core') ON CONFLICT DO NOTHING");
  await client.query("UPDATE records SET data=jsonb_set(jsonb_set(data,'{systemName}',to_jsonb('EWASCO LIMS'::text)),'{applicationVersion}',to_jsonb('LIMS-1.0'::text)) WHERE entity='settings' AND id='SETTINGS-BASELINE' AND data->>'systemName'='EWASCO Chemical Inventory'");
  await client.query("INSERT INTO schema_migrations(version) VALUES('005-ewasco-lims-product-baseline') ON CONFLICT DO NOTHING");
  await client.query("INSERT INTO schema_migrations(version) VALUES('006-ewasco-lims-phases-1-6-foundation') ON CONFLICT DO NOTHING");
  await client.query("INSERT INTO schema_migrations(version) VALUES('007-ewasco-lims-phase3-quality-events') ON CONFLICT DO NOTHING");
  await client.query("INSERT INTO schema_migrations(version) VALUES('008-ewasco-lims-phase3-trend-rules') ON CONFLICT DO NOTHING");
  await client.query("INSERT INTO schema_migrations(version) VALUES('009-ewasco-lims-phase4-instrument-controls') ON CONFLICT DO NOTHING");
  await client.query("INSERT INTO schema_migrations(version) VALUES('010-ewasco-lims-phase5-qms-foundation') ON CONFLICT DO NOTHING");
  await client.query("INSERT INTO schema_migrations(version) VALUES('011-ewasco-lims-phase6-reporting-integrations') ON CONFLICT DO NOTHING");
  await client.query('COMMIT');
  console.log(JSON.stringify({event:'migration_verified',tables:requiredTables.length,lims:true}));
}catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}finally{client.release();await pool.end()}
