interface Report {status:'passed'|'failed';installationId:string;agentPid:number;agentUid:number;orderlyDrained:boolean;results:readonly unknown[];failure?:string|undefined}
/** Undefined is not JSON; successful reports omit the optional failure field. */
export function privateReport(input:Report){
 const {failure,...required}=input;return {...required,...(failure===undefined?{}:{failure})};
}
