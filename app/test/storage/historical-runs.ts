/** Frozen pre-enqueue-control fixture admission, from605bb6f. Never production recovery. */
import {checkExecutionQueue} from '../../src/adapters/outbound/sqlite/execution-queue.js';
import {checkRevisionPins} from '../../src/adapters/outbound/sqlite/revision-pins.js';
import { insertExecutionIntent } from '../../src/adapters/outbound/sqlite/execution-intents.js';
import type { DatabaseSync } from 'node:sqlite';
import { encodeJson } from '@beetle/contracts';
import type { Offer } from '@beetle/contracts';
import { validateApi } from '@beetle/contracts/api';
import type { Run } from '@beetle/contracts/api';
import type { RunCommand } from '../../src/ports/runs.js';
import { requireRule } from '../../src/domain/namespaces/index.js';
import { lower } from '../../src/adapters/outbound/sqlite/input-values.js';
import { normalizedScope } from '../../src/adapters/outbound/sqlite/suites.js';
import type { Suites } from '../../src/adapters/outbound/sqlite/suites.js';
import type { Settings } from '../../src/adapters/outbound/sqlite/settings.js';
import type { RunConfiguration, RunProfilePin } from '../../src/adapters/outbound/execution-profiles/index.js';
import { checkedRunConfiguration } from '../../src/adapters/outbound/execution-profiles/index.js';
import { makeRunOffer } from '../../src/adapters/outbound/sqlite/run-offer.js';

/** Called only inside Store's existing receipt-first immediate transaction. */
export class HistoricalRuns {
  private readonly config: RunConfiguration;
  constructor(private readonly db: DatabaseSync, private readonly suites: Suites,
    private readonly settings: Settings, config: RunConfiguration) { this.config = checkedRunConfiguration(config); }
  create(command: RunCommand): Run {
    const scope = normalizedScope(command.request.scope); this.suites.workspace(scope);
    const revision = this.suites.getRevision({ scope, id: command.request.revisionId });
    checkRevisionPins(this.db,revision);
    const resolved = this.settings.resolveRun(scope, { engineProfile: command.request.engineProfile, budget: command.request.budget });
    const profile = this.config.profiles.find(pin => pin.engine.profileId === resolved.defaults.engineProfile);
    requireRule(profile !== undefined, 'capacity_unavailable');
    requireRule(profile.engine.id === revision.engineId && profile.engine.configVersion === revision.configVersion);
    checkExecutionQueue(this.db,this.config.pendingLimit);
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
  private insert(run: Run, offer: string, profile: RunProfilePin): void {
    const parsedOffer = JSON.parse(offer) as Offer;
    const intentDigest = parsedOffer.intentDigest;
    this.db.prepare(`INSERT INTO runs(id,organization_id,workspace_id,suite_id,revision_id,active_attempt_id,
      version,state,outcome,validation_status,cancellation_requested,reason,requested_at,snapshot_json)
      VALUES(?,?,?,?,?,?,1,'queued','pending','pending',0,NULL,?,?)`).run(run.id, run.scope.organizationId,
      run.scope.workspaceId, run.suiteId, run.revisionId, run.activeAttemptId, run.requestedAt, encodeJson(run, 65536));
    this.db.prepare(`INSERT INTO attempts(id,run_id,organization_id,workspace_id,ordinal,intent_digest,offer_json,registry_json,state,foundation_owned)
      VALUES(?,?,?,?,1,?,?,?,'offered',1)`).run(run.activeAttemptId, run.id, run.scope.organizationId,
      run.scope.workspaceId, intentDigest, offer, encodeJson(profile, 32768));
    insertExecutionIntent(this.db, run, parsedOffer, profile);
    this.db.prepare('INSERT INTO dispatch_outbox(attempt_id,intent_digest) VALUES(?,?)').run(run.activeAttemptId, intentDigest);
  }
}
