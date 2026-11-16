import {finalizationEvidence} from './output-finalization/evidence.js';
import {absenceEvidence} from './output-absence/evidence.js';
// Keep historical migration SQL unchanged. Only these two views change in schema29.
const systemReasons="('timeout','output_limit','artifact_incomplete','clock_integrity')";
const header=(path:string)=>`json_extract(e.snapshot_json,'$.${path}')`;
function replace(sql:string,prior:string,next:string):string{
 if(sql.split(prior).length!==2)throw Error('Unexpected predecessor projection');
 return sql.replace(prior,next);
}
const wrapper=header('exitEvidence.reason');
const finalState=replace(finalizationEvidence,
 `CASE WHEN r.cancellation_requested=1 THEN 'cancelled'\n  WHEN ${header('exitEvidence.oomKilled')}=1 THEN 'errored'`,
 `CASE WHEN ${header('exitEvidence.oomKilled')}=1 THEN 'errored'
  WHEN ${wrapper} IN ${systemReasons} THEN CASE
   WHEN json_type(e.snapshot_json,'$.exitEvidence.exitCode')='integer'
    AND ${header('exitEvidence.oomKilled')}=0 THEN 'errored' ELSE NULL END
  WHEN r.cancellation_requested=1 THEN 'cancelled'`);
const finalProjection=replace(finalState,
 `CASE WHEN r.cancellation_requested=1 THEN 'cancelled'\n  WHEN ${header('exitEvidence.oomKilled')}=1 THEN 'memory_limit'`,
 `CASE WHEN ${header('exitEvidence.oomKilled')}=1 THEN 'memory_limit'
  WHEN ${wrapper} IN ${systemReasons} THEN ${wrapper}
  WHEN r.cancellation_requested=1 THEN 'cancelled'`);
const absentReason="json_extract(s.proof_json,'$.reason')";
const absentState=replace(absenceEvidence,
 "CASE WHEN r.cancellation_requested=1 THEN 'cancelled' ELSE 'errored' END state",
 `CASE WHEN ${absentReason} IN ${systemReasons} THEN 'errored'
  WHEN r.cancellation_requested=1 THEN 'cancelled' ELSE 'errored' END state`);
const absentProjection=replace(absentState,
 `CASE WHEN r.cancellation_requested=1 THEN 'cancelled' ELSE ${absentReason} END reason`,
 `CASE WHEN ${absentReason} IN ${systemReasons} THEN ${absentReason}
  WHEN r.cancellation_requested=1 THEN 'cancelled' ELSE ${absentReason} END reason`);
export const migration029=`
DROP VIEW output_finalization_evidence;
DROP VIEW output_absence_evidence;
${finalProjection}
${absentProjection}
PRAGMA user_version=29;
`;
