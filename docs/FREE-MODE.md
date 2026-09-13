# E2B Hobby setup with existing OpenAI API credits

The project uses the E2B Hobby tier for Blender workstations and existing **OpenAI API Platform credits** for model calls. E2B Hobby has no monthly subscription and includes a one-time $100 credit, but sandbox use is metered by the second and stops when that credit is exhausted unless billing is enabled. Keep generation and rendering disabled until credentials and the desktop template have been verified.

Connect an OpenAI project API key from the funded account through Atelier Settings. GPT-LIVE-1 uses the same API authentication but adds its own voice-session usage; Astra work delegated during a call is charged separately. Credits must remain available for the actual account/project and service. Do not assume a credit balance grants access to every model or prevents overage.

## What works now without service charges

Run the app and local Worker on your own computer. Local D1/R2 emulation stores projects and artifacts on disk. You can explore the studio and furnished sample, save project briefs and make the supported manual material edits. Clerk keys can remain blank for loopback development. This is a local preview, not an AI-generated result or a hosted remote desktop. Existing hardware, electricity and internet still have their usual costs.

```sh
npm ci
npm run setup:local
```

Then run `npm run worker:dev` and `npm run dev` in separate terminals. Open `http://127.0.0.1:3000`. The short frontend template is [../.env.example](../.env.example). Setup preserves existing secrets.

Add `E2B_API_KEY` to the generated `worker/.dev.vars.local`, then run `npm run desktop:build` once and `npm run desktop:benchmark` to verify the template. These scripts now load that ignored local file automatically. They create metered E2B resources, so do not repeat them unnecessarily.

## What the credits cover, and what remains separate

| Component | Cost constraint |
|---|---|
| GPT-6 Astra | Use the confirmed existing API Platform credits. Standard text pricing lists $10 per million input tokens and $50 per million output tokens, with separate cache and long-context rules. |
| GPT-LIVE-1 | $0.05 per minute of session duration, billed per second. Delegated Astra/model/tool usage is additional. Ten minutes is $0.50 for voice alone. |
| E2B desktops | Hobby has no base subscription, but compute is metered. Its advertised credit is one-time, not a recurring free compute allocation. |
| Sites | This account's included hosting allowance and eligibility remain unverified; do not promise free public hosting. |
| Cloudflare | Some services have free allowances; these are limited, and local compatibility is not proof that the complete production workload fits them. No remote resources are needed for the local preview. |

Sources checked on 2026-09-13: [Astra model/pricing](https://developers.openai.com/api/docs/models/gpt-6-astra), [Live model/pricing](https://developers.openai.com/api/docs/models/gpt-live-1), [E2B pricing](https://e2b.dev/pricing), [Cloudflare Durable Objects free limits](https://developers.cloudflare.com/durable-objects/platform/pricing/), [Cloudflare Workflows free limits](https://developers.cloudflare.com/workflows/reference/pricing/).

Do not treat a ChatGPT/Codex login as an application API key, or a trial credit as a promise of permanently free service. Even with user-provided keys, OpenAI usage costs money to the owner of that key.

## Recommended compute path

Use Blender inside E2B as the canonical compiler and renderer. The existing JSON → Blender → GLB pipeline, asset registration, checkpoints and render validation already use this path. Stop workstations promptly and leave billing disabled if the one-time Hobby credit is a hard limit. Spline can remain an optional manual asset-authoring tool; it is not required for click-to-walk or runtime interaction.

## A future fully local alternative

To add automated design and speech without metered APIs, replace the OpenAI calls with a locally runnable model and local speech components, and replace E2B with an isolated local Blender job runner. Keep generated files on local disk/SQLite or local object storage. Text-only interaction is a smaller first step than local full-duplex voice.

This would be an alternative if the API credits run out, not the current recommendation. It requires new provider adapters, hardware benchmarks and desktop isolation. It is **not implemented**, cannot provide the exact hosted Astra or GPT-LIVE-1 models, and does not guarantee equivalent quality or speed. The current source retains the exact models previously requested instead of silently substituting them.

A local computer can supply compute for a later hosted frontend, but it must stay online, authenticate each job, isolate execution and securely connect to that frontend. Do not expose a raw Docker socket, filesystem, local inference server or unauthenticated desktop to the internet. Public traffic cannot be promised unlimited free compute on one personal computer.
