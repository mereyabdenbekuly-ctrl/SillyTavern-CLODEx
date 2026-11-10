# Changelog

## 0.3.0 preview — 2026-11-11

- Native CLODEx TTS provider, safe voice catalog/search/manual IDs, paid preview, per-character voice map and reload-safe provider registration.
- Local microphone recording with preview/discard and explicit STT upload, limits, cancellation and track cleanup.
- Versioned server video billing display: paid wallet only, no invented promotional/free attempts.
- Clean disable lifecycle; native TTS falls back to System with speech disabled.
- Acceptance against installed SillyTavern 1.19.0, including F5, real native media/Secrets/ToolManager/TTS and fake-device microphone. Upstream requests remain mocked.
- Dependency-free unit tests and isolated browser harness; no paid-provider-wide compatibility claim.
- Matching docs/landing integration and integrity-pinned domain mirror prepared for the separate backend release.
- Rollout update: the 0.2.0 narrow-CORS/wallet backend patch was accepted on November 11, 2026. The historical publication-time note below is not the current status.

## 0.2.0 preview — 2026-11-10

### Исправлено / Fixed

- Запоминание ключа включено по умолчанию; ключ восстанавливается из настроек
  профиля, каталог и баланс обновляются при загрузке. Отключение запоминания
  удаляет сохранённый ключ, а «Забыть» очищает также память вкладки.
  **Ключ хранится незашифрованным** и доступен серверу, расширениям и резервным
  копиям настроек. Global `allowKeysExposure` не включается. Отдельный native
  Custom OpenAI secret не удаляется этой кнопкой.
- Баланс кошелька USD/RUB отделён от лимита ключа, включая unlimited keys.
  Старый backend явно обозначается как не предоставляющий баланс кошелька.
  RUB берётся только из явно рублёвых серверных данных.
- Прежние Custom OpenAI header/body overrides можно очистить с отдельным
  подтверждением. Отказ или ошибка записи native secret сохраняет настройки.
- Запоздавший ответ баланса не восстанавливает данные забытого/заменённого ключа.

### Backend rollout / Выпуск сервера

**На момент публикации серверный патч ещё не развёрнут.** Узкий CORS и поля
кошелька реализованы и протестированы в backend, но штатный выпуск остановлен
из-за несовпадения установленного защищённого publisher с версией репозитория.
Для исправления publisher требуется отдельное разрешение владельца.
Публикация этого расширения не исправляет CORS живого сервера сама по себе.

**The matching backend patch is not deployed at publication time.** Direct
metadata access and wallet fields require a separate server rollout. Its
protected publisher must first be synchronized through an owner-authorized
operation. This extension release does not deploy or reconfigure the server.

### Verification / Проверки

- Dependency-free Node unit tests; RU/EN and syntax/manifest validation.
- Browser integration harness with mock API, native MP4 decoding, profile
  serialization/reinitialization, key removal, and billing duplicate guards.
- Backend middleware/controller tests cover exact read-only CORS paths,
  authenticated owner-only wallet access, currency semantics and fail-closed
  responses. No real keys or paid generations are used in extension tests.
- This is a **preview**, not installed-SillyTavern acceptance or a claim that
  every live provider/model is supported. See `docs/ROADMAP.md`.

## 0.1.0 preview — 2026-11-10

Initial build-free extension: live catalog, native Custom OpenAI switching,
image/video/I2V generation, resumable video jobs, speech and audio-file STT,
optional tools and automatic illustrations, and RU/EN interface.
