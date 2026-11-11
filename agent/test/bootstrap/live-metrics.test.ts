import { expect, it } from 'vitest';
import { createK6LiveApproval } from '@beetle/contracts/k6-live';
import type { K6MetricShape } from '@beetle/contracts/k6-metrics';
import { createEngineCatalog } from '../../src/catalog/index.js';
import { installedLiveMetricApproval } from '../../src/bootstrap/live-metrics.js';
import { prepareRuntime, runtimeName } from '../../src/backends/docker/index.js';
import { registration, offer as makeOffer } from '../catalog/fixtures.js';
import { hash } from '../live-metrics/fixtures.js';
function fixture(enabled: boolean) {
  const engine = registration();
  const configured = {...engine, profile: {...engine.profile, liveMetricMailbox: enabled}};
  const catalog = createEngineCatalog([configured]); const offer = makeOffer(configured);
  const name = runtimeName({...offer, installationId: engine.profile.installationId, generation: 1});
  const root = `${engine.profile.stagingRoot}/${name}`;
  const plan = prepareRuntime({offer, manifest: engine.manifest, profile: configured.profile, generation: 1,
    staged: {input: `${root}/input`, output: `${root}/output`, secrets: `${root}/secrets`}});
  if (!plan.ok) throw new Error(plan.reason);
  const key = {organizationId: offer.organizationId, workspaceId: offer.workspaceId, attemptId: offer.attemptId, generation: 1};
  return {offer, catalog, input: {key, plan: plan.value}};
}
it('derives native-equivalent approval only for an installed, opted-in k6 profile', () => {
  const e = fixture(true); const approve = installedLiveMetricApproval(e.catalog);
  expect(approve(e.offer, e.input)).toEqual(createK6LiveApproval({source: e.offer.config as unknown as K6MetricShape,
    scope: e.input.key, assignment: {specDigest: e.input.plan.specDigest, intentDigest: e.offer.intentDigest}, hash}));
  const off = fixture(false); expect(installedLiveMetricApproval(off.catalog)(off.offer, off.input)).toBeUndefined();
});
it('rejects config or installed-identity tampering before producing approval', () => {
  const e = fixture(true); const approve = installedLiveMetricApproval(e.catalog);
  expect(() => approve({...e.offer, config: {requests: []}}, e.input)).toThrow();
  expect(() => approve({...e.offer, engine: {...e.offer.engine, imageDigest: 'sha256:' + 'f'.repeat(64)}}, e.input)).toThrow();
});
