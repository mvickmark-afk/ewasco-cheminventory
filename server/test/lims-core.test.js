import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluate,statusTransitions} from '../src/lims.js';
import {passwordSchema,feature} from '../src/permissions.js';

test('sample lifecycle only permits controlled forward transitions',()=>{
  assert.deepEqual(statusTransitions.REGISTERED,['RECEIVED','CANCELLED']);
  assert.equal(statusTransitions.APPROVED.includes('ARCHIVED'),false);
  assert.equal(statusTransitions.REPORTED.includes('ARCHIVED'),true);
});

test('numeric specification evaluation is deterministic and boundary-aware',()=>{
  const spec={operator:'BETWEEN',lower_limit:'0.2',upper_limit:'0.5'};
  assert.equal(evaluate(0.2,spec),'PASS');
  assert.equal(evaluate(0.5,spec),'PASS');
  assert.equal(evaluate(0.51,spec),'FAIL');
  assert.equal(evaluate(0.3,null),'NOT_EVALUATED');
});

test('role gates prevent storekeepers from entering LIMS data',()=>{
  assert.equal(feature('Storekeeper','limsRead'),false);
  assert.equal(feature('Analyst/Chemist','limsResultEntry'),true);
  assert.equal(feature('Laboratory Manager','limsApprove'),true);
});

test('password policy requires length and character classes',()=>{
  assert.doesNotThrow(()=>passwordSchema.parse('EWASCO-Secure-2026A1'));
  assert.throws(()=>passwordSchema.parse('password123'));
});
