import type { DatabaseSync } from 'node:sqlite';
import { encodeCanonicalJson, estimateStaging } from '@beetle/contracts';
import type { Offer } from '@beetle/contracts';
import type { Run } from '@beetle/contracts/api';
import type { RunProfilePin } from './run-profiles.js';
import { sha256 } from './input-values.js';

/** Shared by enqueue and future claim registry comparisons. */
export function executionRegistryDigest(profile: RunProfilePin): string {
  return sha256(`beetle-lab.execution-registry.v1\n${encodeCanonicalJson(profile, 32768)}`);
}

/** Caller owns the receipt-first enqueue transaction and its bounded parsed Offer. */
export function insertExecutionIntent(db: DatabaseSync, run: Run, offer: Offer, profile: RunProfilePin): void {
  const staging = estimateStaging(offer);
  const digest = executionRegistryDigest(profile);
  db.prepare(`INSERT INTO execution_intents(attempt_id,run_id,organization_id,workspace_id,intent_digest,
    profile_alias,registry_digest,cpu_millis,memory_bytes,pids,timeout_ms,output_bytes,mode,prefer_idle,
    staging_policy,offer_bytes,input_bytes,secret_bytes,manifest_bytes,metadata_bytes,staging_bytes)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(offer.attemptId, run.id, offer.organizationId,
    offer.workspaceId, offer.intentDigest, profile.engine.profileId, digest, offer.budget.cpuMillis,
    offer.budget.memoryBytes, offer.budget.pids, offer.budget.timeoutMs, offer.budget.outputBytes,
    offer.executionPolicy.mode, Number(offer.executionPolicy.preferIdle), staging.policyVersion,
    staging.offerBytes, staging.inputBytes, staging.secretBytes, staging.manifestBytes, staging.metadataBytes, staging.totalBytes);
}
