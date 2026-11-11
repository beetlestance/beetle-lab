import { expect, it } from 'vitest';
import { LivePosition } from './position.js';
import { frame, latest } from './fixtures.js';
it('does not refresh unchanged producer data under a frozen wall clock', () => {
  const position = new LivePosition(); const value = latest(); position.accept(value, 0);
  expect(position.accept({...value, receivedMono: 2000, expiresAtMono: 8000}, 2000).expiresAtMono).toBe(6000);
  expect(() => position.accept({...value, receivedMono: 6000, expiresAtMono: 12000}, 6000)).toThrow();
});
it.each(['epoch', 'subset', 'repeat', 'revision', 'source', 'overlap', 'capture', 'publication', 'coalesced'] as const)('rejects display discontinuity: %s', cause => {
  const position = new LivePosition(); position.accept(latest(frame({coalescedWindows: 1})), 0);
  const next = latest(frame({publishedSequence: 2, sourceSequence: 2, startTimeMs: 1000, endTimeMs: 2000,
    capturedAtMs: 2000, publishedAtMs: 2000, coalescedWindows: 1}), 1000, 2000);
  if (cause === 'epoch') next.frame.producerEpoch = '00000000-0000-4000-8000-000000000099';
  if (cause === 'subset') next.frame.subsetDigest = 'f'.repeat(64);
  if (cause === 'repeat') {next.frame.publishedSequence = 1; return expect(() => position.accept({...next, fingerprint: 'b'.repeat(64)}, 1000)).toThrow();}
  if (cause === 'revision') next.frame.publishedSequence = 0;
  if (cause === 'source') next.frame.sourceSequence = 1;
  if (cause === 'overlap') next.frame.startTimeMs = 999;
  if (cause === 'capture') next.frame.capturedAtMs = 999;
  if (cause === 'publication') next.frame.publishedAtMs = 999;
  if (cause === 'coalesced') next.frame.coalescedWindows = 0;
  expect(() => position.accept(next, 1000)).toThrow();
});

it('rejects wall regression between polls', () => {
  const position = new LivePosition(); position.accept(latest(), 0);
  expect(() => position.accept({...latest(), receivedWall: 999, receivedMono: 1000}, 1000)).toThrow();
});
