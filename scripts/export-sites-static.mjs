import { cp, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';

await rm('out', { recursive: true, force: true });
await mkdir('out/_next', { recursive: true });
await cp('.next/server/app/index.html', 'out/index.html');
await cp('.next/server/app/_not-found.html', 'out/404.html');
await cp('.next/static', 'out/_next/static', { recursive: true });
if (existsSync('public')) await cp('public', 'out', { recursive: true, force: true });
