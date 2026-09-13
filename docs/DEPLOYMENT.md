# Deployment and resource review

## Current deployment status: 2026-09-13

The user has requested local testing first; the deployment was set up from a
friend's machine. Do not publish or require deployment login for local
verification. `wrangler dev --env local` emulates Cloudflare services locally;
live generation still uses the configured OpenAI and E2B services.

The existing frontend is hosted at
<https://atelier-architecture-studio.z3e0.chatgpt.site>, with API Worker
<https://atelier-api-production.ultraraptor.workers.dev>. Reuse the Sites project
ID recorded in [`.openai/hosting.json`](../.openai/hosting.json). The resource
proposal below is historical; do not recreate resources from it.

A read-only check found the public frontend and Worker reachable, but the Worker
did not expose the new runtime profile and the frontend bundle lacked the recent
connection/recovery changes. This is evidence that the local updates still need
deployment. It does not establish the deployed model or reasoning effort.
The Sites connector could not access the recorded project, and local Cloudflare
deployment authentication was unavailable. An account/workspace mismatch is a
possible cause of the Sites access failure, not a confirmed diagnosis.

To restore access, use the ChatGPT account/workspace that can edit the existing
Atelier Site at <https://chatgpt.com/sites>. For Cloudflare, run
`npx wrangler login` in this repository and complete authentication with the
account owning `atelier-api-production`; `npx wrangler whoami` verifies the
result. Login alone does not deploy. Keep credentials out of messages and Git.

After access is available, inspect production migrations and bindings, apply
the required migrations before publishing the new Worker, and build the matching
frontend with `npm run build:sites`. This writes the deployment package to `dist`;
`npm run build` produces the separate standard Next application. Push the exact
source revision before saving/publishing a Sites version. Preserve the existing
Site ID, audience and secrets. A real signed-in browser journey through the Site
is still required; direct backend tests do not verify its authentication adapter.

The latest local Astra/max verification failed in planning before creating any
workstation leases or geometry. Its temporary run-specific allowance was removed.
See [the diagnostic record](model-quality-diagnosis.md#live-astra-verification-stopped-before-delegation).

## Historical resource proposal

**Superseded budget:** the user now requires free infrastructure and has confirmed existing OpenAI API Platform credits for Astra. The paid beta estimate and provisioning steps below are historical options, not the active execution plan. Follow [FREE-MODE.md](FREE-MODE.md); OpenAI credits do not authorize paid hosting or E2B compute.

Prepared before provisioning on 2026-09-13. The user requested a resource/cost
review before creating services. Later approved provisioning and deployment
supersede that initial status; check the current configuration and account state
before any further resource changes.

**Hosting update:** [Sites and Blender compute assessment](SITES-AND-COMPUTE.md) evaluates Sites as an alternative frontend host. The Vercel instructions and estimate below remain the existing baseline until that migration is validated and Sites account allowances are confirmed. Backend storage and E2B compute stay separate in either option.

## Exact resources

| Resource | Staging | Production |
|---|---|---|
| Vercel project | `atelier` preview environment | `atelier` production environment |
| Cloudflare Worker | `atelier-api-staging` | `atelier-api-production` |
| D1 database | `atelier-staging` | `atelier-production` |
| Private R2 standard bucket | `atelier-artifacts-staging` | `atelier-artifacts-production` |
| Workflow | `atelier-jobs-staging` | `atelier-jobs-production` |
| Project Durable Object class | `ProjectCoordinator`, one instance/project | Separate namespace, one instance/project |
| Compute Durable Object class | `ComputeBudget`, instance `desktop-budget` | Separate namespace, instance `desktop-budget` |
| API burst limiter | `API_LIMIT`, namespace `927302` | `API_LIMIT`, namespace `927303` |
| Clerk application | `Atelier` development instance | Its separate production instance |
| E2B template | `atelier-desktop`, default 2 vCPU / 4 GiB | Same tested template/version |

Check names and rate-limit namespace IDs against the chosen accounts before creating them. No custom domain, Spline paid plan, E2B Pro upgrade, payment service, public bucket or public desktop endpoint is requested.

**Only one environment may admit desktop work at a time during this beta.** Turn staging generation OFF and let its leases finish before enabling production. The environment budget namespaces are intentionally isolated; enabling both would double the application allowance. Staging/benchmark runtime must be counted inside the same E2B $35 account allowance.

## Monthly estimate

| Service | Estimated small-beta spend | Reserved allowance |
|---|---:|---:|
| Vercel, one Pro seat | $20–30 | $30 |
| Cloudflare, including D1/R2/DO/Workflows | $5–15 | $15 |
| E2B default desktop compute, up to 200 hours | $33.12 | $35 |
| Clerk within free allowance | $0 | $0 |
| Headroom | — | $20 |
| Total | approximately **$58–78** | **$100** |

Vercel lists Pro at $20/month plus applicable usage. [Vercel pricing](https://vercel.com/pricing)

Cloudflare Workers Paid has a $5 account subscription component. Low-volume database, object coordination and Workflow use should fit included allowances; this estimate reserves extra usage. [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)

R2 standard storage includes 10 GB-month free, then $0.015/GB-month, with separately metered operations and free egress. This does not eliminate Vercel proxy transfer/compute costs. [R2 pricing](https://developers.cloudflare.com/r2/pricing/)

E2B's published default compute is $0.000028/s for 2 vCPU plus $0.000018/s for 4 GiB, or $0.1656/hour. 200 hours costs $33.12. A full 15-minute reservation is about $0.0414. Hobby has no base subscription and sessions up to one hour, but the account must confirm continued pay-as-you-go eligibility after its one-time credit. **The $150/month Pro plan is outside this plan.** [E2B pricing](https://e2b.dev/pricing)

Clerk's free tier currently includes 50,000 monthly retained users. Keep free features only. [Clerk pricing](https://clerk.com/pricing)

These are estimates, not a provider-enforced $100 cap. They exclude tax, domains and each user's OpenAI charges. Unrestricted signup/traffic cannot be guaranteed under this budget. Configure provider usage alerts and spending controls where available; do not enable automatic upgrades.

## Account setup required

1. Sign in to Vercel CLI with `npx vercel login`, select the intended team and link the `atelier` project. Vercel was not authenticated during implementation.
2. Create/configure the Clerk application. Add the exact localhost, staging and production origins. Use environment-specific credentials. Set `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` on Vercel; set Clerk verification configuration on the corresponding Worker.
3. Configure E2B Hobby credentials and verify billing. Build `atelier-desktop`, then execute the benchmark. Place `E2B_API_KEY` only in trusted local/Worker secret storage.
4. Create a different 32-byte random AES key for staging and production. Store each as the secret `KEY_ENCRYPTION_KEYS`, JSON such as `{"v1":"<base64 key>"}`. Never print real keys, put them in source control, or reuse the local developer key in production.

## Provision after the resource review

Use `worker/wrangler.jsonc`. Provision the staging D1 and R2 resources first, fill its returned database ID, and set its exact Vercel preview origin. The production section deliberately contains `REPLACE_AFTER_PROVISIONING`; do not deploy placeholders.

```sh
npx wrangler d1 create atelier-staging
npx wrangler r2 bucket create atelier-artifacts-staging
npx wrangler d1 migrations apply atelier-staging --remote --config worker/wrangler.jsonc --env staging
npx wrangler secret put CLERK_SECRET_KEY --config worker/wrangler.jsonc --env staging
npx wrangler secret put E2B_API_KEY --config worker/wrangler.jsonc --env staging
npx wrangler secret put KEY_ENCRYPTION_KEYS --config worker/wrangler.jsonc --env staging
npx wrangler deploy --config worker/wrangler.jsonc --env staging
```

Use the created Worker URL as Vercel's `ATELIER_WORKER_URL`. Deploy the Next application with `npx vercel` for preview. Configure all Vercel variables before rebuilding so the Clerk public key is included.

Complete [verification](VERIFICATION.md) on staging. For production, create the separately named D1/bucket, apply its migrations, use separate secrets, set its production origin, and deploy with `--env production`. Deploy Next with `npx vercel --prod`. Keep both `GENERATION_ENABLED` and `RENDER_ENABLED` false until their gates pass. Rendering has its own gate; a failed benchmark must not trigger an upgrade or a substitute render.

## Operations

- Turn `GENERATION_ENABLED` false and redeploy to stop new generation/voice admission. Cancel active runs through the authenticated UI and confirm E2B shutdown when an immediate stop is required; already-running Workflow versions can retain their original environment snapshot.
- Admission reserves a bounded workstation allowance. Confirmed release records actual elapsed use; an unconfirmed shutdown retains its conservative reservation until expiry. Check the current lease ledger instead of estimating daily usage from the number of reservations.
- Idle desktops shut down after two minutes without work/viewer heartbeat. A failed kill retains its slot until the provider timeout. No job extends a desktop beyond its bounded lease.
- Set alerts at approximately 50%, 80% and 95% of the service allowances. Check actual E2B billing against reserved usage. Keep Vercel usage controls and account notifications enabled.
- R2 buckets stay private. Do not enable `r2.dev` or public custom domains. Artifact and desktop URLs are returned only after ownership checks.
- Export D1/back up R2 before schema changes. Keep historical AES key versions until all stored credentials have been re-encrypted or removed.
- Never delete a previous revision because a render/upload failed. Cancelled or stale proposals cannot move the current revision pointer. Failed proposal uploads can leave unreferenced objects; review and garbage-collect only objects absent from all D1 references.
