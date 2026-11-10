import test from 'node:test';
import assert from 'node:assert/strict';
import { activateTextModel, attachMedia, captureTarget, DEFAULT_SETTINGS, imageFromBase64, loadSettings,
    localMediaPath, saveMedia, sceneContext, targetIsCurrent, storeKey } from '../src/chat.js';
import { GenerationController } from '../src/controller.js';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a33sAAAAASUVORK5CYII=';
const KEY = 'sk-test-only-not-a-credential';
function setup(overrides = {}) {
    const original = { chatId: 'chat-a', chat: [{ name: 'Mira', mes: 'A quiet forest.', is_user: false, extra: {} }],
        characters: [{ avatar: 'mira.png', data: { description: 'Silver hair.', scenario: 'A forest.' } }], characterId: 0,
        extensionSettings: {}, getRequestHeaders: () => ({ 'X-CSRF-Token': 'csrf' }),
        saveSettingsDebounced() {}, updateMessageBlock() {}, generateQuietPrompt: async () => 'A forest portrait.' };
    let current = original;
    const saved = [];
    original.saveChat = async () => saved.push(current.chatId);
    const calls = [];
    const api = { getKey: () => KEY,
        image: async body => { calls.push(['image', body]); return { b64_json: PNG }; },
        createVideo: async body => { calls.push(['video', body]); return { id: 'video_1', status: 'queued', progress: 0 }; },
        waitVideo: async (id, options) => { calls.push(['poll', id]); await options.onProgress({ status: 'completed', progress: 100 }); },
        videoContent: async id => { calls.push(['content', id]); return new Blob(['video'], { type: 'video/mp4' }); },
        speech: async body => { calls.push(['speech', body]); return new Blob(['audio'], { type: 'audio/mpeg' }); },
    };
    const settings = { ...DEFAULT_SETTINGS, imageModel: 'image-test', videoModel: 'video-test', speechModel: 'speech-test' };
    const controller = new GenerationController({ api, getContext: () => current, settings, confirm: async () => true,
        persistMedia: async (_ctx, blob) => `/user/files/result.${blob.type.startsWith('video') ? 'mp4' : blob.type.startsWith('audio') ? 'mp3' : 'png'}`,
        ...overrides });
    return { original, saved, calls, api, settings, controller, change: value => { current = value; } };
}

test('settings drop unknown/secret fields and default paid automation and tools off', () => {
    const context = { extensionSettings: { clodex: { apiKey: KEY, autoImages: 'yes', imageModel: 'img' } } };
    const settings = loadSettings(context);
    assert.equal(settings.imageModel, 'img'); assert.equal(settings.autoImages, false);
    assert.equal(settings.toolVideos, false); assert.ok(!JSON.stringify(settings).includes(KEY));
});

test('remembered key survives profile serialization and can be removed without touching chat', () => {
    const context = { extensionSettings: {}, chat: [{ mes: 'hello' }] };
    const settings = loadSettings(context);
    assert.equal(settings.rememberKey, true);
    storeKey(settings, KEY);
    const restored = loadSettings({ extensionSettings: JSON.parse(JSON.stringify(context.extensionSettings)) });
    assert.equal(restored.savedKey, KEY);
    assert.ok(!JSON.stringify(context.chat).includes(KEY));
    storeKey(restored, '');
    assert.equal(restored.savedKey, '');
});

test('memory-only mode and malformed saved keys never restore a credential', () => {
    const settings = { ...DEFAULT_SETTINGS, rememberKey: false, savedKey: KEY };
    storeKey(settings, KEY);
    assert.equal(settings.savedKey, '');
    assert.equal(loadSettings({ extensionSettings: { clodex: { rememberKey: false, savedKey: KEY } } }).savedKey, '');
    assert.equal(loadSettings({ extensionSettings: { clodex: { savedKey: 'invalid' } } }).savedKey, '');
    settings.rememberKey = true;
    storeKey(settings, KEY);
    assert.equal(settings.savedKey, KEY);
});

test('target identity detects chat switches, swipes, deletion and edits', () => {
    const { original } = setup(); const target = captureTarget(original);
    assert.equal(targetIsCurrent(original, target), true);
    assert.equal(targetIsCurrent({ ...original, chatId: 'other' }, target), false);
    assert.equal(targetIsCurrent({ ...original, chat: [...original.chat] }, target), false);
    original.chat[0].swipe_id = 1; assert.equal(targetIsCurrent(original, target), false);
    original.chat[0].swipe_id = 0; original.chat[0].mes = 'edited'; assert.equal(targetIsCurrent(original, target), false);
});

test('no target is created on a user/system/empty chat', () => {
    assert.throws(() => captureTarget({ chat: [] }));
    assert.throws(() => captureTarget({ chat: [{ is_user: true }] }, 0));
    assert.throws(() => captureTarget({ chat: [{ is_system: true }] }, 0));
});

test('group context uses the message speaker card and excludes unrelated private card fields', () => {
    const { original } = setup();
    original.chat[0].original_avatar = 'other.png';
    original.characters.push({ avatar: 'other.png', data: { description: 'Red coat', creator_notes: 'PRIVATE_NOTES' } });
    const source = sceneContext(original, captureTarget(original));
    assert.match(source, /Red coat/); assert.doesNotMatch(source, /Silver hair|PRIVATE_NOTES/);
});

test('media attachment preserves text/existing media and is idempotent per job', () => {
    const message = { mes: 'original', extra: { media: [{ type: 'image', url: '/user/images/old.png' }] } };
    const job = { id: 'job', model: 'image-model' };
    attachMedia(message, '/user/files/new.png', 'image', job); attachMedia(message, '/user/files/new.png', 'image', job);
    assert.equal(message.mes, 'original'); assert.equal(message.extra.media.length, 2);
    assert.equal(message.extra.media[0].url, '/user/images/old.png');
});

test('image generation composes a prompt, uploads and saves a durable native attachment', async () => {
    const { controller, original, calls } = setup();
    const url = await controller.run('image');
    assert.equal(url, '/user/files/result.png'); assert.equal(calls[0][1].prompt, 'A forest portrait.');
    assert.equal(original.chat[0].extra.media[0].type, 'image');
    assert.equal(original.chat[0].extra.clodex.jobs[0].status, 'completed');
    assert.ok(!JSON.stringify(original.chat).includes(KEY));
});

test('explicit slash/tool prompt does not trigger another quiet text generation', async () => {
    const { controller, original, calls } = setup();
    original.generateQuietPrompt = () => { throw new Error('must not run'); };
    await controller.run('image', { prompt: 'explicit scene' });
    assert.equal(calls[0][1].prompt, 'explicit scene');
});

test('video records task ID before polling and persists video, not a protected playback URL', async () => {
    const { controller, original, calls, api } = setup();
    const wait = api.waitVideo;
    api.waitVideo = (id, options) => {
        assert.equal(original.chat[0].extra.clodex.jobs[0].taskId, 'video_1');
        return wait(id, options);
    };
    await controller.run('video', { prompt: 'scene' });
    assert.deepEqual(calls.map(c => c[0]), ['video', 'poll', 'content']);
    assert.equal(original.chat[0].extra.media[0].url, '/user/files/result.mp4');
});

test('resume after timeout/download failure polls the existing task without another billable POST', async () => {
    const { controller, original, calls, api } = setup();
    const read = api.videoContent;
    api.videoContent = async () => { throw new Error('download interrupted'); };
    await assert.rejects(controller.run('video', { prompt: 'scene' }));
    const job = original.chat[0].extra.clodex.jobs[0];
    assert.equal(job.status, 'paused'); assert.equal(job.taskId, 'video_1');
    api.videoContent = read;
    await controller.resume(0, job.id);
    assert.equal(calls.filter(c => c[0] === 'video').length, 1);
    assert.equal(original.chat[0].extra.media.length, 1);
});

test('chat switch during generation never attaches or saves to another chat', async () => {
    const f = setup();
    const other = { ...f.original, chatId: 'chat-b', chat: [{ name: 'Other', mes: 'other text' }] };
    f.api.image = async () => { f.change(other); return { b64_json: PNG }; };
    await assert.rejects(f.controller.run('image', { prompt: 'scene' }), { name: 'AbortError' });
    assert.equal(other.chat[0].extra, undefined); assert.ok(f.saved.every(id => id === 'chat-a'));
    assert.equal(f.original.chat[0].extra.media, undefined);
});

test('changing swipe during video creation cannot bind media to the new swipe', async () => {
    const f = setup();
    f.api.createVideo = async () => { f.original.chat[0].swipe_id = 1; return { id: 'v', status: 'queued' }; };
    await assert.rejects(f.controller.run('video', { prompt: 'scene' }), { name: 'AbortError' });
    assert.equal(f.original.chat[0].extra.media, undefined);
});

test('cancellation after submission does not retry; outcome is explicitly uncertain', async () => {
    const f = setup();
    f.api.image = async () => { f.controller.cancel(); return { b64_json: PNG }; };
    await assert.rejects(f.controller.run('image', { prompt: 'scene' }), { name: 'AbortError' });
    assert.equal(f.original.chat[0].extra.clodex.jobs[0].status, 'uncertain');
    assert.equal(f.original.chat[0].extra.media, undefined);
});

test('declining confirmation creates no jobs, media or billable requests', async () => {
    const f = setup({ confirm: async () => false });
    assert.equal(await f.controller.run('image', { prompt: 'scene' }), '');
    assert.equal(f.calls.length, 0); assert.equal(f.original.chat[0].extra.clodex, undefined);
});

test('tools always confirm even with manual confirmations disabled', async () => {
    let confirmations = 0;
    const f = setup({ confirm: async () => { confirmations++; return false; } });
    f.settings.confirmPaid = false;
    await f.controller.run('image', { source: 'tool', prompt: 'selfie' });
    assert.equal(confirmations, 1); assert.equal(f.calls.length, 0);
});

test('one active operation prevents double clicks and recursive tool generations', async () => {
    const f = setup();
    let release;
    f.api.image = () => new Promise(resolve => { release = resolve; });
    const running = f.controller.run('image', { prompt: 'scene' });
    await assert.rejects(f.controller.run('image', { prompt: 'scene' }), { code: 'busy' });
    while (!release) await new Promise(resolve => setImmediate(resolve));
    release({ b64_json: PNG }); await running;
});

test('auto illustrations are opt-in, deduplicated and rate limited', async () => {
    let time = 0;
    const f = setup({ now: () => time });
    await f.controller.autoImage(0); assert.equal(f.calls.length, 0);
    f.settings.autoImages = true;
    await f.controller.autoImage(0); await f.controller.autoImage(0);
    f.original.chat.push({ name: 'Mira', mes: 'new reply', extra: {} });
    await f.controller.autoImage(1); assert.equal(f.calls.filter(c => c[0] === 'image').length, 1);
    time = 61_000; await f.controller.autoImage(1);
    assert.equal(f.calls.filter(c => c[0] === 'image').length, 2);
});

test('missing key fails before quiet prompt can incur a text charge', async () => {
    const f = setup(); let quiet = 0;
    f.api.getKey = () => ''; f.original.generateQuietPrompt = () => { quiet++; };
    await assert.rejects(f.controller.run('image'), { code: 'key_required' }); assert.equal(quiet, 0);
});

test('audio is stored and attached as durable audio media', async () => {
    const f = setup(); await f.controller.run('audio');
    assert.equal(f.calls[0][1].input, 'A quiet forest.');
    assert.equal(f.original.chat[0].extra.media[0].type, 'audio');
});

test('I2V loads saved image bytes rather than sending localhost URLs to CLODEx', async () => {
    const f = setup({ fetchImpl: async url => {
        assert.equal(url, '/user/files/source.png'); return new Response(imageFromBase64(PNG));
    } });
    f.original.chat[0].extra.media = [{ type: 'image', url: '/user/files/source.png' }];
    await f.controller.run('video', { prompt: 'motion', animate: true });
    assert.match(f.calls[0][1].image, /^data:image\/png;base64,/);
});

test('safe local media allowlist and raster signature validation', () => {
    assert.equal(localMediaPath('user/files/video.mp4'), '/user/files/video.mp4');
    for (const path of ['https://evil.test/a', '//evil.test/a', '/api/secrets/view', '/user/files/../x', '/user/files/%2e%2e/x']) assert.throws(() => localMediaPath(path));
    assert.equal(imageFromBase64(PNG).type, 'image/png'); assert.throws(() => imageFromBase64(btoa('<svg></svg>')));
});

test('media save uploads to the official ST file endpoint without CLODEx credentials', async () => {
    const { original } = setup(); let request;
    const result = await saveMedia(original, imageFromBase64(PNG), { fetchImpl: async (url, options) => {
        request = { url, ...options }; return Response.json({ path: 'user/files/saved.png' });
    } });
    assert.equal(result, '/user/files/saved.png'); assert.equal(request.url, '/api/files/upload');
    assert.ok(!JSON.stringify(request).includes(KEY)); assert.equal(JSON.parse(request.body).data, PNG);
});

test('text activation uses native controls and server secrets, not slash interpolation', async () => {
    const fields = new Map(['#custom_api_url_text', '#custom_model_id', '#main_api', '#chat_completion_source', '#api_button_openai']
        .map(id => [id, { value: '', dispatchEvent() {}, click() {} }]));
    const context = { chatCompletionSettings: {}, saveSettingsDebounced() {} }; let secret;
    const model = 'model | /dangerous-command';
    await activateTextModel(context, { model, key: KEY, document: { querySelector: id => fields.get(id) }, writeSecret: async (...args) => { secret = args; return 'id'; } });
    assert.deepEqual(secret, ['api_key_custom', KEY, 'CLODEx']);
    assert.equal(context.chatCompletionSettings.custom_model, model);
    assert.equal(fields.get('#custom_api_url_text').value, 'https://clodex.xyz/v1');
});

test('declining override reset leaves previous connection and secrets untouched', async () => {
    let writes = 0;
    const originalHeaders = 'Authorization: old-key';
    const context = { chatCompletionSettings: { custom_include_headers: originalHeaders } };
    assert.equal(await activateTextModel(context, { model: 'm', key: KEY,
        document: { querySelector: () => ({}) }, writeSecret: async () => { writes++; return 'id'; },
        confirmResetOverrides: async () => false }), false);
    assert.equal(writes, 0); assert.equal(context.chatCompletionSettings.custom_include_headers, originalHeaders);
});

test('confirmed switch clears all previous overrides in settings and native inputs', async () => {
    const names = ['custom_include_headers', 'custom_include_body', 'custom_exclude_body'];
    const context = { chatCompletionSettings: Object.fromEntries(names.map(n => [n, 'previous value'])), saveSettingsDebounced() {} };
    const fields = new Map();
    const document = { querySelector: id => {
        if (!fields.has(id)) fields.set(id, { value: 'previous value', dispatchEvent() {}, click() {} });
        return fields.get(id);
    } };
    let confirmations = 0;
    assert.equal(await activateTextModel(context, { model: 'm', key: KEY, document, writeSecret: async () => 'id',
        confirmResetOverrides: async () => { confirmations++; return true; } }), true);
    assert.equal(confirmations, 1);
    for (const name of names) { assert.equal(context.chatCompletionSettings[name], ''); assert.equal(fields.get(`#${name}`).value, ''); }
    assert.equal(context.chatCompletionSettings.custom_model, 'm');
});

test('failed native secret write does not destroy confirmed old provider overrides', async () => {
    const context = { chatCompletionSettings: { custom_include_body: 'old-body' } };
    await assert.rejects(activateTextModel(context, { model: 'm', key: KEY, document: { querySelector: () => ({}) },
        writeSecret: async () => null, confirmResetOverrides: async () => true }), /save the key/);
    assert.equal(context.chatCompletionSettings.custom_include_body, 'old-body');
});
