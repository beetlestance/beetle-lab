import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {gunzipSync} from 'node:zlib';
import {decodeLiveMetricSnapshot} from '@beetle/contracts/api';
import {fixture, hash, window} from './fixtures.js';
beforeEach(() => vi.useFakeTimers());
afterEach(() => {vi.clearAllTimers(); vi.useRealTimers();});
it('charges actual bounded gzip bytes, accepts the exact quota and refuses the next frame without IO', async () => {
 const sample = fixture(); sample.publisher.accept(window(1)); await sample.advance();
 const bytes = sample.write.mock.calls[0]![0]; const length = bytes.length;
 expect([...bytes.subarray(0, 2)]).toEqual([0x1f, 0x8b]);
 const decoded = gunzipSync(bytes, {maxOutputLength: 65536}); expect(length).toBeLessThan(decoded.length);
 expect(decodeLiveMetricSnapshot(decoded, hash)).toEqual(sample.frames[0]); expect(sample.publisher.state().chargedBytes).toBe(length); await sample.publisher.close();
 const exact = fixture({maximumProducedBytes: length}); exact.publisher.accept(window(1)); await exact.advance();
 expect(exact.write).toHaveBeenCalledTimes(1); expect(exact.publisher.state().chargedBytes).toBe(length);
 exact.publisher.accept(window(3)); await exact.advance(2000);
 expect(exact.write).toHaveBeenCalledTimes(1); expect(exact.publisher.state()).toMatchObject({reason: 'quota', publishedSequence: 1, chargedBytes: length}); await exact.publisher.close();
 const short = fixture({maximumProducedBytes: length - 1}); short.publisher.accept(window(1)); await short.advance();
 expect(short.write).not.toHaveBeenCalled(); expect(short.publisher.state().reason).toBe('quota'); await short.publisher.close();
});
