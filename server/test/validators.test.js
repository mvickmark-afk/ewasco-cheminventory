import test from 'node:test';
import assert from 'node:assert/strict';
import '../public/validators.js';

const v=globalThis.EWASCO_VALIDATE;

test('SDS file validator accepts supported extensions',()=>{
  for(const name of ['SDS.docx','report.PDF','inventory.xlsx','a.b.xlsx']){
    assert.equal(v.isSdsFile({name,type:''}),true,name);
  }
});

test('SDS file validator accepts supported MIME types',()=>{
  assert.equal(v.isSdsFile({name:'document',type:'application/pdf'}),true);
  assert.equal(v.isSdsFile({name:'document',type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}),true);
  assert.equal(v.isSdsFile({name:'document',type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),true);
  assert.equal(v.isSdsFile({name:'document',type:'application/x-pdf'}),true);
});

test('SDS file validator rejects JSON, unknown extensions, and misleading MIME types',()=>{
  assert.equal(v.isSdsFile({name:'sds.json',type:'application/json'}),false);
  assert.equal(v.isSdsFile({name:'sds.txt',type:'text/plain'}),false);
  assert.equal(v.isSdsFile({name:'sds',type:'application/octet-stream'}),false);
  assert.equal(v.isSdsFile({name:'sds.json',type:'application/pdf'}),false);
  assert.equal(v.isSdsFile({name:'sds.doc',type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}),false);
});
test('SDS file validator accepts supported MIME types only when extension is absent',()=>{
  assert.equal(v.isSdsFile({name:'document',type:'application/pdf'}),true);
  assert.equal(v.isSdsFile({name:'document.pdf',type:'application/octet-stream'}),true);
});

test('CAS validator accepts normal CAS registry numbers',()=>{
  for(const cas of ['7732-18-5','64-17-5','7647-14-5'])assert.equal(v.isCas(cas),true,cas);
});

test('CAS validator rejects malformed values',()=>{
  for(const cas of ['001','12345','123-45','12345678-12-3','7732-18-55','abc'])assert.equal(v.isCas(cas),false,cas);
});
