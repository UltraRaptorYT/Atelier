import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync, copyFileSync } from 'node:fs';
const file = new URL('../worker/.dev.vars.local', import.meta.url);
if (!existsSync(file)) {
  writeFileSync(file, `# Local Worker secrets; OpenAI keys are connected in Atelier Settings.\nCLERK_SECRET_KEY=\nCLERK_JWT_KEY=\nE2B_API_KEY=\nKEY_ENCRYPTION_KEYS='${JSON.stringify({v1:randomBytes(32).toString('base64')})}'\n`, { mode: 0o600 });
  console.log('Created a local credential-encryption key. No external credentials were generated.');
} else console.log('Preserved existing local secrets.');
const nextEnv = new URL('../.env.local', import.meta.url);
if (!existsSync(nextEnv)) {
  copyFileSync(new URL('../.env.example', import.meta.url), nextEnv);
  console.log('Created the Next.js environment template with empty Clerk credentials.');
}
