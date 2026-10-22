import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import jwt from 'jsonwebtoken';
import pg from 'pg';

const databaseUrl=process.env.TEST_DATABASE_URL;
const root=fileURLToPath(new URL('../',import.meta.url));
const secret='ewasco-ci-jwt-secret-0123456789abcdef';
const skipReason=databaseUrl?false:'TEST_DATABASE_URL is not configured';

const runNode=(script,env={})=>new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,[script],{cwd:root,env:{...process.env,...env},stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';
  child.stdout.on('data',chunk=>stdout+=chunk);
  child.stderr.on('data',chunk=>stderr+=chunk);
  child.on('error',reject);
  child.on('close',code=>resolve({code,stdout,stderr}));
});

const freePort=()=>new Promise((resolve,reject)=>{
  const socket=net.createServer();
  socket.on('error',reject);
  socket.listen(0,'127.0.0.1',()=>{const {port}=socket.address();socket.close(()=>resolve(port))});
});

const waitForHealth=async(url,child,logs)=>{
  const deadline=Date.now()+15000;
  while(Date.now()<deadline){
    if(child.exitCode!==null)throw new Error(`Server exited with ${child.exitCode}: ${logs()}`);
    try{if((await fetch(`${url}/healthz`)).status===200)return}catch{}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw new Error(`Server did not become healthy: ${logs()}`);
};

const stop=async child=>{
  if(!child||child.exitCode!==null)return;
  child.kill('SIGTERM');
  await Promise.race([once(child,'exit'),new Promise(resolve=>setTimeout(resolve,5000))]);
  if(child.exitCode===null)child.kill('SIGKILL');
};

const quoteIdentifier=value=>`"${value.replaceAll('"','""')}"`;

test('PostgreSQL-backed deployment and transaction checks',{skip:skipReason,timeout:120000},async t=>{
  const parsed=new URL(databaseUrl);
  const databaseName=decodeURIComponent(parsed.pathname.slice(1));
  assert.match(databaseName,/test/i,'TEST_DATABASE_URL must reference a dedicated test database');
  const pool=new pg.Pool({connectionString:databaseUrl});

  try{
    await t.test('migration applies against PostgreSQL 16 and is idempotent',async()=>{
      for(let run=0;run<2;run++){
        const result=await runNode('src/migrate.js',{DATABASE_URL:databaseUrl});
        assert.equal(result.code,0,result.stderr||result.stdout);
      }
      const tables=await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name=ANY($1)",[['schema_migrations','records','reports','notifications']]);
      assert.deepEqual(new Set(tables.rows.map(row=>row.table_name)),new Set(['schema_migrations','records','reports','notifications']));
      assert.equal((await pool.query("SELECT to_regclass('public.lims_sample_number_seq') relation")).rows[0].relation,'lims_sample_number_seq');
      assert.equal((await pool.query("SELECT count(*)::int count FROM schema_migrations WHERE version='011-ewasco-lims-phase6-reporting-integrations'")).rows[0].count,1);
    });

    await t.test('failed migration rolls back earlier schema changes',async()=>{
      const rollbackDatabase=`ewasco_rollback_test_${crypto.randomUUID().replaceAll('-','').slice(0,12)}`;
      const maintenanceUrl=new URL(databaseUrl);maintenanceUrl.pathname='/postgres';
      const rollbackUrl=new URL(databaseUrl);rollbackUrl.pathname=`/${rollbackDatabase}`;
      const admin=new pg.Pool({connectionString:maintenanceUrl.toString()});
      let verification;
      try{
        await admin.query(`CREATE DATABASE ${quoteIdentifier(rollbackDatabase)}`);
        verification=new pg.Pool({connectionString:rollbackUrl.toString()});
        await verification.query('CREATE TABLE organizations(broken integer)');
        await verification.end();verification=null;
        const result=await runNode('src/migrate.js',{DATABASE_URL:rollbackUrl.toString()});
        assert.notEqual(result.code,0,'migration unexpectedly succeeded against an incompatible schema');
        verification=new pg.Pool({connectionString:rollbackUrl.toString()});
        assert.equal((await verification.query("SELECT to_regclass('public.schema_migrations') relation")).rows[0].relation,null);
        assert.equal((await verification.query("SELECT to_regclass('public.organizations') relation")).rows[0].relation,'organizations');
      }finally{
        if(verification)await verification.end();
        await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',[rollbackDatabase]);
        await admin.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(rollbackDatabase)}`);
        await admin.end();
      }
    });

    await t.test('seed-admin rolls back organization creation when user creation fails',async()=>{
      const existingOrganization=`CI Existing ${crypto.randomUUID()}`;
      const rolledBackOrganization=`CI Rollback ${crypto.randomUUID()}`;
      const username=`ci_${crypto.randomUUID().replaceAll('-','').slice(0,20)}`;
      const organization=await pool.query('INSERT INTO organizations(name) VALUES($1) RETURNING id',[existingOrganization]);
      await pool.query("INSERT INTO users(organization_id,username,password_hash,role) VALUES($1,$2,'unused','Administrator')",[organization.rows[0].id,username]);
      try{
        const result=await runNode('src/seed-admin.js',{DATABASE_URL:databaseUrl,ORG_NAME:rolledBackOrganization,ADMIN_USERNAME:username,ADMIN_PASSWORD:'Valid-Test-Password-123'});
        assert.notEqual(result.code,0,'seed-admin unexpectedly accepted a globally duplicated username');
        assert.equal((await pool.query('SELECT count(*)::int count FROM organizations WHERE name=$1',[rolledBackOrganization])).rows[0].count,0);
      }finally{
        await pool.query('DELETE FROM organizations WHERE id=$1',[organization.rows[0].id]);
      }
    });

    await t.test('seed-admin never resets or re-enables an existing administrator',async()=>{
      const organizationName=`CI Existing Admin ${crypto.randomUUID()}`;
      const username=`ci_existing_${crypto.randomUUID().replaceAll('-','').slice(0,20)}`;
      const oldPassword='Existing-Admin-Password-123';
      const organization=await pool.query('INSERT INTO organizations(name) VALUES($1) RETURNING id',[organizationName]);
      const oldHash=await (await import('bcryptjs')).default.hash(oldPassword,12);
      const inserted=await pool.query(
        "INSERT INTO users(organization_id,username,password_hash,role,disabled,failed_login_attempts,locked_until) VALUES($1,$2,$3,'Administrator',true,5,now()+interval '15 minutes') RETURNING id",
        [organization.rows[0].id,username,oldHash]
      );
      const userId=inserted.rows[0].id;
      const tokenHash=crypto.createHash('sha256').update(`ci-seed-session-${userId}`).digest('hex');
      await pool.query("INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 hour')",[userId,tokenHash]);

      try{
        const result=await runNode('src/seed-admin.js',{
          DATABASE_URL:databaseUrl,
          ORG_NAME:organizationName,
          ADMIN_USERNAME:username,
          ADMIN_PASSWORD:'New-Seed-Password-456'
        });
        assert.equal(result.code,0,result.stderr||result.stdout);
        assert.match(result.stdout,/admin_seed_skipped_existing/);
        const row=(await pool.query('SELECT password_hash,disabled,failed_login_attempts,locked_until FROM users WHERE id=$1',[userId])).rows[0];
        assert.equal(row.password_hash,oldHash);
        assert.equal(row.disabled,true);
        assert.equal(row.failed_login_attempts,5);
        assert.ok(new Date(row.locked_until)>new Date());
        assert.equal((await pool.query('SELECT count(*)::int count FROM sessions WHERE user_id=$1',[userId])).rows[0].count,1);
      }finally{
        await pool.query('DELETE FROM organizations WHERE id=$1',[organization.rows[0].id]);
      }
    });

    await t.test('stale record update returns its pooled connection idle',async()=>{
      const organizationId=crypto.randomUUID(),userId=crypto.randomUUID(),recordId=`CI-${crypto.randomUUID()}`;
      const appName=`ewasco_transaction_test_${crypto.randomUUID().replaceAll('-','').slice(0,12)}`;
      const serverDatabaseUrl=new URL(databaseUrl);serverDatabaseUrl.searchParams.set('application_name',appName);
      const token=jwt.sign({sub:userId,jti:crypto.randomUUID()},secret,{issuer:'ewasco',audience:'ewasco-web',expiresIn:'8h'});
      const tokenHash=crypto.createHash('sha256').update(token).digest('hex');
      await pool.query('INSERT INTO organizations(id,name) VALUES($1,$2)',[organizationId,`CI Transaction ${organizationId}`]);
      await pool.query("INSERT INTO users(id,organization_id,username,password_hash,role) VALUES($1,$2,$3,'unused','Administrator')",[userId,organizationId,`ci_${userId.replaceAll('-','').slice(0,20)}`]);
      await pool.query("INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 hour')",[userId,tokenHash]);
      await pool.query("INSERT INTO records(id,organization_id,entity,data) VALUES($1,$2,'chemicals',$3)",[recordId,organizationId,{id:recordId,name:'Original'}]);

      const port=await freePort(),uploadDir=await fs.mkdtemp(path.join(os.tmpdir(),'ewasco-ci-'));
      let stdout='',stderr='';
      const server=spawn(process.execPath,['src/server.js'],{cwd:root,env:{...process.env,DATABASE_URL:serverDatabaseUrl.toString(),JWT_SECRET:secret,CORS_ORIGIN:`http://127.0.0.1:${port}`,COOKIE_SECURE:'false',NODE_ENV:'test',PORT:String(port),DB_POOL_MAX:'1',UPLOAD_DIR:uploadDir},stdio:['ignore','pipe','pipe']});
      server.stdout.on('data',chunk=>stdout+=chunk);server.stderr.on('data',chunk=>stderr+=chunk);server.on('error',error=>stderr+=error.stack||error.message);
      const logs=()=>`${stdout}\n${stderr}`;

      try{
        const base=`http://127.0.0.1:${port}`;
        await waitForHealth(base,server,logs);
        const csrfResponse=await fetch(`${base}/api/auth/csrf`);
        assert.equal(csrfResponse.status,200);
        const {token:csrf}=await csrfResponse.json();
        const response=await fetch(`${base}/api/records/chemicals/${recordId}`,{method:'PUT',headers:{'Content-Type':'application/json','If-Match':'"99"','X-CSRF-Token':csrf,'Cookie':`ewasco_csrf=${csrf}; ewasco_session=${token}`},body:JSON.stringify({id:recordId,name:'Changed'})});
        assert.equal(response.status,409,await response.text());
        const activity=await pool.query('SELECT state FROM pg_stat_activity WHERE datname=current_database() AND application_name=$1',[appName]);
        assert.equal(activity.rowCount,1);
        assert.equal(activity.rows[0].state,'idle');
        const reusable=await fetch(`${base}/api/records/chemicals`,{headers:{Cookie:`ewasco_session=${token}`}});
        assert.equal(reusable.status,200,await reusable.text());
      }finally{
        await stop(server);
        await fs.rm(uploadDir,{recursive:true,force:true});
        await pool.query('DELETE FROM organizations WHERE id=$1',[organizationId]);
      }
    });
  }finally{
    await pool.end();
  }
});
