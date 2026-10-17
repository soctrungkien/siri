#!/usr/bin/env node
/**
 * serve — zero-dependency static server for local development.
 *
 *   node web/tools/serve.mjs            # http://localhost:8123 (web/, i.e. the dev page)
 *   node web/tools/serve.mjs --dist     # http://localhost:8123 (web/dist, i.e. the built site)
 *   node web/tools/serve.mjs --port 9000
 *
 * A server (not file://) is recommended while developing: the microphone demo needs a
 * "secure context", and some browsers restrict local file access.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createStaticServer } from './static-server.mjs';

const WEB_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const useDist = args.includes('--dist');
const portArg = args.indexOf('--port');
const port = portArg >= 0 ? Number(args[portArg + 1]) : 8123;
const root = useDist ? join(WEB_DIR, 'dist') : WEB_DIR;

if (useDist && !existsSync(root)) {
    console.error('web/dist does not exist yet — run: node web/tools/build.mjs');
    process.exit(1);
}

const server = await createStaticServer(root, port);
console.log(`SiriSphere web — serving ${useDist ? 'web/dist (built)' : 'web (dev)'}`);
console.log(`  ${server.url}`);
