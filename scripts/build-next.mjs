import { spawnSync } from 'node:child_process';

// Public auth flags are frozen into client bundles. A Next server uses Clerk;
// only the separately packaged Sites adapter can provide ChatGPT sign-in.
const result = spawnSync(process.execPath, ['node_modules/next/dist/bin/next', 'build', ...process.argv.slice(2)], {
  stdio: 'inherit', env: { ...process.env, NEXT_PUBLIC_ATELIER_SITES_AUTH: 'false' },
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
