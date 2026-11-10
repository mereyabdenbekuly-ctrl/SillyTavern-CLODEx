export const ORIGIN = 'https://clodex.xyz';
export const MAX_MEDIA_BYTES = 100 * 1024 * 1024;

export class ApiError extends Error {
    constructor(message, { status = 0, code = 'request_failed' } = {}) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
        this.code = code;
    }
}

export function redact(value, key = '') {
    let text = String(value ?? 'Request failed');
    if (key) text = text.split(key).join('[redacted]');
    return text.replace(/sk-[a-z\d_-]+/gi, '[redacted]').slice(0, 400);
}

export function validateKey(key) {
    const value = String(key ?? '').trim();
    if (!/^sk-[a-z\d_-]{6,}$/i.test(value)) throw new ApiError('Enter a valid CLODEx sk-… key.', { code: 'key_required' });
    return value;
}

export function taskId(value) {
    const id = String(value ?? '');
    if (!/^[a-z\d_-]{1,200}$/i.test(id)) throw new ApiError('Invalid video task ID.', { code: 'invalid_response' });
    return id;
}

export function safeMediaUrl(value) {
    const url = new URL(String(value));
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || url.username || url.password || url.port && url.port !== '443'
        || host === 'localhost' || !host.includes('.') || host.endsWith('.localhost') || host.endsWith('.local')
        || host.endsWith('.internal') || /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(':')) {
        throw new ApiError('Unsafe media URL rejected.', { code: 'unsafe_url' });
    }
    return url.href;
}

export function normalizeVideo(payload) {
    const data = payload?.data && !Array.isArray(payload.data) ? payload.data : payload;
    if (!data || typeof data !== 'object') throw new ApiError('Invalid video response.', { code: 'invalid_response' });
    const state = String(data.status ?? '').toLowerCase();
    const status = ['completed', 'succeeded', 'success'].includes(state) ? 'completed'
        : ['failed', 'error', 'cancelled', 'canceled', 'expired'].includes(state) ? 'failed'
            : ['queued', 'pending', 'submitted', 'not_start', 'created'].includes(state) ? 'queued'
                : ['in_progress', 'running', 'processing', 'started'].includes(state) ? 'in_progress' : 'unknown';
    const progress = Number.parseFloat(data.progress);
    return {
        id: taskId(data.id ?? data.task_id), status,
        progress: Number.isFinite(progress) ? Math.min(100, Math.max(0, progress)) : null,
        error: redact(data.error?.message ?? data.fail_reason ?? 'Video generation failed.'),
    };
}

export function abortableDelay(ms, signal) {
    return new Promise((resolve, reject) => {
        signal?.throwIfAborted();
        const abort = () => { clearTimeout(timer); reject(signal.reason ?? new DOMException('Aborted', 'AbortError')); };
        const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
        signal?.addEventListener('abort', abort, { once: true });
    });
}

export class ClodexApi {
    constructor({ getKey, fetchImpl = globalThis.fetch.bind(globalThis), publicProxy = () => false,
        getRequestHeaders = () => ({}), sleep = abortableDelay, now = Date.now } = {}) {
        this.getKey = getKey;
        this.fetch = fetchImpl;
        this.publicProxy = publicProxy;
        this.getRequestHeaders = getRequestHeaders;
        this.sleep = sleep;
        this.now = now;
    }

    async request(path, { method = 'GET', body, auth = true, signal, timeout = 60_000, blob = false } = {}) {
        // Credentials can only be sent to this fixed origin, never to a model-supplied URL.
        if (!/^\/(v1\/|api\/(usage\/token\/|status$|pricing$))/.test(path)
            || path.includes('..') || path.includes('\\') || path.includes('#')) throw new ApiError('Invalid API path.');
        const key = auth ? validateKey(this.getKey?.()) : '';
        const proxy = !auth && this.publicProxy() && ['/api/status', '/api/pricing'].includes(path);
        const headers = new Headers(proxy ? this.getRequestHeaders() : {});
        headers.delete('Authorization');
        headers.delete('Content-Type');
        if (key) headers.set('Authorization', `Bearer ${key}`);
        const multipart = typeof FormData !== 'undefined' && body instanceof FormData;
        if (body !== undefined && !multipart) headers.set('Content-Type', 'application/json');
        const controller = new AbortController();
        const abort = () => controller.abort(signal.reason);
        signal?.throwIfAborted();
        signal?.addEventListener('abort', abort, { once: true });
        const timer = setTimeout(() => controller.abort(new DOMException('Request timed out', 'TimeoutError')), timeout);
        try {
            const url = proxy ? `/proxy/${ORIGIN}${path}` : `${ORIGIN}${path}`;
            const response = await this.fetch(url, {
                method, headers, body: body === undefined ? undefined : multipart ? body : JSON.stringify(body),
                credentials: proxy ? 'same-origin' : 'omit', redirect: 'error', referrerPolicy: 'no-referrer',
                signal: controller.signal,
            });
            if (!response.ok) {
                const detail = await response.json().catch(() => ({}));
                throw new ApiError(redact(detail.error?.message ?? detail.message ?? `HTTP ${response.status}`, key),
                    { status: response.status, code: 'http_error' });
            }
            if (blob) return await readMediaBlob(response, blob);
            const data = await response.json();
            if (data.error || data.success === false || data.code === false) {
                throw new ApiError(redact(data.error?.message ?? data.message, key), { code: 'api_error' });
            }
            return data;
        } catch (error) {
            if (controller.signal.aborted) throw controller.signal.reason;
            if (error instanceof ApiError) throw error;
            throw new ApiError('Network/CORS error. Check the connection and CLODEx API availability.', { code: 'network_error' });
        } finally {
            clearTimeout(timer);
            signal?.removeEventListener('abort', abort);
        }
    }

    models(signal) { return this.request('/v1/models', { signal }); }
    quota(signal) { return this.request('/api/usage/token/', { signal }); }
    pricing(signal) { return this.request('/api/pricing', { signal, auth: false, timeout: 15_000 }); }
    status(signal) { return this.request('/api/status', { signal, auth: false, timeout: 15_000 }); }
    voices(model, { search = '', page = 1, signal } = {}) {
        const query = new URLSearchParams({ model, search, page: String(page), page_size: '100' });
        return this.request(`/v1/audio/voices?${query}`, { signal });
    }

    async image({ model, prompt, size, quality }, signal) {
        const body = { model, prompt, n: 1 };
        if (size) body.size = size;
        if (quality) body.quality = quality;
        const data = await this.request('/v1/images/generations', { method: 'POST', body, signal, timeout: 180_000 });
        const result = data.data?.[0];
        if (!result?.b64_json && !result?.url) throw new ApiError('Image response contains no image.', { code: 'invalid_response' });
        return result;
    }

    async createVideo({ model, prompt, seconds, image }, signal) {
        const body = { model, prompt };
        if (seconds) body.seconds = String(seconds);
        if (image) body.image = image; // CLODEx's common JSON image-to-video input (data URL).
        return normalizeVideo(await this.request('/v1/videos', { method: 'POST', body, signal, timeout: 120_000 }));
    }

    async waitVideo(id, { signal, onProgress = () => {}, timeout = 20 * 60_000, interval = 3000 } = {}) {
        id = taskId(id);
        const start = this.now();
        let transientErrors = 0;
        while (this.now() - start < timeout) {
            signal?.throwIfAborted();
            let result;
            try {
                result = normalizeVideo(await this.request(`/v1/videos/${encodeURIComponent(id)}`, { signal }));
                if (result.id !== id) throw new ApiError('Video response belongs to a different task.', { code: 'invalid_response' });
                transientErrors = 0;
            } catch (error) {
                // Only safe GET polling is retried, never a billable creation request.
                if (![429, 502, 503, 504].includes(error.status) || ++transientErrors > 4) throw error;
                await this.sleep(Math.min(30_000, interval * 2 ** transientErrors), signal);
                continue;
            }
            await onProgress(result);
            if (result.status === 'completed') return result;
            if (result.status === 'failed') throw new ApiError(result.error, { code: 'video_failed' });
            if (result.status === 'unknown') throw new ApiError('Unknown video status; polling paused.', { code: 'invalid_response' });
            await this.sleep(interval, signal);
        }
        throw new ApiError('Polling timed out. Resume this task; do not create a second video.', { code: 'poll_timeout' });
    }

    videoContent(id, signal) {
        return this.request(`/v1/videos/${encodeURIComponent(taskId(id))}/content`, { blob: 'video', signal, timeout: 180_000 });
    }

    speech({ model, input, voice }, signal) {
        return this.request('/v1/audio/speech', {
            method: 'POST', body: { model, input, voice, response_format: 'mp3' }, blob: 'audio', signal, timeout: 120_000,
        });
    }

    async transcribe({ model, file }, signal) {
        if (!file || file.size > 25 * 1024 * 1024) throw new ApiError('Choose an audio file up to 25 MB.');
        const body = new FormData();
        body.set('model', model);
        body.set('file', file, file.name || 'recording.webm');
        const result = await this.request('/v1/audio/transcriptions', { method: 'POST', body, signal, timeout: 120_000 });
        if (typeof result.text !== 'string') throw new ApiError('Transcription response contains no text.');
        return result.text;
    }

    async downloadImage(url, signal) {
        const safe = safeMediaUrl(url);
        const controller = new AbortController();
        const abort = () => controller.abort(signal.reason);
        signal?.throwIfAborted();
        signal?.addEventListener('abort', abort, { once: true });
        const timer = setTimeout(() => controller.abort(new DOMException('Media download timed out', 'TimeoutError')), 120_000);
        try {
            // A returned media URL never receives the API key, even on the CLODEx origin.
            const response = await this.fetch(safe, { signal: controller.signal, credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer' });
            if (!response.ok) throw new ApiError(`Image download failed: HTTP ${response.status}.`);
            return await readMediaBlob(response, 'image');
        } finally {
            clearTimeout(timer);
            signal?.removeEventListener('abort', abort);
        }
    }
}

export async function readMediaBlob(response, kind, maxBytes = MAX_MEDIA_BYTES) {
    if (Number(response.headers.get('content-length')) > maxBytes) throw new ApiError('Media exceeds the local size limit.');
    const mime = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() || '';
    const allowed = {
        image: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
        video: ['video/mp4', 'video/webm'],
        audio: ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/webm', 'audio/mp4'],
    };
    if (!allowed[kind]?.includes(mime)) throw new ApiError(`Unexpected ${kind} content type.`, { code: 'invalid_media' });
    const reader = response.body?.getReader();
    if (!reader) throw new ApiError('Empty media response.');
    const chunks = [];
    let size = 0;
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > maxBytes) throw new ApiError('Media exceeds the local size limit.');
            chunks.push(value);
        }
    } catch (error) {
        await reader.cancel().catch(() => {});
        throw error;
    } finally { reader.releaseLock(); }
    if (!size) throw new ApiError('Empty media response.');
    return new Blob(chunks, { type: mime });
}
