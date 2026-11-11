import { expect, it } from 'vitest';
import { boundaryIssues } from '../../architecture.js';
it('permits only the public mailbox entrypoint for native cross-service qualification', () => {
  const source = 'tools/qualification/native-application/mailbox-producer.ts';
  expect(boundaryIssues(source, ['../../../engines/k6/wrapper/live-mailbox/index.js'])).toEqual([]);
  expect(boundaryIssues(source, ['../../../engines/k6/wrapper/live-mailbox/native.js'])).toHaveLength(1);
});
