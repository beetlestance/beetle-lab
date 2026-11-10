import { expect, it, vi } from 'vitest';
import type { Offer } from '@beetle/contracts';
import { collectionAuthority } from '../../src/controller/authority.js';
import { CollectionReadBusy } from '../../src/controller/launch-contention.js';
import type { ControllerJournal } from '../../src/controller/types.js';
import { JournalError } from '../../src/journal/index.js';
import fixtureOffer from '../../../contracts/fixtures/valid/offer.json' with { type: 'json' };

const specDigest = 'e'.repeat(64);
const journalAuthority = '12345678-1234-4234-8234-123456789abc';
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function fixture() {
  const offer = structuredClone(fixtureOffer) as Offer;
  offer.organizationId = 'ABCDEFAB-CDEF-4ABC-8DEF-ABCDEFABCDEF';
  const key = { organizationId: offer.organizationId, workspaceId: offer.workspaceId,
    attemptId: offer.attemptId, generation: 1 };
  const journal = {
    readOffer: vi.fn<ControllerJournal['readOffer']>().mockResolvedValue(offer),
    journalAuthority: vi.fn<ControllerJournal['journalAuthority']>().mockResolvedValue(journalAuthority),
  };
  return { offer, key, journal };
}
it('owns requested IDs and only original metadata before awaiting the physical Journal identity', async () => {
  const { offer, key, journal } = fixture();
  const read = deferred<Offer>(); const authority = deferred<string>(); const entered = deferred<void>();
  journal.readOffer.mockReturnValue(read.promise);
  journal.journalAuthority.mockImplementation(() => { entered.resolve(); return authority.promise; });
  const expected = { engineId: offer.engine.id, outputBytes: offer.budget.outputBytes, binding: {
    organizationId: offer.organizationId, workspaceId: offer.workspaceId, attemptId: offer.attemptId,
    generation: 1, intentDigest: offer.intentDigest, engine: structuredClone(offer.engine),
    installedIdentity: structuredClone(offer.installedIdentity), journalAuthority, specDigest,
  } };
  const pending = collectionAuthority(journal, key, specDigest);
  const capturedKey = journal.readOffer.mock.calls[0]![0];
  expect(capturedKey).toEqual(key); expect(capturedKey).not.toBe(key); expect(Object.isFrozen(capturedKey)).toBe(true);
  key.organizationId = key.workspaceId; key.workspaceId = key.attemptId;
  key.attemptId = '00000000-0000-4000-8000-000000000099'; key.generation = 2;
  read.resolve(offer); await entered.promise;
  offer.organizationId = key.organizationId; offer.workspaceId = key.workspaceId; offer.attemptId = key.attemptId;
  offer.intentDigest = '0'.repeat(64); offer.engine.id = 'mutated'; offer.engine.imageDigest = `sha256:${'0'.repeat(64)}`;
  offer.engine.configVersion++; offer.installedIdentity.manifestId = 'changed'; offer.installedIdentity.profileId = 'changed';
  offer.installedIdentity.catalogVersion++; offer.installedIdentity.manifestDigest = '0'.repeat(64);
  offer.installedIdentity.profileDigest = '0'.repeat(64); offer.installedIdentity.schemaDigest = '0'.repeat(64);
  offer.budget.outputBytes++;
  authority.resolve(journalAuthority);
  const result = await pending;
  expect(result).toEqual(expected);
  expect(result.binding.engine).not.toBe(offer.engine); expect(result.binding.installedIdentity).not.toBe(offer.installedIdentity);
  for (const value of [result, result.binding, result.binding.engine, result.binding.installedIdentity]) expect(Object.isFrozen(value)).toBe(true);
  expect(journal.readOffer).toHaveBeenCalledTimes(1); expect(journal.journalAuthority).toHaveBeenCalledTimes(1);
});
it('never reads or retains config, inputs, secrets or undeclared metadata canaries', async () => {
  const { offer, key, journal } = fixture();
  const foreign = vi.fn(() => { throw new Error('CANARY_PAYLOAD_ACCESS'); });
  for (const name of ['config', 'inputs', 'secretReferences']) Object.defineProperty(offer, name, { get: foreign });
  Object.defineProperty(offer.engine, 'extra', { get: foreign, enumerable: true });
  Object.defineProperty(offer.installedIdentity, 'extra', { get: foreign, enumerable: true });
  const result = await collectionAuthority(journal, key, specDigest);
  expect(foreign).not.toHaveBeenCalled();
  expect(Object.keys(result).sort()).toEqual(['binding', 'engineId', 'outputBytes']);
  expect(Object.keys(result.binding).sort()).toEqual(['attemptId', 'engine', 'generation', 'installedIdentity',
    'intentDigest', 'journalAuthority', 'organizationId', 'specDigest', 'workspaceId']);
  expect(Object.keys(result.binding.engine).sort()).toEqual(['configVersion', 'id', 'imageDigest']);
  expect(Object.keys(result.binding.installedIdentity).sort()).toEqual(['catalogVersion', 'manifestDigest', 'manifestId',
    'profileDigest', 'profileId', 'schemaDigest']);
  expect(JSON.stringify(result)).not.toContain('CANARY');
});
it.each(['organizationId', 'workspaceId', 'attemptId'] as const)('refuses mismatched original %s before authority issue', async field => {
  const { offer, key, journal } = fixture();
  offer[field] = '00000000-0000-4000-8000-000000000099';
  await expect(collectionAuthority(journal, key, specDigest)).rejects.toMatchObject({ reason: 'journal' });
  expect(journal.journalAuthority).not.toHaveBeenCalled();
});
it('does not normalize original scope spellings to accept a different requested tuple', async () => {
  const { key, journal } = fixture(); key.organizationId = key.organizationId.toLowerCase();
  await expect(collectionAuthority(journal, key, specDigest)).rejects.toMatchObject({ reason: 'journal' });
  expect(journal.journalAuthority).not.toHaveBeenCalled();
});
it.each(['', 'E'.repeat(64), 'e'.repeat(63), 'e'.repeat(65), 'g'.repeat(64)])('refuses malformed spec digest %s before either port', async spec => {
  const { key, journal } = fixture();
  await expect(collectionAuthority(journal, key, spec)).rejects.toMatchObject({ reason: 'invalid_input' });
  expect(journal.readOffer).not.toHaveBeenCalled(); expect(journal.journalAuthority).not.toHaveBeenCalled();
});
it.each([0, 2])('refuses generation %s before either port', async generation => {
  const { key, journal } = fixture(); key.generation = generation;
  await expect(collectionAuthority(journal, key, specDigest)).rejects.toBeDefined();
  expect(journal.readOffer).not.toHaveBeenCalled(); expect(journal.journalAuthority).not.toHaveBeenCalled();
});
it.each(['', 'not-a-uuid', journalAuthority.toUpperCase()])('never invents a replacement for malformed physical UUID %s', async identity => {
  const { key, journal } = fixture(); journal.journalAuthority.mockResolvedValue(identity);
  await expect(collectionAuthority(journal, key, specDigest)).rejects.toMatchObject({ reason: 'journal' });
  expect(journal.journalAuthority).toHaveBeenCalledTimes(1);
});
for (const port of ['readOffer', 'journalAuthority'] as const) {
  it(`maps only an actual ${port} queue refusal to collection busy`, async () => {
    const { key, journal } = fixture(); journal[port].mockRejectedValue(new JournalError('queue_full'));
    await expect(collectionAuthority(journal, key, specDigest)).rejects.toBeInstanceOf(CollectionReadBusy);
    if (port === 'readOffer') expect(journal.journalAuthority).not.toHaveBeenCalled();
  });
  it.each(['not_found', 'unavailable', 'recovery_required', 'closed'] as const)(`propagates ${port} %s without creating authority`, async code => {
    const { key, journal } = fixture(); const failure = new JournalError(code);
    journal[port].mockRejectedValue(failure);
    await expect(collectionAuthority(journal, key, specDigest)).rejects.toBe(failure);
  });
  it(`propagates a non-Journal ${port} exception unchanged`, async () => {
    const { key, journal } = fixture(); const failure = new Error('synthetic port failure');
    journal[port].mockRejectedValue(failure);
    await expect(collectionAuthority(journal, key, specDigest)).rejects.toBe(failure);
  });
}
it('does not turn a post-read metadata failure into nonissued collection busy', async () => {
  const { offer, key, journal } = fixture(); const failure = new JournalError('queue_full');
  Object.defineProperty(offer, 'engine', { get() { throw failure; } });
  await expect(collectionAuthority(journal, key, specDigest)).rejects.toBe(failure);
  expect(journal.journalAuthority).not.toHaveBeenCalled();
});
