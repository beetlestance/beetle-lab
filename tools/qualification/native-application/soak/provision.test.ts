import {expect, it} from 'vitest';
import {provisionDiagnosis, publicProvisionDiagnosis} from './provision.js';
it('retains only the exact fixed installer classification and bounded exit/signal', () => {
 expect(provisionDiagnosis(1, 'deadline\n', null)).toEqual({operation: 'installer-cli', code: 'deadline', exitCode: 1, signal: null});
 const result = provisionDiagnosis(999, 'PRIVATE_CANARY', 'PRIVATE_CANARY'); expect(result).toEqual({operation: 'installer-cli', code: 'internal', exitCode: null, signal: null});
 expect(JSON.stringify(publicProvisionDiagnosis({...result, private: 'PRIVATE_CANARY'}))).not.toContain('PRIVATE_CANARY');
 expect(publicProvisionDiagnosis({operation: 'PRIVATE_CANARY'})).toBeNull();
});
it('accepts one fixed code amid packaged SQLite warnings but rejects contradictory or duplicate codes', () => {
 expect(provisionDiagnosis(1, '(node:2) ExperimentalWarning: PRIVATE_CANARY\ndeadline\n', null).code).toBe('deadline');
 for (const stderr of ['deadline\nconflict\n', 'deadline\ndeadline\n', 'deadline\nunknown_code\n', 'x'.repeat(65537)])
  expect(provisionDiagnosis(1, stderr, null).code).toBe('internal');
});
