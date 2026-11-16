import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { createK6LiveApproval } from '@beetle/contracts/k6-live';
import { k6MetricCatalogue, k6MetricLayout } from '@beetle/contracts/k6-metrics';
import { createK6MetricProfile } from '../../aggregation/index.js';
import { compiled, fixture } from '../suite/fixtures.js';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
it.each([true, false])('derives the same raw/compiled catalogue and approval with readiness=%s', readiness => {
  const source = fixture(); if (!readiness) delete source.readiness; const suite = compiled(source);
  const raw = k6MetricCatalogue(k6MetricLayout(source)); const actual = createK6MetricProfile(suite);
  expect(raw).toEqual(actual.allowedSeries);
  const common = {scope: {organizationId: '00000000-0000-4000-8000-000000000001', workspaceId: '00000000-0000-4000-8000-000000000002',
    attemptId: '00000000-0000-4000-8000-000000000003', generation: 1},
    assignment: {specDigest: '1'.repeat(64), intentDigest: '2'.repeat(64)}, hash};
  expect(createK6LiveApproval({source, ...common})).toEqual(createK6LiveApproval({source: suite, ...common}));
});
