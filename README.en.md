# CLODEx for SillyTavern · 0.1.0

Standalone, build-free UI extension for **SillyTavern 1.19.0+**. A CLODEx `sk-…`
API key is required. **MVP / preview 0.1.0: the full requested specification is not complete.**
Acceptance in an installed SillyTavern instance and live paid-provider testing are still pending.
No paid live generations were used in development; automated checks mock the API.

[Русский](README.md) · [Readiness and limitations](docs/ROADMAP.md) · [MIT](LICENSE)

## Install

In **Extensions → Install Extension**, paste:

```text
https://github.com/mereyabdenbekuly-ctrl/SillyTavern-CLODEx
```

Confirm installation, reload, open **Extensions → CLODEx**, enter a key, refresh
and select models. Use **Use for chat** to configure the text connection.
Prices and currency conversion may need the public-metadata proxy setup below.

For a manual installation:

Copy the `SillyTavern-CLODEx` directory into
`<SillyTavern>/data/<profile>/extensions/` (usually `data/default-user/extensions/`).
Reload, open **Extensions → CLODEx**, enter a key, refresh and select models.

**Extensions → Install Extension** accepts the Git repository URL,
not a URL to `manifest.json` or a ZIP. Auto-updates require a Git installation.

## Features

- Live `/v1/models`; public reference pricing, cache-read prices and API-key allowance.
- One-click native **Custom OpenAI** configuration; RP presets and streaming remain native to SillyTavern.
- `/clodex-img [prompt]`, `/clodex-video [prompt]`, `/clodex-say [text]` and per-message buttons.
- `/clodex-video message=4 animate=true motion prompt` uses saved image bytes, never a localhost URL.
- Native image/video/audio attachments, saved to SillyTavern's `user/files`.
- Real video polling, progress, local stop and `/clodex-resume message=4` without resubmission.
- Optional, rate-limited automatic illustrations; optional image/video function tools with per-call consent.
- Speech API and audio-file transcription into the composer, without automatically sending it.
- RU/EN and responsive settings. Voice is implemented by this extension's own controls, not a built-in TTS provider.

## Public metadata / CORS

On November 10, 2026, `/api/pricing` and `/api/status` did not expose browser CORS
headers. To load prices and currency information, enable `enableCorsProxy: true`
in your **private, protected** SillyTavern `config.yaml`, restart, and enable
**Public metadata via SillyTavern proxy** in this extension. This proxy handles
only two public GETs, with **no CLODEx key**. Never expose an unauthenticated proxy publicly.

Without metadata, allowance is displayed in quota units and prices are unavailable.
USD uses the server's quota conversion; RUB requires an explicitly identified RUB
conversion. The new-api CNY exchange rate is never mislabeled as RUB.
API-key allowance is not necessarily the account wallet. Unlimited keys do not imply free usage.
A separate CLODEx server release enabling narrow public CORS is needed to remove this setup step.

## Safety and limits

The media key stays only in tab memory. Re-enter after a reload. **Use for chat**
separately saves it in SillyTavern's native server Secrets; **Forget tab key** does
not delete that secret. All installed extensions share browser access.

Automatic generation and tools default off. Auto images run at most once per
minute and once per message, with no automatic retry. Tools always ask for consent.
Image/video/speech creation POSTs are never retried automatically. Stopping is local:
the provider may still complete and charge a submitted job. If submission failed
before an ID was received, inspect CLODEx history before retrying.

The extension pins the credential destination, rejects unsafe media URLs/types,
never embeds keys in media URLs and checks chat/message/swipe identity before saving.
Changing chats, swiping, deleting or editing interrupts local generation.
Video task IDs are persisted for resumption. Native binary attachments must be backed
up with `user/files`; a JSON chat export alone does not include those files.

Maximum saved media: 100 MB; image reference: 20 MB; STT upload: 25 MB. Provider limits
may be lower. JSON `image` support, sizes, duration, voices, model eligibility and
promotions depend on CLODEx/provider capabilities. No free-video entitlement is assumed.
Quiet prompt composition may incur additional text costs and uses the configured
SillyTavern text provider/context; explicit prompts skip it. Scene construction reads
character appearance/scenario and up to four recent messages.

## Development

Node.js 20+, no dependencies: `npm test`, `npm run check`, `npm run package`.
`node tests/browser-server.mjs` starts a local mock integration harness; no paid calls.
See [compatibility notes](docs/COMPATIBILITY.md) for verified upstream contracts.

Code is licensed under [MIT](LICENSE). This does not grant paid API access;
model availability, limits and charges are controlled by CLODEx and providers.
Publishing this extension does not deploy changes to the CLODEx website or API.
