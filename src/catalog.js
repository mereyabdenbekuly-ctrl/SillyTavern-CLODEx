const finite = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;

export function modelKinds(model, price = {}) {
    const id = String(model.id ?? '').toLowerCase();
    const endpoints = [model.supported_endpoint_types, price.supported_endpoint_types].flatMap(value => Array.isArray(value) ? value : []);
    const kinds = new Set();
    const video = endpoints.includes('openai-video') || /seedance|hailuo|wan[-_.]|kling|veo[-_.]|sora|video/.test(id);
    if (endpoints.includes('image-generation') || !video && /gpt-image|nano-banana|flux|seedream|dall-e|imagen|grok-imagine/.test(id)) kinds.add('image');
    if (video) kinds.add('video');
    if (/tts|speech|voice|f5[-_]|cosyvoice/.test(id)) kinds.add('speech');
    if (/whisper|transcrib|\bstt\b/.test(id)) kinds.add('transcription');
    if (!kinds.size && !/embed|rerank|moderation|music|suno|3d|rodin/.test(id)
        && (!endpoints.length || endpoints.includes('openai'))) kinds.add('text');
    return [...kinds];
}

export function normalizeCatalog(models, pricing = {}) {
    if (!Array.isArray(models?.data)) throw new Error('Invalid /v1/models response.');
    const prices = new Map((Array.isArray(pricing.data) ? pricing.data : []).map(p => [p.model_name, p]));
    return [...new Map(models.data.filter(m => typeof m.id === 'string').map(model => {
        const price = prices.get(model.id);
        return [model.id, { id: model.id, name: price?.display_name || model.id, kinds: modelKinds(model, price), price }];
    })).values()].sort((a, b) => a.id.localeCompare(b.id));
}

// Public reference prices are not personalized quotes: no private group multiplier is guessed.
export function priceView(price) {
    if (!price) return null;
    if (['expression', 'quote_based'].includes(price.billing_mode) || price.billing_expr) return { unit: 'dynamic' };
    if (finite(price.usage_fixed_price)) {
        return { unit: price.usage_fixed_price_unit || 'per_1m_total_tokens', input: price.usage_fixed_price,
            cached: finite(price.cached_usage_fixed_price) ? price.cached_usage_fixed_price : null };
    }
    if (price.quota_type === 1 && finite(price.model_price)) return { unit: 'request', input: price.model_price };
    if (price.quota_type === 0 && finite(price.model_ratio)) {
        const input = price.model_ratio * 2;
        return { unit: 'per_1m_tokens', input,
            output: finite(price.completion_ratio) ? input * price.completion_ratio : null,
            cached: finite(price.cache_ratio) ? input * price.cache_ratio : null };
    }
    return null;
}

export function quotaView(payload, metadata) {
    const quota = payload?.data;
    if (!quota || !finite(quota.total_available)) throw new Error('Invalid API key quota response.');
    const unit = metadata?.data?.quota_per_unit;
    const usd = finite(unit) && unit > 0 ? quota.total_available / unit : null;
    const status = metadata?.data;
    // usd_exchange_rate is CNY in new-api; it must NEVER be presented as a RUB rate.
    const rubRate = ['₽', 'RUB', 'руб', 'руб.'].includes(status?.custom_currency_symbol)
        && finite(status?.custom_currency_exchange_rate) && status.custom_currency_exchange_rate > 0
        ? status.custom_currency_exchange_rate : null;
    return { unlimited: quota.unlimited_quota === true, units: quota.total_available, usd,
        rub: usd !== null && rubRate !== null ? usd * rubRate : null,
        expiresAt: quota.expires_at > 0 ? quota.expires_at : null };
}
