import assert from 'node:assert/strict';
import {expect, it} from 'vitest';
import {nativeOutcome} from './outcome.js';

it('never publishes a session token from a real failed session-equality assertion', () => {
  const canary = 'SYNTHETIC_SESSION_TOKEN_CANARY'; let failure: Error | undefined;
  try {assert.deepEqual({csrfToken: canary}, {csrfToken: 'different'});}
  catch (error) {failure = error as Error;}
  expect(failure?.message).toContain(canary);
  const encoded = JSON.stringify(nativeOutcome({status: 'failed', phase: 'restart', cleanupVerified: true,
    revision: 'a'.repeat(40), architecture: 'arm64', failure: failure!.message, stack: failure!.stack,
    csrfToken: canary, imageIds: {frontend: `sha256:${'b'.repeat(64)}`, backend: canary, extra: canary}}));
  expect(encoded).not.toContain(canary); expect(encoded).not.toContain('csrfToken');
  expect(JSON.parse(encoded)).toMatchObject({failure: 'qualification_failed', phase: 'restart',
    imageIds: {frontend: `sha256:${'b'.repeat(64)}`, backend: null}});
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
