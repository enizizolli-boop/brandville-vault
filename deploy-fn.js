const fs = require('fs');
const code = fs.readFileSync('./supabase/functions/sync-odoo-status/index.ts', 'utf8');
const body = JSON.stringify({ body: code });
fs.writeFileSync('./fn_body.json', body, { encoding: 'utf8' });
console.log('Body written:', body.length, 'bytes, first 80 chars:', body.slice(0, 80));
