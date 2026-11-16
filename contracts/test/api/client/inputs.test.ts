import { expect, it } from 'vitest';
import { createApiClient, validateApi } from '../../../src/api/index.js';
import { baseUrl, load, otherId, params, reply } from './helpers.js';

it('binds input status and every paged record to route identity, scope and lifecycle facts', async () => {
  const record = await load('input', 'InputRecord');
  const route = { ...params, inputId: record.id };
  expect(await createApiClient({ baseUrl, fetch: reply(record) }).getInput({ params: route }))
    .toEqual({ ok: true, value: record });
  const published = { ...record, state: 'published' as const, offset: 12, version: 3 };
  expect(await createApiClient({ baseUrl, fetch: reply(published) }).getInput({ params: route }))
    .toEqual({ ok: true, value: published });
  for (const invalid of [{ ...record, id: otherId }, { ...record, offset: record.bytes + 1 },
    { ...record, state: 'published' }, { ...record, state: 'failed', reason: null },
    { ...record, state: 'staging', reason: 'io' }]) {
    expect(await createApiClient({ baseUrl, fetch: reply(invalid) }).getInput({ params: route }))
      .toEqual({ ok: false, error: { kind: 'response' } });
  }
  const page = await load('input-page', 'InputPage');
  page.items[0]!.scope.workspaceId = otherId;
  expect(await createApiClient({ baseUrl, fetch: reply(page) }).listInputs({ params, query: { limit: 10 } }))
    .toEqual({ ok: false, error: { kind: 'response' } });
  const wrongProgress = { scope: record.scope, items: [{ ...record, offset: 13 }], nextCursor: null };
  expect(await createApiClient({ baseUrl, fetch: reply(wrongProgress) }).listInputs({ params, query: { limit: 10 } }))
    .toEqual({ ok: false, error: { kind: 'response' } });
});

it('keeps create replay bound to the original staging snapshot and declared byte identity', async () => {
  const record = await load('input', 'InputRecord');
  const body = await load('create-input', 'CreateInputRequest');
  expect(await createApiClient({ baseUrl, fetch: reply(record, 201) }).createInput({ params, body }))
    .toEqual({ ok: true, value: record });
  for (const invalid of [{ ...record, sha256: 'b'.repeat(64) }, { ...record, bytes: 13 },
    { ...record, state: 'published', offset: record.bytes, version: 3 }, { ...record, name: 'Other dataset' }]) {
    expect(await createApiClient({ baseUrl, fetch: reply(invalid, 201) }).createInput({ params, body }))
      .toEqual({ ok: false, error: { kind: 'response' } });
  }
});

it('binds seal/delete acceptance without treating a receipt as published or deleted status', async () => {
  const receipt = await load('input-receipt', 'InputReceipt');
  const body = await load('transition-input', 'TransitionInputRequest');
  const route = { ...params, inputId: receipt.id };
  expect(await createApiClient({ baseUrl, fetch: reply(receipt, 202) }).sealInput({ params: route, body }))
    .toEqual({ ok: true, value: receipt });
  for (const invalid of [{ ...receipt, id: otherId }, { ...receipt, requestId: otherId },
    { ...receipt, operation: 'delete' }, { ...receipt, acceptedVersion: 4 }]) {
    expect(await createApiClient({ baseUrl, fetch: reply(invalid, 202) }).sealInput({ params: route, body }))
      .toEqual({ ok: false, error: { kind: 'response' } });
  }
  const deletion = { ...receipt, operation: 'delete' as const };
  expect(await createApiClient({ baseUrl, fetch: reply(deletion, 202) }).deleteInput({ params: route, body }))
    .toEqual({ ok: true, value: deletion });
});

it('rejects oversized declarations, unknown fields and page overflow before publishing any availability', async () => {
  const body = await load('create-input', 'CreateInputRequest');
  expect(validateApi('CreateInputRequest', { ...body, bytes: 8_388_608 }).ok).toBe(true);
  expect(validateApi('CreateInputRequest', { ...body, bytes: 8_388_609 }).ok).toBe(false);
  expect(validateApi('CreateInputRequest', { ...body, localPath: '/synthetic/canary' }).ok).toBe(false);
  const page = await load('input-page', 'InputPage');
  expect(validateApi('InputPage', { ...page, items: Array.from({ length: 101 }, () => page.items[0]) }).ok).toBe(false);
  const fetcher = reply({}, 201);
  expect(await createApiClient({ baseUrl, fetch: fetcher }).createInput({ params, body: { ...body, bytes: 8_388_609 } }))
    .toEqual({ ok: false, error: { kind: 'request' } });
  expect(await createApiClient({ baseUrl, fetch: fetcher }).createInput({ params,
    body: { ...body, scope: { ...body.scope, workspaceId: otherId } } }))
    .toEqual({ ok: false, error: { kind: 'request' } });
  expect(fetcher).not.toHaveBeenCalled();
});
