import { describe, expect, it } from 'vitest';
import { writeFile, truncate } from 'node:fs/promises';
import { fixture, seal, sha, tracking } from './fixture.js';

describe('generic stopped output verification', () => {
  const f = fixture();
  it('verifies a zero-artifact result with exact actual-result/control accounting', async () => {
    const result = f.result(); await f.write(result); const bytes = Buffer.byteLength(JSON.stringify(result)) + 123;
    const t = tracking(); const operation = f.collect(f.options(result, { outputBytes: bytes }), t.ports);
    expect(await operation.result).toEqual({ ok: true, value: result, verifiedBytes: bytes });
    expect(t.closed.length).toBe(t.opened.length); expect(Object.isFrozen(result)).toBe(true);
    await operation.quiesced; expect(operation.close()).toBe(operation.close());
  });
  it('streams a large nested artifact with bounded read windows and exact accounting', async () => {
    const body = Buffer.alloc(2_000_000, 71); const artifact = await f.artifact('reports/nested/large.bin', body);
    const result = f.result([artifact]); await f.write(result); const t = tracking({ chunk: 17_111 });
    const operation = f.collect(f.options(result), t.ports); const outcome = await operation.result;
    expect(outcome).toEqual({ ok: true, value: result, verifiedBytes: Buffer.byteLength(JSON.stringify(result)) + artifact.bytes + 123 });
    const artifactReads = t.reads.filter(read => read.path.endsWith('large.bin'));
    expect(artifactReads.length).toBeGreaterThan(30); expect(artifactReads.reduce((sum, read) => sum + read.bytes, 0)).toBe(body.length);
    expect(Math.max(...t.reads.map(read => read.requested))).toBeLessThanOrEqual(65_536);
    expect(t.closed.length).toBe(t.opened.length);
  });
  it('does not count undeclared file occupancy as verified output bytes', async () => {
    await f.artifact('undeclared.bin', Buffer.alloc(1000)); const result = f.result(); await f.write(result);
    const bytes = Buffer.byteLength(JSON.stringify(result)) + 123;
    expect(await f.collect(f.options(result, { outputBytes: bytes })).result).toMatchObject({ ok: true, verifiedBytes: bytes });
  });
  it('accepts an actual result file exactly at its one MiB bound', async () => {
    const result = f.result(); const raw = JSON.stringify(result); await f.write(raw + ' '.repeat(1_048_576 - Buffer.byteLength(raw)));
    expect(await f.collect(f.options(result, { outputBytes: 1_048_576 + 123 })).result)
      .toMatchObject({ ok: true, verifiedBytes: 1_048_576 + 123 });
  });
  it('verifies an empty declared artifact without retaining an artifact body', async () => {
    const artifact = await f.artifact('empty.bin', ''); const result = f.result([artifact]); await f.write(result); const t = tracking();
    expect(await f.collect(f.options(result), t.ports).result).toMatchObject({ ok: true });
    expect(t.reads.filter(read => read.path.endsWith('empty.bin'))).toHaveLength(0);
  });
  it.each(['budget', 'hash', 'length'])('rejects an artifact %s conflict', async fault => {
    const artifact = await f.artifact('payload.bin', 'contents');
    if (fault === 'hash') artifact.sha256 = 'a'.repeat(64);
    if (fault === 'length') artifact.bytes++;
    const result = f.result([artifact]); await f.write(result);
    const exact = Buffer.byteLength(JSON.stringify(result)) + artifact.bytes + 123;
    const options = f.options(result, { outputBytes: fault === 'budget' ? exact - 1 : exact });
    expect(await f.collect(options).result).toEqual({ ok: false, reason: fault === 'budget' ? 'output_limit' : 'integrity' });
  });
  it.each(['file-seal', 'reported-seal', 'scope', 'engine', 'agreement'])('rejects %s mismatch', async fault => {
    const correct = f.result(); let file = structuredClone(correct); let reported = structuredClone(correct);
    if (fault === 'file-seal') file.seal.sha256 = '0'.repeat(64);
    if (fault === 'reported-seal') reported.seal.sha256 = '0'.repeat(64);
    if (fault === 'scope') file = structuredClone(seal({ ...file, generation: 2 }));
    if (fault === 'engine') file = structuredClone(seal({ ...file, engineId: 'different' }));
    if (fault === 'agreement') reported = structuredClone(seal({ ...reported, thresholds: [] }));
    await f.write(file); expect(await f.collect(f.options(reported)).result).toEqual({ ok: false, reason: 'result' });
  });
  it.each(['utf8', 'json', 'oversize', 'missing'])('rejects a %s result file', async fault => {
    const result = f.result();
    if (fault === 'utf8') await f.write(Buffer.from([0xff]));
    if (fault === 'json') await f.write('{');
    if (fault === 'oversize') { await f.write(''); await truncate(f.path(), 1_048_577); }
    expect(await f.collect(f.options(result)).result).toEqual({ ok: false, reason: fault === 'missing' ? 'missing' : 'result' });
  });
  it('detects same-size mutation immediately after an original artifact read', async () => {
    const artifact = await f.artifact('mutable.bin', 'contents'); const result = f.result([artifact]); await f.write(result);
    let changed = false;
    const t = tracking({ readDone: async path => {
      if (!changed && path.endsWith('mutable.bin')) { changed = true; await writeFile(path, 'mutated!'); }
    } });
    expect(await f.collect(f.options(result), t.ports).result).toEqual({ ok: false, reason: 'custody' });
    expect(t.closed.length).toBe(t.opened.length); expect(sha('contents')).not.toBe(sha('mutated!'));
  });
});
