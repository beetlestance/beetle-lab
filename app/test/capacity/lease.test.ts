import { describe, expect, it } from 'vitest';
import { capabilities, fixture } from './fixture.js';

describe('original agent and composite source leases', () => {
  it('uses the earliest source start and original expiry; cached disk reads cannot renew either', async () => {
    const f = await fixture();
    try {
      const source = await f.open(); const first = await source.sample();
      expect(first?.observedAtMs).toBe(10000); expect(first?.expiresAtMs).toBe(11000);
      f.state.now = 10800;
      expect(await source.sample()).toEqual(first);
      f.state.now = 11000; expect(await source.sample()).toBeNull();
      f.state.frame = capabilities(10500); f.state.now = 11100;
      expect(await source.sample()).toBeNull();
      f.state.frame = capabilities(11200); f.state.now = 11220;
      expect((await source.sample())?.expiresAtMs).toBe(12200);
    } finally { await f.cleanup(); }
  });
  it('clips to an earlier original agent expiry, including the half-open boundary', async () => {
    const f = await fixture(); f.state.frame.observation.expiresAtMs = 10200;
    try {
      const source = await f.open(); expect((await source.sample())?.expiresAtMs).toBe(10200);
      f.state.now = 10200; expect(await source.sample()).toBeNull();
    } finally { await f.cleanup(); }
  });
  it('retains the original local start when a newer agent frame arrives during a held read', async () => {
    const f = await fixture(); f.state.now = 9990;
    f.calls.mockImplementationOnce(async () => { f.state.now = 10100; return { ok: true, value: f.state.frame }; });
    try {
      const source = await f.open(); const first = await source.sample();
      expect(first?.observedAtMs).toBe(9990); expect(first?.expiresAtMs).toBe(10990);
      f.state.now = 10200; expect(await source.sample()).toEqual(first);
    } finally { await f.cleanup(); }
  });
  it.each([
    ['unmapped policy', () => { const v = capabilities(); v.observation.policyDigest = 'f'.repeat(64); return v; }],
    ['unmapped staging', () => { const v = capabilities(); v.observation.freeStagingDiskBytes = 123; return v; }],
    ['unmapped engine version', () => { const v = capabilities(); v.engines[0]!.version = '2'; return v; }],
    ['older original', () => capabilities(9990)],
    ['future original', () => capabilities(10400)],
    ['expired original', () => { const v = capabilities(); v.observation.expiresAtMs = 10100; return v; }],
  ])('revokes on %s and requires a source newer than the revocation fence', async (_name, replacement) => {
    const f = await fixture();
    try {
      const source = await f.open(); expect(await source.sample()).not.toBeNull();
      f.state.frame = replacement(); expect(await source.sample()).toBeNull();
      f.state.frame = capabilities(); expect(await source.sample()).toBeNull();
      f.state.now = 10600; f.state.frame = capabilities(10500);
      expect(await source.sample()).not.toBeNull();
    } finally { await f.cleanup(); }
  });
  it.each([50000, Number.MAX_SAFE_INTEGER, Number.POSITIVE_INFINITY])('rejected source %s cannot poison recovery from a current newer source', async invalid => {
    const f = await fixture();
    try {
      const source = await f.open(); expect(await source.sample()).not.toBeNull();
      f.state.frame = capabilities(invalid);
      expect(await source.sample()).toBeNull();
      f.state.frame = capabilities(); expect(await source.sample()).toBeNull();
      f.state.frame = capabilities(10200); f.state.now = 10300;
      const recovered = await source.sample();
      expect(recovered?.observedAtMs).toBe(10200); expect(recovered?.expiresAtMs).toBe(11200);
      f.state.now = 10400; expect(await source.sample()).toEqual(recovered);
    } finally { await f.cleanup(); }
  });
  it('revokes changed equal-source backend ceilings and requires a newer agent source', async () => {
    const f = await fixture(); const actual = await f.actual();
    try {
      const source = await f.open(); expect(await source.sample()).not.toBeNull();
      f.disk.statfs = async () => ({ ...actual, bsize: 100n, blocks: 5000n, bavail: 4000n });
      expect(await source.sample()).toBeNull();
      f.state.now = 10300; f.state.frame = capabilities(10200);
      expect((await source.sample())?.ceilings.pool.storageBytes).toBe(500000);
    } finally { await f.cleanup(); }
  });
  it('revokes unknown responses and clock rollback; output copies cannot mutate replay custody', async () => {
    const f = await fixture();
    try {
      const source = await f.open(); const first = await source.sample(); first!.ceilings.pool.cpuMillis = 1;
      expect((await source.sample())?.ceilings.pool.cpuMillis).toBe(4000);
      f.calls.mockResolvedValueOnce({ ok: false, error: { kind: 'transport' } });
      expect(await source.sample()).toBeNull(); expect(await source.sample()).toBeNull();
      f.state.now = 10300; f.state.frame = capabilities(10200); expect(await source.sample()).not.toBeNull();
      f.state.now = 10299; expect(await source.sample()).toBeNull();
      f.state.now = 10400; expect(await source.sample()).toBeNull();
      f.state.now = 10600; f.state.frame = capabilities(10500); expect(await source.sample()).not.toBeNull();
    } finally { await f.cleanup(); }
  });
  it('checks expiry after native disk work rather than only before reading', async () => {
    const f = await fixture(); const actual = await f.actual();
    f.disk.statfs = async () => { f.state.now = 11000; return actual; };
    try { expect(await (await f.open()).sample()).toBeNull(); } finally { await f.cleanup(); }
  });
  it('recovers after periodic unknown probes without advancing the first revocation fence', async () => {
    const f = await fixture(); f.state.now = 1040;
    f.calls.mockResolvedValueOnce({ ok: false, error: { kind: 'transport' } });
    try {
      const source = await f.open(); expect(await source.sample()).toBeNull();
      f.state.frame = capabilities(1000);
      for (const now of [1290, 1540, 1790, 2040]) {
        f.state.now = now; expect(await source.sample()).toBeNull();
      }
      f.state.frame = capabilities(2000); f.state.now = 2290;
      expect((await source.sample())?.observedAtMs).toBe(2000);
    } finally { await f.cleanup(); }
  });
});
