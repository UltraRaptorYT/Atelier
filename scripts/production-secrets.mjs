import { loadEnvFile } from 'node:process';
import { createHmac } from 'node:crypto';
import { spawnSync } from 'node:child_process';
loadEnvFile('worker/.dev.vars.local');
const names = ['OPENAI_API_KEY', 'E2B_API_KEY', 'KEY_ENCRYPTION_KEYS'];
const secrets = Object.fromEntries(names.map(name => {
  if (!process.env[name]?.trim()) throw new Error(`Missing ${name} in worker/.dev.vars.local`);
  return [name, process.env[name].trim()];
}));
// Derive a separate service credential without writing another secret file.
const encryptionKey = Buffer.from(JSON.parse(secrets.KEY_ENCRYPTION_KEYS).v1, 'base64');
if (encryptionKey.length !== 32) throw new Error('Expected a 256-bit credential encryption key.');
secrets.SITES_PROXY_SECRET = createHmac('sha256', encryptionKey).update('atelier-sites-proxy-v1').digest('base64url');
const result = spawnSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'secret', 'bulk', '--config', 'worker/wrangler.jsonc', '--env', 'production'], {
  input: JSON.stringify(secrets), encoding: 'utf8', stdio: ['pipe', 'inherit', 'inherit'],
});
process.exitCode = result.status ?? 1;
