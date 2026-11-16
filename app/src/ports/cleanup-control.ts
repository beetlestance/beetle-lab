/** Policy1 logical control reservation; independent from retained output metadata. */
export const BACKEND_CLEANUP_CONTROL_BYTES = 65_536;
export const BACKEND_CLEANUP_BUCKETS = Object.freeze({intent:4096,files:128*384,ack:4608,tombstone:2560,ledger:1024,slack:4096});
