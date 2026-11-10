import { initialize } from './src/ui.js';

let started = false;
function start() {
    if (started || !document.querySelector('#extensions_settings')) return;
    started = true;
    initialize().catch(() => {
        const notice = document.createElement('p');
        notice.textContent = 'CLODEx could not load. Use SillyTavern 1.19.0+ and check the extension files.';
        document.querySelector('#extensions_settings')?.append(notice);
    });
}

const context = globalThis.SillyTavern?.getContext();
if (context) {
    const ready = context.eventTypes?.APP_READY ?? context.event_types?.APP_READY;
    if (ready) context.eventSource.on(ready, start);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
}
