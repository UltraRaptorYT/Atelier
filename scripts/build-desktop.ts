import { Template } from '@e2b/desktop';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';

if (existsSync('worker/.dev.vars.local')) loadEnvFile('worker/.dev.vars.local');
if (!process.env.E2B_API_KEY) throw new Error('Set E2B_API_KEY locally before building the desktop template.');
const template = Template().fromTemplate('desktop').runCmd('apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y blender python3 python3-pip mousepad && apt-get clean', { user: 'root' });
await Template.build(template, 'atelier-desktop', { apiKey: process.env.E2B_API_KEY });
console.log('Atelier desktop template built. Benchmark it before enabling public rendering.');
