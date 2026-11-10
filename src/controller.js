import { ApiError, validateKey } from './api.js';
import { addJob, assertTarget, attachMedia, blobToBase64, captureTarget, createScenePrompt,
    imageFromBase64, jobError, jobsFor, localMediaPath, saveMedia, targetIsCurrent } from './chat.js';

export class GenerationController {
    constructor({ api, getContext, settings, render = () => {}, confirm = async () => true,
        persistMedia = saveMedia, fetchImpl = globalThis.fetch.bind(globalThis), now = Date.now }) {
        Object.assign(this, { api, getContext, settings, render, confirm, persistMedia, fetchImpl, now });
        this.active = null;
        this.lastAutoAt = -Infinity;
        this.autoSeen = new WeakMap();
    }

    cancel() { this.active?.abort.abort(new DOMException('Stopped locally. The server task may still run.', 'AbortError')); }

    async save(target) {
        const context = this.getContext();
        assertTarget(context, target);
        await context.saveChat();
        if (targetIsCurrent(this.getContext(), target)) this.render(target.index);
    }

    async imageReference(target, signal) {
        const media = target.message.extra?.media;
        const selected = media?.[target.message.extra?.media_index];
        const image = selected?.type === 'image' ? selected : media?.findLast(m => m.type === 'image');
        const url = image?.url ?? target.message.extra?.image;
        if (!url) throw new ApiError('This message has no image to animate.');
        let blob;
        if (/^https:\/\//.test(url)) blob = await this.api.downloadImage(url, signal);
        else {
            const response = await this.fetchImpl(localMediaPath(url), { signal, credentials: 'same-origin', redirect: 'error' });
            const { readMediaBlob } = await import('./api.js');
            if (!response.ok) throw new ApiError('Cannot load the reference image.');
            blob = await readMediaBlob(response, 'image', 20 * 1024 * 1024);
        }
        if (blob.size > 20 * 1024 * 1024) throw new ApiError('The reference image exceeds 20 MB.');
        return `data:${blob.type};base64,${await blobToBase64(blob)}`;
    }

    async run(kind, { index, prompt = '', animate = false, source = 'manual', resumeJob } = {}) {
        if (this.active) throw new ApiError('A CLODEx operation is already running.', { code: 'busy' });
        validateKey(this.api.getKey?.());
        const target = captureTarget(this.getContext(), index);
        const model = resumeJob?.model ?? this.settings[`${kind === 'audio' ? 'speech' : kind}Model`];
        if (!model) throw new ApiError(`Select a ${kind} model first.`, { code: 'model_required' });
        const abort = new AbortController();
        const signal = abort.signal;
        this.active = { abort, target };
        let job;
        let submitted = false;
        try {
            if (!resumeJob && source !== 'auto' && (source === 'tool' || this.settings.confirmPaid)) {
                if (!await this.confirm(kind, model)) return '';
            }
            signal.throwIfAborted();
            assertTarget(this.getContext(), target);
            job = resumeJob ?? { id: crypto.randomUUID(), kind, model, source, createdAt: this.now(), status: 'preparing', progress: null };
            if (!resumeJob) addJob(target.message, job);
            job.error = '';
            await this.save(target);
            let blob;
            if (kind === 'audio') {
                prompt = String(prompt || target.message.mes || '').trim();
                if (!prompt || prompt.length > 12_000) throw new ApiError('Speech input must contain 1–12000 characters.');
                job.status = 'submitting';
                await this.save(target);
                submitted = true;
                blob = await this.api.speech({ model, input: prompt, voice: this.settings.voice }, signal);
            } else if (resumeJob) {
                if (kind !== 'video' || !job.taskId) throw new ApiError('Only an existing video task can be resumed.');
                blob = await this.finishVideo(job, target, signal);
            } else {
                if (!prompt.trim()) {
                    const context = this.getContext();
                    if (context.streamingProcessor && !context.streamingProcessor.isFinished) throw new ApiError('Wait for the character reply to finish.');
                    prompt = await createScenePrompt(context, target, this.settings.quietPrompt);
                }
                signal.throwIfAborted();
                assertTarget(this.getContext(), target);
                if (!prompt.trim() || prompt.length > 12_000) throw new ApiError('Prompt must contain 1–12000 characters.');
                const image = animate ? await this.imageReference(target, signal) : undefined;
                signal.throwIfAborted();
                assertTarget(this.getContext(), target);
                job.status = 'submitting';
                await this.save(target);
                submitted = true;
                if (kind === 'image') {
                    const result = await this.api.image({ model, prompt, size: this.settings.imageSize, quality: this.settings.imageQuality }, signal);
                    job.status = 'saving';
                    blob = result.b64_json ? imageFromBase64(result.b64_json) : await this.api.downloadImage(result.url, signal);
                } else if (kind === 'video') {
                    const result = await this.api.createVideo({ model, prompt, seconds: this.settings.videoSeconds, image }, signal);
                    // Record the task before polling, so reload/resume never submits another paid POST.
                    job.taskId = result.id;
                    job.status = result.status;
                    job.progress = result.progress;
                    await this.save(target);
                    if (result.status === 'failed') throw new ApiError(result.error, { code: 'video_failed' });
                    blob = await this.finishVideo(job, target, signal);
                } else throw new ApiError('Unsupported generation type.');
            }
            signal.throwIfAborted();
            assertTarget(this.getContext(), target);
            job.status = 'saving';
            await this.save(target);
            const url = await this.persistMedia(this.getContext(), blob, { signal });
            signal.throwIfAborted();
            assertTarget(this.getContext(), target);
            attachMedia(target.message, url, kind, job);
            job.status = 'completed';
            job.progress = 100;
            await this.save(target);
            this.getContext().updateMessageBlock?.(target.index, target.message, { rerenderMessage: false });
            this.render(target.index);
            return url;
        } catch (error) {
            if (job) {
                job.status = job.taskId && error.code !== 'video_failed' ? 'paused'
                    : submitted && !job.taskId && error.code !== 'http_error' && error.code !== 'api_error' ? 'uncertain' : 'failed';
                job.error = jobError(error, this.api.getKey?.());
                // Never save the current (different) chat with a stale job's result.
                if (targetIsCurrent(this.getContext(), target)) await this.save(target).catch(() => {});
            }
            throw error;
        } finally {
            this.active = null;
            this.render();
        }
    }

    async finishVideo(job, target, signal) {
        await this.api.waitVideo(job.taskId, { signal, onProgress: async result => {
            assertTarget(this.getContext(), target);
            const changed = job.status !== result.status || job.progress !== result.progress;
            job.status = result.status;
            job.progress = result.progress;
            if (changed) await this.save(target);
        } });
        return this.api.videoContent(job.taskId, signal);
    }

    resume(index, id) {
        const target = captureTarget(this.getContext(), index);
        const job = jobsFor(target.message).find(j => j.id === id && j.kind === 'video' && j.taskId && j.status !== 'completed');
        if (!job) throw new ApiError('No resumable video task in this message.');
        return this.run('video', { index, resumeJob: job });
    }

    async autoImage(index) {
        if (!this.settings.autoImages || this.active || this.now() - this.lastAutoAt < 60_000) return;
        const target = captureTarget(this.getContext(), index);
        const signature = `${target.swipe}:${target.text}`;
        if (this.autoSeen.get(target.message) === signature || jobsFor(target.message).some(j => j.source === 'auto')) return;
        this.autoSeen.set(target.message, signature);
        this.lastAutoAt = this.now();
        return this.run('image', { index, source: 'auto' });
    }
}
