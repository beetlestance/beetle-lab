import { expect, it } from 'vitest';
import { boundaryIssues } from './architecture.js';

it('limits cross-service qualification to named entrypoints in its own tooling owner', () => {
  const owner = 'tools/qualification/native-application/smoke-app.ts';
  expect(boundaryIssues(owner, ['../../../app/src/bootstrap/api.js',
    '../../../agent/src/bootstrap/index.js', '../../../agent/test/container/docker.js'])).toEqual([]);
  expect(boundaryIssues(owner, ['../../../app/src/adapters/outbound/sqlite/metadata.js'])).toHaveLength(1);
  expect(boundaryIssues('tools/other.ts', ['../agent/src/bootstrap/index.js'])).toHaveLength(1);
  expect(boundaryIssues('app/test/container/probe.ts', ['../../../agent/src/bootstrap/index.js'])).toHaveLength(1);
  expect(boundaryIssues('app/src/bootstrap/api.ts', ['../../../tools/qualification/native-application/smoke-app.js']))
    .toHaveLength(1);
  expect(boundaryIssues(owner, ['@beetle/agent'])).toHaveLength(1);
});
