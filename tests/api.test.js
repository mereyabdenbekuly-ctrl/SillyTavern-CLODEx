import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, ClodexApi, normalizeVideo, readMediaBlob, redact, safeMediaUrl, taskId } from '../src/api.js';

const KEY = 'sk-test-only-not-a-credential';
const json = (value, status = 200) => Response.json(value, { status });
function setup(responses) {
    const calls = [];
    let time = 0;
    const api = new ClodexApi({ getKey: () => KEY, now: () => time, sleep: async ms => { time += ms; },
        fetchImpl: async (url, options) => {
            calls.push({ url, ...options });
            const result = responses.shift();
            if (result instanceof Error) throw result;
            if (!result) throw new Error('Unexpected request');
            return result;
        } });
    return { api, calls };
}

test('authenticated requests use the fixed CLODEx origin without cookies or redirects', async () => {
    const { api, calls } = setup([json({ data: [] })]);
    await api.models();
    assert.equal(calls[0].url, 'https://clodex.xyz/v1/models');
    assert.equal(calls[0].headers.get('Authorization'), `Bearer ${KEY}`);
    assert.equal(calls[0].credentials, 'omit'); assert.equal(calls[0].redirect, 'error');
    await assert.rejects(api.request('https://evil.example/v1/models'));
    await assert.rejects(api.request('//evil.example'));
});

test('optional public metadata proxy never forwards API credentials', async () => {
    let request;
    const api = new ClodexApi({ getKey: () => KEY, publicProxy: () => true,
        getRequestHeaders: () => ({ 'X-CSRF-Token': 'local-csrf', Authorization: 'must-be-removed' }),
        fetchImpl: async (url, options) => { request = { url, ...options }; return json({ data: [] }); } });
    await api.pricing();
    assert.equal(request.url, '/proxy/https://clodex.xyz/api/pricing');
    assert.equal(request.headers.get('authorization'), null);
    assert.equal(request.headers.get('x-csrf-token'), 'local-csrf');
    assert.equal(request.credentials, 'same-origin');
    await api.models();
    assert.equal(request.url, 'https://clodex.xyz/v1/models');
    assert.equal(request.headers.get('x-csrf-token'), null);
});

test('images use the real endpoint, provider defaults and exactly one billable POST', async () => {
    const { api, calls } = setup([json({ error: { message: 'Busy' } }, 503)]);
    await assert.rejects(api.image({ model: 'image-one', prompt: 'scene' }), { status: 503 });
    assert.equal(calls.length, 1);
    assert.deepEqual(JSON.parse(calls[0].body), { model: 'image-one', prompt: 'scene', n: 1 });
    assert.equal(calls[0].url, 'https://clodex.xyz/v1/images/generations');
});

test('image optional parameters and malformed result handling', async () => {
    const { api, calls } = setup([json({ data: [{ b64_json: 'AAAA' }] }), json({ data: [] })]);
    await api.image({ model: 'image', prompt: 'x', size: '1024x1024', quality: 'high' });
    assert.equal(JSON.parse(calls[0].body).quality, 'high');
    await assert.rejects(api.image({ model: 'image', prompt: 'x' }), { code: 'invalid_response' });
});

test('video creation supports JSON image-to-video and seconds', async () => {
    const { api, calls } = setup([json({ id: 'video_1', status: 'queued', progress: 0 })]);
    assert.equal((await api.createVideo({ model: 'video', prompt: 'x', image: 'data:image/png;base64,AA==', seconds: 5 })).id, 'video_1');
    assert.deepEqual(JSON.parse(calls[0].body), { model: 'video', prompt: 'x', image: 'data:image/png;base64,AA==', seconds: '5' });
});

test('normalizes documented and legacy video status wrappers', () => {
    assert.equal(normalizeVideo({ data: { task_id: 'task_1', status: 'succeeded' } }).status, 'completed');
    assert.equal(normalizeVideo({ id: 't', status: 'RUNNING', progress: '52%' }).progress, 52);
    assert.equal(normalizeVideo({ id: 't', status: 'expired' }).status, 'failed');
    assert.equal(normalizeVideo({ id: 't', status: 'in_progress', progress: 201 }).progress, 100);
    assert.throws(() => normalizeVideo({ status: 'queued' }));
});

test('polls to completion and reports actual provider progress', async () => {
    const { api, calls } = setup([json({ id: 'v', status: 'queued' }), json({ id: 'v', status: 'in_progress', progress: 32 }), json({ id: 'v', status: 'completed', progress: 100 })]);
    const progress = [];
    const result = await api.waitVideo('v', { onProgress: s => progress.push(s.progress) });
    assert.equal(result.status, 'completed'); assert.deepEqual(progress, [null, 32, 100]);
    assert.ok(calls.every(c => c.method === 'GET'));
});

test('polling rejects failure, unknown states and mismatched media task identity', async () => {
    for (const data of [
        { id: 'v', status: 'failed', error: { message: 'Blocked' } },
        { id: 'v', status: 'future_state' }, { id: 'another', status: 'completed' },
    ]) {
        const { api } = setup([json(data)]);
        await assert.rejects(api.waitVideo('v'));
    }
});

test('only safe polling retries transient failures with bounded backoff', async () => {
    const { api, calls } = setup([json({}, 429), json({}, 503), json({ id: 'v', status: 'completed' })]);
    await api.waitVideo('v'); assert.equal(calls.length, 3);
    const unauth = setup([json({}, 401)]);
    await assert.rejects(unauth.api.waitVideo('v'), { status: 401 }); assert.equal(unauth.calls.length, 1);
});

test('polling is bounded and can be resumed with the same ID', async () => {
    const { api } = setup([json({ id: 'v', status: 'queued' }), json({ id: 'v', status: 'queued' })]);
    await assert.rejects(api.waitVideo('v', { timeout: 5000 }), { code: 'poll_timeout' });
});

test('abort stops polling before any request', async () => {
    const { api, calls } = setup([]);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(api.waitVideo('v', { signal: controller.signal }), { name: 'AbortError' });
    assert.equal(calls.length, 0);
});

test('HTTP and JSON-envelope errors redact keys including HTTP 200 errors', async () => {
    const { api } = setup([json({ error: { message: `Bad ${KEY}` } }, 401), json({ success: false, message: `No ${KEY}` })]);
    await assert.rejects(api.models(), e => e instanceof ApiError && !e.message.includes(KEY));
    await assert.rejects(api.models(), e => !e.message.includes(KEY));
    assert.equal(redact(`Bearer ${KEY}`), 'Bearer [redacted]');
});

test('media downloads carry no bearer token and reject dangerous URLs', async () => {
    const { api, calls } = setup([new Response(new Blob(['png'], { type: 'image/png' }))]);
    await api.downloadImage('https://cdn.example.com/a.png');
    assert.equal(calls[0].headers, undefined); assert.equal(calls[0].credentials, 'omit');
    for (const url of ['javascript:alert(1)', 'http://cdn.example.com/a', 'https://localhost/a', 'https://127.0.0.1/a',
        'https://10.1.2.3/a', 'https://[::1]/a', 'https://user:pass@cdn.example.com/a', 'https://cdn.example.com:8443/a']) {
        assert.throws(() => safeMediaUrl(url), url);
    }
});

test('authenticated video content is fetched as bytes, never with a key in the URL', async () => {
    const { api, calls } = setup([new Response(new Blob(['video'], { type: 'video/mp4' }))]);
    const content = await api.videoContent('video_1');
    assert.equal(content.type, 'video/mp4'); assert.equal(calls[0].url, 'https://clodex.xyz/v1/videos/video_1/content');
    assert.ok(!calls[0].url.includes(KEY)); assert.equal(calls[0].redirect, 'error');
});

test('rejects HTML/SVG media, empty content and oversized streams', async () => {
    await assert.rejects(readMediaBlob(new Response('<script>', { headers: { 'content-type': 'text/html' } }), 'video'));
    await assert.rejects(readMediaBlob(new Response('<svg>', { headers: { 'content-type': 'image/svg+xml' } }), 'image'));
    await assert.rejects(readMediaBlob(new Response('', { headers: { 'content-type': 'video/mp4' } }), 'video'));
    await assert.rejects(readMediaBlob(new Response('abcdef', { headers: { 'content-type': 'video/mp4' } }), 'video', 3));
});

test('STT sends native multipart, without manually setting Content-Type or using the JSON proxy', async () => {
    const { api, calls } = setup([json({ text: 'hello' })]);
    api.publicProxy = () => true;
    const file = new File(['test'], 'speech.webm', { type: 'audio/webm' });
    assert.equal(await api.transcribe({ model: 'whisper', file }), 'hello');
    assert.ok(calls[0].body instanceof FormData); assert.equal(calls[0].headers.get('content-type'), null);
    assert.equal(calls[0].url, 'https://clodex.xyz/v1/audio/transcriptions');
    assert.equal(calls[0].body.get('file').name, 'speech.webm');
});

test('task IDs cannot escape their path', () => {
    for (const value of ['', '../models', 'v?key=x', 'v/../x', null]) assert.throws(() => taskId(value));
});
