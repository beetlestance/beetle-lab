import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runRoute, suiteRoute, submittedRun, checkRunState } from './run-state.mjs';
const source = JSON.parse(
  readFileSync(new URL('../../../contracts/fixtures/api/valid/run.json', import.meta.url), 'utf8'),
);
const path = `/organizations/${source.scope.organizationId}/workspaces/${source.scope.workspaceId}/runs/${source.id}`;
const key = runRoute('http://127.0.0.1:5190' + path);
const suite = suiteRoute(
  `http://127.0.0.1:5190/organizations/${source.scope.organizationId}/workspaces/${source.scope.workspaceId}/suites/${source.suiteId}`,
);
const submitted = submittedRun(source, suite, source.revisionId);
test('qualification state is bound to the exact visible run and workspace', () => {
  const run = { ...source, state: 'finished', outcome: 'passed', validationStatus: 'passed' };
  checkRunState(run, key, { state: 'finished', outcome: 'passed' }, submitted);
  assert.throws(
    () =>
      checkRunState({ ...run, id: source.scope.workspaceId }, key, { state: 'finished', outcome: 'passed' }, submitted),
    { name: 'AssertionError' },
  );
  assert.throws(
    () =>
      checkRunState(
        { ...run, scope: { ...run.scope, workspaceId: source.id } },
        key,
        { state: 'finished', outcome: 'passed' },
        submitted,
      ),
    { name: 'AssertionError' },
  );
  assert.throws(
    () =>
      checkRunState(
        { ...run, state: 'cancelled', outcome: 'inconclusive' },
        key,
        { state: 'finished', outcome: 'passed' },
        submitted,
      ),
    { name: 'AssertionError' },
  );
  assert.throws(
    () => checkRunState({ ...run, unexpected: true }, key, { state: 'finished', outcome: 'passed' }, submitted),
    { name: 'AssertionError' },
  );
});
test('qualification URLs cannot escape loopback, carry credentials or select another route', () => {
  for (const url of [
    'http://example.invalid' + path,
    'http://user:password@localhost' + path,
    'http://localhost/organizations/x/workspaces/y/runs/z',
    'http://localhost' + path + '/result',
  ])
    assert.throws(() => runRoute(url));
  assert.equal(runRoute('http://localhost:5190' + path + '?target=phases').id, key.id);
});

test('a route and response agreeing with each other cannot substitute another requested run', () => {
  const other = {
    ...source,
    state: 'finished',
    outcome: 'passed',
    validationStatus: 'passed',
    scope: { ...source.scope, workspaceId: source.id },
  };
  const otherKey = runRoute(
    `http://127.0.0.1:5190/organizations/${other.scope.organizationId}/workspaces/${other.scope.workspaceId}/runs/${other.id}`,
  );
  assert.throws(() => checkRunState(other, otherKey, { state: 'finished', outcome: 'passed' }, submitted));
  assert.throws(() => submittedRun(other, suite, source.revisionId), { name: 'AssertionError' });
  assert.throws(() => submittedRun(source, suite, source.id), { name: 'AssertionError' });
});
