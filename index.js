import { initialize } from './src/ui.js';

let app;
let activation;

// SillyTavern awaits this lifecycle hook. Loading before built-in TTS ensures
// a saved CLODEx provider exists before TTS restores its selection after F5.
export async function activate() {
    activation ??= initialize().then(async instance => {
        app = instance;
        await instance?.nativeReady;
    }).catch(error => {
        activation = null;
        const notice = document.createElement('p');
        notice.textContent = 'CLODEx could not load. Use SillyTavern 1.19.0+ and check the extension files.';
        document.querySelector('#extensions_settings')?.append(notice);
        throw error;
    });
    return activation;
}

export function deactivate() {
    app?.dispose(); app = null; activation = null;
    const context = globalThis.SillyTavern?.getContext();
    const tts = context?.extensionSettings.tts;
    // A disabled third-party extension cannot register a provider on reload.
    // Keep native TTS from restoring an unavailable provider or auto-speaking.
    if (tts?.currentProvider === 'CLODEx') {
        const enabled = document.querySelector('#tts_enabled');
        if (enabled?.checked) enabled.click();
        tts.enabled = false; tts.currentProvider = 'System';
        const selector = document.querySelector('#tts_provider');
        if (selector) { selector.value = 'System'; selector.dispatchEvent(new Event('change', { bubbles: true })); }
        context.saveSettingsDebounced();
    }
}
