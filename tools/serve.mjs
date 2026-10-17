#!/usr/bin/env node
/**
 * serve — zero-dependency static server for local development.
 *
 *   node tools/serve.mjs            # http://localhost:8123 (repo root, i.e. the dev page)
 *   node tools/serve.mjs --dist     # http://localhost:8123 (dist/, i.e. the built site)
 *   node tools/serve.mjs --port 9000
 *   (inside the SiriSphere monorepo the same tools live at web/tools/, prefix accordingly)
 *
 * A server (not file://) is recommended while developing: the microphone demo needs a
 * "secure context", and some browsers restrict local file access.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createStaticServer } from './static-server.mjs';
import { MONOREPO } from './sync-shaders.mjs';

const WEB_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const useDist = args.includes('--dist');
const portArg = args.indexOf('--port');
const port = portArg >= 0 ? Number(args[portArg + 1]) : 8123;
const root = useDist ? join(WEB_DIR, 'dist') : WEB_DIR;

if (useDist && !existsSync(root)) {
    console.error(`${MONOREPO ? 'web/dist' : 'dist'} does not exist yet — run: node ${MONOREPO ? 'web/tools' : 'tools'}/build.mjs`);
    process.exit(1);
}

const server = await createStaticServer(root, port);
console.log(`SiriSphere web — serving ${useDist ? (MONOREPO ? 'web/dist' : 'dist') + ' (built)' : (MONOREPO ? 'web' : '.') + ' (dev)'}`);
console.log(`  ${server.url}`);
