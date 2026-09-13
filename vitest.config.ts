import { defineConfig } from 'vitest/config';
import { readFileSync } from 'node:fs';
export default defineConfig({
  // Match Wrangler's Text module rules when testing real Worker modules.
  plugins: [{ name: 'worker-text-assets', enforce: 'pre', load(id) {
    if (/\.(py|md)$/.test(id)) return `export default ${JSON.stringify(readFileSync(id, 'utf8'))};`;
  } }],
  test: { include: ['tests/**/*.test.ts'], testTimeout: 30000, hookTimeout: 60000, fileParallelism: false },
  resolve: { alias: { '@': import.meta.dirname } },
});
