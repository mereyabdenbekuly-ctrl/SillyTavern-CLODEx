import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('../', import.meta.url));
async function walk(directory) {
    const files = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (['dist', 'node_modules', '.git'].includes(entry.name)) continue;
        const path = resolve(directory, entry.name);
        if (entry.isDirectory()) files.push(...await walk(path)); else files.push(path);
    }
    return files;
}
const files = await walk(root);
for (const path of files.filter(p => /\.(mjs|js)$/.test(p))) {
    const result = spawnSync(process.execPath, ['--check', path], { stdio: 'inherit' });
    if (result.status !== 0) process.exit(result.status || 1);
}
const manifest = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'));
for (const name of [manifest.js, manifest.css, 'settings.html', ...Object.values(manifest.i18n)]) await readFile(resolve(root, name));
const en = JSON.parse(await readFile(resolve(root, 'i18n/en-us.json'), 'utf8'));
const ru = JSON.parse(await readFile(resolve(root, 'i18n/ru-ru.json'), 'utf8'));
assert.deepEqual(Object.keys(en).sort(), Object.keys(ru).sort(), 'Locale keys must match');
assert.ok(Object.keys(en).every(key => key.startsWith('clodex.')), 'Translations must be namespaced');
const template = await readFile(resolve(root, 'settings.html'), 'utf8');
const source = await readFile(resolve(root, 'src/ui.js'), 'utf8');
const keys = [...template.matchAll(/data-clodex-i18n="([^"]+)"/g), ...source.matchAll(/\bt\('([^']+)'/g)];
for (const [, key] of keys) assert.ok(en[`clodex.${key}`], `Missing translation ${key}`);
assert.equal(manifest.version, JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')).version);
console.log(`Syntax, manifest and ${Object.keys(en).length} RU/EN translation keys: OK`);
