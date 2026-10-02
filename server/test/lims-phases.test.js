import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('EWASCO LIMS Phase 1-6 schema foundation is present',()=>{
  const sql=fs.readFileSync(new URL('../sql/schema.sql',import.meta.url),'utf8');
  for(const table of ['sampling_schedules','sample_containers','chain_of_custody','custody_events','analytical_batches','batch_members','qc_results','hold_time_rules','calculations','instruments','instrument_interfaces','instrument_files','calibration_records','controlled_documents','document_versions','training_records','deviations','capa_actions','audit_plans','change_controls','reports','notifications','integration_events']){
    assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS '+table+'('),table+' table missing');
  }
});
test('Phase API is wired into the application',()=>{
  const server=fs.readFileSync(new URL('../src/server.js',import.meta.url),'utf8');
  assert.match(server,/from '\.\/lims-phases\.js'/);
  assert.match(server,/registerLimsPhaseRoutes\(\{app,pool,audit\}\)/);
});
test('Phase status exposes all six delivery phases',()=>{
  const routes=fs.readFileSync(new URL('../src/lims-phases.js',import.meta.url),'utf8');
  for(let i=1;i<=6;i++)assert.ok(routes.includes('phase'+i+':'),'phase '+i+' missing');
});


test('Phase 3 QC evaluation and acceptance gates are wired',()=>{
  const routes=fs.readFileSync(new URL('../src/lims-phases.js',import.meta.url),'utf8');
  assert.match(routes,/export function evaluateQcFlag/);
  assert.match(routes,/Lower limit cannot exceed upper limit/);
  assert.match(routes,/flag='FAIL'/);
  assert.match(routes,/Batch cannot be accepted while quality gates are failing/);
  assert.match(routes,/HOLD_TIME_EXPIRED/);
});

test('Batch lifecycle has controlled transition rules',()=>{
  const routes=fs.readFileSync(new URL('../src/lims-phases.js',import.meta.url),'utf8');
  assert.match(routes,/const transitions=/);
  assert.match(routes,/Invalid batch status transition/);
});


test('Phase 3 OOS/OOT and calculation controls are wired',()=>{
  const routes=fs.readFileSync(new URL('../src/lims-phases.js',import.meta.url),'utf8');
  assert.match(routes,/quality-events/);
  assert.match(routes,/eventType:z\.enum\(\['OOS','OOT'\]\)/);
  assert.match(routes,/formulaVersion/);
  assert.match(routes,/calculations/);
});
test('Phase 3 quality event table is part of migration verification',()=>{
  const migration=fs.readFileSync(new URL('../src/migrate.js',import.meta.url),'utf8');
  assert.match(migration,/quality_events/);
  assert.match(migration,/007-ewasco-lims-phase3-quality-events/);
});
