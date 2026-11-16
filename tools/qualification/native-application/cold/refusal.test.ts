import {expect, it} from 'vitest';
import {captureResumeRefusal} from './refusal.js';
it('accepts only exact completed conflict, without exposing private warning text', () => {
 const value = captureResumeRefusal({exitCode: 1, oomKilled: false, logs: '(node:2) ExperimentalWarning: PRIVATE-CANARY\nconflict\n'});
 expect(value).toEqual({exitCode: 1, code: 'conflict'}); expect(JSON.stringify(value)).not.toContain('PRIVATE-CANARY');
});
it('does not treat arbitrary failure, OOM, missing or contradictory codes as expected refusal', () => {
 const original = {exitCode: 1, oomKilled: false, logs: 'conflict\n'};
 for (const patch of [{exitCode: 0}, {exitCode: 137}, {oomKilled: true}, {logs: 'unavailable\n'}, {logs: ''},
  {logs: 'conflict\nunavailable\n'}, {logs: 'conflict\n' + 'x'.repeat(16384)}]) expect(() => captureResumeRefusal({...original, ...patch})).toThrow();
});
