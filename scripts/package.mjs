// Dependency-free ZIP (STORE) writer. An explicit allowlist excludes tests, secrets and local evidence.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'));
const files = ['manifest.json', 'index.js', 'settings.html', 'style.css', 'README.md', 'README.en.md', 'LICENSE', 'CHANGELOG.md',
    'src/api.js', 'src/catalog.js', 'src/chat.js', 'src/controller.js', 'src/ui.js', 'src/microphone.js', 'src/tts.js',
    'i18n/en-us.json', 'i18n/ru-ru.json', 'docs/COMPATIBILITY.md', 'docs/ROADMAP.md'];
function crc32(buffer) {
    let crc = 0xffffffff;
    for (const byte of buffer) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
}
const local = [], central = [];
let offset = 0;
for (const file of files) {
    const data = await readFile(resolve(root, file));
    const name = Buffer.from(`SillyTavern-CLODEx/${file}`);
    const crc = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6);
    header.writeUInt16LE(33, 12); header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(data.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(name.length, 26);
    local.push(header, name, data);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(0x800, 8); directory.writeUInt16LE(33, 14); directory.writeUInt32LE(crc, 16);
    directory.writeUInt32LE(data.length, 20); directory.writeUInt32LE(data.length, 24);
    directory.writeUInt16LE(name.length, 28); directory.writeUInt32LE(offset, 42);
    central.push(directory, name); offset += header.length + name.length + data.length;
}
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(Buffer.concat(central).length, 12); end.writeUInt32LE(offset, 16);
await mkdir(resolve(root, 'dist'), { recursive: true });
const output = resolve(root, 'dist', `SillyTavern-CLODEx-${manifest.version}.zip`);
await writeFile(output, Buffer.concat([...local, ...central, end]));
console.log(output);
