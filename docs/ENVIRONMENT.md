# Atelier environment setup

The local preview needs no external keys. Live generation uses existing OpenAI API Platform credits and E2B Hobby sandboxes. The frontend [`.env.example`](../.env.example) is intentionally short; Worker secrets belong in `worker/.dev.vars.local`.

Use two local files. They already exist in this workspace; edit them without replacing the generated encryption key. Both are git-ignored. Restart Next.js and the Worker after editing.

## 1. Next.js: `.env.local` in the project root

```dotenv
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_your_clerk_publishable_key
CLERK_SECRET_KEY=sk_test_your_clerk_secret_key
ATELIER_WORKER_URL=http://127.0.0.1:8787
```

Get the first two values from the same Clerk application. Leave them empty to use the single-owner local preview at `http://127.0.0.1:3000`. Authentication is required for a public deployment. Only the publishable Clerk key is public.

## 2. Cloudflare Worker: `worker/.dev.vars.local`

```dotenv
CLERK_SECRET_KEY=sk_test_the_same_clerk_secret_key
E2B_API_KEY=your_e2b_api_key
KEY_ENCRYPTION_KEYS='{"v1":"KEEP_THE_EXISTING_GENERATED_VALUE"}'
```

The example above shows the format; **do not paste the placeholder over your existing encryption key**. `npm run setup:local` generates 32 random bytes when this file is missing and preserves an existing file. This key encrypts saved user credentials. Losing it makes those credentials unreadable; users would need to reconnect their OpenAI keys.

`CLERK_JWT_KEY` is an optional PEM public verification key, supported as an alternative to the Worker Clerk secret. It can stay empty when `CLERK_SECRET_KEY` is configured. E2B is required for remote workstations and design runs; voice itself does not create a desktop.

The desktop build/benchmark scripts automatically load `worker/.dev.vars.local`:

```sh
npm run desktop:build
npm run desktop:benchmark
```

Those commands consume E2B compute; run them only when your account and budget are ready.

## 3. OpenAI: connect the key in Atelier Settings

Create an OpenAI project API key with access to `gpt-6-astra`, `gpt-live-1`, Responses, and Live sessions. Open Atelier → Settings → connect your OpenAI key. One normal project key authenticates both models; there is no separate Astra-specific key. API usage is billed to that OpenAI project.

Users can supply their own key in Settings; the Worker verifies and encrypts it in D1. An optional `OPENAI_API_KEY` Worker secret supplies an environment fallback when the user has no saved key. Neither key is returned to the browser or passed into an E2B sandbox. Do not put it in a `NEXT_PUBLIC_*` variable or paste it into chat. Saving a key verifies authentication, not every model permission; a real design/voice request is still needed to verify access.

## 4. Models and feature gates: `worker/wrangler.jsonc`

These are already set in each environment's `vars` block:

```json
"OPENAI_MODEL": "gpt-6-astra",
"OPENAI_REASONING_EFFORT": "max",
"VOICE_MODEL": "gpt-live-1",
"GENERATION_ENABLED": "false",
"RENDER_ENABLED": "false",
"KEY_VERSION": "v1",
"E2B_TEMPLATE": "atelier-desktop"
```

Astra uses Responses for the four specialists and the delegated voice tools. GPT-Live handles native speech and transcript deltas over WebRTC; no separate Whisper/STT/TTS service or key is needed. The design team uses explicit `max` reasoning for planning, architectural modeling, interior work, visual review, and conflict resolution. `max` is Astra’s highest documented API effort; `ultra` is not a supported Responses API value. Conversation routing, the initial clarification meeting, and brief normalization keep their existing API-default behavior; voice delegation uses `low`. Higher reasoning effort may take longer and use more tokens; it does not replace the canonical geometry contract or rendered checks.

Keep generation and render gates false until setup is complete. The current generation workflow requires the verified E2B desktop template. Voice uses no E2B desktop but incurs GPT-LIVE-1 session usage plus any delegated Astra calls. Check the running `/capabilities` response for actual feature gates and `runtimeProfile` model/effort settings; local CLI overrides can differ from checked-in defaults. Each new run saves `generation-profile.json` so the actual configuration can be compared with the deployed Worker. These fingerprints are diagnostic evidence, not proof of matching generated quality or provider access.

Structured calls through `modelJSON` have a 64,000-token per-response allowance, including reasoning and visible output, defined by `MODEL_MAX_OUTPUT_TOKENS` in [model-settings.ts](../worker/src/model-settings.ts). Agent instructions and reasoning settings are preserved. Task and request deadlines remain separate limits. Runtime profile version 2 records this allowance in `limits.modelOutputTokens`. Incomplete responses distinguish token exhaustion, content filtering and an unspecified incomplete result; server diagnostics record the response ID, reason and token counts without logging prompts or generated content. **Retry team briefing** starts a new attempt in the same project using its saved brief and answers; the failed attempt remains in history.

## 5. Vercel and Cloudflare deployment

On Vercel, enter the three Next.js variables in the project's environment settings. Use production Clerk credentials and set `ATELIER_WORKER_URL` to the deployed Worker URL. Keep preview/staging and production values separate.

On Cloudflare, store `CLERK_SECRET_KEY`, `E2B_API_KEY`, and `KEY_ENCRYPTION_KEYS` as **Worker secrets** for the selected environment. `CLERK_JWT_KEY` remains optional. Use an independent encryption key for each environment. D1/R2 IDs and bindings, `APP_ORIGIN`, models, and feature gates belong in the matching Wrangler environment. D1 and R2 use bindings, so the app does not need `DATABASE_URL` or an R2 access key.

No Vercel or Cloudflare deployment token belongs in the browser or the app env files. CLI authentication is separate. The production resources recorded in Wrangler have been provisioned; verify the target bindings and migrations before deployment. The resource/cost review in [DEPLOYMENT.md](DEPLOYMENT.md) still applies.

Documentation checked before migration: [GPT-6 Astra](https://developers.openai.com/api/docs/models/gpt-6-astra), [Astra migration](https://developers.openai.com/api/docs/guides/latest-model/gpt-6-astra.md#migration-quickstart), [Live WebRTC](https://developers.openai.com/api/docs/guides/voice-webrtc?api=live), [Live migration](https://developers.openai.com/api/docs/guides/live-migration), [Live delegation](https://developers.openai.com/api/docs/guides/live-delegation), [Live lifecycle](https://developers.openai.com/api/docs/guides/live-conversations).
