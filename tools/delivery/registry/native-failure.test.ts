import {expect, it} from 'vitest';
import {nativeFailureRecord} from './native-failure.js';
it('retains a bounded native failure location without leaking private exception or session data', () => {
  const secret = '/private/session-token-canary';
  const record = nativeFailureRecord({format: 'beetle-native-outcome', version: 1, status: 'failed', phase: 'ordinary-run',
    revision: 'a'.repeat(40), architecture: 'amd64', cleanupVerified: true, failure: secret, stack: secret, cookie: secret,
    diagnosis: {code: 'assertion', site: {file: 'smoke', line: 40, column: 1}, message: secret}, imageIds: {frontend: secret}});
  expect(record.outcome).toMatchObject({status: 'failed', phase: 'ordinary-run', cleanupVerified: true,
    diagnosis: {code: 'assertion', site: {file: 'smoke', line: 40, column: 1}}});
  expect(JSON.stringify(record)).not.toContain(secret); expect(record.format).not.toBe('beetle-anonymous-qualification');
  expect(() => nativeFailureRecord({format: 'other', version: 1})).toThrow();
});
