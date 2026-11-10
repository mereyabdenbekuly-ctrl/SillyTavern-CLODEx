import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativeTtsProvider, normalizeVoices, registerNativeTts } from '../src/tts.js';

function fixture(overrides = {}) {
    const settings = { speechModel: 'eleven_v4', voice: 'manual-id', confirmPaid: true };
    let key = 'sk-test-only-not-a-real-credential';
    const calls = [];
    const bridge = createNativeTtsProvider({ api: { speech: async (payload, signal) => { signal.throwIfAborted(); calls.push(payload); return new Blob(['test-audio'], { type: 'audio/mpeg' }); } },
        getKey: () => key, getSettings: () => settings, voices: async () => normalizeVoices({ voices: [{ name: 'Voice', voice_id: 'catalog-id', locale: 'ru' }] }),
        confirm: async () => true, ...overrides });
    return { bridge, provider: new bridge.Provider(), settings, calls, setKey(value) { key = value; } };
}

test('native TTS serializes only voice maps, supports manual voices and returns a Response', async () => {
    const f = fixture(); await f.provider.loadSettings({ voiceMap: { Alice: 'manual-id' }, apiKey: 'do-not-copy', speechModel: 'old' });
    assert.deepEqual(f.provider.settings, { voiceMap: { Alice: 'manual-id' } });
    assert.equal((await f.provider.getVoice('manual-id')).voice_id, 'manual-id');
    assert.equal((await f.provider.getVoice('Voice (catalog-id)')).lang, 'ru');
    const audio = await f.provider.generateTts('Hello', 'manual-id');
    assert.ok(audio instanceof Response); assert.equal(audio.headers.get('Content-Type'), 'audio/mpeg');
    assert.equal(await audio.text(), 'test-audio');
    assert.deepEqual(f.calls, [{ model: 'eleven_v4', input: 'Hello', voice: 'manual-id' }]);
});

test('native TTS holds the paid-request lock while awaiting confirmation', async () => {
    let answer; const f = fixture({ confirm: () => new Promise(resolve => { answer = resolve; }) });
    const first = f.provider.generateTts('first', 'manual-id');
    await Promise.resolve(); await Promise.resolve();
    await assert.rejects(f.provider.generateTts('second', 'manual-id'), /already running/);
    answer(true); await first; assert.equal(f.calls.length, 1);
});

test('cancel or key/model replacement during confirmation prevents a paid POST', async () => {
    for (const action of ['cancel', 'key', 'model', 'decline', 'dispose']) {
        let answer; const f = fixture({ confirm: () => new Promise(resolve => { answer = resolve; }) });
        const first = f.provider.generateTts('test', 'manual-id');
        await Promise.resolve(); await Promise.resolve();
        if (action === 'cancel') f.bridge.cancel();
        if (action === 'key') f.setKey('sk-replacement-test-only');
        if (action === 'model') f.settings.speechModel = 'other-model';
        if (action === 'dispose') f.bridge.dispose();
        answer(action !== 'decline');
        await assert.rejects(first, error => error.name === 'AbortError'); assert.equal(f.calls.length, 0);
    }
});

test('a failed voice catalog retains the configured manual voice without guessing provider voices', async () => {
    const f = fixture({ voices: async () => { throw new Error('Unsupported catalog'); } });
    assert.deepEqual(await f.provider.fetchTtsVoiceObjects(), [{ name: 'manual-id', voice_id: 'manual-id', lang: 'und', preview_url: false }]);
    await assert.rejects(f.provider.getVoice('unrelated'), /Select a CLODEx voice/);
});

test('voice IDs disambiguate equal names and untrusted preview URLs are not returned', () => {
    const voices = normalizeVoices({ voices: [{ name: 'Same', voice_id: 'a', preview_url: 'https://untrusted.invalid/voice' }, { name: 'Same', voice_id: 'b' }, { voice_id: 'a', name: 'Same' }, { name: 'invalid' }] });
    assert.equal(voices.length, 2); assert.notEqual(voices[0].name, voices[1].name);
    assert.ok(voices.every(voice => voice.preview_url === false));
    assert.throws(() => normalizeVoices({ data: [] }), /Invalid voice catalog/);
});

test('provider registration is idempotent and subsequent instances use the current bridge', () => {
    const providers = []; const register = (name, Provider) => providers.push({ name, Provider });
    registerNativeTts(register, { Provider: class { version = 1; } });
    assert.equal(new providers[0].Provider().version, 1);
    registerNativeTts(register, { Provider: class { version = 2; } });
    assert.equal(providers.length, 1); assert.equal(providers[0].name, 'CLODEx'); assert.equal(new providers[0].Provider().version, 2);
});

test('native preview metadata cannot inject markup or inline event-handler code', async () => {
    const list = normalizeVoices({ voices: [{ voice_id: "bad');alert(1);//", name: 'bad' }, { voice_id: 'safe-id', name: '<img src=x onerror="alert(1)">', locale: '<script>' }] });
    assert.equal(list.length, 1); assert.ok(!/[<>"'&]/.test(list[0].name)); assert.equal(list[0].lang, 'script');
    const f = fixture(); f.settings.voice = "x');alert(1);//";
    await assert.rejects(f.provider.fetchTtsVoiceObjects(), /unsupported characters/);
    await assert.rejects(f.provider.generateTts('hello', f.settings.voice), /valid voice ID/); assert.equal(f.calls.length, 0);
});

test('native voice preview uses the same paid confirmation and cleans up playback', async () => {
    let playing = false; const audio = new EventTarget(); audio.play = async () => { playing = true; }; audio.pause = () => { playing = false; };
    const errors = []; const f = fixture({ createAudio: () => audio, onError: error => errors.push(error) });
    await f.provider.previewTtsVoice('manual-id'); assert.equal(playing, true); assert.ok(audio.src.startsWith('blob:')); assert.equal(f.calls.length, 1);
    f.bridge.cancel(); assert.equal(playing, false); assert.equal(f.provider.previewURL, ''); assert.equal(errors.length, 0);
});

test('disabling a native bridge also blocks providers constructed after disposal', async () => {
    const f = fixture(); f.bridge.dispose();
    const late = new f.bridge.Provider();
    await assert.rejects(late.checkReady(), /disposed/);
    await assert.rejects(late.generateTts('No request after disable', 'manual-id'), /disposed/);
    assert.equal(f.calls.length, 0);
});
