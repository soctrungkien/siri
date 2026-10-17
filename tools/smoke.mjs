#!/usr/bin/env node
/**
 * smoke — real-GPU (or SwiftShader) check of the built bundle in a headless browser.
 *
 *   node web/tools/build.mjs && node web/tools/smoke.mjs
 *
 * It serves web/dist, loads /smoke.html in Chrome/Edge/Chromium and parses the machine readable
 * first line of the page (<pre id="smoke">):
 *
 *   SMOKE: OK    -> exit 0
 *   SMOKE: SKIP  -> exit 0  (no WebGL2 in this browser, e.g. software rendering disabled)
 *   SMOKE: FAIL  -> exit 1
 *
 * Options: --require-browser (fail instead of skipping when no browser is installed),
 *          --chrome <path>, --keep-html (print the whole DOM dump).
 */
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { createStaticServer } from './static-server.mjs';

const WEB_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(WEB_DIR, 'dist');
const args = process.argv.slice(2);
const requireBrowser = args.includes('--require-browser');
const keepHtml = args.includes('--keep-html');
const explicit = args.includes('--chrome') ? args[args.indexOf('--chrome') + 1] : null;

const WINDOWS = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
];
const POSIX = [
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium',
    '/usr/bin/chromium-browser', '/snap/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium'
];

function fromPath() {
    const names = process.platform === 'win32'
        ? ['chrome.exe', 'msedge.exe']
        : ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'chrome'];
    for (const dir of (process.env.PATH || '').split(delimiter)) {
        for (const name of names) {
            const candidate = join(dir, name);
            if (dir && existsSync(candidate)) return candidate;
        }
    }
    return null;
}

function findBrowser() {
    for (const candidate of [explicit, process.env.CHROME_BIN, process.env.CHROME_PATH, ...WINDOWS, ...POSIX]) {
        if (candidate && existsSync(candidate)) return candidate;
    }
    return fromPath();
}

function run(browser, url) {
    return new Promise((resolve) => {
        const profile = mkdtempSync(join(tmpdir(), 'sirisphere-smoke-'));
        const child = spawn(browser, [
            '--headless=new',
            '--no-sandbox',
            '--disable-dev-shm-usage',
            '--enable-unsafe-swiftshader',      // allow software WebGL (CI runners have no GPU)
            '--hide-scrollbars',
            '--window-size=900,1500',
            '--user-data-dir=' + profile,
            '--virtual-time-budget=20000',
            '--dump-dom',
            url
        ], { stdio: ['ignore', 'pipe', 'pipe'] });

        let out = '';
        child.stdout.on('data', d => { out += d; });
        child.stderr.on('data', () => { });
        const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch (e) { } }, 120000);
        child.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, out: '', error: e.message }); });
        child.on('close', (code) => { clearTimeout(timer); resolve({ code, out }); });
    });
}

function decode(html) {
    return html
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

if (!existsSync(join(DIST, 'smoke.html'))) {
    console.error('FAIL  web/dist/smoke.html is missing — run: node web/tools/build.mjs');
    process.exit(1);
}

const browser = findBrowser();
if (!browser) {
    console.log('SKIP  no Chrome/Edge/Chromium found (set CHROME_BIN or use --chrome <path>)');
    process.exit(requireBrowser ? 1 : 0);
}
console.log('      browser: ' + browser);

const server = await createStaticServer(DIST, 0);
const url = server.url + 'smoke.html';
let result;
try {
    result = await run(browser, url);
} finally {
    await server.close();
}

const dom = result.out || '';
const match = dom.match(/<pre id="smoke">([\s\S]*?)<\/pre>/g);      // last one = the real element
const pre = match ? match[match.length - 1].match(/<pre id="smoke">([\s\S]*?)<\/pre>/) : null;
const text = pre ? decode(pre[1]).trim() : '';
const verdict = (text.match(/^SMOKE: (OK|FAIL|SKIP)\b.*$/m) || [, null])[1];

if (!verdict) {
    const dump = join(tmpdir(), 'sirisphere-smoke-dom.html');
    try { writeFileSync(dump, dom, 'utf8'); } catch (e) { }
    console.log('FAIL  the smoke page produced no verdict (browser exit code ' + result.code + ')');
    if (result.error) console.log('      ' + result.error);
    console.log('      dom dump: ' + dump);
    console.log('      tail: ' + (dom.slice(-1500) || '(no output)').replace(/\s+/g, ' '));
    process.exit(1);
}

console.log(text);
if (keepHtml) console.log('\n--- dom dump ---\n' + dom);

const details = text.split('\n').filter(l => l.startsWith('FAIL') || l.startsWith('note'));
const tail = details.length ? '  (' + details[0].trim() + ')' : '';
console.log(`\n${verdict === 'OK' ? 'PASS' : verdict}  headless smoke test of web/dist — shaders + two-pass render${tail}`);
process.exit(verdict === 'FAIL' ? 1 : 0);
