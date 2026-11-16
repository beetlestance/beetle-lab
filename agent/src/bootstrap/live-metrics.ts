import { createHash } from 'node:crypto';
import { createK6LiveApproval } from '@beetle/contracts/k6-live';
import type { K6MetricShape } from '@beetle/contracts/k6-metrics';
import type { Catalog } from '../catalog/index.js';
import type { LiveMetricApprovalFactory } from '../supervisor/index.js';

/** Installed k6 policy selects approval; frames and image-supplied declarations cannot. */
export function installedLiveMetricApproval(catalog: Catalog): LiveMetricApprovalFactory {
  return (offer, input) => {
    if (!input.plan.spec.HostConfig.Mounts.some(mount => mount.Type === 'volume'
      && mount.Target === '/beetle/live' && mount.Source === `${input.plan.name}-live`
      && mount.ReadOnly === false && mount.VolumeOptions?.NoCopy === true)) return undefined;

    const {engine, offer: validated} = catalog.preflight(offer);
    if (engine.manifest.engineId !== 'k6' || engine.profile.liveMetricMailbox !== true) return undefined;
    const {organizationId, workspaceId, attemptId, generation} = input.key;
    return createK6LiveApproval({source: validated.config as unknown as K6MetricShape,
      scope: {organizationId, workspaceId, attemptId, generation},
      assignment: {specDigest: input.plan.specDigest, intentDigest: validated.intentDigest},
      hash: value => createHash('sha256').update(value).digest('hex')});
  };
}
