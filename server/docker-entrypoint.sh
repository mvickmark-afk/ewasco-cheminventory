#!/bin/sh
set -eu
node -e "const net=require('net'),u=new URL(process.env.DATABASE_URL),s=net.createConnection({host:u.hostname,port:u.port||5432});s.on('connect',()=>{s.end();process.exit(0)});s.on('error',()=>process.exit(1))"
node src/migrate.js
if [ "${SEED_ADMIN:-false}" = "true" ]; then node src/seed-admin.js; fi
exec node src/server.js
