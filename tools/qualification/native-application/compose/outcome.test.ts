import assert from 'node:assert/strict';
import {expect, it} from 'vitest';
import {nativeOutcome} from './outcome.js';
import {nativeFailure} from './failure.js';

it('never publishes a session token from a real failed session-equality assertion', () => {
  const canary = 'SYNTHETIC_SESSION_TOKEN_CANARY'; let failure: Error | undefined;
  try {assert.deepEqual({csrfToken: canary}, {csrfToken: 'different'});}
  catch (error) {failure = error as Error;}
  expect(failure?.message).toContain(canary);
  const encoded = JSON.stringify(nativeOutcome({status: 'failed', phase: 'restart', cleanupVerified: true,
    revision: 'a'.repeat(40), architecture: 'arm64', failure: failure!.message, stack: failure!.stack,
    csrfToken: canary, diagnosis: nativeFailure(failure),
    imageIds: {frontend: `sha256:${'b'.repeat(64)}`, backend: canary, extra: canary}}));
  expect(encoded).not.toContain(canary); expect(encoded).not.toContain('csrfToken');
  expect(JSON.parse(encoded)).toMatchObject({failure: 'qualification_failed', phase: 'restart',
    diagnosis: {code: 'assertion', site: null}, imageIds: {frontend: `sha256:${'b'.repeat(64)}`, backend: null}});
});
it('publishes only a fixed code and whitelisted numeric source location from private errors', () => {
  const error = new Error('Public API failure: timeout/0/SECRET_TOKEN');
  error.stack = 'SECRET_TOKEN\n at value (/private/SECRET_TOKEN/tools/qualification/native-application/public-api.ts:13:25)';
  expect(nativeFailure(error)).toEqual({code: 'public_timeout', site: {file: 'public-api', line: 13, column: 25}});
  const encoded = JSON.stringify(nativeOutcome({status: 'failed', phase: 'local-session',
    diagnosis: nativeFailure(error), failure: error.message, stack: error.stack}));
  expect(encoded).not.toContain('SECRET_TOKEN'); expect(encoded).not.toContain('/private/');
});
it('rejects forged free-form diagnosis fields and source locations', () => {
  const encoded = JSON.stringify(nativeOutcome({diagnosis: {code: 'SECRET', site: {file: 'SECRET', line: 'SECRET', column: -1}}}));
  expect(encoded).not.toContain('SECRET'); expect(JSON.parse(encoded).diagnosis).toEqual({code: 'internal', site: null});
});
it('exposes only a bounded HTTP status from a public-read failure',()=>{
 const error=new Error('Public API failure: protocol/503/SYNTHETIC_SECRET');
 const encoded=JSON.stringify(nativeOutcome({diagnosis:nativeFailure(error)}));
 expect(JSON.parse(encoded).diagnosis.publicStatus).toBe(503);expect(encoded).not.toContain('SYNTHETIC_SECRET');
 for(const status of ['SYNTHETIC_SECRET',0,600,403.5]){
  expect(nativeOutcome({diagnosis:{code:'public_api',publicStatus:status}}).diagnosis).not.toHaveProperty('publicStatus');
 }
});
it('does not grant a public pass for failed cleanup or arbitrary status/phase strings', () => {
  expect(nativeOutcome({status: 'passed', cleanupVerified: false})).toMatchObject({status: 'failed', failure: 'qualification_failed'});
  const outcome = nativeOutcome({status: 'TOKEN', phase: 'TOKEN', architecture: 'TOKEN', revision: 'TOKEN'});
  expect(JSON.stringify(outcome)).not.toContain('TOKEN');
  expect(outcome).toMatchObject({status: 'failed', phase: 'unknown', revision: null, architecture: null});
});
it('records a closed successful outcome only after verified cleanup', () => {
  expect(nativeOutcome({status: 'passed', phase: 'cleanup', cleanupVerified: true})).toMatchObject({status: 'passed', failure: null});
});
