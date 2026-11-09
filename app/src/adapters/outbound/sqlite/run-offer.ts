import { encodeJson, RUNNER_MAXIMUM_OFFER_BYTES, validate } from '@beetle/contracts';
import type { Offer } from '@beetle/contracts';
import { prepareK6SecretReferences } from '@beetle/contracts/engine-config/k6';
import type { Run, SuiteRevision } from '@beetle/contracts/api';
import { digestMutationIntent } from '../../../application/namespaces/index.js';
import { requireRule } from '../../../domain/namespaces/index.js';
import type { RunProfilePin } from './run-profiles.js';
import { k6ConfigSchema } from './configuration-schema.js';
import { sha256 } from './input-values.js';

/** The same immutable revision and pins own both public snapshot and private Offer. */
export function makeRunOffer(run: Run, revision: SuiteRevision, profile: RunProfilePin): string {
  requireRule(k6ConfigSchema.validate(revision.config));
  const secrets = prepareK6SecretReferences(revision.config.secrets);
  requireRule(secrets.ok);
  const intent = { protocolVersion: '1.0' as const, organizationId: run.scope.organizationId,
    workspaceId: run.scope.workspaceId, attemptId: run.activeAttemptId, engine: {
      id: profile.engine.id, imageDigest: profile.engine.imageDigest, configVersion: profile.engine.configVersion },
    inputs: revision.inputManifest, budget: run.budget, executionPolicy: run.executionPolicy,
    requiredCapabilities: profile.requiredCapabilities, secretReferences: secrets.value, config: revision.config };
  const intentDigest = digestMutationIntent(intent, text => sha256(`beetle-lab.run-offer.v1\n${text}`));
  const offer: Offer = { ...intent, requiredCapabilities: [...profile.requiredCapabilities],
    secretReferences: [...secrets.value], intentDigest };
  requireRule(validate('Offer', offer).ok);
  return encodeJson(offer, RUNNER_MAXIMUM_OFFER_BYTES);
}
