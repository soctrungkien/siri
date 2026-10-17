#!/usr/bin/env node
/**
 * test — runs the logic tests of the web port in node, using the very same scripts the browser
 * loads (read from the <script> tags of web/index.html), plus the shader embed.
 *
 *   node tools/test.mjs   (monorepo: node web/tools/test.mjs)
 *
 * The GL parts need a GPU, so they are not covered here; everything that is pure logic
 * (state machine, palettes, params, helpers) is exercised exactly as in tools/jvmtest.
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import vm from 'node:vm';
import { renderShaderModule, WEB_DIR, readShaders } from './sync-shaders.mjs';

const INDEX = join(WEB_DIR, 'index.html');
const SCRIPTS_START = '<!-- siri:scripts:start -->';
const SCRIPTS_END = '<!-- siri:scripts:end -->';

function scriptsFromIndex() {
    const html = readFileSync(INDEX, 'utf8');
    const from = html.indexOf(SCRIPTS_START);
    const to = html.indexOf(SCRIPTS_END);
    if (from < 0 || to < 0) throw new Error('web/index.html lost its siri:scripts markers');
    return [...html.slice(from, to).matchAll(/<script[^>]+src=["']([^"']+)["']/g)].map(m => m[1]);
}

const results = [];
let passed = 0;

const sandbox = {
    console,
    performance: globalThis.performance,                 // the modules read root.performance
    setTimeout, clearTimeout,
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => { },
    __siriCheck(ok, what) {
        results.push({ ok, what });
        if (ok) { passed++; console.log('PASS  ' + what); } else { console.log('FAIL  ' + what); }
    }
};
sandbox.window = sandbox;                                // the modules attach to `window`
vm.createContext(sandbox);

const parts = [renderShaderModule()];
for (const src of scriptsFromIndex()) {
    if (src === 'src/shaders.generated.js') continue;    // the fresh embed above is the source of truth
    if (src.indexOf('demo/') === 0) continue;            // demo/page wiring touches the DOM, not testable in node
    const path = join(WEB_DIR, src);
    if (!existsSync(path)) throw new Error('index.html references a missing file: ' + src);
    parts.push(readFileSync(path, 'utf8'));
}
parts.push(readFileSync(join(WEB_DIR, 'tools', 'tests.js'), 'utf8'));

try {
    new vm.Script(parts.join('\n/* ---- */\n'), { filename: 'sirisphere-bundle.js' }).runInContext(sandbox);
} catch (e) {
    console.error('FAIL  the bundle threw while loading: ' + (e && e.stack ? e.stack : e));
    process.exit(1);
}

const failed = results.filter(r => !r.ok).length;
if (!sandbox.window.__siriTestsDone) {
    console.error('FAIL  the test file did not finish (see the error above)');
    process.exit(1);
}
console.log(`\n${failed === 0 ? 'ALL PASSED' : 'FAILURES: ' + failed}  (${passed}/${results.length} checks, shaders ${readShaders().hash})`);
process.exit(failed === 0 ? 0 : 1);
