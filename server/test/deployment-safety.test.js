import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root=path.resolve(process.cwd());
const read=rel=>fs.readFileSync(path.join(root,rel),'utf8');
const app=read('public/app.js');
const api=read('public/api-client.js');
const server=read('src/server.js');

test('production frontend points to the server-served application assets',()=>{
  const index=read('public/index.html');
  assert.match(index,/api-client\.js/);
  assert.match(index,/app\.js/);
  assert.doesNotMatch(index,/<script>\s*[\s\S]*<\/script>/i);
});

test('Settings remains on the dedicated API-backed implementation',()=>{
  assert.match(app,/if\(page==='settings'\)return renderSettings\(\);/);
  assert.match(app,/async function renderSettings\(\)/);
  assert.match(app,/EWASCO_API\.list\('settings'\)/);
  assert.match(app,/EWASCO_API\.update\('settings'/);
});

test('every frontend API adapter call has an implementation',()=>{
  const methods=new Set([...api.matchAll(/(?:^|[,{])[ \t\r\n]*([A-Za-z_$][A-Za-z0-9_$]*)[ \t\r\n]*:/g)].map(m=>m[1]));
  const calls=new Set([...app.matchAll(/EWASCO_API[.]([A-Za-z_$][A-Za-z0-9_$]*)/g)].map(m=>m[1]));
  const missing=[...calls].filter(name=>!methods.has(name));
  assert.deepEqual(missing,[]);
});

test('critical backend contracts remain registered',()=>{
  for(const route of [
    "app.get('/api/records/:entity'",
    "app.get('/api/audit'",
    "app.get('/api/sds/:id/history'",
    "app.post('/api/sds/:id/file'",
    "app.get('/api/sds/:id/file/:version'",
    "app.delete('/api/sds/:id/file/:version'",
    "registerLimsRoutes({app,pool,auth,audit})"
  ]){
    assert.ok(server.includes(route),`Missing contract: ${route}`);
  }
});

test('SDS automatic import cannot silently diverge between frontend and backend',()=>{
  assert.equal(
    app.includes('EWASCO_API.sdsImport'),
    server.includes("app.post('/api/sds/:id/import'")
  );
});
