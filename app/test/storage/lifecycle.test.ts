import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openMetadata } from '../../src/adapters/outbound/sqlite/index.js';
import type { NamespaceCommand } from '../../src/ports/namespaces.js';
import { command, observation, requestId, seed, settingsFixture, storageFixture, uuid } from './fixture.js';

const fixture = storageFixture();
const key = { kind: 'organization' as const, scope: { kind: 'installation' as const }, id: uuid(1) };
function create(): NamespaceCommand {
  return command({ kind: 'createOrganization', id: uuid(1), request: {
    requestId: requestId(), scope: { kind: 'installation' }, name: 'Team', slug: 'team' } });
}
describe('bounded storage worker lifecycle', () => {
  it('retains one connection owner, reports bounded busy refusal and releases the lock after close/abort', async () => {
    const path = fixture.path(); let metadata = await fixture.open(path); await metadata.namespaces.execute(create());
    await expect(fixture.open(path)).rejects.toMatchObject({ code: 'owned', message: 'Storage owned' });
    await fixture.close(metadata); metadata = await fixture.open(path);
    expect((await metadata.get(key)).id).toBe(uuid(1));
    await metadata.abort(); fixture.handles.delete(metadata);
    const successor = await fixture.open(path); expect((await successor.get(key)).id).toBe(uuid(1));
  });
  it('bounds the queue, drains accepted FIFO work and returns the same close promise', async () => {
    const path = fixture.path(); const metadata = await fixture.open(path, { queueLimit: 1 });
    const accepted = metadata.namespaces.execute(create());
    await expect(metadata.get(key)).rejects.toMatchObject({ code: 'queue_full' });
    const closing = metadata.close();
    await expect(metadata.get(key)).rejects.toMatchObject({ code: 'closed' });
    expect(metadata.close()).toBe(closing);
    await expect(accepted).resolves.toMatchObject({ id: uuid(1) });
    await closing; fixture.handles.delete(metadata);
    const successor = await fixture.open(path); expect((await successor.get(key)).id).toBe(uuid(1));
  });
  it('rejects pending work on abrupt termination without retrying unknown outcomes', async () => {
    const metadata = await fixture.open();
    const rejected = expect(metadata.namespaces.execute(create())).rejects.toMatchObject({ code: 'unavailable' });
    await metadata.abort(); fixture.handles.delete(metadata); await rejected;
  });
  it.each(['close', 'get'])('awaits real worker termination after %s fails during native SQLite work', async kind => {
    const path = fixture.path(); const entry = join(fixture.root(), `failing-${kind}.mjs`);
    await writeFile(entry, `import {parentPort} from 'node:worker_threads';
      import {DatabaseSync} from 'node:sqlite';
      const delay = new DatabaseSync(':memory:');
      parentPort.on('message',command=>{
        if(command.kind!==${JSON.stringify(kind)}) return;
        parentPort.postMessage({kind:'result',messageId:command.messageId,ok:false,code:'unavailable'});
        delay.exec('WITH RECURSIVE d(x) AS (VALUES(0) UNION ALL SELECT x+1 FROM d WHERE x<5000000) SELECT sum(x) FROM d');
      });
      await import(${JSON.stringify(fixture.workerUrl().href)});`);
    const metadata = await fixture.open(path, { workerUrl: pathToFileURL(entry) }); await metadata.namespaces.execute(create());
    if (kind === 'get') await expect(metadata.get(key)).rejects.toMatchObject({ code: 'unavailable' });
    const closing = metadata.close();
    await expect(closing).rejects.toMatchObject({ code: 'unavailable', message: 'Storage unavailable' });
    expect(metadata.close()).toBe(closing); fixture.handles.delete(metadata);
    const probe = new DatabaseSync(path, { timeout: 0 });
    try { expect(() => probe.exec('PRAGMA locking_mode=EXCLUSIVE; BEGIN EXCLUSIVE; COMMIT;')).not.toThrow(); }
    finally { probe.close(); }
    const successor = await fixture.open(path); expect((await successor.get(key)).id).toBe(uuid(1));
  });
  it('rejects all pending callers after an actual worker crash and permits restart', async () => {
    const path = fixture.path(); const entry = join(fixture.root(), 'crash.mjs');
    await writeFile(entry, `import {parentPort} from 'node:worker_threads';
      parentPort.on('message',command=>{if(command.kind==='get')process.exit(17)});
      await import(${JSON.stringify(fixture.workerUrl().href)});`);
    const metadata = await fixture.open(path, { workerUrl: pathToFileURL(entry) }); await seed(metadata);
    const results = await Promise.allSettled([metadata.get(key), metadata.get(key)]);
    for (const result of results) {
      expect(result.status).toBe('rejected');
      if (result.status === 'rejected') expect(result.reason).toMatchObject({ code: 'unavailable', message: 'Storage unavailable' });
    }
    await expect(metadata.close()).rejects.toMatchObject({ code: 'unavailable' }); fixture.handles.delete(metadata);
    const successor = await fixture.open(path); expect((await successor.get(key)).id).toBe(uuid(1));
  });
  it('bounds stalled command availability and awaits termination on close after failure', async () => {
    const entry = join(fixture.root(), 'stall.mjs');
    await writeFile(entry, "import {parentPort} from 'node:worker_threads';parentPort.on('message',()=>{});parentPort.postMessage({kind:'ready'});");
    const metadata = await fixture.open(undefined, { workerUrl: pathToFileURL(entry) });
    await expect(metadata.namespaces.execute(create())).rejects.toMatchObject({ code: 'unavailable' });
    await expect(metadata.close()).rejects.toMatchObject({ code: 'unavailable' }); fixture.handles.delete(metadata);
  });
  it('bounds startup availability and redacts startup/database failures', async () => {
    const entry = join(fixture.root(), 'startup-stall.mjs');
    await writeFile(entry, "import {parentPort} from 'node:worker_threads';parentPort.on('message',()=>{});");
    await expect(fixture.open(undefined, { workerUrl: pathToFileURL(entry) })).rejects.toMatchObject({ code: 'unavailable' });
    await expect(fixture.open(join(fixture.root(), 'CANARY-missing', 'metadata.sqlite')))
      .rejects.toMatchObject({ code: 'unavailable', message: 'Storage unavailable' });
  });
  it('rejects unsafe inputs without invoking getters or leaking submitted values', async () => {
    const metadata = await fixture.open(); let invoked = false;
    const accessor = Object.defineProperty({ ...create() }, 'request', { enumerable: true,
      get() { invoked = true; throw new Error('CANARY'); } });
    const huge = structuredClone(create()); huge.request.name = 'CANARY'.repeat(20000);
    for (const input of [accessor, huge, null]) await expect(metadata.namespaces.execute(input as NamespaceCommand))
      .rejects.toMatchObject({ code: 'invalid_input', message: 'Storage invalid_input' });
    expect(invoked).toBe(false);
    expect((await metadata.list({ kind: 'organization', scope: { kind: 'installation' }, limit: 100 })).items).toEqual([]);
    for (const queueLimit of [0, 65, 1.5]) await expect(fixture.open(undefined, { queueLimit })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(fixture.open(':memory:')).rejects.toMatchObject({ code: 'invalid_input' });
    const setup = settingsFixture();
    await expect(openMetadata({ path: fixture.path(), workerUrl: fixture.workerUrl(), installation: setup.chain.installation,
      runtime: observation({ ...setup.runtime, supportedProfiles: [] }) })).rejects.toMatchObject({ code: 'invalid_input' });
  });
});
