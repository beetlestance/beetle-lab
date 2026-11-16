import { OUTPUT_REJECTION_REASONS } from '@beetle/contracts/output-source';

const r = (path: string): string => `json_extract(r.reservation_json,'$.${path}')`;
const integer = (path: string): string => `json_type(r.reservation_json,'$.${path}')='integer' AND ${r(path)} BETWEEN 0 AND 9007199254740991`;
const token = (path: string): string => `json_type(r.reservation_json,'$.${path}')='text' AND length(CAST(${r(path)} AS BLOB)) BETWEEN 1 AND 128`;
const q = (path: string): string => `json_extract(q.candidate_json,'$.${path}')`;
const scope = ['attemptId', 'organizationId', 'workspaceId', 'generation'];
const columns = ['attempt_id', 'organization_id', 'workspace_id', 'generation'];
const bound = (expression: (path: string) => string): string => scope.map((name, i) => `${expression(name)} IS a.${columns[i]}`).join(' AND ');
const releaseBinding = ['createToken', 'specDigest', 'runtimeId'].map(name =>
  `${r(`releaseEvidence.${name}`)} IS ${r(name)} AND ${r(`launchSettlement.${name}`)} IS ${r(name)}`).join(' AND ');
const reasons = Object.entries(OUTPUT_REJECTION_REASONS).map(([reason, outcome]) => `WHEN '${reason}' THEN '${outcome}'`).join(' ');
const rejection = `json_extract(q.decision_json,'$.reason')`;
const neverStarted = `${r('aborted')}=1 AND ${r('createToken')} IS NULL AND ${r('startToken')} IS NULL
  AND ${r('specDigest')} IS NULL AND ${r('runtimeId')} IS NULL AND ${r('launchSettlement')} IS NULL
  AND ${r('releaseEvidence')} IS NULL AND ${r('launchEpoch')}=0 AND ${r('startClaimedAt')} IS NULL`;
const settled = `${r('aborted')}=0 AND ${r('launchSettlement.authority')}='supervisor'
  AND ${r('launchSettlement.disposition')} IN ('retired','completed')
  AND ${bound(name => r(`launchSettlement.key.${name}`))}
  AND ${bound(name => r(`releaseEvidence.key.${name}`))} AND ${releaseBinding}
  AND ${token('createToken')} AND ${token('runtimeId')}
  AND length(${r('specDigest')})=64 AND ${r('specDigest')} NOT GLOB '*[^a-f0-9]*'
  AND ${r('launchEpoch')} IN (0,1)
  AND ((${r('launchEpoch')}=0 AND ${r('startToken')} IS NULL AND ${r('startClaimedAt')} IS NULL
      AND ${r('launchSettlement.disposition')}='retired')
    OR (${r('launchEpoch')}=1 AND ${token('startToken')} AND ${integer('startClaimedAt')}
      AND ${r('startClaimedAt')}>=${r('admittedAt')}))
  AND ${integer('launchSettlement.settledAt')} AND ${token('launchSettlement.evidenceId')}
  AND ${integer('releaseEvidence.runtime.observedAt')} AND ${token('releaseEvidence.runtime.evidenceId')}
  AND ${integer('releaseEvidence.collection.observedAt')} AND ${token('releaseEvidence.collection.evidenceId')}
  AND ${r('launchSettlement.epoch')} IS ${r('launchEpoch')}
  AND ${r('launchSettlement.startToken')} IS ${r('startToken')}
  AND ${r('releaseEvidence.authority')}='supervisor'
  AND ${r('releaseEvidence.launch.epoch')} IS ${r('launchEpoch')}
  AND ${r('releaseEvidence.launch.startToken')} IS ${r('startToken')}
  AND ${r('releaseEvidence.launch.settlementId')} IS ${r('launchSettlement.evidenceId')}
  AND ${r('launchSettlement.settledAt')}>=COALESCE(${r('startClaimedAt')},${r('admittedAt')})
  AND ${r('releaseEvidence.runtime.source')}='supervisor' AND ${r('releaseEvidence.runtime.state')} IN ('stopped','absent')
  AND ${r('releaseEvidence.runtime.observedAt')}>${r('launchSettlement.settledAt')}
  AND ${r('releaseEvidence.collection.observedAt')}>${r('launchSettlement.settledAt')}
  AND ${r('releaseEvidence.collection.state')}='failed'
  AND (i.attempt_id IS NULL OR (i.phase='failed'
    AND ${r('releaseEvidence.collection.evidenceId')}=i.collection_id
    AND ${r('releaseEvidence.collection.observedAt')}>=json_extract(i.intent_json,'$.begunAt')
    AND ${r('releaseEvidence.runtime')}=json_extract(i.intent_json,'$.runtime')))`;
const zero = ['last_seq', 'retained_start_seq', 'acknowledged_seq', 'wrapper_high', 'supervisor_high',
  'wrapper_expired', 'supervisor_expired', 'spool_bytes', 'spool_rows', 'snapshot_bytes', 'checkpoint_bytes']
  .map(name => `a.${name}=0`).join(' AND ');
const empty = ['phase', 'exit_json', 'exit_facts_json', 'result_json', 'wrapper_checkpoint_json'].map(name => `a.${name} IS NULL`).join(' AND ');
const fresh = `c.generation=1 AND a.generation=1 AND a.cancel_requested=1 AND a.state='offered'
  AND ${zero} AND ${empty} AND q.attempt_id IS NULL AND r.attempt_id IS NULL
  AND NOT EXISTS(SELECT 1 FROM event_spool WHERE attempt_id=a.attempt_id)
  AND k.cancel_reason='cancelled' AND k.cancel_at BETWEEN 0 AND k.high_water`;
const rejected = `r.attempt_id IS NULL AND q.pending=0 AND ${bound(q)}
  AND json_extract(q.decision_json,'$.kind')='reject' AND ${rejection} IN (${Object.keys(OUTPUT_REJECTION_REASONS).map(x => `'${x}'`).join(',')})
  AND (${rejection}!='cancelled' OR a.cancel_requested=1)`;
const released = `r.charged=0 AND q.pending=0 AND q.decision_json IS NULL AND ${bound(q)} AND ${bound(r)}
  AND ${r('status')}='released' AND ${r('launchClosed')}=1 AND ${integer('admittedAt')}
  AND h.phase='retained' AND h.organization_id=a.organization_id AND h.workspace_id=a.workspace_id
  AND h.generation=a.generation AND h.intent_digest=a.intent_digest AND h.metadata_bytes=512 AND a.hold_bytes=512
  AND h.output_bytes=${r('resources.outputBytes')} AND h.staging_bytes=${r('resources.stagingBytes')}
  AND ((${neverStarted}) OR (${settled}))`;

/** SQL witnesses are checked independently of the trusted worker, including raw INSERT. */
export const absenceFacts = `CREATE VIEW output_absence_facts AS
  SELECT a.attempt_id,
    CASE WHEN (${fresh}) THEN json_object('reason','cancelled','state','rejected')
      WHEN (${rejected}) THEN json_object('reason',${rejection},'state','rejected')
      WHEN (${released}) THEN json_object('disposition',CASE WHEN ${r('aborted')}=1 THEN 'never_started' ELSE 'settled' END,'state','released')
      END AS admission_json,
    CASE WHEN (${fresh}) THEN 'cancelled' WHEN (${rejected}) THEN CASE ${rejection} ${reasons} END
      ELSE COALESCE(CASE WHEN k.cancel_reason IN ('cancelled','timeout','output_limit','artifact_incomplete','clock_integrity') THEN k.cancel_reason END,
        CASE WHEN json_extract(COALESCE(a.exit_facts_json,a.exit_json,'{}'),'$.reason') IN
          ('cancelled','timeout','output_limit','artifact_incomplete','clock_integrity','setup_failed','unsupported_capability','budget_unavailable')
          THEN json_extract(COALESCE(a.exit_facts_json,a.exit_json,'{}'),'$.reason') END,
        CASE WHEN ${r('aborted')}=1 THEN 'setup_failed' ELSE 'artifact_incomplete' END) END AS reason
  FROM accepted_attempts a LEFT JOIN admission_queue q USING(attempt_id) LEFT JOIN reservations r USING(attempt_id)
  LEFT JOIN disk_holds h USING(attempt_id) LEFT JOIN output_collection_intents i USING(attempt_id)
  LEFT JOIN cancelled_originals c USING(attempt_id) LEFT JOIN supervision_clock k USING(attempt_id)
  WHERE NOT EXISTS(SELECT 1 FROM output_sources WHERE attempt_id=a.attempt_id)
    AND NOT EXISTS(SELECT 1 FROM output_delivery_closures WHERE attempt_id=a.attempt_id)
    AND (i.attempt_id IS NULL OR i.phase='failed');`;

/** Debt is a scheduling hint. It grants neither native retirement nor closure. */
export function absencePending(parent: string): string {
  return `CASE WHEN NOT EXISTS(SELECT 1 FROM output_absence_closures WHERE attempt_id=${parent}.attempt_id)
    AND NOT EXISTS(SELECT 1 FROM output_sources WHERE attempt_id=${parent}.attempt_id)
    AND (EXISTS(SELECT 1 FROM cancelled_originals WHERE attempt_id=${parent}.attempt_id)
      OR EXISTS(SELECT 1 FROM admission_queue WHERE attempt_id=${parent}.attempt_id AND pending=0 AND decision_json IS NOT NULL
        AND json_extract(decision_json,'$.kind')='reject')
      OR EXISTS(SELECT 1 FROM reservations WHERE attempt_id=${parent}.attempt_id AND charged=0
        AND (json_extract(reservation_json,'$.aborted')=1 OR json_extract(reservation_json,'$.releaseEvidence.collection.state')='failed')))
    THEN 1 ELSE 0 END`;
}
