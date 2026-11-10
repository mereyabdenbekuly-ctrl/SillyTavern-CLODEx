# Contract audit — 2026-11-10

## Primary references

- SillyTavern release 1.19.0, commit `06bde939fb1e9c4c8d8641d810f0a916b5bce127`:
  https://github.com/SillyTavern/SillyTavern/tree/06bde939fb1e9c4c8d8641d810f0a916b5bce127
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
| `public/scripts/constants.js` | String media types `image`, `video`, `audio`; `media_display=list` |
| `public/scripts/extensions/stable-diffusion/index.js` | Native media attachment shape, function-tool registration and persistence |
| `public/scripts/openai.js` | Custom OpenAI URL/model/source controls and settings |
| `public/scripts/secrets.js` | `writeSecret('api_key_custom', key, label)`; active secret reuse |
| `src/endpoints/files.js` | Same-origin CSRF-protected `POST /api/files/upload { name, data } → { path }` |
| `src/endpoints/extensions.js` | Git-clone installer; not a manifest-URL installer |
| `src/middleware/corsProxy.js` | Public-metadata workaround; proxy serializes JSON and is not used for multipart |

SillyTavern secrets cannot generally be read back without `allowKeysExposure`.
This extension does **not** require or enable it. Version 0.2.0 optionally remembers
the media key in unencrypted profile extension settings, with an adjacent warning
and a tab-only opt-out. Native Secrets are written only on text activation.

## CLODEx interfaces checked in the existing source

| Endpoint | Contract |
| --- | --- |
| `GET /v1/models` | `data[]` IDs; only this list grants catalog availability |
| `GET /api/usage/token/` | `{ code, data: { total_available, unlimited_quota, expires_at, wallet_balance_quota, wallet_balance_usd, wallet_balance_rub, quota_per_unit, usd_to_rub } }`; additive wallet fields require the backend patch |
| `GET /api/status` | `data.quota_per_unit`, custom currency symbol/rate |
| `GET /api/pricing` | `data[].model_name`, `supported_endpoint_types`, fixed-total or ratio prices and cache fields |
| `POST /v1/images/generations` | `{ model, prompt, n: 1, size?, quality? }`; `data[0].b64_json` or `.url` |
| `POST /v1/videos` | JSON common task interface; optional string seconds and image data URL |
| `GET /v1/videos/:id` | OpenAI-style `id,status,progress`; legacy `task_id`/`succeeded` accepted |
| `GET /v1/videos/:id/content` | Authenticated video bytes; no direct-delivery/download query needed |
| `POST /v1/audio/speech` | `{ model, input, voice, response_format: 'mp3' }`; audio bytes |
| `POST /v1/audio/transcriptions` | Multipart file/model; JSON text |

Source audit locations in the CLODEx monorepo: `router/relay-router.go`,
`router/video-router.go`, `router/api-router.go`, `controller/token.go`,
`controller/misc.go`, `controller/pricing.go`, `model/pricing.go`,
`dto/openai_video.go`, `dto/video.go`, `controller/video_proxy.go` and
`relay/channel/task/artlist/request.go` under `deploy/new-api-src/new-api/`.

Pre-patch read-only public probes: status and pricing returned 200, but no browser
`Access-Control-Allow-Origin`; image endpoint OPTIONS returned 204 with CORS.
Release status must be verified separately; no paid generation probes were performed. Local source
contracts do not prove every deployed model supports every optional parameter.

## Verification boundary

Unit tests cover transport, status normalization, prices, quota currency semantics,
secret redaction, media safety/persistence, chat/swipe races, duplicate suppression,
cancel/resume and no-repeat billing. The browser harness uses the real extension
modules against a mock SillyTavern context/API. It is **not** a paid provider test
or a substitute for acceptance in an installed SillyTavern instance.

This repository is published as a **preview**, not a production-ready or fully
accepted implementation of the requested specification. See [ROADMAP.md](ROADMAP.md).

Before a stable release: install on a clean 1.19.0+ profile; verify Custom OpenAI secret
selection, streaming RP, group scenes, native playback after reload, CORS/network
failure messages, and one owner-approved image/video/audio generation per supported
provider family. Do not declare stable/provider-wide compatibility before those gates.
