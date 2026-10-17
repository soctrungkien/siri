/**
 * static-server — the tiny file server shared by `serve.mjs` (development) and `smoke.mjs`
 * (headless-browser smoke test). No dependencies.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, normalize, extname } from 'node:path';

const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2'
};

/**
 * @param {string} root directory to serve
 * @param {number} port 0 = pick a free one
 * @return {Promise<{url: string, port: number, close: Function}>}
 */
export function createStaticServer(root, port = 0) {
    const server = createServer(async (req, res) => {
        const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
        let file = join(root, normalize(urlPath).replace(/^([/\\])+/, ''));
        try {
            const info = await stat(file).catch(() => null);
            if (info && info.isDirectory()) file = join(file, 'index.html');
            const body = await readFile(file);
            res.writeHead(200, {
                'Content-Type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream',
                'Cache-Control': 'no-store'
            });
            res.end(body);
        } catch (e) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('404 ' + urlPath);
        }
    });
    return new Promise((resolve, reject) => {
        server.on('error', reject);
        server.listen(port, '127.0.0.1', () => {
            const actual = server.address().port;
            resolve({
                url: `http://127.0.0.1:${actual}/`,
                port: actual,
                close: () => new Promise(r => server.close(r))
            });
        });
    });
}
