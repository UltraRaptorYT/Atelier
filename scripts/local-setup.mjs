import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
const file = new URL('../worker/.dev.vars.local', import.meta.url);
if (!existsSync(file)) {
  writeFileSync(file, `KEY_ENCRYPTION_KEYS='${JSON.stringify({v1:randomBytes(32).toString('base64')})}'\n`, { mode: 0o600 });
  console.log('Created a local credential-encryption key. No external credentials were generated.');
} else console.log('Preserved existing local secrets.');
