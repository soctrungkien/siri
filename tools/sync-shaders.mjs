#!/usr/bin/env node
/**
 * sync-shaders — keeps the web port in sync with the Android assets.
 *
 *   siri-sphere/src/main/assets/siri_sphere/{sphere.vert,ribbon.frag,glass.frag}
 *        -> web/src/shaders.generated.js   (window.SiriSphere.Shaders)
 *
 * WebGL2 runs GLSL ES 3.00, i.e. the very same shader source the Android module uses, so no
 * translation is needed: the generated file is a verbatim, byte-for-byte embed. That also means
 * a change to the Android shaders is automatically picked up by the web demo after one command
 * (and CI fails if the committed file is stale).
 *
 * Usage:
 *   node web/tools/sync-shaders.mjs            # (re)write web/src/shaders.generated.js
 *   node web/tools/sync-shaders.mjs --check    # exit 1 when the committed file is out of date
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
export const WEB_DIR = join(HERE, '..');
export const REPO_DIR = join(WEB_DIR, '..');

export const SHADER_DIR = join(REPO_DIR, 'siri-sphere', 'src', 'main', 'assets', 'siri_sphere');
export const GENERATED_FILE = join(WEB_DIR, 'src', 'shaders.generated.js');

/** Android asset file -> property name in window.SiriSphere.Shaders */
export const SHADERS = [
    ['sphere.vert', 'sphereVert'],
    ['ribbon.frag', 'ribbonFrag'],
    ['glass.frag', 'glassFrag']
];

/** @return {{sources: Object<string,string>, hash: string}} */
export function readShaders(dir = SHADER_DIR) {
    const sources = {};
    const hash = createHash('sha256');
    for (const [file, key] of SHADERS) {
        const path = join(dir, file);
        if (!existsSync(path)) throw new Error(`missing shader: ${path}`);
        const text = readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
        sources[key] = text;
        hash.update(file).update('\0').update(text).update('\0');
    }
    return { sources, hash: 'sha256:' + hash.digest('hex').slice(0, 16) };
}

/** The classic-script content of web/src/shaders.generated.js. */
export function renderShaderModule(dir = SHADER_DIR) {
    const { sources, hash } = readShaders(dir);
    const lines = [
        '/*!',
        ' * SiriSphere — web port: shader sources.',
        ' *',
        ' * AUTO-GENERATED — DO NOT EDIT. Run `node web/tools/sync-shaders.mjs` after changing',
        ' * siri-sphere/src/main/assets/siri_sphere/*.{vert,frag}. WebGL2 speaks GLSL ES 3.00, so the',
        ' * Android shaders are embedded verbatim.',
        ' *',
        ` * shaders: ${hash}`,
        ' */',
        '(function (root) {',
        "    'use strict';",
        '    var SiriSphere = root.SiriSphere = root.SiriSphere || {};',
        '    SiriSphere.Shaders = {',
        `        hash: ${JSON.stringify(hash)},`,
        '        sourceDir: \'siri-sphere/src/main/assets/siri_sphere/\','
    ];
    for (const [, key] of SHADERS) {
        lines.push(`        ${key}: ${JSON.stringify(sources[key])},`);
    }
    lines.push('    };');
    lines.push('})(window);');
    lines.push('');
    return lines.join('\n');
}

function main() {
    const check = process.argv.includes('--check');
    const wanted = renderShaderModule();
    const current = existsSync(GENERATED_FILE) ? readFileSync(GENERATED_FILE, 'utf8').replace(/\r\n/g, '\n') : null;

    if (check) {
        if (wanted !== current) {
            console.error('FAIL  web/src/shaders.generated.js is out of date.');
            console.error('      Run: node web/tools/sync-shaders.mjs');
            process.exit(1);
        }
        console.log('OK    web/src/shaders.generated.js matches the Android shaders.');
        return;
    }

    if (wanted === current) {
        console.log('OK    web/src/shaders.generated.js already up to date.');
        return;
    }
    writeFileSync(GENERATED_FILE, wanted, 'utf8');
    console.log(`OK    wrote ${GENERATED_FILE}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
