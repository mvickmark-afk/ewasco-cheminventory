import 'dotenv/config';
import bcrypt from 'bcryptjs';
import pg from 'pg';

const username=(process.env.ADMIN_USERNAME||'admin').trim().toLowerCase();
const password=process.env.ADMIN_PASSWORD;
if(!password||password.length<12||password.startsWith('SET_'))throw Error('Set a unique ADMIN_PASSWORD of at least 12 characters');

const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
const client=await pool.connect();

try{
  await client.query('BEGIN');

  const orgName=process.env.ORG_NAME||'EWASCO';
  const orgResult=await client.query(
    `INSERT INTO organizations(name)
     VALUES($1)
     ON CONFLICT(name) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [orgName]
  );

  const organizationId=orgResult.rows[0].id;
  const existingUser=await client.query(
    `SELECT id, username, disabled, failed_login_attempts, locked_until
     FROM users
     WHERE organization_id=$1 AND username=$2
     FOR UPDATE`,
    [organizationId, username]
  );

  const passwordHash=await bcrypt.hash(password,12);

  if(existingUser.rowCount){
    await client.query(
      `UPDATE users
       SET password_hash=$1,
           role='Administrator',
           disabled=false,
           failed_login_attempts=0,
           locked_until=NULL,
           password_changed_at=now()
       WHERE id=$2`,
      [passwordHash, existingUser.rows[0].id]
    );
  }else{
    await client.query(
      `INSERT INTO users(organization_id,username,password_hash,role,disabled,password_changed_at)
       VALUES($1,$2,$3,'Administrator',false,now())`,
      [organizationId, username, passwordHash]
    );
  }

  await client.query('COMMIT');
  console.log(JSON.stringify({event:'admin_seed_verified',organization:orgName,username,updatedExisting:Boolean(existingUser.rowCount)}));
}catch(error){
  await client.query('ROLLBACK').catch(()=>{});
  throw error;
}finally{
  client.release();
  await pool.end();
}
