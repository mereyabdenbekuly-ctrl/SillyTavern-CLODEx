import test from 'node:test';
import assert from 'node:assert/strict';
import { MicrophoneRecorder } from '../src/microphone.js';

function fixture(overrides = {}) {
    let stops = 0, timer;
    const stream = { getTracks: () => [{ stop: () => { stops++; } }] };
    class Recorder extends EventTarget {
        static isTypeSupported(type) { return type === 'audio/webm;codecs=opus'; }
        constructor(_stream, options) { super(); this.mimeType = options.mimeType; this.state = 'inactive'; }
        start(interval) { assert.equal(interval, 1000); this.state = 'recording'; }
        chunk(text) { const event = new Event('dataavailable'); event.data = new Blob([text], { type: this.mimeType }); this.dispatchEvent(event); }
        stop() { this.state = 'inactive'; this.dispatchEvent(new Event('stop')); }
    }
    const errors = [];
    const mic = new MicrophoneRecorder({ mediaDevices: { getUserMedia: async constraints => { assert.deepEqual(constraints, { audio: true, video: false }); return stream; } }, Recorder,
        setTimer: callback => { timer = callback; return 1; }, clearTimer: () => { timer = null; }, onError: error => errors.push(error), ...overrides });
    return { mic, stream, errors, get stops() { return stops; }, timeout: () => timer() };
}

test('recording creates a local playable file, stops tracks and never uploads', async () => {
    const f = fixture(); assert.equal(await f.mic.start(), true);
    const recorder = f.mic.session.recorder; recorder.chunk('audio');
    assert.equal(f.mic.file, null); assert.equal(f.mic.state, 'recording');
    await assert.rejects(f.mic.start(), error => error.code === 'mic_busy');
    const file = await f.mic.stop();
    assert.equal(file.name, 'recording.webm'); assert.equal(await file.text(), 'audio');
    assert.equal(f.mic.state, 'ready'); assert.equal(f.stops, 1);
    f.mic.cancel(); assert.equal(f.mic.file, null); assert.equal(f.mic.state, 'idle');
});

test('cancelling a pending permission request releases a subsequently granted stream', async () => {
    let grant;
    const f = fixture({ mediaDevices: { getUserMedia: () => new Promise(resolve => { grant = resolve; }) } });
    const starting = f.mic.start(); assert.equal(f.mic.state, 'requesting');
    f.mic.cancel(); grant(f.stream);
    assert.equal(await starting, false); assert.equal(f.stops, 1); assert.equal(f.mic.state, 'idle');
});

test('denied or unsupported microphones fail without keeping an active session', async () => {
    const f = fixture({ mediaDevices: { getUserMedia: async () => { throw new DOMException('Denied', 'NotAllowedError'); } } });
    await assert.rejects(f.mic.start(), error => error.code === 'mic_denied');
    assert.equal(f.mic.state, 'idle'); assert.equal(f.mic.session, null);
    await assert.rejects(fixture({ Recorder: null }).mic.start(), error => error.code === 'mic_unsupported');
});

test('duration limit keeps the local recording but byte limit discards it', async () => {
    const f = fixture({ maxBytes: 5 }); await f.mic.start(); f.mic.session.recorder.chunk('abc'); f.timeout();
    assert.equal(f.mic.state, 'ready'); assert.equal(f.mic.file.size, 3); assert.equal(f.stops, 1);
    await f.mic.start(); f.mic.session.recorder.chunk('abcdef');
    assert.equal(f.mic.state, 'idle'); assert.equal(f.mic.file, null); assert.equal(f.stops, 2); assert.equal(f.errors[0].code, 'mic_too_large');
});

test('recorder errors discard partial audio and release tracks', async () => {
    const f = fixture(); await f.mic.start(); const recorder = f.mic.session.recorder;
    recorder.chunk('abc'); recorder.dispatchEvent(new Event('error'));
    assert.equal(f.mic.file, null); assert.equal(f.mic.session, null); assert.equal(f.stops, 1); assert.equal(f.errors[0].code, 'mic_failed');
    recorder.chunk('late'); assert.equal(f.mic.file, null);
});
