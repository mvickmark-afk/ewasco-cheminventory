import test from 'node:test';
import assert from 'node:assert/strict';
import {validate} from '../src/permissions.js';

test('active SDS records require complete controlled metadata',()=>{
  assert.doesNotThrow(()=>validate('sds',{
    id:'SDS-1',
    name:'Sodium Hypochlorite',
    manufacturer:'EWASCO',
    product:'Sodium Hypochlorite',
    cas:'7681-52-9',
    revisionDate:'2026-09-30',
    status:'ACTIVE'
  }));
});

test('incomplete active SDS validation returns 422',()=>{
  assert.throws(()=>validate('sds',{id:'SDS-2',status:'ACTIVE'}),err=>{
    assert.equal(err.statusCode,422);
    assert.equal(err.name,'ZodError');
    return true;
  });
});

test('pending-review SDS may retain missing metadata',()=>{
  assert.doesNotThrow(()=>validate('sds',{id:'SDS-3',status:'PENDING_REVIEW',cas:null}));
});
