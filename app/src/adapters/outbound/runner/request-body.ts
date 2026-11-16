import {createHash} from 'node:crypto';
import {captureStandaloneExportAssignment,EXPORT_ASSIGNMENT_BYTES,encodeJson,RUNNER_MAXIMUM_OFFER_BYTES,validate} from '@beetle/contracts';
import type {ClientResult,RunnerTransport} from '@beetle/contracts';
import type {RunnerAttemptIdentity} from '../../../ports/runner.js';
import {matchesIdentity} from './identity.js';
type Call=Parameters<RunnerTransport['json']>[0];
export function bodyFor(call: Call, identity?: RunnerAttemptIdentity): ClientResult<string | undefined> {
  if (!call.request) return { ok: true, value: undefined };
  if(call.request==='StandaloneExportAssignment')return exportBody(call.body,identity);
  try {
    const body = encodeJson(call.body, call.request === 'Offer' ? RUNNER_MAXIMUM_OFFER_BYTES : 65_536);
    const value: unknown = JSON.parse(body);
    const checked = validate(call.request, value);
    if (!checked.ok) return { ok: false, error: { kind: 'request', issues: checked.issues } };
    if (!identity || !matchesIdentity(checked.value, identity)) return { ok: false, error: { kind: 'request' } };
    if (call.request === 'Offer' && identity.generation !== 1) return { ok: false, error: { kind: 'request' } };
    return { ok: true, value: body };
  } catch { return { ok: false, error: { kind: 'request' } }; }
}

function exportBody(input:unknown,identity?:RunnerAttemptIdentity):ClientResult<string>{
 try{
  const assignment=captureStandaloneExportAssignment(input,text=>createHash('sha256').update(text).digest('hex'));
  if(!identity||identity.generation!==1||!matchesIdentity(assignment.offer,identity))return {ok:false,error:{kind:'request'}};
  return {ok:true,value:encodeJson(assignment,EXPORT_ASSIGNMENT_BYTES)};
 }catch{return {ok:false,error:{kind:'request'}};}
}
