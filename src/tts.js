import { ApiError, validateKey } from './api.js';

const registrations = new WeakMap();
// Native SillyTavern's voice-preview popup interpolates IDs into an inline
// handler and names into HTML. Do not pass provider-controlled markup to it.
const safeVoiceId = value => typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,200}$/.test(value);
const voiceLabel = value => String(value).replace(/[<>&"'\x00-\x1f\x7f]/g, '').slice(0, 200);
export function registerNativeTts(register, bridge) {
    const previous = registrations.get(register);
    if (previous) { previous.Provider = bridge.Provider; return; }
    const holder = { Provider: bridge.Provider };
    register('CLODEx', class { constructor() { return new holder.Provider(); } });
    registrations.set(register, holder);
}

export function normalizeVoices(payload) {
    if (!Array.isArray(payload?.voices)) throw new ApiError('Invalid voice catalog response.');
    return [...new Map(payload.voices.filter(voice => safeVoiceId(voice.voice_id))
        .map(voice => [voice.voice_id, { voice_id: voice.voice_id,
            name: voice.name ? `${voiceLabel(voice.name)} (${voice.voice_id})` : voice.voice_id,
            lang: String(voice.locale || voice.language || 'und').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40),
            preview_url: false }])).values()];
}

// The native provider reuses the extension's key; never serialize it into TTS
// settings (SillyTavern logs those settings when saving a voice map).
export function createNativeTtsProvider({ api, getKey, getSettings, voices, confirm, onComplete = () => {}, onError = () => {},
    previewText = () => 'This is a CLODEx voice preview.', createAudio = () => new Audio(),
    settingsHtml = '<p>Configure the model, key and voices in CLODEx. Native TTS uses the same account and may incur charges.</p>' }) {
    const instances = new Set();
    let bridgeDisposed = false;
    class ClodexTtsProvider {
        constructor() { this.settings = { voiceMap: {} }; this.active = null; this.disposed = bridgeDisposed; instances.add(this); }
        get settingsHtml() { return typeof settingsHtml === 'function' ? settingsHtml() : settingsHtml; }
        get separator() { return '. '; }
        async loadSettings(saved = {}) {
            this.settings = { voiceMap: saved.voiceMap && typeof saved.voiceMap === 'object' ? saved.voiceMap : {} };
        }
        async checkReady() {
            if (this.disposed) throw new ApiError('CLODEx TTS provider was disposed.');
            validateKey(getKey());
            if (!getSettings().speechModel) throw new ApiError('Select a speech model in CLODEx settings.');
        }
        async fetchTtsVoiceObjects() {
            await this.checkReady();
            const list = await voices().catch(() => []);
            const manual = getSettings().voice;
            if (manual && !safeVoiceId(manual)) throw new ApiError('Voice ID contains unsupported characters.');
            return manual && !list.some(voice => voice.voice_id === manual)
                ? [{ name: manual, voice_id: manual, lang: 'und', preview_url: false }, ...list] : list;
        }
        async getVoice(name) {
            const list = await this.fetchTtsVoiceObjects();
            const voice = list.find(item => item.name === name || item.voice_id === name);
            if (!voice) throw new ApiError('Select a CLODEx voice in the native TTS voice map.');
            return voice;
        }
        async generateTts(text, voiceId) {
            await this.checkReady();
            if (this.active) throw new ApiError('CLODEx TTS is already running.');
            if (typeof text !== 'string' || !text.trim() || !safeVoiceId(voiceId)) throw new ApiError('Speech text and a valid voice ID are required.');
            const controller = new AbortController(); this.active = controller;
            const key = getKey(), model = getSettings().speechModel;
            try {
                if (getSettings().confirmPaid && !await confirm(model)) throw new DOMException('Cancelled', 'AbortError');
                controller.signal.throwIfAborted();
                if (key !== getKey() || model !== getSettings().speechModel) throw new DOMException('CLODEx settings changed', 'AbortError');
                const blob = await api.speech({ model, input: text, voice: voiceId }, controller.signal);
                controller.signal.throwIfAborted();
                await onComplete();
                return new Response(blob, { headers: { 'Content-Type': blob.type } });
            } finally { if (this.active === controller) this.active = null; }
        }
        onSettingsChange() { /* No separate API key or model settings. */ }
        async onRefreshClick() { return this.fetchTtsVoiceObjects(); }
        stopPreview() {
            this.previewEpoch = (this.previewEpoch || 0) + 1;
            this.previewAudio?.pause(); this.previewAudio = null;
            if (this.previewURL) URL.revokeObjectURL(this.previewURL);
            this.previewURL = '';
        }
        async previewTtsVoice(voiceId) {
            try {
                this.stopPreview();
                const epoch = this.previewEpoch;
                const response = await this.generateTts(previewText(), voiceId);
                const blob = await response.blob();
                if (this.disposed || epoch !== this.previewEpoch) return;
                this.previewURL = URL.createObjectURL(blob); this.previewAudio = createAudio();
                this.previewAudio.src = this.previewURL;
                this.previewAudio.addEventListener('ended', () => this.stopPreview(), { once: true });
                await this.previewAudio.play();
            } catch (error) { this.stopPreview(); onError(error); }
        }
        dispose() { this.disposed = true; this.active?.abort(); this.stopPreview(); instances.delete(this); }
    }
    return { Provider: ClodexTtsProvider, cancel() { for (const instance of instances) { instance.active?.abort(); instance.stopPreview(); } },
        dispose() { bridgeDisposed = true; for (const instance of instances) instance.dispose(); } };
}
