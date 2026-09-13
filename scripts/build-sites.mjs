import { spawnSync } from 'node:child_process';
import { cp, mkdir, rm } from 'node:fs/promises';
import { build } from 'esbuild';

const result = spawnSync(process.execPath, ['node_modules/next/dist/bin/next', 'build'], {
  stdio: 'inherit', env: { ...process.env, NEXT_PUBLIC_ATELIER_SITES_AUTH: 'true', NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: '' },
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);
await import('./export-sites-static.mjs');
await rm(new URL('../dist/', import.meta.url), { recursive: true, force: true });
await mkdir('dist/server', { recursive: true });
await cp('out', 'dist/client', { recursive: true });
await build({ entryPoints: ['sites/index.ts'], outfile: 'dist/server/index.js', bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true });
await mkdir('dist/.openai', { recursive: true });
await cp('.openai/hosting.json', 'dist/.openai/hosting.json');
