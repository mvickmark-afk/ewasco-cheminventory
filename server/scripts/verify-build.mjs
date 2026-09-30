import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const root=process.cwd();
const runtimeFiles=[
  'src/server.js',
  'src/lims.js',
  'src/permissions.js',
  'src/migrate.js',
  'src/seed-admin.js',
  'src/sds.js',
  'public/app.js',
  'public/api-client.js'
];

const fail=msg=>{throw new Error(msg)};

for(const rel of runtimeFiles){
  const file=path.join(root,rel);
  if(!fs.existsSync(file))fail(`Required runtime file missing: ${rel}`);
  const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});
  if(result.status!==0){
    fail(`JavaScript syntax check failed for ${rel}: ${(result.stderr||result.stdout||'').trim()}`);
  }
}

const index=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
if(!index.includes('src="/api-client.js'))fail('Production frontend must load /api-client.js');
if(!index.includes('src="/app.js'))fail('Production frontend must load /app.js');
if(/<script>[ \t\r\n]*(?!src=)/i.test(index))fail('Production frontend contains an inline application script');

const app=fs.readFileSync(path.join(root,'public/app.js'),'utf8');
const api=fs.readFileSync(path.join(root,'public/api-client.js'),'utf8');
const server=fs.readFileSync(path.join(root,'src/server.js'),'utf8');
const sds=fs.readFileSync(path.join(root,'src/sds.js'),'utf8');

if(!app.includes("if(page==='settings')return renderSettings();"))fail('Settings must use its dedicated renderer');
if(!app.includes('async function renderSettings()'))fail('Dedicated Settings renderer is missing');
if(!app.includes("EWASCO_API.list('settings')"))fail('Settings renderer must read through the API');
if(!app.includes("EWASCO_API.update('settings'"))fail('Settings editor must update through the API');
if(!api.includes("login:(u,p)=>api('/auth/login'"))fail('Login API adapter is missing');
if(!api.includes("csrf().catch(()=>{})"))fail('CSRF client bootstrap is missing');

const apiMethods=new Set([...api.matchAll(/(?:^|[,{])[ \t\r\n]*([A-Za-z_$][A-Za-z0-9_$]*)[ \t\r\n]*:/g)].map(m=>m[1]));
const apiCalls=new Set([...app.matchAll(/EWASCO_API[.]([A-Za-z_$][A-Za-z0-9_$]*)/g)].map(m=>m[1]));
for(const name of apiCalls){
  if(!apiMethods.has(name))fail(`Frontend calls missing API adapter method: ${name}`);
}

const requiredRoutes=[
  "app.get('/api/records/:entity'",
  "app.get('/api/audit'",
  "app.get('/api/sds/:id/history'",
  "app.post('/api/sds/:id/file'",
  "app.get('/api/sds/:id/file/:version'",
  "app.delete('/api/sds/:id/file/:version'",
  "registerLimsRoutes({app,pool,auth,audit})"
];
for(const route of requiredRoutes){
  if(!server.includes(route))fail(`Required backend route/registration missing: ${route}`);
}

const frontendAdvertisesSdsImport=app.includes('EWASCO_API.sdsImport');
const backendProvidesSdsImport=server.includes("app.post('/api/sds/:id/import'")||sds.includes("app.post('/api/sds/:id/import'");
if(frontendAdvertisesSdsImport!==backendProvidesSdsImport){
  fail('SDS automatic-import frontend/backend contract is inconsistent');
}

console.log(JSON.stringify({
  ok:true,
  syntaxChecked:runtimeFiles.length,
  frontendApiCallsChecked:apiCalls.size,
  backendContractsChecked:requiredRoutes.length,
  sdsImportContractConsistent:true
}));
