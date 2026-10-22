import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const root=process.cwd();
const requiredRuntimeFiles=[
  'src/server.js',
  'src/lims.js',
  'src/lims-phases.js',
  'src/permissions.js',
  'src/migrate.js',
  'src/seed-admin.js',
  'src/sds.js',
  'public/app.js',
  'public/api-client.js',
  'public/validators.js'
];

const fail=msg=>{throw new Error(msg)};

// A hardcoded list silently skips any file added later, so enumerate the tree
// as well: every module that can be loaded must parse.
const collectJs=(dir,out=[])=>{
  for(const entry of fs.readdirSync(path.join(root,dir),{withFileTypes:true})){
    const rel=path.join(dir,entry.name);
    if(entry.isDirectory())collectJs(rel,out);
    else if(/\.(js|mjs)$/.test(entry.name))out.push(rel);
  }
  return out;
};

const runtimeFiles=[...new Set([
  ...requiredRuntimeFiles,
  ...collectJs('src'),
  ...collectJs('public'),
  ...collectJs('test'),
  ...collectJs('scripts')
])];

for(const rel of requiredRuntimeFiles){
  if(!fs.existsSync(path.join(root,rel)))fail(`Required runtime file missing: ${rel}`);
}

for(const rel of runtimeFiles){
  const file=path.join(root,rel);
  const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});
  if(result.status!==0){
    fail(`JavaScript syntax check failed for ${rel}: ${(result.stderr||result.stdout||'').trim()}`);
  }
}

const index=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
if(!index.includes('src="/api-client.js'))fail('Production frontend must load /api-client.js');
if(!index.includes('href="/favicon.svg"'))fail('Production frontend must load the application favicon');
if(!index.includes('src="/validators.js'))fail('Production frontend must load /validators.js');
if(!index.includes('src="/app.js'))fail('Production frontend must load /app.js');
if(index.indexOf('src="/validators.js')>index.indexOf('src="/app.js'))fail('Validators must load before app.js');
const assetVersions=[...index.matchAll(/src="\/(?:validators|api-client|app)\.js\?v=([^"]+)"/g)].map(m=>m[1]);
if(assetVersions.length!==3)fail('All three production JavaScript assets must have explicit cache-version query strings');
if(new Set(assetVersions).size!==1)fail('Production JavaScript asset cache versions must match; bump all three together after frontend changes');
if(/<script>[ \t\r\n]*(?!src=)/i.test(index))fail('Production frontend contains an inline application script');

const app=fs.readFileSync(path.join(root,'public/app.js'),'utf8');
const validators=fs.readFileSync(path.join(root,'public/validators.js'),'utf8');
const api=fs.readFileSync(path.join(root,'public/api-client.js'),'utf8');
const server=fs.readFileSync(path.join(root,'src/server.js'),'utf8');
const sds=fs.readFileSync(path.join(root,'src/sds.js'),'utf8');

if(!app.includes("if(page==='settings')return renderSettings();"))fail('Settings must use its dedicated renderer');
if(!app.includes('async function renderSettings()'))fail('Dedicated Settings renderer is missing');
if(!app.includes("EWASCO_API.list('settings')"))fail('Settings renderer must read through the API');
if(!app.includes("EWASCO_API.update('settings'"))fail('Settings editor must update through the API');
for(const section of ['Configuration centre','Inventory and reagent controls','Water quality and analytical rules','Security, roles and governance','Service readiness']){
  if(!app.includes(section))fail(`Settings configuration-centre section missing: ${section}`);
}
if(!app.includes("fetch('/healthz'")||!app.includes("fetch('/readyz'"))fail('Settings readiness panel must check application and database readiness endpoints');

if(!validators.includes('EWASCO_VALIDATE'))fail('Browser validators are missing');
if(!app.includes('EWASCO_VALIDATE.isSdsFile'))fail('SDS file validation must use centralized validator');
if(!app.includes('EWASCO_VALIDATE.sdsFileError'))fail('SDS upload errors must identify the rejected file and supported formats');
if(!app.includes('EWASCO_VALIDATE.isCas'))fail('SDS CAS validation must use centralized validator');
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
const sdsImportOccurrences=sds.split("app.post('/api/sds/:id/import'").length-1;
const backendProvidesSdsImport=sdsImportOccurrences===1;
if(frontendAdvertisesSdsImport!==backendProvidesSdsImport){
  fail(`SDS automatic-import frontend/backend contract is inconsistent; backend route occurrences: ${sdsImportOccurrences}`);
}

console.log(JSON.stringify({
  ok:true,
  syntaxChecked:runtimeFiles.length,
  frontendApiCallsChecked:apiCalls.size,
  backendContractsChecked:requiredRoutes.length,
  sdsImportContractConsistent:true
}));
