/** Frozen version1 logical capacity; future versions get a separate policy.
 * Not filesystem/WAL preallocation; applied migration constants must stay stable. */
export const cleanupControl = Object.freeze({
  version: 1 as const, reservedBytes: 196_608,
  taskNamespaceBytes: 8192, intentBytes: 4096, planBytes: 131_072,
  progressBytes: 8192, receiptBytes: 4096, replayBytes: 4096,
  rowAllowanceBytes: 8192, maximumEntries: 512, maximumDepth: 32,
  maximumPathBytes: 4096, windowBytes: 65_536, operationMs: 30_000,
});
export const cleanupPayloadBytes = cleanupControl.taskNamespaceBytes + cleanupControl.intentBytes
  + cleanupControl.planBytes + cleanupControl.progressBytes + cleanupControl.receiptBytes
  + cleanupControl.replayBytes + cleanupControl.rowAllowanceBytes;
