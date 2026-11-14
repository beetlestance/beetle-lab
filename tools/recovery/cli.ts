import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runRecoveryCli } from './run.js';
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) process.exitCode = await runRecoveryCli(process.argv.slice(2));
