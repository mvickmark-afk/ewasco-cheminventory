import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('EWASCO LIMS Phase 1-6 schema foundation is present',()=>{
  const sql=fs.readFileSync(new URL('../sql/schema.sql',import.meta.url),'utf8');
  for(const table of ['sampling_schedules','sample_containers','chain_of_custody','custody_events','analytical_batches','batch_members','qc_results','hold_time_rules','calculations','instruments','instrument_interfaces','instrument_files','calibration_records','instrument_maintenance','instrument_qualifications','controlled_documents','document_versions','training_records','deviations','capa_actions','audit_plans','change_controls','reports','notifications','integration_events']){
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

test('Phase 3 batch membership and QC completeness controls are wired',()=>{
  const routes=fs.readFileSync(new URL('../src/lims-phases.js',import.meta.url),'utf8');
  assert.match(routes,/\/api\/lims\/batches\/:id\/members/);
  assert.match(routes,/Sample test method does not match the batch method/);
  assert.match(routes,/requiredQcTypes/);
  assert.match(routes,/QC_REQUIRED_MISSING/);
  assert.match(routes,/QC cannot be added to a closed batch/);
});
test('Analytical result failure automatically creates an OOS quality event',()=>{
  const routes=fs.readFileSync(new URL('../src/lims.js',import.meta.url),'utf8');
  assert.match(routes,/if\(flag==='FAIL'\)/);
  assert.match(routes,/event_type='OOS'/);
  assert.match(routes,/lims_quality_event_auto_oos/);
});

test('Phase 3 trend and OOT controls are wired',()=>{
  const routes=fs.readFileSync(new URL('../src/lims-phases.js',import.meta.url),'utf8');
  assert.match(routes,/trend-rules/);
  assert.match(routes,/\/api\/lims\/trends\/\:sampleTestId/);
  assert.match(routes,/TREND_CONTROL_CHART/);
  assert.match(routes,/OOT_ACTION/);
  assert.match(routes,/Insufficient historical observations/);
});
test('Trend rules have migration tracking',()=>{
  const migration=fs.readFileSync(new URL('../src/migrate.js',import.meta.url),'utf8');
  const sql=fs.readFileSync(new URL('../sql/schema.sql',import.meta.url),'utf8');
  assert.match(migration,/008-ewasco-lims-phase3-trend-rules/);
  assert.match(sql,/CREATE TABLE IF NOT EXISTS trend_rules/);
});

test('Phase 4 instrument and calibration controls are wired',()=>{
  const routes=fs.readFileSync(new URL('../src/lims-phases.js',import.meta.url),'utf8');
  assert.match(routes,/\/api\/lims\/instruments\/due/);
  assert.match(routes,/\/api\/lims\/instruments\/\:id\/status/);
  assert.match(routes,/Retired instrument cannot be calibrated/);
  assert.match(routes,/status='OUT_OF_SERVICE'/);
});

test('Phase 4 maintenance qualification and readiness controls are wired',()=>{
  const routes=fs.readFileSync(new URL('../src/lims-phases.js',import.meta.url),'utf8');
  assert.match(routes,/\/api\/lims\/maintenance/);
  assert.match(routes,/\/api\/lims\/qualifications/);
  assert.match(routes,/\/api\/lims\/instruments\/\:id\/readiness/);
  assert.match(routes,/Instrument not found/);
  assert.match(routes,/instrument_files/);
});

test('Phase 4 instrument file traceability is wired',()=>{
  const routes=fs.readFileSync(new URL('../src/lims-phases.js',import.meta.url),'utf8');
  assert.match(routes,/\/api\/lims\/instruments\/\:id\/files/);
  assert.match(routes,/lims_instrument_file_register/);
});

test('Phase 4 lifecycle and calibration-point validation controls are wired',()=>{
  const routes=fs.readFileSync(new URL('../src/lims-phases.js',import.meta.url),'utf8');
  assert.match(routes,/calibrationPoint/);
  assert.match(routes,/Measured value exceeds the declared tolerance/);
  assert.match(routes,//api/lims/maintenance/:id/status/);
  assert.match(routes,/Invalid maintenance status transition/);
  assert.match(routes,//api/lims/qualifications/:id/status/);
});
test('Analytical results enforce referenced instrument readiness',()=>{
  const routes=fs.readFileSync(new URL('../src/lims.js',import.meta.url),'utf8');
  assert.match(routes,/Referenced instrument not found in this organization/);
  assert.match(routes,/Referenced instrument calibration is overdue/);
  assert.match(routes,/Referenced instrument qualification is not current/);
});
