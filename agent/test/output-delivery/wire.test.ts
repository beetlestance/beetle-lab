import { expect, it, vi } from 'vitest';
import { Worker } from 'node:worker_threads';
import { once } from 'node:events';
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { Store } from '../../src/journal/store.js';
import { deliveryFixture, inspect } from './fixtures.js';
const f = deliveryFixture();

it('bounds close receipt before real clone, refuses caller high-water/accessors, and captures originals once', async () => {
  const e = await f.ready(); const worker = Reflect.get(e.journal, 'worker') as Worker; const post = vi.spyOn(worker, 'postMessage');
  const getter = vi.fn(() => e.receipt.sourceDigest); const accessor = { ...e.receipt };
  Object.defineProperty(accessor, 'sourceDigest', { get: getter, enumerable: true });
  for (const value of [{ ...e.receipt, sourceDigest: 'é'.repeat(513) }, { ...e.receipt, finalAgentSeq: 1 }, accessor]) {
    await expect(e.journal.closeOutputDelivery(value)).rejects.toMatchObject({ code: 'invalid_input' });
  }
  expect(getter).not.toHaveBeenCalled(); expect(post).not.toHaveBeenCalled();
  const receipt = structuredClone(e.receipt); const pending = e.journal.closeOutputDelivery(receipt);
  Reflect.set(receipt, 'sourceDigest', '0'.repeat(64)); Reflect.set(receipt.key, 'workspaceId', receipt.key.attemptId);
  expect((await pending).receipt).toEqual(e.receipt);
  expect(post).toHaveBeenCalledTimes(1);
  const [command] = post.mock.calls[0]!;
  expect(command.kind).toBe('outputDeliveryClose'); expect(Buffer.byteLength(command.json)).toBeLessThanOrEqual(1024);
  expect(Object.keys(JSON.parse(command.json))).toEqual(['journalAuthority', 'key', 'manifestDigest', 'sourceDigest', 'version']);
});
it('actual compiled worker refuses UTF8 close overflow before JSON.parse', async () => {
  const path = f.path(); const script = path + '.probe.mjs';
  await writeFile(script, `import {parentPort} from 'node:worker_threads';
    let closing=false;const parse=JSON.parse;
    parentPort.on('message',m=>{closing=m.kind==='outputDeliveryClose'});
    JSON.parse=function(text,...args){if(closing&&typeof text==='string'&&Buffer.byteLength(text)>1024){parentPort.postMessage({kind:'parse_violation'});throw Error('preparse')}return parse.call(this,text,...args)};
    await import(${JSON.stringify(f.workerUrl().href)});`);
  const worker = new Worker(pathToFileURL(script), { workerData: { path, spoolQuotaBytes: 67108864 } });
  try {
    expect((await once(worker, 'message'))[0].kind).toBe('ready'); const reply = once(worker, 'message');
    worker.postMessage({ kind: 'outputDeliveryClose', id: 1, json: 'é'.repeat(513) });
    expect((await reply)[0]).toMatchObject({ kind: 'result', id: 1, ok: false, code: 'invalid_input' });
  } finally { await worker.terminate(); }
});
it('native CASE refuses oversized stored closure bytes before JavaScript parse/materialization', async () => {
  const e = await f.nativeReady(); e.delivery({ kind: 'outputDeliveryClose', json: JSON.stringify(e.receipt) }); f.closeNative(e.db);
  const db = f.corruptCopy(e.path); const oversized = JSON.stringify('é'.repeat(600));
  expect(oversized.length).toBeLessThan(1024); expect(Buffer.byteLength(oversized)).toBeGreaterThan(1024);
  db.prepare('UPDATE output_delivery_closures SET closure_json=?').run(oversized);
  const original = JSON.parse; let parsedCanary = false;
  const parse = vi.spyOn(JSON, 'parse').mockImplementation((text, reviver) => {
    if (text === oversized) parsedCanary = true; return original(text, reviver);
  });
  try {
    expect(() => new Store(db).execute({ kind: 'outputDeliveryRead', key: e.key, id: 1 })).toThrow(expect.objectContaining({ code: 'unavailable' }));
    expect(parsedCanary).toBe(false);
  } finally { parse.mockRestore(); }
});
it('shares two held source credits with both delivery operations before capture while cancellation and close drain FIFO', async () => {
  const e = await f.ready(); const receive = Reflect.get(e.journal, 'receive') as (reply: unknown) => void;
  const first = Number(Reflect.get(e.journal, 'nextId')) + 1; let held = 0; let observed!: () => void;
  const both = new Promise<void>(resolve => { observed = resolve; });
  Reflect.set(e.journal, 'receive', (reply: unknown) => {
    if (reply && typeof reply === 'object' && [first, first + 1].includes(Number(Reflect.get(reply, 'id'))) && Reflect.get(reply, 'ok') === true) {
      if (++held === 2) observed(); return;
    }
    receive.call(e.journal, reply);
  });
  const originals = [e.journal.readOutputDelivery(e.key), e.journal.readOutputSource(e.key)];
  const rejected = originals.map(value => expect(value).rejects.toMatchObject({ code: 'unavailable' })); await both;
  let captures = 0; const blocked = new Proxy(e.receipt, { ownKeys(target) { captures++; return Reflect.ownKeys(target); } });
  for (const issue of [() => e.journal.closeOutputDelivery(blocked), () => e.journal.readOutputDelivery(e.key),
    () => e.journal.readOutputCollection(e.key), () => e.journal.immutableOffer(e.offer)]) await expect(issue()).rejects.toMatchObject({ code: 'queue_full' });
  expect(captures).toBe(0); await e.journal.durableCancel(e.key); await f.close(e.journal); await Promise.all(rejected);
  expect(inspect(e.path).foreignKeys).toEqual([]);
});
it.each(['receipt', 'bytes'] as const)('refuses corrupt %s on the real committed worker reply, then reopens the actual closure', async kind => {
  const e = await f.ready(); const receive = Reflect.get(e.journal, 'receive') as (reply: unknown) => void;
  const id = Number(Reflect.get(e.journal, 'nextId')) + 1;
  Reflect.set(e.journal, 'receive', (reply: unknown) => {
    if (reply && typeof reply === 'object' && Reflect.get(reply, 'id') === id && Reflect.get(reply, 'ok') === true) {
      const value = Reflect.get(reply, 'value');
      if (kind === 'receipt') Reflect.set(Reflect.get(value, 'receipt'), 'sourceDigest', '0'.repeat(64));
      else Reflect.set(value, 'extra', 'é'.repeat(1024));
    }
    receive.call(e.journal, reply);
  });
  await expect(e.journal.closeOutputDelivery(e.receipt)).rejects.toMatchObject({ code: 'unavailable' });
  await e.journal.abort(); const journal = await f.open(e.path);
  expect((await journal.readOutputDelivery(e.key))?.receipt).toEqual(e.receipt);
});
it('actual compiled worker cannot append an unseen supervisor event after closure and preserves snapshot, stream and closure', async () => {
  const e = await f.ready(); const closure = await e.journal.closeOutputDelivery(e.receipt);
  const beforeSnapshot = await e.journal.get(e.key);
  const beforeEvents = await e.journal.readEvents(e.key, 0); const beforeCursors = await e.journal.sourceCursors(e.key);
  const receive = Reflect.get(e.journal, 'receive') as (reply: unknown) => void;
  const id = Number(Reflect.get(e.journal, 'nextId')) + 1;
  const supervisor = f.supervisor(2); supervisor.event = { ...supervisor.event, ...e.key };
  let actualFailure: unknown;
  Reflect.set(e.journal, 'receive', (reply: unknown) => {
    if (reply && typeof reply === 'object' && Reflect.get(reply, 'id') === id) actualFailure = reply;
    receive.call(e.journal, reply);
  });
  await expect(e.journal.appendSupervisor(supervisor)).rejects.toMatchObject({ code: 'unavailable' });
  expect(actualFailure).toMatchObject({ kind: 'result', ok: false, code: 'unavailable' });
  await e.journal.abort(); const before = inspect(e.path);
  const settings = before.rows.find(row => row.table === 'admission_settings')!.rows[0]!;
  expect(typeof settings.observation_json).toBe('string'); settings.observation_json = null;
  const journal = await f.open(e.path);
  expect(await journal.readOutputDelivery(e.key)).toEqual(closure); expect(await journal.get(e.key)).toEqual(beforeSnapshot);
  expect(await journal.readEvents(e.key, 0)).toEqual(beforeEvents); expect(await journal.sourceCursors(e.key)).toEqual(beforeCursors);
  await f.close(journal); expect(inspect(e.path)).toEqual(before);
});
