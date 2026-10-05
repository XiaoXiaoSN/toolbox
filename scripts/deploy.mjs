import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const configPath = 'wrangler.production.json';
const config = JSON.parse(readFileSync(configPath, 'utf8'));
if (!config.d1_databases?.[0]?.database_id || config.d1_databases[0].database_id === '00000000-0000-0000-0000-000000000000') {
  throw new Error('Configure a real D1 database before deploying.');
}
for (const args of [
  ['d1', 'migrations', 'apply', 'DB', '--remote', '--config', configPath],
  ['deploy', '--config', configPath],
]) {
  const result = spawnSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', ...args], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log('Deployment uploaded. Set API_TOKEN with wrangler secret put if not already configured; the API fails closed without it.');
