#!/usr/bin/env node
/**
 * sync-shaders — keeps the web port's shader embed correct.
 *
 * Layout 1 — SiriSphere monorepo (this web/ folder sits NEXT to siri-sphere/):
 *
 *      siri-sphere/src/main/assets/siri_sphere/{sphere.vert,ribbon.frag,glass.frag}
 *           -> src/shaders.generated.js   (window.SiriSphere.Shaders)
 *
 *   WebGL2 runs GLSL ES 3.00, i.e. the very same shader source the Android module uses, so no
 *   translation is needed: the generated file is a verbatim, byte-for-byte embed. A change to
 *   the Android shaders is picked up by the web demo with one command (and CI fails on a stale
 *   embed).
 *
 * Layout 2 — standalone repo (this repo, where the web port IS the root):
 *
 *   There are no Android assets here, so the committed src/shaders.generated.js is the source
 *   of truth and cannot be regenerated. `--check` then verifies its integrity instead: every
 *   shader body must re-hash to the hash recorded inside the file itself (i.e. the embed was
 *   not truncated or hand-edited).
 *
 * Usage:
 *   node tools/sync-shaders.mjs            # (re)write src/shaders.generated.js  (monorepo only)
 *   node tools/sync-shaders.mjs --check    # exit 1 when the embed is stale (monorepo)
 *                                          # or corrupted / hand-edited (standalone)
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
export const WEB_DIR = join(HERE, '..');
export const REPO_DIR = join(WEB_DIR, '..');

/** Where the Android shaders live when this folder is part of the SiriSphere monorepo. */
export const SHADER_DIR = join(REPO_DIR, 'siri-sphere', 'src', 'main', 'assets', 'siri_sphere');
export const GENERATED_FILE = join(WEB_DIR, 'src', 'shaders.generated.js');

/** true when the Android module (with its shader assets) exists next to this web folder. */
export const MONOREPO = existsSync(join(SHADER_DIR, 'sphere.vert'));

/** Android asset file -> property name in window.SiriSphere.Shaders */
export const SHADERS = [
    ['sphere.vert', 'sphereVert'],
    ['ribbon.frag', 'ribbonFrag'],
    ['glass.frag', 'glassFrag']
];

/** sha256 over "file\0body\0" per shader, truncated — identical scheme for both layouts. */
function hashOf(sources) {
    const hash = createHash('sha256');
    for (const [file, key] of SHADERS) {
        hash.update(file).update('\0').update(sources[key]).update('\0');
    }
    return 'sha256:' + hash.digest('hex').slice(0, 16);
}

/**
 * Reads the three shader sources. Monorepo: straight from the Android asset files.
 * Standalone: recovered from the committed embed (the JSON strings round-trip exactly,
 * and CRLF was normalised to LF before embedding, so the recovery is byte-exact).
 *
 * @return {{sources: Object<string,string>, hash: string}}
 */
export function readShaders() {
    if (MONOREPO) {
        const sources = {};
        for (const [file, key] of SHADERS) {
            const path = join(SHADER_DIR, file);
            if (!existsSync(path)) throw new Error(`missing shader: ${path}`);
            sources[key] = readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
        }
        return { sources, hash: hashOf(sources) };
    }
    if (!existsSync(GENERATED_FILE)) {
        throw new Error('not a monorepo and ' + GENERATED_FILE + ' is missing — regenerate it inside the SiriSphere monorepo (node web/tools/sync-shaders.mjs)');
    }
    const text = readFileSync(GENERATED_FILE, 'utf8').replace(/\r\n/g, '\n');
    const sources = {};
    for (const [, key] of SHADERS) {
        const match = text.match(new RegExp('^\\s+' + key + ': (".*"),$', 'm'));
        if (!match) throw new Error(GENERATED_FILE + ' has no shader "' + key + '" — regenerate it inside the SiriSphere monorepo');
        sources[key] = JSON.parse(match[1]);
    }
    return { sources, hash: hashOf(sources) };
}

/** Reads just the sha256 recorded inside the committed embed (standalone integrity check). */
function recordedHash() {
    const text = readFileSync(GENERATED_FILE, 'utf8').replace(/\r\n/g, '\n');
    const match = text.match(/^\s+hash: "(.+)",$/m);
    if (!match) throw new Error(GENERATED_FILE + ' does not record a shader hash');
    return match[1];
}

/** The classic-script content of src/shaders.generated.js. */
export function renderShaderModule() {
    if (!MONOREPO) {
        // Standalone: the committed embed IS the source of truth — nothing to regenerate.
        if (!existsSync(GENERATED_FILE)) {
            throw new Error('src/shaders.generated.js is missing — generate it inside the SiriSphere monorepo (node web/tools/sync-shaders.mjs)');
        }
        return readFileSync(GENERATED_FILE, 'utf8').replace(/\r\n/g, '\n');
    }
    const { sources, hash } = readShaders();
    const lines = [
        '/*!',
        ' * SiriSphere — web port: shader sources.',
        ' *',
        ' * AUTO-GENERATED — DO NOT EDIT. Run `node tools/sync-shaders.mjs` after changing',
        ' * siri-sphere/src/main/assets/siri_sphere/*.{vert,frag} (inside the SiriSphere monorepo).',
        ' * WebGL2 speaks GLSL ES 3.00, so the Android shaders are embedded verbatim.',
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

    if (check) {
        if (MONOREPO) {
            const wanted = renderShaderModule();
            const current = existsSync(GENERATED_FILE) ? readFileSync(GENERATED_FILE, 'utf8').replace(/\r\n/g, '\n') : null;
            if (wanted !== current) {
                console.error('FAIL  src/shaders.generated.js is out of date.');
                console.error('      Run: node tools/sync-shaders.mjs (inside the SiriSphere monorepo)');
                process.exit(1);
            }
            console.log('OK    src/shaders.generated.js matches the Android shaders.');
            return;
        }

        // Standalone: integrity check — the recorded hash must match the embedded bodies.
        try {
            const { sources } = readShaders();
            const recomputed = hashOf(sources);
            const recorded = recordedHash();
            if (recorded !== recomputed) {
                throw new Error(`the recorded hash is ${recorded} but the embedded shader bodies hash to ${recomputed} — the embed was truncated or edited by hand`);
            }
            console.log(`OK    src/shaders.generated.js is complete and self-consistent (${recorded}).`);
        } catch (e) {
            console.error('FAIL  ' + (e && e.message ? e.message : e));
            process.exit(1);
        }
        return;
    }

    if (!MONOREPO) {
        console.log('OK    standalone repo — src/shaders.generated.js is the source of truth, nothing to regenerate.');
        return;
    }

    const wanted = renderShaderModule();
    const current = existsSync(GENERATED_FILE) ? readFileSync(GENERATED_FILE, 'utf8').replace(/\r\n/g, '\n') : null;
    if (wanted === current) {
        console.log('OK    src/shaders.generated.js already up to date.');
        return;
    }
    writeFileSync(GENERATED_FILE, wanted, 'utf8');
    console.log(`OK    wrote ${GENERATED_FILE}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
