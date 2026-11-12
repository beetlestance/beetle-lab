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

it('admits only the reviewed standalone export composition entries and rejects private/reverse imports',()=>{
  const owner='tools/qualification/native-application/export/runner.test.ts';
  expect(boundaryIssues(owner,['../../../../engines/k6/wrapper/export/index.js','../../../../agent/src/collection/output/index.js',
    '../../../../engines/k6/compiler/suite/index.js','../../../../engines/k6/build/index.js','../../../../engines/k6/test/staged-input/fixtures.js'])).toEqual([]);
  expect(boundaryIssues(owner,['../../../../engines/k6/wrapper/export/runner.js'])).toHaveLength(1);
  expect(boundaryIssues(owner,['../../../../agent/src/collection/output/verify.js'])).toHaveLength(1);
  expect(boundaryIssues('engines/k6/wrapper/export/index.ts',['../../../../tools/qualification/native-application/export/fixture.js'])).toHaveLength(1);
  expect(boundaryIssues('tools/qualification/unreviewed/runner.ts',['../../../agent/src/collection/output/index.js'])).toHaveLength(1);
});
