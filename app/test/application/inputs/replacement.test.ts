import {expect, it} from 'vitest';
import type {InputRecord} from '../../../src/ports/inputs.js';
import {storageFixture} from '../../storage/fixture.js';
import {append, createSuite, request} from '../../storage/suites-fixture.js';
import {runCommand, runOptions} from '../../storage/runs-fixture.js';
import {createInputService} from '../../../src/application/inputs/index.js';
import {inputOptions} from '../../storage/inputs-fixture.js';
import {creation, digest, key, memoryBytes, scope, source, transition} from './fixture.js';
import {seed} from '../../storage/fixture.js';

const fixture = storageFixture();
it('replaces through a newly named input and revision while old revisions and queued Runs keep their exact original pins', async () => {
  const metadata = await fixture.open(fixture.path(), {...inputOptions(), ...runOptions()}); await seed(metadata);
  const model = memoryBytes(); const service = createInputService({store: metadata.inputs, bytes: model.bytes, digest});
  async function publish(id: number, content: string) {
    const staged = await service.control(creation(id, content)) as InputRecord;
    const uploaded = await service.append(key(staged), 0, source(content));
    await service.control(transition(uploaded, 'sealInput')); return service.get(key(staged));
  }
  try {
    const original = await publish(90, 'abc'); const suite = await createSuite(metadata);
    const body = request(); const pin = {id: original.id, sha256: original.sha256, bytes: original.bytes};
    body.config.datasets = [{id: 'data', kind: 'json', selection: 'byVu', input: pin}];
    const first = await append(metadata, suite, 60, body);
    const oldRun = await metadata.runs.execute(runCommand(first.id));
    const replacement = await publish(91, 'new content'); const next = request(2);
    const replacementPin = {id: replacement.id, sha256: replacement.sha256, bytes: replacement.bytes};
    next.config.datasets = [{id: 'data', kind: 'json', selection: 'byVu', input: replacementPin}];
    const current = await metadata.suites.getSuite({scope, id: suite.id});
    const second = await append(metadata, current, 61, next);
    expect(second.inputManifest).toEqual([replacementPin]);
    expect((await metadata.suites.getRevision({scope, id: first.id})).inputManifest).toEqual([pin]);
    expect(await metadata.runs.getRun({scope, id: oldRun.id})).toEqual(oldRun);
    expect(oldRun.revisionId).toBe(first.id);
    const chunks: Uint8Array[] = []; await service.read(key(original), undefined, {write: async bytes => {chunks.push(bytes);}});
    expect(Buffer.concat(chunks).toString()).toBe('abc');
    await expect(service.control(transition(original, 'deleteInput'))).rejects.toMatchObject({code: 'conflict'});
  } finally {await service.close();}
});
