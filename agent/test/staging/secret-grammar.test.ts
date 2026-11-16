import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { validate } from '@beetle/contracts';
import { fixture, hash } from './fixtures.js';

const f = fixture();
it('stages exact leading-underscore aliases and declared versions without metadata value material', async () => {
  const e = await f.environment(false);
  const reference = { name: '_TOKEN', provider: 'env' as const, reference: '_SOURCE', version: 'v'.repeat(256) };
  e.offer.secretReferences = [reference];
  expect(validate('Offer', e.offer).ok).toBe(true);
  await f.enqueue(e.owner, e.offer); await f.admit(e.owner, e.offer);
  const value = Buffer.from('SYNTHETIC_SEAM_VALUE');
  const task = e.prepare(e.create({ providers: { ...e.options.providers, secret: async request => {
    expect(request.secret).toEqual(reference); return value;
  } } }));
  const result = await task.result; await task.quiesced;
  expect(result.ok).toBe(true); if (!result.ok) throw new Error(result.reason);
  const root = join(e.rootPath, result.value.name);
  expect(await readFile(join(root, 'secrets', '_TOKEN'))).toEqual(value);
  const metadata = await readFile(join(root, 'input', 'staging.json'), 'utf8');
  expect(validate('StagedAttempt', JSON.parse(metadata)).ok).toBe(true);
  expect(JSON.parse(metadata).secretNames).toEqual(['_TOKEN']);
  expect(metadata).not.toContain(value.toString()); expect(metadata).not.toContain(hash(value));
});
