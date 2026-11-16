import {expect, it} from 'vitest';
import {latency, timed, transient} from './readers.js';
import type {Timing} from './readers.js';
it('keeps successful latency distinct from fast unavailable responses', () => {
 const calls: Timing[] = [{endpoint: 'live', durationMs: 300, status: 200, code: null},
  ...Array.from({length: 40}, (): Timing => ({endpoint: 'live', durationMs: 5, status: 503, code: 'capacity_unavailable'}))];
 expect(latency(calls)).toEqual([{endpoint: 'live', attempted: 41, successful: 1, unavailable: 40, allP95Ms: 5, successfulP95Ms: 300}]);
});
it('records thrown originals and refuses timings beyond its explicit finite bound', async () => {
 const calls: Timing[] = [];
 await expect(timed(calls, 'run', async () => {throw Error('synthetic');})).rejects.toThrow('synthetic');
 expect(calls).toHaveLength(1); expect(calls[0]).toMatchObject({status: 0, code: null});
 const full = Array.from({length: 8192}, () => calls[0]!); let invoked = false;
 await expect(timed(full, 'run', async () => {invoked = true; return {ok: true, value: null};})).rejects.toThrow(); expect(invoked).toBe(false);
});
it('only recognises declared transient protocol refusals', () => {
 expect(transient({ok: true, value: null})).toBe(false);
 expect(transient({ok: false, error: {kind: 'protocol', status: 503, protocol: {code: 'storage_unavailable', message: 'Storage unavailable', retryable: true, fields: [], requestId: 'synthetic'}}})).toBe(true);
 expect(() => transient({ok: false, error: {kind: 'timeout'}})).toThrow();
});
