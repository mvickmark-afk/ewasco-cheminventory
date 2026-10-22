import 'dotenv/config';
import bcrypt from 'bcryptjs';
import pg from 'pg';

const username=(process.env.ADMIN_USERNAME||'admin').trim().toLowerCase();
const password=process.env.ADMIN_PASSWORD;
const orgName=process.env.ORG_NAME||'EWASCO';

if(!password||password.length<12||password.startsWith('SET_')) {
  throw Error('Set a unique ADMIN_PASSWORD of at least 12 characters');
}

const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
const client=await pool.connect();

try {
  await client.query('BEGIN');
  const org=await client.query(
    'INSERT INTO organizations(name) VALUES($1) ON CONFLICT(name) DO UPDATE SET name=EXCLUDED.name RETURNING id',
    [orgName]
  );
  const organizationId=org.rows[0].id;
  const existing=await client.query(
    'SELECT id, username FROM users WHERE organization_id=$1 AND lower(username)=lower($2) FOR UPDATE',
    [organizationId,username]
  );

  if(existing.rowCount) {
    // Startup seeding must never silently reset a password, clear a lockout,
    // re-enable a disabled account, or leave an old session valid.
    await client.query('COMMIT');
    console.log(JSON.stringify({event:'admin_seed_skipped_existing',organization:orgName,username}));
  } else {
    const hash=await bcrypt.hash(password,12);
    await client.query(
      "INSERT INTO users(organization_id,username,password_hash,role,disabled,password_changed_at) VALUES($1,$2,$3,'Administrator',false,now())",
      [organizationId,username,hash]
    );
    await client.query('COMMIT');
    console.log(JSON.stringify({event:'admin_seed_created',organization:orgName,username}));
  }
} catch(error) {
  await client.query('ROLLBACK').catch(()=>{});
  throw error;
} finally {
  client.release();
  await pool.end();
}
