/** Compact resource facts only; no Run projection, launch or release authority. */
export interface ExecutionResourceFact {
 readonly purpose?:'performance'|'standalone_export';readonly queue_order:number|null;
 readonly profile_alias:string;readonly registry_digest:string;
 readonly cpu_millis:number;readonly memory_bytes:number;readonly pids:number;
 readonly timeout_ms:number;readonly output_bytes:number;readonly staging_bytes:number;
 readonly mode:'parallel'|'isolated';readonly storage_bytes?:number;
}
