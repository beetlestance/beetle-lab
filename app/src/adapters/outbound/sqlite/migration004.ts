/** Application migration004: durable enqueue only; no agent execution authority. */
export const migration004 = `
CREATE TABLE runs (
 id TEXT PRIMARY KEY CHECK(id=lower(id)), organization_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
 suite_id TEXT NOT NULL, revision_id TEXT NOT NULL, active_attempt_id TEXT NOT NULL,
 version INTEGER NOT NULL CHECK(typeof(version)='integer' AND version BETWEEN 1 AND 9007199254740991),
 state TEXT NOT NULL CHECK(state IN ('queued','dispatching','active','finalizing','finished','cancelled','errored')),
 outcome TEXT NOT NULL CHECK(outcome IN ('pending','passed','failed','inconclusive')),
 validation_status TEXT NOT NULL CHECK(validation_status IN ('pending','passed','failed')),
 cancellation_requested INTEGER NOT NULL CHECK(cancellation_requested IN (0,1)),
 reason TEXT CHECK(reason IS NULL OR reason IN ('invalid_config','unsupported_capability','budget_unavailable','setup_failed',
 'engine_crash','memory_limit','timeout','output_limit','cancelled','execution_lost','artifact_incomplete','cursor_expired','conflicting_digest','invalid_protocol')),
 requested_at TEXT NOT NULL CHECK(length(requested_at)<=64),
 snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json) AND length(CAST(snapshot_json AS BLOB))<=65536),
 UNIQUE(id,organization_id,workspace_id),
 CHECK(json_extract(snapshot_json,'$.id') IS id),
 CHECK(json_extract(snapshot_json,'$.scope.organizationId') IS organization_id),
 CHECK(json_extract(snapshot_json,'$.scope.workspaceId') IS workspace_id),
 CHECK(json_extract(snapshot_json,'$.suiteId') IS suite_id),
 CHECK(json_extract(snapshot_json,'$.revisionId') IS revision_id),
 CHECK(json_extract(snapshot_json,'$.requestedAt') IS requested_at),
 CHECK((state IN ('queued','dispatching','active','finalizing') AND outcome='pending') OR
       (state='finished' AND outcome IN ('passed','failed','inconclusive') AND validation_status='passed' AND reason IS NULL) OR
       (state='cancelled' AND outcome='inconclusive' AND cancellation_requested=1 AND reason IS NOT NULL AND reason='cancelled') OR
       (state='errored' AND outcome='inconclusive' AND reason IS NOT NULL)),
 FOREIGN KEY(workspace_id,organization_id) REFERENCES workspaces(id,organization_id),
 FOREIGN KEY(revision_id,suite_id,organization_id,workspace_id)
 REFERENCES suite_revisions(id,suite_id,organization_id,workspace_id),
 FOREIGN KEY(active_attempt_id,id,organization_id,workspace_id)
 REFERENCES attempts(id,run_id,organization_id,workspace_id) DEFERRABLE INITIALLY DEFERRED);
CREATE INDEX runs_page ON runs(organization_id,workspace_id,id);
CREATE INDEX runs_pending ON runs(id) WHERE state IN ('queued','dispatching','active','finalizing');
CREATE TABLE attempts (
 id TEXT PRIMARY KEY CHECK(id=lower(id)), run_id TEXT NOT NULL,
 organization_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
 ordinal INTEGER NOT NULL CHECK(typeof(ordinal)='integer' AND ordinal BETWEEN 1 AND 9007199254740991),
 intent_digest TEXT NOT NULL CHECK(length(intent_digest)=64 AND intent_digest NOT GLOB '*[^0-9a-f]*'),
 offer_json TEXT NOT NULL CHECK(json_valid(offer_json) AND length(CAST(offer_json AS BLOB))<=2097152),
 registry_json TEXT NOT NULL CHECK(json_valid(registry_json) AND length(CAST(registry_json AS BLOB))<=32768),
 generation INTEGER CHECK(generation IS NULL OR (typeof(generation)='integer' AND generation BETWEEN 1 AND 9007199254740991)),
 state TEXT NOT NULL CHECK(state IN ('offered','admitted','preparing','running','stopping','collecting','exited','lost')),
 CHECK(id<>run_id), UNIQUE(run_id,ordinal), UNIQUE(id,run_id,organization_id,workspace_id), UNIQUE(id,intent_digest),
 CHECK(json_extract(offer_json,'$.attemptId') IS id),
 CHECK(json_extract(offer_json,'$.organizationId') IS organization_id),
 CHECK(json_extract(offer_json,'$.workspaceId') IS workspace_id),
 CHECK(json_extract(offer_json,'$.intentDigest') IS intent_digest),
 CHECK(json_type(offer_json,'$.config') IS 'object'),
 CHECK(length(CAST(json_extract(offer_json,'$.config') AS BLOB))<=1048576),
 FOREIGN KEY(run_id,organization_id,workspace_id) REFERENCES runs(id,organization_id,workspace_id));
CREATE TABLE dispatch_outbox (
 attempt_id TEXT PRIMARY KEY, intent_digest TEXT NOT NULL,
 possible_delivery INTEGER NOT NULL DEFAULT 0 CHECK(possible_delivery IN (0,1)),
 first_delivery_at TEXT, next_offer_at_ms INTEGER NOT NULL DEFAULT 0
 CHECK(typeof(next_offer_at_ms)='integer' AND next_offer_at_ms BETWEEN 0 AND 9007199254740991),
 CHECK((possible_delivery=0 AND first_delivery_at IS NULL) OR (possible_delivery=1 AND first_delivery_at IS NOT NULL)),
 FOREIGN KEY(attempt_id,intent_digest) REFERENCES attempts(id,intent_digest));
CREATE INDEX outbox_due ON dispatch_outbox(next_offer_at_ms,attempt_id);
CREATE TRIGGER runs_identity_immutable BEFORE UPDATE OF id,organization_id,workspace_id,suite_id,revision_id,requested_at,snapshot_json ON runs
 BEGIN SELECT RAISE(ABORT,'immutable run intent'); END;
CREATE TRIGGER attempts_intent_immutable BEFORE UPDATE OF id,run_id,organization_id,workspace_id,ordinal,intent_digest,offer_json,registry_json ON attempts
 BEGIN SELECT RAISE(ABORT,'immutable attempt intent'); END;
CREATE TRIGGER outbox_intent_immutable BEFORE UPDATE OF attempt_id,intent_digest ON dispatch_outbox
 BEGIN SELECT RAISE(ABORT,'immutable dispatch intent'); END;
CREATE TRIGGER outbox_delivery_monotone BEFORE UPDATE OF possible_delivery,first_delivery_at ON dispatch_outbox
 WHEN OLD.possible_delivery=1 AND (NEW.possible_delivery!=1 OR NEW.first_delivery_at IS NOT OLD.first_delivery_at)
 BEGIN SELECT RAISE(ABORT,'delivery uncertainty immutable'); END;
CREATE TRIGGER runs_no_replace BEFORE INSERT ON runs WHEN EXISTS(SELECT 1 FROM runs WHERE id=NEW.id)
 BEGIN SELECT RAISE(ABORT,'retained run identity'); END;
CREATE TRIGGER attempts_no_replace BEFORE INSERT ON attempts WHEN EXISTS(SELECT 1 FROM attempts WHERE id=NEW.id OR (run_id=NEW.run_id AND ordinal=NEW.ordinal))
 BEGIN SELECT RAISE(ABORT,'retained attempt identity'); END;
CREATE TRIGGER outbox_no_replace BEFORE INSERT ON dispatch_outbox WHEN EXISTS(SELECT 1 FROM dispatch_outbox WHERE attempt_id=NEW.attempt_id)
 BEGIN SELECT RAISE(ABORT,'retained dispatch identity'); END;
CREATE TRIGGER outbox_initial_attempt BEFORE INSERT ON dispatch_outbox
 WHEN NOT EXISTS(SELECT 1 FROM attempts a JOIN runs r ON r.id=a.run_id
 WHERE a.id=NEW.attempt_id AND a.generation IS NULL AND a.state='offered' AND r.state='queued')
 BEGIN SELECT RAISE(ABORT,'dispatch already acknowledged or closed'); END;
CREATE TRIGGER outbox_retain_uncertainty BEFORE DELETE ON dispatch_outbox
 WHEN OLD.possible_delivery=1 AND (SELECT generation FROM attempts WHERE id=OLD.attempt_id) IS NULL
 BEGIN SELECT RAISE(ABORT,'delivery outcome unknown'); END;
CREATE TRIGGER attempts_generation_monotone BEFORE UPDATE OF generation ON attempts
 WHEN OLD.generation IS NOT NULL AND (NEW.generation IS NULL OR NEW.generation<OLD.generation)
 BEGIN SELECT RAISE(ABORT,'generation cannot rewind'); END;
CREATE TRIGGER runs_retain_active BEFORE DELETE ON runs WHEN OLD.state IN ('queued','dispatching','active','finalizing')
 BEGIN SELECT RAISE(ABORT,'retained active run'); END;
CREATE TRIGGER attempts_retain_active BEFORE DELETE ON attempts
 WHEN EXISTS(SELECT 1 FROM runs WHERE id=OLD.run_id AND state IN ('queued','dispatching','active','finalizing'))
 BEGIN SELECT RAISE(ABORT,'retained active attempt'); END;
PRAGMA user_version=4;
`;
