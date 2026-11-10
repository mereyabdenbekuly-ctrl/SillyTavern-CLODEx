import test from 'node:test';
import assert from 'node:assert/strict';
import { modelKinds, normalizeCatalog, priceView, quotaView, walletView } from '../src/catalog.js';

test('catalog uses only live authorized model IDs, enriched by public prices', () => {
    const data = normalizeCatalog({ data: [{ id: 'custom-image', supported_endpoint_types: ['image-generation'] }, { id: 'text' }, { id: 'text' }] },
        { data: [{ model_name: 'text', display_name: 'Text model', usage_fixed_price: 0.14 }, { model_name: 'unavailable' }] });
    assert.deepEqual(data.map(m => m.id), ['custom-image', 'text']);
    assert.equal(data[1].name, 'Text model'); assert.deepEqual(data[0].kinds, ['image']);
});

test('endpoint capabilities and fallback classification cover media without treating embeddings as chat', () => {
    assert.deepEqual(modelKinds({ id: 'unknown' }, { supported_endpoint_types: ['openai-video'] }), ['video']);
    assert.deepEqual(modelKinds({ id: 'grok-imagine-video' }), ['video']);
    assert.deepEqual(modelKinds({ id: 'clodex-video/grok-imagine-1.5' }), ['video']);
    assert.deepEqual(modelKinds({ id: 'gpt-image-2' }), ['image']);
    assert.deepEqual(modelKinds({ id: 'whisper-1' }), ['transcription']);
    assert.deepEqual(modelKinds({ id: 'tts-1' }), ['speech']);
    assert.deepEqual(modelKinds({ id: 'text-embedding-3' }), []);
});

test('fixed total-token pricing, cache read and ratio pricing retain their units', () => {
    assert.deepEqual(priceView({ usage_fixed_price: 0.14, cached_usage_fixed_price: 0.112, usage_fixed_price_unit: 'per_1m_total_tokens' }),
        { unit: 'per_1m_total_tokens', input: 0.14, cached: 0.112 });
    const ratio = priceView({ quota_type: 0, model_ratio: 1.5, completion_ratio: 5, cache_ratio: 0.1 });
    assert.equal(ratio.input, 3); assert.equal(ratio.output, 15);
    assert.ok(Math.abs(ratio.cached - 0.3) < 1e-12);
});

test('zero prices and zero cached prices are preserved; missing prices stay unknown', () => {
    assert.equal(priceView({ usage_fixed_price: 0, cached_usage_fixed_price: 0 }).cached, 0);
    assert.equal(priceView(undefined), null); assert.equal(priceView({}), null);
    assert.deepEqual(priceView({ billing_mode: 'expression', model_price: 1 }), { unit: 'dynamic' });
    assert.deepEqual(priceView({ billing_mode: 'quote_based', quota_type: 1, model_price: 0.49583 }), { unit: 'dynamic' });
});

test('quota converts to USD and RUB only with explicit server metadata', () => {
    const payload = { data: { total_available: 1250000, unlimited_quota: false } };
    const status = { data: { quota_per_unit: 500000, custom_currency_symbol: '₽', custom_currency_exchange_rate: 81.25 } };
    assert.deepEqual(quotaView(payload, status), { units: 1250000, usd: 2.5, rub: 203.125, unlimited: false, expiresAt: null });
    assert.equal(quotaView(payload).usd, null);
});

test('CNY exchange rate is never presented as RUB; unlimited does not imply a wallet balance', () => {
    const value = quotaView({ data: { total_available: 0, unlimited_quota: true } }, { data: { quota_per_unit: 500000, usd_exchange_rate: 7, custom_currency_symbol: '¥', custom_currency_exchange_rate: 7 } });
    assert.equal(value.rub, null); assert.equal(value.unlimited, true);
    assert.throws(() => quotaView({ data: { total_available: -1 } }));
});

test('wallet balance is independent of unlimited or finite key allowance and needs no public metadata', () => {
    const data = { total_available: 0, unlimited_quota: true, wallet_balance_usd: 4.5,
        wallet_balance_rub: 365.625, usd_to_rub: 81.25, quota_per_unit: 500000 };
    assert.deepEqual(walletView({ data }), { usd: 4.5, rub: 365.625 });
    data.total_available = 500; data.unlimited_quota = false;
    assert.deepEqual(walletView({ data }), { usd: 4.5, rub: 365.625 });
    assert.equal(quotaView({ data }).usd, 0.001);
});

test('wallet parser preserves zero/debt, never invents funds or a RUB exchange rate', () => {
    assert.equal(walletView({ data: { total_available: 100000, unlimited_quota: true } }), null);
    assert.equal(walletView({ data: { wallet_balance_usd: '4.5' } }), null);
    assert.equal(walletView({ data: { wallet_balance_usd: Infinity } }), null);
    assert.deepEqual(walletView({ data: { wallet_balance_usd: 0, usd_to_rub: 81.25 } }), { usd: 0, rub: 0 });
    assert.deepEqual(walletView({ data: { wallet_balance_usd: -1, usd_to_rub: 81.25 } }), { usd: -1, rub: -81.25 });
    assert.deepEqual(walletView({ data: { wallet_balance_usd: 4.5 } }, { data: { usd_exchange_rate: 7, custom_currency_symbol: '¥', custom_currency_exchange_rate: 7 } }), { usd: 4.5, rub: null });
});
