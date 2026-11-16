import { encodeJson } from '../json.js';
import { validate } from '../validate.js';
import type { OutputRetirementReply } from '../generated/types.js';
import type { Owned } from '../output-source/index.js';
import type { ResultDigest } from '../result-seal.js';
import { captureOutputRetirementRequest,outputRetirementDigest,OutputRetirementValueError } from './request.js';
export const OUTPUT_RETIREMENT_REPLY_BYTES=4096;
export type RetirementReply=Owned<OutputRetirementReply>;
const binding=['version','purpose','organizationId','workspaceId','attemptId','generation','intentDigest','journalAuthority','runId','deletionId','deletionVersion'] as const;
/** Closed authenticated-wire metadata only. Valid shape/hash never establishes native IO or refund authority. */
export function captureOutputRetirementReply(input:unknown,expected:unknown,digest:ResultDigest):RetirementReply{
 const copy:unknown=JSON.parse(encodeJson(input,OUTPUT_RETIREMENT_REPLY_BYTES));const checked=validate('OutputRetirementReply',copy);
 if(!checked.ok)throw new OutputRetirementValueError();const request=captureOutputRetirementRequest(expected);
 for(const key of binding)if(checked.value[key]!==request[key])throw new OutputRetirementValueError();
 if(checked.value.requestDigest!==outputRetirementDigest(request,digest))throw new OutputRetirementValueError();
 return Object.freeze(checked.value);
}
