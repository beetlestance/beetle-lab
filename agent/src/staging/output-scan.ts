import { performance } from 'node:perf_hooks';
import type { Operation } from '../backends/docker/index.js';
import { outputAuthority } from './output-authority.js';
import { ScanBoundary, scanBudget, ScanFailure, ScanLimit } from './output-budget.js';
import { OutputTree, scanFiles } from './output-tree.js';
import type { ScanFiles } from './output-tree.js';
import { StagingError } from './types.js';
import type { VerifiedRoot } from './types.js';
import type { OutputScanRequest, OutputScanResult } from './output-types.js';

let active = 0;
// A failed original close never releases its slot or loses its descriptor owner to GC.
const quarantine = new Set<OutputTree>();
function failure(error: unknown): OutputScanResult {
  if (error instanceof ScanFailure) return { kind: 'unknown', reason: error.reason };
  if (error instanceof StagingError) {
    if (error.reason === 'deadline' || error.reason === 'cancelled' || error.reason === 'invalid_input') return { kind: 'unknown', reason: error.reason };
    if (error.reason === 'installation') return { kind: 'unknown', reason: 'custody' };
  }
  return { kind: 'unknown', reason: 'io' };
}
async function cleanup(tree: OutputTree | undefined, boundary: ScanBoundary | undefined): Promise<boolean> {
  try {
    if (tree) return await tree.drain();
    await boundary?.drain(); return true;
  } finally { boundary?.dispose(); }
}
/** Private fault-injection seam; the public factory always uses real filesystem ports. */
export async function scanOutputWithFiles(root: VerifiedRoot, input: OutputScanRequest, operation: Operation,
  files: ScanFiles): Promise<OutputScanResult> {
  if (active >= 2) return { kind: 'unknown', reason: 'busy' };
  active++; const startedAt = performance.now();
  let boundary: ScanBoundary | undefined; let tree: OutputTree | undefined;
  let result: OutputScanResult;
  try {
    const budget = scanBudget(operation); boundary = new ScanBoundary(budget);
    tree = new OutputTree(outputAuthority(root, input), boundary, files);
    result = { kind: 'known', startedAt, ...await tree.read() };
  } catch (error) {
    result = error instanceof ScanLimit ? { kind: 'limit', startedAt, reason: error.reason } : failure(error);
  }
  const clean = await cleanup(tree, boundary);
  if (!clean && tree) { quarantine.add(tree); return { kind: 'unknown', reason: 'cleanup' }; }
  active--;
  try { boundary?.check(); } catch (error) { return failure(error); }
  return result;
}
export function scanOutput(root: VerifiedRoot, input: OutputScanRequest, operation: Operation): Promise<OutputScanResult> {
  return scanOutputWithFiles(root, input, operation, scanFiles);
}
