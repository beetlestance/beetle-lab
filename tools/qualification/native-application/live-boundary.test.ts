import { expect, it } from 'vitest';
import { boundaryIssues } from '../../architecture.js';
it('keeps cross-service live HTTP qualification outside service owners and private implementations', () => {
  const source = 'tools/qualification/native-application/live-http.test.ts';
  expect(boundaryIssues(source, ['../../../agent/src/transport/index.js',
    '../../../app/src/application/run-live-metrics/index.js'])).toEqual([]);
  expect(boundaryIssues(source, ['../../../agent/src/transport/live-metrics.js'])).toHaveLength(1);
  expect(boundaryIssues('app/test/http/run-live-metrics/native.test.ts', ['../../../../agent/src/transport/index.js'])).toHaveLength(1);
});
