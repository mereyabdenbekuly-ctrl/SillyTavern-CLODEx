import { initialize } from '../src/ui.js';
import { VIDEO_BASE64 } from './video-fixture.js';

const results = document.querySelector('#results');
const listeners = new Map();
const commands = new Map();
const tools = new Map();
const calls = [];
let confirmations = 0;
let savedSecrets = 0;
let confirmationHook;
const nativeProviders = new Map();
const registerTtsProvider = (name, Provider) => nativeProviders.set(name, Provider);
const polls = new Map();
const context = {
    chatId: 'mock-chat', characterId: 0, name2: 'Мира',
    chat: [{ name: 'Мира', mes: 'Я остановилась у края леса. Над озером медленно поднимается луна.', is_user: false, extra: {} }],
    characters: [{ data: { description: 'Silver hair, green eyes, dark cloak', scenario: 'A tranquil moonlit lake' } }],
    extensionSettings: { clodex: { language: 'ru-ru' } }, chatCompletionSettings: {},
    getCurrentLocale: () => 'ru-ru', getRequestHeaders: () => ({ 'Content-Type': 'application/json', 'X-CSRF-Token': 'mock-csrf' }),
    saveSettingsDebounced() {}, saveChat: async () => {},
    generateQuietPrompt: async () => 'A silver-haired traveller by a moonlit forest lake, cinematic light.',
    updateMessageBlock(index, message) { renderNative(index, message); },
    eventTypes: Object.fromEntries(['CHAT_CHANGED', 'MESSAGE_DELETED', 'MESSAGE_SWIPED', 'MESSAGE_EDITED', 'CHARACTER_MESSAGE_RENDERED', 'GENERATION_ENDED'].map(x => [x, x])),
    eventSource: { on(type, fn) { const list = listeners.get(type) ?? []; list.push(fn); listeners.set(type, list); },
        removeListener(type, fn) { listeners.set(type, (listeners.get(type) ?? []).filter(x => x !== fn)); } },
    SlashCommand: { fromProps: x => x }, SlashCommandNamedArgument: { fromProps: x => x }, SlashCommandArgument: { fromProps: x => x },
    SlashCommandParser: { addCommandObject: command => commands.set(command.name, command) }, ARGUMENT_TYPE: { STRING: 'string', NUMBER: 'number', BOOLEAN: 'boolean' },
    registerFunctionTool: tool => tools.set(tool.name, tool), unregisterFunctionTool: name => tools.delete(name),
};

function renderNative(index, message) {
    let element = document.querySelector(`#chat .mes[mesid="${index}"]`);
    if (!element) {
        element = document.createElement('article'); element.className = 'mes'; element.setAttribute('mesid', index);
        const block = document.createElement('div'); block.className = 'mes_block';
        const name = document.createElement('strong'); name.textContent = message.name;
        const text = document.createElement('div'); text.className = 'mes_text'; text.textContent = message.mes;
        const media = document.createElement('div'); media.className = 'native-media';
        block.append(name, text, media); element.append(block); document.querySelector('#chat').append(element);
    }
    const media = element.querySelector('.native-media'); media.replaceChildren();
    for (const item of message.extra?.media ?? []) {
        const node = document.createElement(item.type === 'image' ? 'img' : item.type === 'video' ? 'video' : 'audio');
        node.src = item.url; node.controls = true; node.preload = 'metadata'; node.alt = 'Mock generated scene'; media.append(node);
    }
}
renderNative(0, context.chat[0]);
const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360;
const paint = canvas.getContext('2d');
const gradient = paint.createLinearGradient(0, 0, 0, 360); gradient.addColorStop(0, '#1b244c'); gradient.addColorStop(1, '#be827e');
paint.fillStyle = gradient; paint.fillRect(0, 0, 640, 360); paint.fillStyle = '#f7e8bf'; paint.beginPath(); paint.arc(470, 95, 38, 0, 2 * Math.PI); paint.fill();
paint.fillStyle = '#253c4c'; paint.beginPath(); paint.moveTo(0, 210); paint.lineTo(120, 110); paint.lineTo(300, 240); paint.lineTo(440, 180); paint.lineTo(640, 270); paint.lineTo(640, 360); paint.lineTo(0, 360); paint.fill();
paint.fillStyle = '#152b36'; paint.fillRect(0, 280, 640, 80); paint.fillStyle = '#e7d7c0'; paint.font = '16px system-ui'; paint.fillText('CLODEx · local mock scene', 20, 335);
const png = canvas.toDataURL().split(',')[1];
const wav = new Uint8Array(44 + 16000); const wavView = new DataView(wav.buffer);
for (const [offset, text] of [[0, 'RIFF'], [8, 'WAVE'], [12, 'fmt '], [36, 'data']]) for (let i = 0; i < text.length; i++) wav[offset + i] = text.charCodeAt(i);
wavView.setUint32(4, wav.length - 8, true); wavView.setUint32(16, 16, true); wavView.setUint16(20, 1, true); wavView.setUint16(22, 1, true);
wavView.setUint32(24, 8000, true); wavView.setUint32(28, 16000, true); wavView.setUint16(32, 2, true); wavView.setUint16(34, 16, true); wavView.setUint32(40, 16000, true);

async function mockFetch(input, options = {}) {
    const url = new URL(input, location.origin);
    if (url.origin !== 'https://clodex.xyz' && !url.pathname.startsWith('/proxy/')) return fetch(input, options);
    const path = url.pathname.replace('/proxy/https://clodex.xyz', '');
    calls.push({ path, method: options.method, body: options.body });
    if (path === '/v1/models') return Response.json({ data: [
        { id: 'claude-demo', supported_endpoint_types: ['openai'] }, { id: 'gpt-image-demo', supported_endpoint_types: ['image-generation'] },
        { id: 'seedance-demo', supported_endpoint_types: ['openai-video'] }, { id: 'tts-demo' }, { id: 'whisper-demo' },
        { id: '<img src=x onerror=alert(1)>', supported_endpoint_types: ['openai'] },
    ] });
    if (path === '/api/pricing') return Response.json({ data: [{ model_name: 'claude-demo', usage_fixed_price: 0.4, cached_usage_fixed_price: 0.04 }] });
    if (path === '/api/status') return Response.json({ data: { quota_per_unit: 500000, custom_currency_symbol: '₽', custom_currency_exchange_rate: 81.25 } });
    if (path === '/api/usage/token/') return Response.json({ code: true, data: { total_available: 0, unlimited_quota: true,
        wallet_balance_usd: 4.5, wallet_balance_rub: 365.625, quota_per_unit: 500000, usd_to_rub: 81.25,
        video_billing: { version: 1, funding_source: 'paid_wallet', promotional_balance_eligible: false, free_generation_available: false, paid_balance_usd: 3 } } });
    if (path === '/v1/images/generations') return Response.json({ data: [{ b64_json: png }] });
    if (path === '/v1/videos' && options.method === 'POST') return Response.json({ id: 'video_mock', status: 'queued', progress: 0 });
    if (/\/v1\/videos\/[^/]+\/content$/.test(path)) return new Response(Uint8Array.from(atob(VIDEO_BASE64), c => c.charCodeAt(0)), { headers: { 'content-type': 'video/mp4' } });
    if (/\/v1\/videos\/[^/]+$/.test(path)) {
        const count = (polls.get(path) ?? 0) + 1; polls.set(path, count);
        return Response.json({ id: path.split('/').at(-1), status: count > 1 ? 'completed' : 'in_progress', progress: count > 1 ? 100 : 37 });
    }
    if (path === '/v1/audio/speech') return new Response(wav, { headers: { 'content-type': 'audio/wav' } });
    if (path === '/v1/audio/voices') return Response.json({ voices: [{ name: 'Mock voice', voice_id: 'voice-mock', language: 'en' }], has_more: false });
    if (path === '/v1/audio/transcriptions') return Response.json({ text: 'Распознанная реплика.' });
    throw new Error(`Unexpected mock request ${path}`);
}

const initializeHarness = () => initialize({ getContext: () => context, fetchImpl: mockFetch,
    loadNativeTts: async () => ({ registerTtsProvider }),
    confirm: () => { confirmations++; return confirmationHook ? confirmationHook() : true; }, writeSecret: async () => { savedSecrets++; return 'mock-secret-id'; } });
let app = await initializeHarness();
app.api.sleep = async () => new Promise(resolve => setTimeout(resolve, 15));
globalThis.clodexHarness = { app, context, commands, tools, calls };
const checks = [];
const check = (condition, name) => { if (!condition) throw new Error(name); checks.push(name); };
const waitFor = async predicate => {
    for (let i = 0; i < 200; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 10)); }
    throw new Error('Timed out waiting for the UI');
};
const set = (name, value) => {
    const field = app.root.querySelector(`[data-setting="${name}"]`);
    if (field.type === 'checkbox') field.checked = value; else field.value = value;
    field.dispatchEvent(new Event('change', { bubbles: true }));
};
if (!new URLSearchParams(location.search).has('auto')) results.textContent = 'Manual mock mode. Use sk-test-only-not-a-credential; all requests are mocked.';
else try {
    check(app.root.textContent.includes('Ваши персонажи'), 'Russian UI loaded');
    app.root.querySelector('[data-role="key"]').value = 'sk-test-only-not-a-credential'; await app.refresh();
    check(app.root.querySelector('[data-role="balance"]').textContent.includes('4,5'), 'Wallet USD shown for an unlimited key');
    check(app.root.querySelector('[data-role="rub"]').textContent.includes('365'), 'Actual wallet RUB shown separately');
    check(app.root.querySelector('[data-role="key"]').value === '', 'Key cleared from visible input');
    check(app.root.querySelector('[data-role="catalog"]').querySelector('img') === null, 'Untrusted model IDs rendered as text (XSS)');
    set('textModel', 'claude-demo'); set('imageModel', 'gpt-image-demo'); set('videoModel', 'seedance-demo');
    set('speechModel', 'tts-demo'); set('transcriptionModel', 'whisper-demo');
    await app.nativeReady;
    check(nativeProviders.has('CLODEx'), 'Native TTS provider registered');
    check(app.root.querySelector('[data-role="video-billing"]').textContent.includes('бесплатные видеогенерации недоступны'), 'Server paid-only video policy displayed, not a fake promo');
    app.root.querySelector('[data-action="loadVoices"]').click();
    await waitFor(() => app.root.querySelector('#clodex-voice-options option'));
    check(app.root.querySelector('#clodex-voice-options option').value === 'voice-mock', 'Provider voice catalog populates manual-ID suggestions');
    const provider = new (nativeProviders.get('CLODEx'))();
    await provider.loadSettings({ voiceMap: { Mira: 'voice-mock' } });
    check((await provider.generateTts('Native speech', 'voice-mock')).headers.get('Content-Type') === 'audio/wav', 'Native TTS contract returns playable audio');
    check(!JSON.stringify(provider.settings).includes('sk-test'), 'Native TTS settings never duplicate the API key');
    context.chatCompletionSettings.custom_include_headers = 'Authorization: old-provider-fixture';
    const connectionConfirmations = confirmations;
    app.root.querySelector('[data-action="activate"]').click(); await waitFor(() => savedSecrets === 1);
    await waitFor(() => context.chatCompletionSettings.custom_model === 'claude-demo');
    check(document.querySelector('#custom_api_url_text').value === 'https://clodex.xyz/v1', 'Native text connection configured');
    check(confirmations === connectionConfirmations + 2 && context.chatCompletionSettings.custom_include_headers === '', 'Previous provider overrides cleared only after explicit consent');
    const image = await commands.get('clodex-img').callback({}, 'Mock moonlit lake');
    check(image.startsWith('/user/files/'), 'Image saved as native local attachment');
    await commands.get('clodex-video').callback({ animate: 'true' }, 'Mock wind');
    const create = calls.find(c => c.path === '/v1/videos' && c.method === 'POST');
    check(JSON.parse(create.body).image.startsWith('data:image/png;base64,'), 'Image-to-video sends image bytes');
    check(document.querySelectorAll('#chat video').length === 1, 'Native video element restored from saved media');
    await waitFor(() => document.querySelector('#chat video')?.readyState >= 2);
    check(document.querySelector('#chat video').videoWidth === 320, 'Stored MP4 decoded by the browser');
    const posts = calls.filter(c => c.path === '/v1/videos' && c.method === 'POST').length;
    context.chat[0].extra.clodex.jobs.push({ id: 'resume-local', taskId: 'resume_server', kind: 'video', model: 'seedance-demo', status: 'paused' });
    await commands.get('clodex-resume').callback({ message: '0' });
    check(calls.filter(c => c.path === '/v1/videos' && c.method === 'POST').length === posts, 'Resume never repeats video POST');
    await commands.get('clodex-say').callback({}, 'Hello');
    check(document.querySelectorAll('#chat audio').length === 1, 'Native speech playback controls');
    const audioFile = app.root.querySelector('[data-role="audio-file"]'); const transfer = new DataTransfer();
    transfer.items.add(new File([wav], 'voice.wav', { type: 'audio/wav' })); audioFile.files = transfer.files;
    app.root.querySelector('[data-action="transcribe"]').click(); await waitFor(() => document.querySelector('#send_textarea').value.includes('Распознанная'));
    check(context.chat.length === 1, 'STT inserts text without sending');
    await waitFor(() => calls.filter(c => c.path === '/api/usage/token/').length > 1);
    await new Promise(resolve => setTimeout(resolve, 0));
    app.root.querySelector('[data-action="record"]').click(); await waitFor(() => app.recorder.state === 'recording');
    await waitFor(() => app.recorder.session?.bytes > 0);
    app.root.querySelector('[data-action="recordStop"]').click(); await waitFor(() => app.recorder.state === 'ready');
    check(!app.root.querySelector('[data-role="recording-preview"]').hidden, 'Microphone recording is available for local preview before upload');
    const sttBefore = calls.filter(c => c.path === '/v1/audio/transcriptions').length;
    let confirmStt;
    confirmationHook = () => new Promise(resolve => { confirmStt = resolve; });
    app.root.querySelector('[data-action="transcribe"]').click(); await waitFor(() => confirmStt);
    app.root.querySelector('[data-action="transcribe"]').click(); await new Promise(resolve => setTimeout(resolve, 0));
    check(calls.filter(c => c.path === '/v1/audio/transcriptions').length === sttBefore, 'Recording stays local until confirmation');
    confirmStt(true); confirmationHook = null;
    await waitFor(() => calls.filter(c => c.path === '/v1/audio/transcriptions').length === sttBefore + 1);
    await new Promise(resolve => setTimeout(resolve, 0));
    check(context.chat.length === 1, 'Microphone STT never sends a chat message or duplicates a paid POST');
    app.root.querySelector('[data-action="recordDiscard"]').click(); await waitFor(() => !app.recorder.file);
    check(app.root.querySelector('[data-role="recording-preview"]').hidden, 'Discard clears local audio preview');
    set('toolImages', true); set('confirmPaid', false); const before = confirmations;
    await tools.get('clodex_generate_image').action({ prompt: 'Selfie scene' });
    check(confirmations > before, 'Tool generation requires separate consent');
    app.renderMessages(); app.renderMessages();
    check(document.querySelectorAll('.clodex-message-actions').length === 1, 'Repeated renders do not duplicate controls');
    set('language', 'en-us'); check(app.root.textContent.includes('Your characters'), 'English locale switching'); set('language', 'ru-ru');
    check(!JSON.stringify(context.chat).includes('sk-test'), 'Key absent from saved chat');
    check(context.extensionSettings.clodex.savedKey === app.api.getKey(), 'Remembered key stored only in profile settings');
    const savedProfile = JSON.parse(JSON.stringify(context.extensionSettings));
    app.dispose(); context.extensionSettings = savedProfile; app = await initializeHarness(); await app.ready;
    check(app.api.getKey() === 'sk-test-only-not-a-credential', 'Key restored after profile serialization and reinitialization');
    check((await commands.get('clodex-img').callback({}, 'After reload')).startsWith('/user/files/'), 'Generation works after reload without re-entering key');
    set('rememberKey', false);
    check(!JSON.stringify(context.extensionSettings).includes('sk-test'), 'Disabling remember removes persisted key');
    check(app.api.getKey() === 'sk-test-only-not-a-credential', 'Tab key stays usable after disabling persistence');
    const memoryOnly = JSON.parse(JSON.stringify(context.extensionSettings));
    app.dispose(); context.extensionSettings = memoryOnly; app = await initializeHarness(); await app.ready;
    check(app.api.getKey() === '', 'Memory-only profile does not restore a key');
    set('rememberKey', true);
    app.root.querySelector('[data-role="key"]').value = 'sk-test-only-not-a-credential'; await app.refresh();
    const quotaMethod = app.api.quota.bind(app.api);
    const previousWallet = await quotaMethod();
    let releaseQuota;
    app.api.quota = () => new Promise(resolve => { releaseQuota = resolve; });
    const pendingGeneration = commands.get('clodex-img').callback({}, 'Delayed balance response');
    await waitFor(() => releaseQuota);
    app.root.querySelector('[data-action="forget"]').click(); await waitFor(() => app.api.getKey() === '');
    check(!JSON.stringify(context.extensionSettings).includes('sk-test'), 'Forget removes saved and in-memory extension keys');
    releaseQuota(previousWallet); await pendingGeneration; app.api.quota = quotaMethod;
    check(app.root.querySelector('[data-role="balance"]').textContent === '—', 'Delayed balance response cannot restore a forgotten wallet');
    results.textContent = `PASS — ${checks.length} browser integration checks\n${checks.join(' · ')}`;
    results.dataset.passed = String(checks.length);
} catch (error) {
    results.dataset.failed = 'true'; results.textContent = `FAIL after ${checks.length} checks: ${error.message}`;
    console.error(error);
}
