import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { encodeJson, validate } from '@beetle/contracts';
import type { Offer } from '@beetle/contracts';
import type { Run } from '@beetle/contracts/api';
import { claimsFixture } from './dispatch-claim-fixtures.js';
import type { ClaimsFixture } from './dispatch-claim-fixtures.js';
import { suiteCommand, request } from './suites-fixture.js';
import { runCommand } from './runs-fixture.js';
import { uuid } from './fixture.js';
import { captureDispatchOfferReply } from '../../src/adapters/outbound/sqlite/dispatch-offer-reply.js';

let f: ClaimsFixture;
beforeEach(() => { vi.useFakeTimers(); f = claimsFixture(); });
afterEach(() => { f.db.close(); vi.useRealTimers(); });
// Independent iterative census, without the production JSON encoder's counters.
function census(value: unknown): { nodes: number; depth: number } {
  const pending = [{ value, depth: 0 }];
  let nodes = 0; let depth = 0;
  while (pending.length) {
    const item = pending.pop()!; nodes++; depth = Math.max(depth, item.depth);
    if (item.value !== null && typeof item.value === 'object') {
      for (const value of Object.values(item.value)) pending.push({ value, depth: item.depth + 1 });
    }
  }
  return { nodes, depth };
}
function withBody(offer: Offer, value: unknown): void {
  const requests = offer.config.requests as { body?: { kind: string; value: unknown } }[];
  requests[0]!.body = { kind: 'json', value };
}
function acceptedOriginal(template: Offer) {
  const revision = request(2); revision.config = template.config;
  f.store.execute({ kind: 'suite', command: suiteCommand({ kind: 'createSuiteRevision', id: uuid(61), suiteId: uuid(50), request: revision }) });
  const run = f.store.execute({ kind: 'run', command: runCommand(uuid(61), 71) }) as Run;
  const text = String(f.db.prepare('SELECT offer_json FROM attempts WHERE id=?').get(run.activeAttemptId)!.offer_json);
  const offer = JSON.parse(text) as Offer;
  return { text, offer, key: { runId: run.id, attempt: { attemptId: offer.attemptId,
    organizationId: offer.organizationId, workspaceId: offer.workspaceId, intentDigest: offer.intentDigest, generation: 1 as const } } };
}
function preserve(text: string, name: string): void {
  const directory = process.env.BEETLE_DISPATCH_OFFER_EVIDENCE_DIRECTORY;
  if (directory) writeFileSync(join(directory, `${name}.json`), text);
  console.info(name, Buffer.byteLength(text), createHash('sha256').update(text).digest('hex'));
}
it.each([65528, 65536])('returns normally accepted original %i nodes with its fixed carrier overhead', nodes => {
  const template = f.original().offer;
  const value: null[][] = Array.from({ length: 16 }, () => []);
  withBody(template, value);
  let remaining = nodes - census(template).nodes;
  for (const array of value) {
    const length = Math.min(remaining, 4096); array.push(...Array<null>(length).fill(null)); remaining -= length;
  }
  expect(remaining).toBe(0);
  const original = acceptedOriginal(template);
  expect(census(original.offer).nodes).toBe(nodes);
  expect(validate('Offer', original.offer).ok).toBe(true);
  expect(encodeJson(original.offer, 2097152)).toBe(original.text);
  expect(Buffer.byteLength(encodeJson(original.offer.config, 1048576))).toBeLessThan(1048576);
  expect(Buffer.byteLength(original.text)).toBeLessThan(2097152);
  expect(census({ key: original.key, offer: original.offer }).nodes).toBe(nodes + 9);
  preserve(original.text, `nodes-${nodes}`);
  expect(f.claims.readOffer(original.key)).toEqual({ key: original.key, offer: original.offer });
});

it('preserves original maximum depth64 and rejects depth65 independently of the fixed carrier', () => {
  const { key, offer } = f.original();
  let value: unknown = null;
  for (let depth = 0; depth < 59; depth++) value = [value];
  withBody(offer, value);
  expect(census(offer).depth).toBe(64);
  expect(validate('Offer', offer).ok).toBe(true);
  expect(() => encodeJson(offer, 2097152)).not.toThrow();
  const result = captureDispatchOfferReply({ key, offer }, key);
  expect(census(result).depth).toBe(65);
  expect(result.offer).toEqual(offer);
  withBody(offer, [value]);
  expect(census(offer).depth).toBe(65);
  expect(() => captureDispatchOfferReply({ key, offer }, key)).toThrow('request_limit');
});
it('rejects one node over the original cap while every individual collection remains bounded', () => {
  const { key, offer } = f.original();
  const value: null[][] = Array.from({ length: 16 }, () => []);
  withBody(offer, value);
  let remaining = 65537 - census(offer).nodes;
  for (const array of value) {
    const length = Math.min(remaining, 4096); array.push(...Array<null>(length).fill(null)); remaining -= length;
  }
  expect(remaining).toBe(0);
  expect(census(offer).nodes).toBe(65537);
  expect(value.every(array => array.length <= 4096)).toBe(true);
  expect(() => captureDispatchOfferReply({ key, offer }, key)).toThrow('request_limit');
});
it('keeps per-collection4096, Offer2MiB and config1MiB byte limits unchanged', () => {
  const { key, offer } = f.original();
  withBody(offer, Array<null>(4097).fill(null));
  expect(() => captureDispatchOfferReply({ key, offer }, key)).toThrow('request_limit');
  withBody(offer, '');
  const overhead = Buffer.byteLength(JSON.stringify(offer.config));
  withBody(offer, 'x'.repeat(1048576 - overhead));
  expect(Buffer.byteLength(JSON.stringify(offer.config))).toBe(1048576);
  expect(captureDispatchOfferReply({ key, offer }, key).offer).toEqual(offer);
  withBody(offer, 'x'.repeat(1048577 - overhead));
  expect(Buffer.byteLength(JSON.stringify(offer.config))).toBe(1048577);
  expect(() => captureDispatchOfferReply({ key, offer }, key)).toThrow();
  withBody(offer, 'x'.repeat(2097152));
  expect(() => captureDispatchOfferReply({ key, offer }, key)).toThrow('request_limit');
});
it('accounts fixed carrier bytes and returns captured copies without invoking outer or nested accessors', () => {
  const { key, offer } = f.original();
  const result = captureDispatchOfferReply({ key, offer }, key);
  expect(Buffer.byteLength(JSON.stringify(result))).toBe(Buffer.byteLength(JSON.stringify(key)) + Buffer.byteLength(JSON.stringify(offer)) + 17);
  expect(census(result).nodes).toBe(census(offer).nodes + 9);
  const getter = vi.fn();
  for (const field of ['key', 'offer']) {
    const input = { key, offer };
    Object.defineProperty(input, field, { enumerable: true, get: getter });
    expect(() => captureDispatchOfferReply(input, key)).toThrow();
  }
  const nested = structuredClone(offer);
  Object.defineProperty(nested.config, 'untrusted', { enumerable: true, get: getter });
  expect(() => captureDispatchOfferReply({ key, offer: nested }, key)).toThrow();
  const expected = { ...key };
  Object.defineProperty(expected, 'runId', { enumerable: true, get: getter });
  expect(() => captureDispatchOfferReply({ key, offer }, expected)).toThrow();
  expect(getter).not.toHaveBeenCalled();
  (key as { runId: string }).runId = uuid(999);
  offer.budget.cpuMillis = 999;
  expect(result.key.runId).not.toBe(key.runId);
  expect(result.offer.budget.cpuMillis).not.toBe(offer.budget.cpuMillis);
});
it('rejects extra/missing/nonplain/malformed carrier fields, symbols and nonenumerable extras', () => {
  const { key, offer } = f.original();
  for (const input of [null, [], new Date(), 'raw', {}, { key }, { offer }, { key, offer, extra: true },
    { key, offer: JSON.stringify(offer) }, { key, offer: null }, { key, offer: { ...offer, budget: null } }]) {
    expect(() => captureDispatchOfferReply(input, key)).toThrow();
  }
  expect(() => captureDispatchOfferReply(Object.create({ key, offer }), key)).toThrow();
  const symbol = { key, offer, [Symbol('extra')]: true };
  expect(() => captureDispatchOfferReply(symbol, key)).toThrow();
  const hidden = { key, offer };
  Object.defineProperty(hidden, 'extra', { value: true });
  expect(() => captureDispatchOfferReply(hidden, key)).toThrow();
  expect(captureDispatchOfferReply(Object.assign(Object.create(null) as object, { key, offer }), key)).toEqual({ key, offer });
});
it('binds every original Offer field and all expected request key fields without normalization', () => {
  const { key, offer } = f.original();
  for (const field of ['attemptId', 'organizationId', 'workspaceId', 'intentDigest'] as const) {
    const changed = field === 'intentDigest' ? '0'.repeat(64) : uuid(999);
    expect(() => captureDispatchOfferReply({ key, offer: { ...offer, [field]: changed } }, key)).toThrow();
    const expected = { ...key, attempt: { ...key.attempt, [field]: changed } };
    expect(() => captureDispatchOfferReply({ key, offer }, expected)).toThrow();
  }
  expect(() => captureDispatchOfferReply({ key, offer }, { ...key, runId: uuid(999) })).toThrow();
  expect(() => captureDispatchOfferReply({ key, offer }, { ...key, attempt: { ...key.attempt, generation: 2 } } as never)).toThrow();
  expect(() => captureDispatchOfferReply({ key: { ...key, extra: true }, offer }, key)).toThrow();
  const reordered = { attempt: { generation: 1 as const, intentDigest: key.attempt.intentDigest,
    workspaceId: key.attempt.workspaceId, organizationId: key.attempt.organizationId, attemptId: key.attempt.attemptId }, runId: key.runId };
  expect(captureDispatchOfferReply({ key, offer }, reordered)).toEqual({ key, offer });
});
