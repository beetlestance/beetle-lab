import type {DatabaseSync} from 'node:sqlite';
import {encodeJson, estimateStaging} from '@beetle/contracts';
import type {Offer} from '@beetle/contracts';
import type {InstallationValues, Run} from '@beetle/contracts/api';
import type {RunCommand} from '../../src/ports/runs.js';
import {transaction} from '../../src/adapters/outbound/sqlite/schema.js';
import {Entities} from '../../src/adapters/outbound/sqlite/entities.js';
import {Suites} from '../../src/adapters/outbound/sqlite/suites.js';
import {Settings} from '../../src/adapters/outbound/sqlite/settings.js';
import {makeRunOffer} from '../../src/adapters/outbound/sqlite/run-offer.js';
import {executionRegistryDigest} from '../../src/adapters/outbound/sqlite/execution-intents.js';
import {writeMutationReceipt} from '../../src/adapters/outbound/sqlite/mutation-receipts.js';
import {observation, settingsFixture} from './fixture.js';
import {runOptions} from './runs-fixture.js';

/** Test-only row seed for actual schemas5–7, copied from7739937's insertion shape.
 * Not admission: no queue/capacity/replay eligibility assertion may use this seed.
 * Keep historical SQL independent of today's export/cleanup/order tables. Pure
 * shared wire builders still validate the synthetic Run/Offer; no frozen engine.
 */
export function historicalRun(db: DatabaseSync, command: RunCommand): Run {
  const version = Number(db.prepare('PRAGMA user_version').get()?.user_version);
  if (![5, 6, 7].includes(version)) throw new Error('Historical run seed requires schema5–7');
  const fixture = settingsFixture();
  const values = JSON.parse(String(db.prepare("SELECT value_json FROM settings WHERE scope_key='installation'").get()?.value_json)) as InstallationValues;
  // Explicit historical test capacity, independent of today's host observation.
  const runtime = {...fixture.runtime, pool: {...values.pool}, perRun: {...values.perRunCeilings}, supportedProfiles: [...values.supportedProfiles]};
  const settings = new Settings(db, {installation: fixture.chain.installation, runtime: observation(runtime)});
  const revision = new Suites(db, new Entities(db)).getRevision({scope: command.request.scope, id: command.request.revisionId});
  const resolved = settings.resolveRun(command.request.scope, {engineProfile: command.request.engineProfile, budget: command.request.budget});
  const profile = runOptions().runs!.profiles[0]!;
  const run: Run = {id: command.id, scope: command.request.scope, version: 1, suiteId: revision.suiteId,
    revisionId: revision.id, revisionDigest: revision.digest, requestedAt: command.requestedAt,
    activeAttemptId: command.attemptId, state: 'queued', outcome: 'pending', validationStatus: 'pending',
    cancellationRequested: false, reason: null, engine: profile.engine, budget: resolved.defaults.budget,
    executionPolicy: command.request.executionPolicy, settingsVersions: resolved.versions};
  const offer = makeRunOffer(run, revision, profile);
  return transaction(db, () => {
    insertRows(db, run, offer, encodeJson(profile, 32768));
    insertIntent(db, run, JSON.parse(offer) as Offer);
    db.prepare('INSERT INTO dispatch_outbox(attempt_id,intent_digest) VALUES(?,?)').run(run.activeAttemptId, (JSON.parse(offer) as Offer).intentDigest);
    return writeMutationReceipt(db, command, run, 65536) as Run;
  });
}
function insertRows(db: DatabaseSync, run: Run, offer: string, registry: string): void {
  db.prepare(`INSERT INTO runs(id,organization_id,workspace_id,suite_id,revision_id,active_attempt_id,
    version,state,outcome,validation_status,cancellation_requested,reason,requested_at,snapshot_json)
    VALUES(?,?,?,?,?,?,1,'queued','pending','pending',0,NULL,?,?)`).run(run.id, run.scope.organizationId,
    run.scope.workspaceId, run.suiteId, run.revisionId, run.activeAttemptId, run.requestedAt, encodeJson(run, 65536));
  db.prepare(`INSERT INTO attempts(id,run_id,organization_id,workspace_id,ordinal,intent_digest,offer_json,registry_json,state,foundation_owned)
    VALUES(?,?,?,?,1,?,?,?,'offered',1)`).run(run.activeAttemptId, run.id, run.scope.organizationId,
    run.scope.workspaceId, (JSON.parse(offer) as Offer).intentDigest, offer, registry);
}
function insertIntent(db: DatabaseSync, run: Run, offer: Offer): void {
  const staging = estimateStaging(offer); const profile = runOptions().runs!.profiles[0]!;
  db.prepare(`INSERT INTO execution_intents(attempt_id,run_id,organization_id,workspace_id,intent_digest,
    profile_alias,registry_digest,cpu_millis,memory_bytes,pids,timeout_ms,output_bytes,mode,prefer_idle,
    staging_policy,offer_bytes,input_bytes,secret_bytes,manifest_bytes,metadata_bytes,staging_bytes)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(offer.attemptId, run.id, offer.organizationId,
    offer.workspaceId, offer.intentDigest, profile.engine.profileId, executionRegistryDigest(profile),
    offer.budget.cpuMillis, offer.budget.memoryBytes, offer.budget.pids, offer.budget.timeoutMs, offer.budget.outputBytes,
    offer.executionPolicy.mode, Number(offer.executionPolicy.preferIdle), staging.policyVersion,
    staging.offerBytes, staging.inputBytes, staging.secretBytes, staging.manifestBytes, staging.metadataBytes, staging.totalBytes);
}
