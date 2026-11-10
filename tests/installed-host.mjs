// Run only against an isolated SillyTavern test profile. Every CLODEx/provider
// request is mocked; local character, chat, media and settings APIs are real.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { VIDEO_BASE64 } from './video-fixture.js';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const url = process.env.ST_TEST_URL || 'http://127.0.0.1:8766';
assert.equal(new URL(url).hostname, '127.0.0.1', 'Use an isolated loopback-only test host');
const browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}), headless: true,
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
const key = 'sk-test-only-not-a-real-credential';
const calls = [], checks = [], errors = [];
const models = ['claude-test', 'gpt-image-test', 'seedance-test', 'eleven_v4', 'whisper-test'];
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6X0YAAAAASUVORK5CYII=';
const wav = Buffer.alloc(44 + 16000);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16,16);
wav.writeUInt16LE(1,20); wav.writeUInt16LE(1,22); wav.writeUInt32LE(8000,24); wav.writeUInt32LE(16000,28);
wav.writeUInt16LE(2,32); wav.writeUInt16LE(16,34); wav.write('data',36); wav.writeUInt32LE(16000,40);
const check = (ok, label) => { assert.ok(ok, label); checks.push(label); console.log('PASS', label); };
let page;
try {
    const context = await browser.newContext({ permissions: ['microphone'], viewport: { width: 1400, height: 1000 } });
    page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (['error','warning'].includes(message.type()) && /settings|save/i.test(message.text())) console.log('HOST', message.text().slice(0,250)); });
    page.on('response', response => { if (response.url().includes('/api/settings/')) console.log('SETTINGS RESPONSE', new URL(response.url()).pathname, response.status()); });
    page.on('dialog', dialog => dialog.accept());
    await page.route('https://**/*', async route => {
        const request = route.request(), path = new URL(request.url()).pathname;
        if (new URL(request.url()).origin !== 'https://clodex.xyz') return route.abort();
        calls.push({ path, method: request.method(), body: request.postData() });
        const json = body => route.fulfill({ json: body });
        if (path === '/v1/models') return json({ data: models.map(id => ({ id })) });
        if (path === '/api/pricing') return json({ data: [{ model_name: models[0], usage_fixed_price: 0.4 }] });
        if (path === '/api/status') return json({ data: { quota_per_unit: 500000 } });
        if (path === '/api/usage/token/') return json({ code: true, data: { total_available: 0, unlimited_quota: true, wallet_balance_usd: 4.5, wallet_balance_rub: 365.625, quota_per_unit: 500000,
            video_billing: { version: 1, funding_source: 'paid_wallet', promotional_balance_eligible: false, free_generation_available: false, paid_balance_usd: 3 } } });
        if (path === '/v1/images/generations') return json({ data: [{ b64_json: png }] });
        if (path === '/v1/videos' && request.method() === 'POST') return json({ id: 'video_acceptance', status: 'queued' });
        if (path === '/v1/videos/video_acceptance') return json({ id: 'video_acceptance', status: 'completed' });
        if (path === '/v1/videos/video_acceptance/content') return route.fulfill({ body: Buffer.from(VIDEO_BASE64, 'base64'), contentType: 'video/mp4' });
        if (path === '/v1/audio/voices') return json({ voices: [{ voice_id: 'test-voice', name: 'Test voice', language: 'en' }], has_more: false });
        if (path === '/v1/audio/speech') return route.fulfill({ body: wav, contentType: 'audio/wav' });
        if (path === '/v1/audio/transcriptions') return json({ text: 'Microphone acceptance transcript.' });
        throw new Error(`Unmocked CLODEx path: ${path}`);
    });
    await page.route('**/api/backends/chat-completions/status', route => route.fulfill({ json: { data: models.map(id => ({ id })) } }));
    await page.goto(url);
    await page.waitForFunction(() => !!globalThis.SillyTavern?.getContext, null, { timeout: 60000 });
    await page.waitForFunction(() => document.querySelector('[data-role="native-tts-status"]')?.textContent.includes('CLODEx'));
    // APP_READY is replayed to late subscribers by the native event emitter.
    // A disposable profile must have completed first-run onboarding beforehand.
    const ready = () => page.evaluate(() => new Promise(resolve => {
        const ctx = SillyTavern.getContext(); ctx.eventSource.once(ctx.eventTypes.APP_READY, resolve);
    }));
    await ready();
    await page.waitForSelector('#tts_provider option[value="CLODEx"]', { state: 'attached', timeout: 60000 });
    check(await page.locator('#tts_provider option[value="CLODEx"]').count() === 1, 'Native TTS CLODEx provider appears in real SillyTavern');
    await page.evaluate(async () => {
        const ctx = SillyTavern.getContext();
        if (!ctx.characters.some(c => c.name === 'CLODEx Acceptance')) {
            const response = await fetch('/api/characters/create', { method: 'POST', headers: ctx.getRequestHeaders(), body: JSON.stringify({ ch_name: 'CLODEx Acceptance', description: 'Silver hair, green eyes', first_mes: 'A quiet night beside the lake.', personality: '', scenario: 'A moonlit lake', mes_example: '' }) });
            if (!response.ok) throw new Error('Cannot create isolated test character');
            await ctx.getCharacters();
        }
        const current = SillyTavern.getContext(); await current.selectCharacterById(current.characters.findIndex(c => c.name === 'CLODEx Acceptance'));
    });
    await page.waitForSelector('#chat .mes[mesid="0"]', { state: 'attached' });
    const field = async (name, value) => page.locator(`#clodex-settings [data-setting="${name}"]`).evaluate((element, value) => {
        if (element.type === 'checkbox') element.checked = value; else element.value = value;
        element.dispatchEvent(new Event('change', { bubbles: true }));
    }, value);
    const action = async name => page.locator(`#clodex-settings [data-action="${name}"]`).evaluate(element => element.click());
    await page.locator('#clodex-settings [data-role="key"]').evaluate((element, value) => { element.value = value; }, key);
    await action('refresh');
    await page.waitForFunction(() => document.querySelector('[data-role="balance"]').textContent.includes('4'));
    await field('language', 'en-us'); await field('textModel', 'claude-test'); await field('imageModel', 'gpt-image-test');
    await field('videoModel', 'seedance-test'); await field('speechModel', 'eleven_v4'); await field('voice', 'test-voice');
    await field('transcriptionModel', 'whisper-test'); await field('quietPrompt', false);
    check((await page.locator('[data-role="video-billing"]').innerText()).includes('Paid wallet'), 'Authoritative paid-video wallet shown in installed host');
    await action('activate');
    await page.waitForFunction(() => SillyTavern.getContext().chatCompletionSettings.custom_model === 'claude-test');
    check(await page.locator('#custom_api_url_text').inputValue() === 'https://clodex.xyz/v1', 'Native Custom OpenAI settings activated');
    check(await page.evaluate(async () => { const { secret_state } = await import('/scripts/secrets.js'); return secret_state.api_key_custom?.some(item => item.active); }), 'Text key stored through real server Secrets');
    const slash = command => page.evaluate(command => SillyTavern.getContext().executeSlashCommandsWithOptions(command), command);
    await slash('/clodex-img A quiet moonlit lake');
    await page.waitForFunction(() => SillyTavern.getContext().chat[0]?.extra?.media?.some(m => m.type === 'image'));
    check(await page.evaluate(() => SillyTavern.getContext().chat[0].extra.media.find(m => m.type === 'image').url.startsWith('/user/files/')), 'Image persisted by real SillyTavern file API');
    await slash('/clodex-video animate=true Wind on the lake');
    await page.waitForSelector('#chat .mes[mesid="0"] video', { state: 'attached', timeout: 45000 });
    await page.waitForFunction(() => [...document.querySelectorAll('#chat video')].at(-1)?.readyState >= 2);
    check(await page.locator('#chat video').last().evaluate(video => video.videoWidth === 320), 'Real native media renderer decodes generated MP4');
    check(JSON.parse(calls.find(call => call.path === '/v1/videos' && call.method === 'POST').body).image.startsWith('data:image/'), 'Installed image-to-video sends saved image bytes');
    await slash('/clodex-say A voice beside the lake');
    await page.waitForSelector('#chat audio', { state: 'attached' });
    check(true, 'Message speech saved and playable in native chat');
    await action('loadVoices'); await page.waitForSelector('#clodex-voice-options option', { state: 'attached' });
    await page.locator('#tts_auto_generation').evaluate(element => { if (element.checked) element.click(); });
    await page.locator('#tts_enabled').evaluate(element => { if (!element.checked) element.click(); });
    await page.locator('#tts_provider').evaluate(element => { element.value = 'CLODEx'; element.dispatchEvent(new Event('change', { bubbles: true })); });
    await page.waitForFunction(() => document.querySelector('#tts_voicemap_block')?.textContent.includes('Test voice'));
    await page.locator('#tts_voicemap_block select').evaluateAll(elements => {
        for (const element of elements) { element.value = 'Test voice (test-voice)'; element.dispatchEvent(new Event('change', { bubbles: true })); }
    });
    const nativeBefore = calls.filter(call => call.path === '/v1/audio/speech').length;
    const spoken = page.waitForRequest(request => new URL(request.url()).pathname === '/v1/audio/speech');
    await slash('/speak voice="CLODEx Acceptance" Native provider speech');
    await spoken;
    await page.waitForFunction(() => document.querySelector('#tts_provider_settings')?.textContent.includes('CLODEx'));
    assert.ok(calls.filter(call => call.path === '/v1/audio/speech').length > nativeBefore, 'Native /speak invokes provider');
    check(true, 'Native TTS voice map and /speak use the CLODEx provider');
    await page.locator('#tts_enabled').evaluate(element => { if (element.checked) element.click(); });
    await action('record');
    await page.waitForFunction(() => document.querySelector('[data-role="microphone-status"]').textContent.includes('Recording locally'));
    // MediaRecorder emits the first chunk after its 1s recording interval.
    await page.waitForTimeout(1200); await action('recordStop');
    await page.waitForSelector('[data-role="recording-preview"]:not([hidden])', { state: 'attached' });
    const chatLength = await page.evaluate(() => SillyTavern.getContext().chat.length);
    await action('transcribe'); await page.waitForFunction(() => document.querySelector('#send_textarea').value.includes('Microphone acceptance transcript'));
    check(await page.evaluate(() => SillyTavern.getContext().chat.length) === chatLength, 'Real microphone STT only inserts composer text');
    const saved = page.waitForResponse(response => response.url().endsWith('/api/settings/save') && response.ok(), { timeout: 15000 });
    await page.locator('#tts_enabled').evaluate(element => { if (!element.checked) element.click(); });
    await field('toolImages', true); await field('toolVideos', true);
    check(await page.evaluate(() => { const c = SillyTavern.getContext(); return c.extensionSettings.clodex.toolImages && c.extensionSettings.clodex.toolVideos; }), 'Tool calling opt-ins persist in native settings');
    await saved;
    check(await page.evaluate(async () => {
        const manager = SillyTavern.getContext().ToolManager;
        for (const name of ['clodex_generate_image', 'clodex_generate_video']) {
            if (!manager.tools.some(tool => tool.toFunctionOpenAI().function.name === name)) return false;
            const result = await manager.invokeFunctionTool(name, { prompt: 'Acceptance tool scene' });
            if (result instanceof Error) throw result;
        }
        return true;
    }), 'Native ToolManager invokes both media tools with mocked providers');
    await page.reload(); await page.waitForFunction(() => document.querySelector('[data-role="balance"]')?.textContent.includes('4'));
    await ready();
    check(await page.locator('[data-role="key"]').inputValue() === '', 'F5 restores key without showing it in password input');
    check(await page.locator('#tts_provider').inputValue() === 'CLODEx', 'F5 restores the native CLODEx TTS provider before native initialization');
    check(await page.locator('#tts_enabled').isChecked(), 'F5 preserves native TTS enabled state');
    await page.evaluate(async () => {
        const ctx = SillyTavern.getContext(); await ctx.selectCharacterById(ctx.characters.findIndex(c => c.name === 'CLODEx Acceptance'));
    });
    await page.waitForSelector('#chat .clodex-message-actions', { state: 'attached' });
    await page.locator('#tts_enabled').evaluate(element => { if (!element.checked) element.click(); });
    await page.waitForFunction(() => document.querySelector('#tts_voicemap_block')?.textContent.includes('Test voice'));
    const reloadedSpeech = page.waitForRequest(request => new URL(request.url()).pathname === '/v1/audio/speech');
    await slash('/speak voice="CLODEx Acceptance" Native provider after reload'); await reloadedSpeech;
    check(true, 'Native TTS speaks after F5 using the saved voice map and key');
    await page.locator('#tts_enabled').evaluate(element => { if (element.checked) element.click(); });
    await slash('/clodex-img After reload without key entry');
    check(calls.filter(call => call.path === '/v1/images/generations').length >= 2, 'Image generation works after real page reload');
    check(await page.evaluate(() => !JSON.stringify(SillyTavern.getContext().chat).includes('sk-test')), 'Chat serialization contains no API key');
    await field('language', 'ru-ru'); check((await page.locator('#clodex-settings').textContent()).includes('Ваши персонажи'), 'RU locale in installed host');
    await field('language', 'en-us'); check((await page.locator('#clodex-settings').textContent()).includes('Your characters'), 'EN locale in installed host');
    await page.locator('#extensions-settings-button').click();
    await page.locator('#clodex-settings .inline-drawer-toggle').click();
    if (process.env.ST_SCREENSHOT) await page.screenshot({ path: process.env.ST_SCREENSHOT });
    await page.evaluate(async () => {
        const { disableExtension } = await import('/scripts/extensions.js');
        await disableExtension('third-party/SillyTavern-CLODEx', false);
    });
    check(await page.evaluate(() => {
        const ctx = SillyTavern.getContext();
        return !document.querySelector('#clodex-settings') && ctx.extensionSettings.tts.currentProvider === 'System'
            && !ctx.extensionSettings.tts.enabled && !ctx.ToolManager.tools.some(tool => tool.toFunctionOpenAI().function.name.startsWith('clodex_'));
    }), 'Native disable hook removes tools and prevents a missing TTS provider on reload');
    await page.evaluate(async () => {
        const { enableExtension } = await import('/scripts/extensions.js');
        await enableExtension('third-party/SillyTavern-CLODEx', false);
    });
    assert.deepEqual(errors, [], 'Installed host has no uncaught browser errors');
    console.log(JSON.stringify({ host: 'SillyTavern 1.19.0', upstream: 'mock only; no paid requests', checks, pageErrors: errors }, null, 2));
    if (process.env.ST_REPORT) await writeFile(process.env.ST_REPORT, JSON.stringify({ checks, pageErrors: errors, upstream: 'mock' }, null, 2));
} catch (error) {
    console.log('DIAGNOSTICS', await page?.evaluate(() => ({
        extensionStatus: document.querySelector('[data-role="status"]')?.textContent,
        ttsStatus: document.querySelector('#tts_status')?.textContent,
        voiceMap: document.querySelector('#tts_voicemap_block')?.textContent,
        provider: document.querySelector('#tts_provider')?.value,
    })).catch(() => null), 'PAGE ERRORS', errors);
    throw error;
} finally { await browser.close(); }
