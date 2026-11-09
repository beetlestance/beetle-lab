import { expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { offerInput } from '../../src/journal/input.js';
import { admissionInput, configDigest } from '../../src/journal/admission-input.js';
import { journalFixture } from './fixtures.js';

const f = journalFixture();
function config(bytes: number): Record<string, unknown> {
  const value = { z: '\n"\\🪲', a: '' };
  const left = bytes - Buffer.byteLength(JSON.stringify(value));
  value.a = 'é'.repeat(Math.floor(left / 2)) + 'x'.repeat(left % 2); return value;
}
it('persists an independently measured exact1MiB UTF8/escaped config and reordered dedup across real-worker reopen', async () => {
  const path = f.path(); let journal = await f.open(path); const offer = f.offer(); offer.config = config(1048576);
  const original = JSON.stringify(offer);
  expect(Buffer.byteLength(JSON.stringify(offer.config))).toBe(1048576);
  expect(Buffer.byteLength(original)).toBeGreaterThan(1048576);
  const first = await journal.immutableOffer(offer); await f.close(journal); journal = await f.open(path);
  expect(await journal.readOffer(f.key())).toEqual(offer);
  const reordered = Object.fromEntries(Object.entries(offer).reverse());
  reordered.config = { a: offer.config.a, z: offer.config.z };
  expect(await journal.immutableOffer(reordered)).toEqual(first);
  const changed = structuredClone(offer); changed.config.z = 'other';
  await expect(journal.immutableOffer(changed)).rejects.toMatchObject({ code: 'conflict' });
  await f.close(journal); const db = new DatabaseSync(path);
  try {
    const row = db.prepare('SELECT offer_json,canonical_json FROM accepted_attempts').get()!;
    expect(row.offer_json).toBe(original);
    expect(Buffer.byteLength(String(row.canonical_json))).toBe(Buffer.byteLength(original));
  } finally { db.close(); }
});
it('rejects config and whole-Offer overflow before rows or reservations and before later getters', async () => {
  const journal = await f.open(); const offer = f.offer(); offer.config = config(1048577);
  await expect(journal.immutableOffer(offer)).rejects.toMatchObject({ code: 'invalid_input' });
  expect(() => configDigest(offer.config)).toThrow();
  let observed = false;
  const huge = { padding: 'x'.repeat(2097152), get later() { observed = true; return 1; } };
  expect(() => offerInput(huge)).toThrow(); expect(observed).toBe(false);
  await expect(journal.immutableOffer(huge)).rejects.toMatchObject({ code: 'invalid_input' });
  expect((await journal.listOpen({ limit: 10 })).snapshots).toEqual([]);
});
it('bounds non-Offer commands before traversal and classifies kind without invoking accessors', () => {
  let observed = false;
  const command = { kind: 'configure', padding: 'x'.repeat(65536), get later() { observed = true; return 1; } };
  expect(() => admissionInput(command as never)).toThrow(); expect(observed).toBe(false);
  const accessor = { get kind() { observed = true; return 'offer'; } };
  expect(() => admissionInput(accessor as never)).toThrow(); expect(observed).toBe(false);
});
it('allows only Offer commands the explicit2MiB plus64KiB whole-command allowance', () => {
  const offer = f.offer(); offer.config = config(1048576);
  const command = { kind: 'offer' as const, offer, now: 1, padding: '', validation: {
    manifestId: 'synthetic', profileId: 'synthetic', schemaDigest: 'b'.repeat(64), catalogVersion: 1,
    configDigest: configDigest(offer.config) } };
  command.padding = 'x'.repeat(2097152 + 65536 - Buffer.byteLength(JSON.stringify(command)));
  expect(Buffer.byteLength(JSON.stringify(command))).toBe(2097152 + 65536);
  expect(admissionInput(command).kind).toBe('offer');
  command.padding += 'x'; expect(() => admissionInput(command)).toThrow();
});
