import { expect, it, vi } from 'vitest';
import { Worker } from 'node:worker_threads';
import { once } from 'node:events';
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { receiptForOutputSource } from '../../src/output-source/index.js';
import { sourceFixture, hash, inspect } from './fixtures.js';
const f = sourceFixture();
it('bounds encoded originals before actual postMessage and captures mutable source data once', async () => {
  const e = await f.seed(); const worker = Reflect.get(e.journal, 'worker') as Worker; const post = vi.spyOn(worker, 'postMessage');
  const badIntent = structuredClone(e.intent); Reflect.set(badIntent.root, 'directory', '/' + 'a'.repeat(32768));
  const badSource = structuredClone(e.collected); badSource.collection.custody.root.directory = '/' + 'a'.repeat(131072);
  const badReceipt = { ...receiptForOutputSource(e.source, hash), sourceDigest: 'a'.repeat(1025) };
  const badFailure = structuredClone(e.failed); Reflect.set(badFailure.evidence.runtime, 'evidenceId', 'a'.repeat(8193));
  for (const issue of [() => e.journal.beginOutputCollection(badIntent), () => e.journal.commitOutputSource(badSource),
    () => e.journal.releaseOutputSource(badReceipt), () => e.journal.failOutputCollection(badFailure)]) {
    await expect(issue()).rejects.toMatchObject({ code: 'invalid_input' });
  }
  expect(post).not.toHaveBeenCalled();
  const intent = structuredClone(e.intent); const begun = e.journal.beginOutputCollection(intent); Reflect.set(intent.root, 'directory', '/changed');
  expect(await begun).toEqual(e.intent);
  const source = structuredClone(e.collected); const committed = e.journal.commitOutputSource(source); source.collection.custody.root.directory = '/changed';
  expect(await committed).toEqual(receiptForOutputSource(e.source, hash));
  for (const [command] of post.mock.calls) {
    expect(typeof command.json).toBe('string');
    expect(Buffer.byteLength(command.json)).toBeLessThanOrEqual(command.kind === 'outputCollectionBegin' ? 32768 : 131072);
  }
  post.mockRestore();
});
it.each([
  ['outputCollectionBegin', 32768], ['outputSourceCommit', 131072], ['outputSourceRelease', 1024], ['outputCollectionFailed', 8192],
] as const)('actual worker rejects %s UTF8 overflow before JSON.parse', async (kind, cap) => {
  const path = f.path(); const script = path + '.probe.mjs';
  await writeFile(script, `import {parentPort} from 'node:worker_threads';
    let cap=Infinity;const parse=JSON.parse;const caps={outputCollectionBegin:32768,outputSourceCommit:131072,outputSourceRelease:1024,outputCollectionFailed:8192};
    parentPort.on('message',m=>{cap=caps[m.kind]??Infinity});
    JSON.parse=function(text,...args){if(typeof text==='string'&&Buffer.byteLength(text)>cap){parentPort.postMessage({kind:'parse_violation'});throw Error('preparse bound')}return parse.call(this,text,...args)};
    await import(${JSON.stringify(f.workerUrl().href)});`);
  const worker = new Worker(pathToFileURL(script), { workerData: { path, spoolQuotaBytes: 67108864 } });
  try {
    const [ready] = await once(worker, 'message'); expect(ready.kind).toBe('ready');
    const reply = once(worker, 'message');
    worker.postMessage({ kind, id: 1, json: 'é'.repeat(Math.floor(cap / 2) + 1) });
    expect((await reply)[0]).toMatchObject({ kind: 'result', id: 1, ok: false, code: 'invalid_input' });
  } finally { await worker.terminate(); }
});
it('shares two held large credits across all six source operations and existing Offers, leaving cancel/close independent', async () => {
  const e = await f.seed(); const receive = Reflect.get(e.journal, 'receive') as (reply: unknown) => void;
  const firstId = Number(Reflect.get(e.journal, 'nextId')) + 1; let held = 0; let observed!: () => void;
  const both = new Promise<void>(resolve => { observed = resolve; });
  Reflect.set(e.journal, 'receive', (reply: unknown) => {
    if (reply && typeof reply === 'object' && [firstId, firstId + 1].includes(Number(Reflect.get(reply, 'id'))) && Reflect.get(reply, 'ok') === true) {
      if (++held === 2) observed(); return;
    }
    receive.call(e.journal, reply);
  });
  const read = e.journal.readOutputSource(e.key); const intent = e.journal.readOutputCollection(e.key);
  const rejected = [expect(read).rejects.toMatchObject({ code: 'unavailable' }), expect(intent).rejects.toMatchObject({ code: 'unavailable' })];
  await both; let captures = 0;
  const blocked = new Proxy(e.intent, { ownKeys(value) { captures++; return Reflect.ownKeys(value); } });
  for (const issue of [() => e.journal.beginOutputCollection(blocked), () => e.journal.commitOutputSource(e.collected),
    () => e.journal.releaseOutputSource(receiptForOutputSource(e.source, hash)), () => e.journal.failOutputCollection(e.failed),
    () => e.journal.readOutputSource(e.key), () => e.journal.readOutputCollection(e.key), () => e.journal.immutableOffer(e.offer)]) {
    await expect(issue()).rejects.toMatchObject({ code: 'queue_full' });
  }
  expect(captures).toBe(0); await e.journal.durableCancel(e.key); await f.close(e.journal); await Promise.all(rejected);
  expect(inspect(e.path).foreignKeys).toEqual([]);
});
it('rejects a mismatched actual commit reply rather than granting the candidate receipt', async () => {
  const e = await f.seed(); await e.journal.beginOutputCollection(e.intent);
  const receive = Reflect.get(e.journal, 'receive') as (reply: unknown) => void; const id = Number(Reflect.get(e.journal, 'nextId')) + 1;
  Reflect.set(e.journal, 'receive', (reply: unknown) => {
    if (reply && typeof reply === 'object' && Reflect.get(reply, 'id') === id && Reflect.get(reply, 'ok') === true) {
      const value = Reflect.get(reply, 'value'); Reflect.set(value, 'manifestDigest', '0'.repeat(64));
    }
    receive.call(e.journal, reply);
  });
  await expect(e.journal.commitOutputSource(e.collected)).rejects.toMatchObject({ code: 'unavailable' });
  await e.journal.abort(); const reopened = await f.open(e.path);
  expect(await reopened.commitOutputSource(e.collected)).toEqual(receiptForOutputSource(e.source, hash));
});
