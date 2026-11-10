import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const files = new Map();
const types = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
    '.html': 'text/html', '.css': 'text/css', '.png': 'image/png', '.mp4': 'video/mp4', '.wav': 'audio/wav' };
const server = createServer(async (req, res) => {
    try {
        const path = new URL(req.url, 'http://localhost').pathname;
        if (path === '/api/files/upload' && req.method === 'POST') {
            let body = '';
            for await (const chunk of req) { body += chunk; if (body.length > 5_000_000) throw new Error('too large'); }
            const value = JSON.parse(body);
            if (!/^clodex-[\w-]+\.(png|mp4|wav|mp3)$/.test(value.name)) throw new Error('invalid filename');
            const url = `/user/files/${value.name}`;
            files.set(url, { bytes: Buffer.from(value.data, 'base64'), type: types[extname(value.name)] ?? 'audio/mpeg' });
            res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ path: url })); return;
        }
        if (files.has(path)) { const file = files.get(path); res.writeHead(200, { 'content-type': file.type }); res.end(file.bytes); return; }
        const relative = path === '/' ? 'tests/browser-harness.html' : decodeURIComponent(path).slice(1);
        const target = resolve(root, relative);
        if (!target.startsWith(root.endsWith(sep) ? root : root + sep)) { res.writeHead(403); res.end(); return; }
        const data = await readFile(target);
        res.writeHead(200, { 'content-type': types[extname(target)] ?? 'application/octet-stream', 'cache-control': 'no-store' }); res.end(data);
    } catch { res.writeHead(404); res.end('Not found'); }
});
server.listen(Number(process.env.PORT || 8765), '127.0.0.1', () => console.log(`Mock-only harness: http://127.0.0.1:${server.address().port}/?auto=1`));
