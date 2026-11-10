import { ApiError } from './api.js';

// Recording is local-only. Stopping never uploads audio or submits a chat message.
export class MicrophoneRecorder {
    constructor({ mediaDevices = globalThis.navigator?.mediaDevices, Recorder = globalThis.MediaRecorder,
        maxBytes = 24 * 1024 * 1024, maxMilliseconds = 120_000,
        setTimer = (fn, ms) => globalThis.setTimeout(fn, ms), clearTimer = id => globalThis.clearTimeout(id),
        onChange = () => {}, onError = () => {} } = {}) {
        Object.assign(this, { mediaDevices, Recorder, maxBytes, maxMilliseconds, setTimer, clearTimer, onChange, onError });
        this.state = 'idle'; this.file = null; this.session = null; this.epoch = 0;
    }

    get supported() { return !!this.mediaDevices?.getUserMedia && typeof this.Recorder === 'function'; }
    get busy() { return ['requesting', 'recording', 'stopping'].includes(this.state); }
    change(state) { this.state = state; this.onChange(state, this.file); }

    async start() {
        if (!this.supported) throw new ApiError('Microphone recording requires HTTPS or localhost and a supported browser.', { code: 'mic_unsupported' });
        if (this.busy) throw new ApiError('A microphone recording is already running.', { code: 'mic_busy' });
        this.cancel();
        const epoch = this.epoch;
        this.change('requesting');
        let stream;
        try {
            stream = await this.mediaDevices.getUserMedia({ audio: true, video: false });
            if (epoch !== this.epoch) { stream.getTracks().forEach(track => track.stop()); return false; }
            const mimeType = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4']
                .find(type => this.Recorder.isTypeSupported?.(type));
            const recorder = new this.Recorder(stream, mimeType ? { mimeType } : undefined);
            const session = { recorder, stream, chunks: [], bytes: 0, timer: null, epoch };
            session.done = new Promise(resolve => { session.resolve = resolve; });
            this.session = session;
            recorder.addEventListener('dataavailable', event => {
                if (this.session !== session || !event.data?.size) return;
                session.bytes += event.data.size;
                if (session.bytes > this.maxBytes) {
                    this.cancel();
                    this.onError(new ApiError('Recording exceeds the audio upload limit.', { code: 'mic_too_large' }));
                } else session.chunks.push(event.data);
            });
            recorder.addEventListener('error', () => {
                if (this.session !== session) return;
                this.cancel();
                this.onError(new ApiError('Microphone recording failed.', { code: 'mic_failed' }));
            });
            recorder.addEventListener('stop', () => {
                if (this.session !== session) return;
                this.clearTimer(session.timer);
                stream.getTracks().forEach(track => track.stop());
                this.session = null;
                const type = recorder.mimeType || mimeType || session.chunks[0]?.type || 'audio/webm';
                const extension = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
                this.file = session.bytes ? new File(session.chunks, `recording.${extension}`, { type }) : null;
                session.chunks = [];
                this.change(this.file ? 'ready' : 'idle');
                session.resolve(this.file);
            });
            recorder.start(1000);
            this.change('recording');
            session.timer = this.setTimer(() => { this.stop(); }, this.maxMilliseconds);
            return true;
        } catch (error) {
            stream?.getTracks().forEach(track => track.stop());
            if (epoch !== this.epoch) return false;
            this.cancel();
            throw new ApiError(error?.name === 'NotAllowedError' ? 'Microphone permission was denied.' : 'Unable to start microphone recording.',
                { code: error?.name === 'NotAllowedError' ? 'mic_denied' : 'mic_failed' });
        }
    }

    stop() {
        const session = this.session;
        if (!session) return Promise.resolve(this.file);
        if (this.state === 'recording') {
            this.change('stopping');
            this.clearTimer(session.timer);
            try { session.recorder.stop(); }
            catch { this.cancel(); this.onError(new ApiError('Unable to finish microphone recording.', { code: 'mic_failed' })); }
        }
        return session.done;
    }

    cancel() {
        this.epoch++;
        const session = this.session;
        this.session = null; this.file = null;
        if (session) {
            this.clearTimer(session.timer);
            try { if (session.recorder.state !== 'inactive') session.recorder.stop(); } catch { /* Already stopped. */ }
            session.stream.getTracks().forEach(track => track.stop());
            session.chunks = []; session.resolve(null);
        }
        this.change('idle');
    }
}
