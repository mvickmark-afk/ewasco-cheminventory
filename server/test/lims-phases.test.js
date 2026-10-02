import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('EWASCO LIMS Phase 1-6 schema foundation is present',()=>{
  const sql=fs.readFileSync(new URL('../sql/schema.sql',import.meta.url),'utf8');
  for(const table of ['sampling_schedules','sample_containers','chain_of_custody','custody_events','analytical_batches','batch_members','qc_results','hold_time_rules','calculations','instruments','instrument_interfaces','instrument_files','calibration_records','controlled_documents','document_versions','training_records','deviations','capa_actions','audit_plans','change_controls','reports','notifications','integration_events']){
    assert.match(sql,new RegExp('CREATE TABLE IF NOT EXISTS '+table+'\\\\('),table+' table missing');
  }
});
test('Phase API is wired into the application',()=>{
  const server=fs.readFileSync(new URL('../src/server.js',import.meta.url),'utf8');
  assert.match(server,/from '\.\/lims-phases\.js'/);
  assert.match(server,/registerLimsPhaseRoutes\(\{app,pool,audit\}\)/);
});
test('Phase status exposes all six delivery phases',()=>{
  const routes=fs.readFileSync(new URL('../src/lims-phases.js',import.meta.url),'utf8');
  for(let i=1;i<=6;i++)assert.match(routes,new RegExp('phase'+i+'\\\\:'));
});
