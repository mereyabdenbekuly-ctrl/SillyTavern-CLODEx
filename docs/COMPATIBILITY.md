# Contract audit — 2026-11-11

## Primary references

- SillyTavern release 1.19.0, commit `7e8663cd9c184a550b37238218bdd32c6efc68e9`:
  https://github.com/SillyTavern/SillyTavern/tree/7e8663cd9c184a550b37238218bdd32c6efc68e9
- User-provided design references (examined, not imported as dependencies/copied):
  - https://github.com/niemandswasser/sillywardrobe3-0 at `e75814dc4dc45d91a0d4f4a812f1dcb507b8110a`
  - https://github.com/0xl0cal/sillyimages at `2c5ef77ecd4f59d817c54479ed9e3cfa12283cf4`

The reference extensions informed modular layout, message actions and per-character
scene-generation UX. Implementation is independent and calls only CLODEx plus the
user's existing SillyTavern server. No reference extension/server patches are required.

## SillyTavern interfaces checked in upstream source

| Source | Interface used |
| --- | --- |
| `public/scripts/st-context.js` | `SillyTavern.getContext`, settings, events, slash commands, function tools, chat save and rendering |
| `public/script.js` | `generateQuietPrompt({ quietPrompt, skipWIAN, quietToLoud, responseLength })`, `updateMessageBlock`, native media arrays |
| `public/scripts/extensions.js` | Awaited `hooks.activate` / `hooks.disable`; order 5 precedes built-in TTS order 10 |
| `public/scripts/extensions/tts/index.js` | `registerTtsProvider`, provider Responses, voice maps, native `/speak` and safe preview metadata |
| `public/scripts/constants.js` | String media types `image`, `video`, `audio`; `media_display=list` |
| `public/scripts/extensions/stable-diffusion/index.js` | Native media attachment shape, function-tool registration and persistence |
| `public/scripts/openai.js` | Custom OpenAI URL/model/source controls and settings |
| `public/scripts/secrets.js` | `writeSecret('api_key_custom', key, label)`; active secret reuse |
| `src/endpoints/files.js` | Same-origin CSRF-protected `POST /api/files/upload { name, data } → { path }` |
| `src/endpoints/extensions.js` | Git-clone installer; not a manifest-URL installer |
| `src/middleware/corsProxy.js` | Public-metadata workaround; proxy serializes JSON and is not used for multipart |

SillyTavern secrets cannot generally be read back without `allowKeysExposure`.
This extension does **not** require or enable it. Version 0.3.0 optionally remembers
the media key in unencrypted profile extension settings, with an adjacent warning
and a tab-only opt-out. Native Secrets are written only on text activation.

## CLODEx interfaces checked in the existing source

| Endpoint | Contract |
| --- | --- |
| `GET /v1/models` | `data[]` IDs; only this list grants catalog availability |
| `GET /api/usage/token/` | `{ code, data: { total_available, unlimited_quota, expires_at, wallet_balance_quota, wallet_balance_usd, wallet_balance_rub, quota_per_unit, usd_to_rub } }`; deployed wallet fields are additive |
| `GET /api/status` | `data.quota_per_unit`, custom currency symbol/rate |
| `GET /api/pricing` | `data[].model_name`, `supported_endpoint_types`, fixed-total or ratio prices and cache fields |
| `POST /v1/images/generations` | `{ model, prompt, n: 1, size?, quality? }`; `data[0].b64_json` or `.url` |
| `POST /v1/videos` | JSON common task interface; optional string seconds and image data URL |
| `GET /v1/videos/:id` | OpenAI-style `id,status,progress`; legacy `task_id`/`succeeded` accepted |
| `GET /v1/videos/:id/content` | Authenticated video bytes; no direct-delivery/download query needed |
| `POST /v1/audio/speech` | `{ model, input, voice, response_format: 'mp3' }`; audio bytes |
| `GET /v1/audio/voices` | model/search/page/page_size → voices, has_more; unsupported model returns 400, manual voice remains possible |
| `POST /v1/audio/transcriptions` | Multipart file/model; JSON text |

Source audit locations in the CLODEx monorepo: `router/relay-router.go`,
`router/video-router.go`, `router/api-router.go`, `controller/token.go`,
`controller/misc.go`, `controller/pricing.go`, `model/pricing.go`,
`dto/openai_video.go`, `dto/video.go`, `controller/video_proxy.go` and
`relay/channel/task/artlist/request.go` under `deploy/new-api-src/new-api/`.

Narrow read-only CORS and wallet fields were deployed on November 11, 2026.
Authenticated wallet queries remain owner-bound. No session/admin endpoints are
opened by this rule. No paid generation probes were performed.

`data.video_billing` version 1 describes current server billing:
`funding_source=paid_wallet`, `promotional_balance_eligible=false`,
`free_generation_available=false`, `paid_balance_usd=max(total-promo,0)/quota_per_unit`.
It matches `service/billing_session.go` and reads a consistent `model.GetWalletQuota`
snapshot. The extension neither changes billing nor grants promotional attempts.

## Verification boundary

- Node unit tests: transport/redaction, pricing/currency semantics, media safety,
  chat/swipe races, duplicate POST prevention, cancellation/resume, recording
  permission/size/time limits, native TTS lifecycle and safe voice metadata.
- Isolated browser harness: real extension modules, fake host context/API, native
  MP4 decoding, serialization, microphone and native-provider registration adapter.
- Installed SillyTavern 1.19.0: real character/settings/Secrets/files/chat APIs,
  actual image/video/audio renderer, native voice map and `/speak`, ToolManager,
  fake-device microphone, RU/EN, F5 key/provider restoration and disable lifecycle.
  Every external HTTPS request is intercepted; CLODEx responses are mocked and
  other upstream requests are blocked. No real credentials or paid calls.

The host test runner is `tests/installed-host.mjs`. Use an isolated loopback profile
with first-run onboarding completed, and point `PLAYWRIGHT_MODULE` / `CHROME_PATH`
at local test dependencies. Never point it at a real user's profile.

This is a **public preview**, not certification of all deployed models. Before a
stable release verify streaming RP, full LLM-driven tools, model-specific media
parameters and one owner-approved paid generation per advertised provider family.
See [ROADMAP.md](ROADMAP.md). Git installation accepts the repository URL only;
manifest/ZIP domain mirrors are downloads, not a substitute for Git auto-updates.
