import { readFileSync, writeFileSync } from 'node:fs';
const id = process.argv[2] || process.env.D1_DATABASE_ID;
if (!id || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id) || /^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(id)) {
  throw new Error('Usage: npm run configure -- <real D1 database UUID>');
}
const config = JSON.parse(readFileSync('wrangler.json', 'utf8'));
config.d1_databases[0].database_id = id;
writeFileSync('wrangler.production.json', `${JSON.stringify(config, null, 2)}\n`, { flag: 'wx' });
console.log('Created wrangler.production.json. Review it before deployment; no remote resources were changed.');
