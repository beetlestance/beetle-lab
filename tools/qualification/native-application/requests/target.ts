import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import type { Fixture } from '../compose/fixture.js';
import { ownedOrigin } from '../public-api.js';
import { readContent } from '../compose/public.js';
import { counter, record } from '../../resources/values.js';
export async function target(f: Fixture) {
  const source = await readFile(new URL('./server.ts', import.meta.url), 'utf8');
  assert(Buffer.byteLength(source) <= 16384);
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  assert(Buffer.byteLength(compiled) <= 16384);
  const script = join(f.root, 'request-target.mjs');
  await writeFile(script, compiled, { flag: 'wx', mode: 0o644 });
  const origin = await ownedOrigin();
  const path = join(f.root, 'target.json');
  const override = JSON.parse(await readFile(path, 'utf8')) as {
    services: { 'synthetic-target': Record<string, unknown> };
  };
  Object.assign(override.services['synthetic-target'], {
    entrypoint: ['node', '/fixture/requests.mjs'],
    volumes: [`${script}:/fixture/requests.mjs:ro`],
    ports: [`127.0.0.1:${new URL(origin).port}:8080`],
  });
  await writeFile(path, JSON.stringify(override), { mode: 0o600 });
  return {
    sourceSha256: createHash('sha256').update(source).digest('hex'),
    compiledSha256: createHash('sha256').update(compiled).digest('hex'),
    async counts() {
      const reply = await fetch(origin + '/counts', { redirect: 'error', signal: AbortSignal.timeout(3000) });
      const row = record(JSON.parse((await readContent(reply, 4096)).toString()));
      for (const name of ['ready', 'total', 'malformed', 'rejected']) assert(counter(row[name]) <= 128);
      const methods = record(row.methods);
      for (const name of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) assert(counter(methods[name]) <= 4);
      return row;
    },
  };
}
