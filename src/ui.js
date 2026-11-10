import { ApiError, ClodexApi, redact, validateKey } from './api.js';
import { normalizeCatalog, priceView, quotaView } from './catalog.js';
import { activateTextModel, captureTarget, jobsFor, loadSettings, localMediaPath } from './chat.js';
import { GenerationController } from './controller.js';

export async function initialize({ getContext = () => globalThis.SillyTavern.getContext(),
    fetchImpl = globalThis.fetch.bind(globalThis), document = globalThis.document,
    confirm = message => globalThis.confirm(message), writeSecret, persistMedia } = {}) {
    if (document.querySelector('#clodex-settings')) return;
    const context = getContext();
    const settings = loadSettings(context);
    const base = new URL('../', import.meta.url);
    const [html, en, ru] = await Promise.all([
        fetchImpl(new URL('settings.html', base)).then(r => { if (!r.ok) throw new Error(); return r.text(); }),
        fetchImpl(new URL('i18n/en-us.json', base)).then(r => r.json()),
        fetchImpl(new URL('i18n/ru-ru.json', base)).then(r => r.json()),
    ]);
    const template = document.createElement('template');
    template.innerHTML = html; // Only the bundled static template; API/user strings use textContent below.
    const root = template.content.firstElementChild;
    const parent = document.querySelector('#extensions_settings');
    if (!parent) throw new Error('Missing SillyTavern extension container.');
    parent.append(root);
    const find = selector => root.querySelector(selector);
    let key = '';
    let catalog = [];
    let quota = null;
    let metadata = null;
    let refreshAbort;
    let speechAbort;
    let disposed = false;
    let lastSecretId = '';
    let lastSecretKey = '';
    let latestAutoIndex = null;
    const events = [];
    const locale = () => {
        const choice = settings.language === 'auto' ? getContext().getCurrentLocale?.() ?? globalThis.navigator?.language : settings.language;
        return String(choice).toLowerCase().startsWith('ru') ? 'ru-ru' : 'en-us';
    };
    const t = (id, args = {}) => {
        const dictionary = locale() === 'ru-ru' ? ru : en;
        return String(dictionary[`clodex.${id}`] ?? en[`clodex.${id}`] ?? id)
            .replace(/\{(\w+)\}/g, (match, name) => String(args[name] ?? match));
    };
    const status = (text, error = false) => {
        find('[data-role="status"]').textContent = text;
        find('[data-role="status"]').dataset.error = String(error);
    };
    const report = error => status(error?.name === 'AbortError' ? t('stopped') : redact(error?.message ?? error, key), true);
    const api = new ClodexApi({ getKey: () => key, fetchImpl,
        publicProxy: () => settings.publicMetadataProxy, getRequestHeaders: () => getContext().getRequestHeaders() });
    const controller = new GenerationController({ api, getContext, settings, fetchImpl, persistMedia,
        render: renderMessages, confirm: (kind, model) => confirm(t('paidConfirm', { kind: t(kind), model })) });
    const button = (label, action) => {
        const element = document.createElement('button');
        element.type = 'button'; element.className = 'menu_button'; element.textContent = label;
        element.addEventListener('click', () => Promise.resolve().then(action).catch(report));
        return element;
    };
    const money = value => new Intl.NumberFormat(locale(), { style: 'currency', currency: 'USD', maximumFractionDigits: 6 }).format(value);

    function describePrice(price) {
        const p = priceView(price);
        if (!p) return t('noPrice');
        if (p.unit === 'dynamic') return t('dynamic');
        if (!['request', 'per_1m_total_tokens', 'per_1m_tokens'].includes(p.unit)) return t('dynamic');
        const suffix = p.unit === 'request' ? 'perRequest' : p.unit === 'per_1m_total_tokens' ? 'perTotal' : 'perTokens';
        return [money(p.input) + t(suffix), p.output == null ? '' : t('outputPrice', { value: money(p.output) }),
            p.cached == null ? '' : t('cachePrice', { value: money(p.cached) })].filter(Boolean).join(' · ');
    }

    function renderCatalog() {
        const container = find('[data-role="catalog"]');
        container.replaceChildren();
        const query = find('[data-role="search"]').value.toLowerCase();
        const matches = catalog.filter(m => `${m.id} ${m.name}`.toLowerCase().includes(query));
        if (!matches.length) container.textContent = t(catalog.length ? 'noMatches' : 'emptyCatalog');
        for (const model of matches) {
            const row = document.createElement('div'); row.className = 'clodex-model-row';
            const name = document.createElement('span'); name.textContent = model.name;
            name.title = model.id;
            const price = document.createElement('small'); price.textContent = describePrice(model.price);
            row.append(name, price);
            if (model.kinds.includes('text')) row.append(button(t('use'), () => activate(model.id)));
            container.append(row);
        }
    }

    function renderSelectors() {
        for (const element of root.querySelectorAll('[data-model-kind]')) {
            const setting = element.dataset.setting;
            const kind = element.dataset.modelKind;
            const choices = catalog.filter(m => m.kinds.includes(kind));
            const others = catalog.filter(m => !m.kinds.includes(kind));
            element.replaceChildren();
            const option = (id, label) => {
                const item = document.createElement('option'); item.value = id; item.textContent = label; return item;
            };
            element.append(option('', t('select')));
            for (const model of choices) element.append(option(model.id, model.name));
            if (others.length) {
                const group = document.createElement('optgroup'); group.label = t('otherModels');
                for (const model of others) group.append(option(model.id, model.name));
                element.append(group);
            }
            if (settings[setting] && !catalog.some(m => m.id === settings[setting])) element.append(option(settings[setting], settings[setting]));
            element.value = settings[setting];
        }
    }

    function renderBalance() {
        find('[data-role="balance"]').textContent = '—'; find('[data-role="rub"]').textContent = '—';
        if (!quota) return;
        const value = quotaView(quota, metadata);
        find('[data-role="balance"]').textContent = value.unlimited ? t('unlimited') : value.usd === null
            ? t('units', { value: value.units.toLocaleString(locale()) }) : money(value.usd);
        find('[data-role="rub"]').textContent = value.unlimited || value.rub === null ? '—'
            : new Intl.NumberFormat(locale(), { style: 'currency', currency: 'RUB' }).format(value.rub);
    }

    function renderStatic() {
        for (const element of root.querySelectorAll('[data-clodex-i18n]')) element.textContent = t(element.dataset.clodexI18n);
        for (const element of root.querySelectorAll('[data-setting]')) {
            if (element.type === 'checkbox') element.checked = settings[element.dataset.setting];
            else element.value = settings[element.dataset.setting];
        }
        renderSelectors(); renderCatalog(); renderBalance(); renderMessages();
    }

    function renderMessages() {
        if (disposed) return;
        const ctx = getContext();
        for (const element of document.querySelectorAll('#chat .mes[mesid]')) {
            const index = Number(element.getAttribute('mesid'));
            const message = ctx.chat[index];
            for (const old of element.querySelectorAll('.clodex-message-actions, .clodex-job, .clodex-audio')) old.remove();
            if (!Number.isInteger(index) || !message || message.is_user || message.is_system) continue;
            const block = element.querySelector('.mes_block') ?? element;
            const actions = document.createElement('div'); actions.className = 'clodex-message-actions';
            actions.append(button(t('draw'), () => generate('image', { index })), button(t('video'), () => generate('video', { index })));
            if (message.extra?.image || message.extra?.media?.some(m => m.type === 'image')) {
                actions.append(button(t('animate'), () => generate('video', { index, animate: true })));
            }
            if (settings.speechModel) actions.append(button(t('speak'), () => generate('audio', { index })));
            for (const child of actions.children) child.disabled = Boolean(controller.active);
            block.append(actions);
            for (const job of jobsFor(message).slice(-3)) {
                const box = document.createElement('div'); box.className = 'clodex-job'; box.setAttribute('role', 'status');
                const active = controller.active?.target.message === message && controller.active?.target.swipe === (message.swipe_id ?? 0);
                const unfinished = !['completed', 'failed', 'uncertain'].includes(job.status);
                const displayStatus = unfinished && !active ? job.taskId ? 'paused' : 'uncertain' : job.status;
                const label = document.createElement('span'); label.textContent = `CLODEx · ${job.model} · ${t(displayStatus)}`; box.append(label);
                if (unfinished && active) {
                    const progress = document.createElement('progress'); progress.max = 100;
                    progress.setAttribute('aria-label', t(displayStatus));
                    if (Number.isFinite(job.progress)) progress.value = job.progress;
                    box.append(progress, button(t('cancel'), () => { controller.cancel(); status(t('stopped')); }));
                }
                if (job.taskId && job.status !== 'completed') {
                    const detail = document.createElement('small'); detail.className = 'clodex-job-detail';
                    detail.textContent = t('resumeHint', { id: job.taskId }); box.append(detail);
                    if (!active && job.status !== 'failed') box.append(button(t('resume'), () => controller.resume(index, job.id)));
                }
                if (job.error) {
                    const error = document.createElement('span'); error.className = 'clodex-job-detail'; error.textContent = redact(job.error, key); box.append(error);
                }
                block.append(box);
            }
            const media = message.extra?.media?.filter(m => m.clodex_job_id) ?? [];
            for (const attachment of media) {
                let url;
                try { url = localMediaPath(attachment.url); } catch { continue; }
                if (attachment.type === 'audio' && ![...element.querySelectorAll('audio')].some(a => a.getAttribute('src') === url)) {
                    const wrapper = document.createElement('div'); wrapper.className = 'clodex-audio';
                    const audio = document.createElement('audio'); audio.controls = true; audio.preload = 'none'; audio.src = url;
                    wrapper.append(audio); block.append(wrapper);
                }
                if (attachment.type === 'video') {
                    for (const video of element.querySelectorAll('video')) {
                        if (video.getAttribute('src') !== url && video.querySelector('source')?.getAttribute('src') !== url) continue;
                        video.controls = true; video.loop = settings.loopVideo; video.playsInline = true;
                        video.autoplay = settings.autoplayVideo;
                        if (settings.autoplayVideo) { video.muted = true; video.play?.().catch(() => {}); }
                    }
                }
            }
        }
    }

    async function refresh() {
        const entered = find('[data-role="key"]').value.trim();
        if (entered) {
            const next = validateKey(entered);
            if (next !== key) { controller.cancel(); speechAbort?.abort(); }
            key = next; find('[data-role="key"]').value = '';
        }
        validateKey(key);
        refreshAbort?.abort(); refreshAbort = new AbortController();
        const own = refreshAbort;
        status(t('loading'));
        const [models, prices, allowance, info] = await Promise.allSettled([
            api.models(own.signal), api.pricing(own.signal), api.quota(own.signal), api.status(own.signal),
        ]);
        if (own.signal.aborted || disposed) return;
        if (models.status === 'rejected') {
            catalog = []; quota = null; metadata = null; renderStatic(); throw models.reason;
        }
        catalog = normalizeCatalog(models.value, prices.status === 'fulfilled' ? prices.value : undefined);
        quota = allowance.status === 'fulfilled' ? allowance.value : null;
        metadata = info.status === 'fulfilled' ? info.value : null;
        renderStatic();
        const missingMetadata = prices.status === 'rejected' || info.status === 'rejected';
        status([t('connected', { count: catalog.length }), missingMetadata ? t('metadataUnavailable') : '',
            allowance.status === 'rejected' ? t('quotaUnavailable') : ''].filter(Boolean).join(' '));
    }

    async function activate(model = settings.textModel) {
        validateKey(key);
        if (!model || !catalog.some(m => m.id === model)) throw new ApiError('Select a model from the live catalog.');
        if (!await confirm(t('activateConfirm'))) return;
        const saver = writeSecret ?? (async (name, value, label) => {
            const secrets = await import('../../../../secrets.js');
            if (value === lastSecretKey && secrets.secret_state[name]?.some(s => s.id === lastSecretId && s.active)) return lastSecretId;
            const id = await secrets.writeSecret(name, value, label);
            if (id) { lastSecretId = id; lastSecretKey = value; }
            return id;
        });
        await activateTextModel(getContext(), { model, key, writeSecret: saver, document });
        settings.textModel = model; getContext().saveSettingsDebounced(); renderSelectors();
        status(t('activated', { model }));
    }

    async function generate(kind, options) {
        validateKey(key);
        if (speechAbort) throw new ApiError('Transcription is already running.');
        const result = await controller.run(kind, options);
        if (result && key) {
            try { quota = await api.quota(); renderBalance(); } catch { /* Keep the last known allowance. */ }
        }
        return result;
    }

    async function transcribe() {
        validateKey(key);
        if (speechAbort || controller.active) throw new ApiError('A CLODEx operation is already running.');
        const model = settings.transcriptionModel;
        const file = find('[data-role="audio-file"]').files[0];
        if (!model || !file) throw new ApiError('Select a transcription model and an audio file.');
        const chat = getContext().chat;
        const chatId = getContext().getCurrentChatId?.() ?? getContext().chatId;
        if (!await confirm(t('paidConfirm', { kind: 'STT', model }))) return;
        if (chat !== getContext().chat || chatId !== (getContext().getCurrentChatId?.() ?? getContext().chatId)) return;
        speechAbort = new AbortController();
        try {
            const text = await api.transcribe({ model, file }, speechAbort.signal);
            speechAbort.signal.throwIfAborted();
            if (chat !== getContext().chat || chatId !== (getContext().getCurrentChatId?.() ?? getContext().chatId)) return;
            const input = document.querySelector('#send_textarea');
            if (!input) throw new ApiError('SillyTavern composer unavailable.');
            input.value = [input.value, text].filter(Boolean).join('\n');
            input.dispatchEvent(new Event('input', { bubbles: true }));
            status(t('transcribed'));
        } finally { speechAbort = null; }
    }

    function registerTools() {
        for (const [kind, setting] of [['image', 'toolImages'], ['video', 'toolVideos']]) {
            const name = `clodex_generate_${kind}`;
            context.unregisterFunctionTool?.(name);
            if (!settings[setting] || !context.registerFunctionTool) continue;
            context.registerFunctionTool({ name, displayName: `CLODEx ${kind}`,
                description: `Generate a ${kind} for the current fictional character scene, only when the user asks. Requires user confirmation.`,
                parameters: { type: 'object', properties: { prompt: { type: 'string', description: 'Visual scene prompt, preserving character appearance.' } }, required: ['prompt'], additionalProperties: false },
                action: async args => {
                    if (!settings[setting] || typeof args?.prompt !== 'string' || !args.prompt.trim()) throw new ApiError('Invalid or disabled CLODEx tool.');
                    const url = await generate(kind, { prompt: args.prompt, source: 'tool' });
                    return JSON.stringify(url ? { status: 'completed', url } : { status: 'cancelled' });
                },
            });
        }
    }

    function registerCommands() {
        const c = getContext();
        const named = () => [c.SlashCommandNamedArgument.fromProps({ name: 'message', description: 'Existing character message index', typeList: [c.ARGUMENT_TYPE.NUMBER] })];
        for (const [name, kind] of [['clodex-img', 'image'], ['clodex-video', 'video'], ['clodex-say', 'audio']]) {
            const args = named();
            if (kind === 'video') args.push(c.SlashCommandNamedArgument.fromProps({ name: 'animate', description: 'Use the message image', typeList: [c.ARGUMENT_TYPE.BOOLEAN], defaultValue: 'false' }));
            c.SlashCommandParser.addCommandObject(c.SlashCommand.fromProps({ name,
                callback: async (args, value) => {
                    try { return await generate(kind, { index: args.message, prompt: String(value ?? ''), animate: String(args.animate) === 'true' }); }
                    catch (error) { report(error); return ''; }
                }, namedArgumentList: args,
                unnamedArgumentList: [c.SlashCommandArgument.fromProps({ description: 'Optional prompt (otherwise compose the scene)', typeList: [c.ARGUMENT_TYPE.STRING], isRequired: false })],
                helpString: 'CLODEx generation. May incur charges; results attach to the selected character message.',
            }));
        }
        c.SlashCommandParser.addCommandObject(c.SlashCommand.fromProps({ name: 'clodex-cancel', callback: () => {
            controller.cancel(); speechAbort?.abort(); status(t('stopped')); return '';
        }, helpString: 'Stop local polling. Does not cancel or refund a submitted server task.' }));
        c.SlashCommandParser.addCommandObject(c.SlashCommand.fromProps({ name: 'clodex-resume', namedArgumentList: named(), callback: async args => {
            try {
                validateKey(key);
                const target = captureTarget(getContext(), args.message);
                const job = jobsFor(target.message).findLast(j => j.kind === 'video' && j.taskId && !['completed', 'failed'].includes(j.status));
                if (!job) throw new ApiError('No resumable video task.');
                return await controller.resume(target.index, job.id);
            } catch (error) { report(error); return ''; }
        }, helpString: 'Resume the last pending video in a character message. Never creates another task.' }));
    }

    root.addEventListener('change', async event => {
        const field = event.target;
        const name = field.dataset.setting;
        if (!name) return;
        let value = field.type === 'checkbox' ? field.checked : field.value;
        if (name === 'autoImages' && value && !await confirm(t('autoConfirm'))) { field.checked = false; return; }
        if (name === 'videoSeconds' && value && (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 60)) {
            field.value = settings[name]; report(new Error('Video seconds must be an integer from 1 to 60.')); return;
        }
        if (typeof value === 'string') value = value.slice(0, 200);
        settings[name] = value; getContext().saveSettingsDebounced();
        if (name === 'toolImages' || name === 'toolVideos') registerTools();
        if (name === 'language') renderStatic(); else renderMessages();
    });
    const actions = { refresh, activate: () => activate(), transcribe, forget: () => {
        controller.cancel(); refreshAbort?.abort(); speechAbort?.abort();
        key = ''; lastSecretKey = ''; lastSecretId = ''; quota = null; catalog = []; metadata = null;
        find('[data-role="key"]').value = ''; renderStatic(); status(t('forgotten'));
    } };
    for (const element of root.querySelectorAll('[data-action]')) element.addEventListener('click', () => {
        Promise.resolve().then(actions[element.dataset.action]).catch(report);
    });
    find('[data-role="search"]').addEventListener('input', renderCatalog);
    const types = context.eventTypes ?? context.event_types;
    function on(type, callback) {
        if (type) { context.eventSource.on(type, callback); events.push([type, callback]); }
    }
    on(types.CHAT_CHANGED, () => { controller.cancel(); speechAbort?.abort(); latestAutoIndex = null; renderMessages(); });
    for (const type of [types.MESSAGE_DELETED, types.MESSAGE_SWIPED, types.MESSAGE_EDITED]) {
        on(type, () => { controller.cancel(); latestAutoIndex = null; renderMessages(); });
    }
    on(types.CHARACTER_MESSAGE_RENDERED, (index, source) => {
        renderMessages();
        if ((!source || source === 'normal') && !controller.active) latestAutoIndex = Number(index);
    });
    on(types.GENERATION_ENDED, () => {
        const index = latestAutoIndex; latestAutoIndex = null;
        if (index !== null && settings.autoImages && key && !speechAbort) controller.autoImage(index).catch(report);
        renderMessages();
    });
    registerCommands(); registerTools(); renderStatic();
    return { root, api, controller, refresh, renderMessages,
        dispose() {
            disposed = true; controller.cancel(); refreshAbort?.abort(); speechAbort?.abort();
            for (const [type, callback] of events) context.eventSource.removeListener?.(type, callback);
            context.unregisterFunctionTool?.('clodex_generate_image'); context.unregisterFunctionTool?.('clodex_generate_video');
            root.remove(); key = ''; lastSecretKey = '';
        },
    };
}
