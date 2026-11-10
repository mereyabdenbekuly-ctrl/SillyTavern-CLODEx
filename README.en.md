# CLODEx for SillyTavern · 0.3.0

Standalone, build-free UI extension for **SillyTavern 1.19.0+**. A CLODEx `sk-…`
API key is required. **0.3.0 public preview.** Text, images, video/I2V, native TTS,
microphone/STT and model tools are implemented. Acceptance runs use installed
SillyTavern 1.19.0 with mocked upstream APIs, not live paid-provider generations.
See the [verification boundary](docs/COMPATIBILITY.md).

[Русский](README.md) · [Readiness and limitations](docs/ROADMAP.md) · [MIT](LICENSE)

## Install

In **Extensions → Install Extension**, paste:

```text
https://github.com/mereyabdenbekuly-ctrl/SillyTavern-CLODEx
```

Confirm installation, reload, open **Extensions → CLODEx**, enter a key, refresh
and select models. Use **Use for chat** to configure the text connection.
No `enableCorsProxy` configuration is needed: narrow CORS and wallet fields are deployed.

For a manual installation:

Copy the `SillyTavern-CLODEx` directory into
`<SillyTavern>/data/<profile>/extensions/` (usually `data/default-user/extensions/`).
Reload, open **Extensions → CLODEx**, enter a key, refresh and select models.

**Extensions → Install Extension** accepts the Git repository URL,
not a URL to `manifest.json` or a ZIP. Auto-updates require a Git installation.

## Features

- Live `/v1/models`; public reference pricing, cache-read prices, wallet balance in USD/RUB and a separate API-key allowance.
- One-click native **Custom OpenAI** configuration; RP presets and streaming remain native to SillyTavern.
- `/clodex-img [prompt]`, `/clodex-video [prompt]`, `/clodex-say [text]` and per-message buttons.
- `/clodex-video message=4 animate=true motion prompt` uses saved image bytes, never a localhost URL.
- Native image/video/audio attachments, saved to SillyTavern's `user/files`.
- Real video polling, progress, local stop and `/clodex-resume message=4` without resubmission.
- Optional, rate-limited automatic illustrations; optional image/video function tools with per-call consent.
- Native **CLODEx** TTS provider, per-character voice maps, provider voice search, manual voice IDs and paid voice previews.
- Microphone recording (up to 2 minutes / 24 MB), local preview/discard, or audio-file STT into the composer without sending it.
- RU/EN and responsive settings. Key, native TTS selection and voice maps survive F5.

## Wallet and direct CORS

**Narrow CORS and wallet fields were deployed on November 11, 2026.**
Direct browser access from localhost works without changing `config.yaml`.

The backend allows credentialless browser GET/OPTIONS on exactly
`/api/pricing`, `/api/status`, `/api/usage/token/`. Wallet requests still require a
Bearer key. New fields include `wallet_balance_usd`, `wallet_balance_rub`,
`quota_per_unit` and `usd_to_rub`; an unlimited key never means an unlimited wallet.
The legacy server fallback is explicitly labelled as a key allowance, not a wallet.

Publishing the extension does not deploy the backend. The old optional public
metadata proxy remains available for legacy servers only; it requires local
`enableCorsProxy`, sends no CLODEx key and cannot fix the legacy protected
usage-endpoint CORS. Normally leave it off once the backend patch is deployed.

## Voice and microphone

Select a speech model and load/search voices in CLODEx settings. Supported ElevenLabs
models expose a catalog; otherwise enter a valid provider voice ID manually. In native
**TTS**, enable speech, choose **CLODEx**, and assign character voices. Click Refresh
if TTS was disabled during startup. Voice previews use the same paid confirmation
path; they are not free demos. No duplicate key is saved in native TTS settings.

For STT, record locally, stop, preview/discard, then choose Transcribe to upload.
HTTPS or localhost is required. Switching chats/keys or disabling the extension
stops recording. Recognized text is never automatically sent.

## Safety and limits

**Remember key in SillyTavern** defaults on. The key is saved **unencrypted** in
`extensionSettings.clodex.savedKey`, restored on reload, and the catalog/balance
refresh automatically. It is accessible to your SillyTavern server, installed
extensions and settings backups. Use a trusted access-protected server. Disabling
the checkbox removes the persisted key and keeps only this tab's in-memory copy.
Chat messages/exports and browser localStorage/sessionStorage do not contain it.

**Forget saved key** clears both the profile and in-memory extension key. **Use for
chat** separately writes the native Custom OpenAI secret; delete that secret in
SillyTavern if needed. The extension does not enable global `allowKeysExposure`.
Previous Custom OpenAI header/body overrides can be cleared with separate consent;
back up your old connection as a preset first. Declining leaves it unchanged.

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
promotions depend on CLODEx/provider capabilities. Video currently uses paid wallet funds only: promotional balance, Credits and
subscriptions do not provide free attempts. The panel shows the server's versioned
billing policy and paid balance; missing policy data is unknown, not a free quota.
Quiet prompt composition may incur additional text costs and uses the configured
SillyTavern text provider/context; explicit prompts skip it. Scene construction reads
character appearance/scenario and up to four recent messages.

## Development

Node.js 20+, no dependencies: `npm test`, `npm run check`, `npm run package`.
`node tests/browser-server.mjs` starts a local mock integration harness; no paid calls.
See [compatibility notes](docs/COMPATIBILITY.md) for verified upstream contracts.

Code is licensed under [MIT](LICENSE). This does not grant paid API access;
model availability, limits and charges are controlled by CLODEx and providers.
The domain mirror is at https://clodex.xyz/sillytavern/; installation still uses the Git URL above.
