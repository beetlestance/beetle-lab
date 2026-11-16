import { expect, it } from 'vitest';
import { API_MAXIMUM_JSON_BYTES, createApiClient, validateApi } from '../../../src/api/index.js';
import type { SuiteRevision } from '../../../src/api/index.js';
import { baseUrl, load, otherId, params, reply } from './helpers.js';

it('binds revision details, create responses and summary pages to exact suite/revision route identity', async () => {
  const revision = await load('suite-revision', 'SuiteRevision');
  const body = await load('create-suite-revision', 'CreateSuiteRevisionRequest');
  const foreign = { ...revision, suiteId: otherId };
  const client = createApiClient({ baseUrl, fetch: reply(foreign, 201) });
  expect(await client.createSuiteRevision({ params: { ...params, suiteId: revision.suiteId }, body }))
    .toEqual({ ok: false, error: { kind: 'response' } });
  const wrongId = createApiClient({ baseUrl, fetch: reply({ ...revision, id: otherId }) });
  expect(await wrongId.getSuiteRevision({ params: { ...params, revisionId: revision.id } }))
    .toEqual({ ok: false, error: { kind: 'response' } });
  const page = await load('suite-revision-page', 'SuiteRevisionPage');
  page.items[0]!.suiteId = otherId;
  expect(await createApiClient({ baseUrl, fetch: reply(page) }).listSuiteRevisions({
    params: { ...params, suiteId: revision.suiteId }, query: { limit: 10 },
  })).toEqual({ ok: false, error: { kind: 'response' } });
});

it('carries a complete 1 MiB config in the bounded public revision envelope', async () => {
  const revision = await load('suite-revision', 'SuiteRevision');
  // DTO transport does not duplicate engine semantics; the application preflight owns those.
  const overhead = new TextEncoder().encode(JSON.stringify({ note: '' })).byteLength;
  revision.config = { note: 'x'.repeat(1_048_576 - overhead) };
  expect(new TextEncoder().encode(JSON.stringify(revision.config)).byteLength).toBe(1_048_576);
  const fetcher = reply(revision);
  const value = await createApiClient({ baseUrl, fetch: fetcher }).getSuiteRevision({ params: { ...params, revisionId: revision.id } });
  expect(value).toEqual({ ok: true, value: revision });
  const envelope = new TextEncoder().encode(JSON.stringify(revision)).byteLength;
  expect(envelope).toBeLessThan(API_MAXIMUM_JSON_BYTES);
  expect(envelope).toBeGreaterThan(1_048_576);
});

it('keeps immutable revision summaries small and rejects unknown fields/oversized pages', async () => {
  const page = await load('suite-revision-page', 'SuiteRevisionPage');
  expect(validateApi('SuiteRevisionPage', { ...page, items: [{ ...page.items[0], config: {} }] }).ok).toBe(false);
  expect(validateApi('SuiteRevisionPage', { ...page, items: Array.from({ length: 101 }, () => page.items[0]) }).ok).toBe(false);
  const invalid = { ...await load('suite-revision', 'SuiteRevision'), preflightStatus: 'executed' };
  expect(validateApi('SuiteRevision', invalid).ok).toBe(false);
  const typed = (value: SuiteRevision) => value.preflightStatus;
  expect(typed(await load('suite-revision', 'SuiteRevision'))).toBe('passed');
});
