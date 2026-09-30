import test from 'node:test';
import assert from 'node:assert/strict';
import {extractSdsMetadata,parseRevisionDate} from '../src/sds.js';
import {validate} from '../src/permissions.js';

const documentText=[
 'SAFETY DATA SHEET NAME: SODIUM',
 'Manufacturer / Supplier: EWASCO',
 'Product Identifier: SODIUM HYPOCHLORITE',
 'CAS No: 7681-52-9',
 'Revision Date: 30 September 2026'
].join('\n');

test('extracts all required SDS metadata from explicit labelled fields',()=>{
  assert.deepEqual(extractSdsMetadata(documentText),{
    name:'SODIUM',
    manufacturer:'EWASCO',
    product:'SODIUM HYPOCHLORITE',
    cas:'7681-52-9',
    revisionDate:'2026-09-30'
  });
});

test('accepts an unambiguous ISO revision date',()=>{
  assert.equal(parseRevisionDate('2026-09-30'),'2026-09-30');
});

test('accepts an explicit month-name revision date',()=>{
  assert.equal(parseRevisionDate('30 September 2026'),'2026-09-30');
});

test('rejects ambiguous numeric dates instead of guessing',()=>{
  assert.throws(()=>parseRevisionDate('09/10/2026'),/ambiguous/i);
});

test('rejects multiple CAS numbers when no labelled CAS uniquely identifies one',()=>{
  assert.throws(()=>extractSdsMetadata([
    'SDS Name: SODIUM',
    'Manufacturer: EWASCO',
    'Product Identifier: SODIUM HYPOCHLORITE',
    'CAS numbers: 7681-52-9 and 7732-18-5',
    'Revision Date: 2026-09-30'
  ].join('\n')),/Multiple CAS numbers/i);
});

test('fails rather than guessing when required metadata is missing',()=>{
  assert.throws(()=>extractSdsMetadata([
    'SDS Name: SODIUM',
    'Manufacturer: EWASCO',
    'Product Identifier: SODIUM HYPOCHLORITE',
    'CAS No: 7681-52-9'
  ].join('\n')),/Revision date/i);
});

test('SDS records may exist before a chemical link is known',()=>{
  assert.doesNotThrow(()=>validate('sds',{id:'SDS-TEST-001',name:'SODIUM',manufacturer:'EWASCO',product:'SODIUM HYPOCHLORITE',cas:'7681-52-9',revisionDate:'2026-09-30'}));
});

test('accepts common year-first slash/dot dates',()=>{
  assert.equal(parseRevisionDate('2026/09/30'),'2026-09-30');
  assert.equal(parseRevisionDate('2026.09.30'),'2026-09-30');
});

test('accepts abbreviated month-name dates',()=>{
  assert.equal(parseRevisionDate('30 Sep 2026'),'2026-09-30');
  assert.equal(parseRevisionDate('September 30, 2026'),'2026-09-30');
});

test('reports ambiguous revision dates as controlled validation errors',()=>{
  assert.equal(parseRevisionDate('September 30th, 2026'),'2026-09-30');
  assert.throws(()=>parseRevisionDate('09/10/2026'),e=>e?.statusCode===422);
});

test('extracts a date token when revision text contains a revision suffix',()=>{
  assert.equal(parseRevisionDate('Rev 1 - 2026-09-30'),'2026-09-30');
  assert.equal(parseRevisionDate('2026-09-30 14:30:00'),'2026-09-30');
});

test('accepts ordinal day suffixes in month-name dates',()=>{
  assert.equal(parseRevisionDate('30th September 2026'),'2026-09-30');
  assert.equal(parseRevisionDate('1st January 2026'),'2026-01-01');
});

test('rejects two-digit numeric years because century is not inferable',()=>{
  assert.throws(()=>parseRevisionDate('30/09/26'),/could not be parsed|guessing/i);
});
