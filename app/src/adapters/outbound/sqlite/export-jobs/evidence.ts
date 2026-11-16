/** Trusted SQL expressions only; values are always bound parameters. */
export function stoppedExportSource(snapshot:string,source:string,finalSeq:string):string {
 return `json_extract(${snapshot},'$.state')='exited'
 AND json_extract(${snapshot},'$.admission.state')='released'
 AND json_extract(${snapshot},'$.admission.disposition')='settled'
 AND json_extract(${snapshot},'$.lastSeq')>=${finalSeq}
 AND json_type(${snapshot},'$.result') IS NULL
 AND json_type(${snapshot},'$.exportResult')='object'
 AND json_extract(${snapshot},'$.exportResult') IS json_extract(${source},'$.manifest.result')`;
}
