import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {join, isAbsolute} from 'node:path';
import {sourceCases} from './cases.js';
const [bundle, output, kind, extra] = process.argv.slice(2); assert(bundle && output && kind && isAbsolute(bundle) && isAbsolute(output) && !extra);
const selected = sourceCases(kind); await mkdir(output, {mode: 0o700});
const checks = selected.map(row => ({id: row.id, timeoutMs: row.timeoutMs, argv: [process.execPath, '--import', 'tsx',
 'tools/qualification/native-application/' + row.script, bundle, join(output, row.id), ...row.args]}));
await writeFile(join(output, 'plan.json'), JSON.stringify({cwd: process.cwd(), checks}), {flag: 'wx', mode: 0o600});
