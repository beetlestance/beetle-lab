import type { DatabaseSync } from 'node:sqlite';
import { encodeJson } from '@beetle/contracts';
import type { Offer } from '@beetle/contracts';
import { validateApi } from '@beetle/contracts/api';
import type { Run, SuiteRevision } from '@beetle/contracts/api';
import type { RunCommand } from '../../../ports/runs.js';
import { requireRule } from '../../../domain/namespaces/index.js';
import { lower } from './input-values.js';
import { normalizedScope } from './suites.js';
import type { Suites } from './suites.js';
import type { Settings } from './settings.js';
import type { RunConfiguration, RunProfilePin } from './run-profiles.js';
import { checkedRunConfiguration } from './run-profiles.js';
import { makeRunOffer } from './run-offer.js';
import { StorageError } from './protocol.js';

/** Called only inside Store's existing receipt-first immediate transaction. */
export class Runs {
  private readonly config: RunConfiguration;
  constructor(private readonly db: DatabaseSync, private readonly suites: Suites,
    private readonly settings: Settings, config: RunConfiguration) { this.config = checkedRunConfiguration(config); }
  create(command: RunCommand): Run {
    const scope = normalizedScope(command.request.scope); this.suites.workspace(scope);
    const revision = this.suites.getRevision({ scope, id: command.request.revisionId });
    this.checkPins(revision);
    const resolved = this.settings.resolveRun(scope, { engineProfile: command.request.engineProfile, budget: command.request.budget });
    const profile = this.config.profiles.find(pin => pin.engine.profileId === resolved.defaults.engineProfile);
    requireRule(profile !== undefined, 'capacity_unavailable');
    requireRule(profile.engine.id === revision.engineId && profile.engine.configVersion === revision.configVersion);
    this.checkQueue();
    const run: Run = { id: lower(command.id), scope, version: 1, suiteId: revision.suiteId, revisionId: revision.id,
      revisionDigest: revision.digest, requestedAt: command.requestedAt, state: 'queued', outcome: 'pending', validationStatus: 'pending',
      activeAttemptId: lower(command.attemptId), cancellationRequested: false, reason: null,
      engine: profile.engine, budget: resolved.defaults.budget, executionPolicy: command.request.executionPolicy,
      settingsVersions: resolved.versions };
    requireRule(validateApi('Run', run).ok);
    const offer = makeRunOffer(run, revision, profile);
    this.insert(run, offer, profile);
    return run;
  }
  private checkQueue(): void {
    const pending = this.db.prepare(`SELECT id FROM runs INDEXED BY runs_pending
      WHERE state IN ('queued','dispatching','active','finalizing') LIMIT ?`).all(this.config.pendingLimit);
    if (pending.length >= this.config.pendingLimit) throw new StorageError('queue_full');
  }
  private checkPins(revision: SuiteRevision): void {
    for (const pin of revision.inputManifest) {
      const row = this.db.prepare(`SELECT id FROM input_blobs WHERE organization_id=? AND workspace_id=?
        AND id=? AND sha256=? AND bytes=? AND state='published'`)
        .get(revision.scope.organizationId, revision.scope.workspaceId, pin.id, pin.sha256, pin.bytes);
      requireRule(row !== undefined, 'not_found');
    }
  }
  private insert(run: Run, offer: string, profile: RunProfilePin): void {
    const intentDigest = (JSON.parse(offer) as Offer).intentDigest;
    this.db.prepare(`INSERT INTO runs(id,organization_id,workspace_id,suite_id,revision_id,active_attempt_id,
      version,state,outcome,validation_status,cancellation_requested,reason,requested_at,snapshot_json)
      VALUES(?,?,?,?,?,?,1,'queued','pending','pending',0,NULL,?,?)`).run(run.id, run.scope.organizationId,
      run.scope.workspaceId, run.suiteId, run.revisionId, run.activeAttemptId, run.requestedAt, encodeJson(run, 65536));
    this.db.prepare(`INSERT INTO attempts(id,run_id,organization_id,workspace_id,ordinal,intent_digest,offer_json,registry_json,state)
      VALUES(?,?,?,?,1,?,?,?,'offered')`).run(run.activeAttemptId, run.id, run.scope.organizationId,
      run.scope.workspaceId, intentDigest, offer, encodeJson(profile, 32768));
    this.db.prepare('INSERT INTO dispatch_outbox(attempt_id,intent_digest) VALUES(?,?)').run(run.activeAttemptId, intentDigest);
  }
}
