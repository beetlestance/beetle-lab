import {captureK6Diagnostics} from '@beetle/contracts/k6-diagnostics';
import type {K6Diagnostics} from '@beetle/contracts/k6-diagnostics';
import type {ExecutionReceipt} from '../execution/index.js';
/** No synthetic empty report when native collection was unavailable. */
export function diagnosticArtifact(receipt: ExecutionReceipt, scope: K6Diagnostics['scope']): K6Diagnostics | null {
  const process = receipt.process;
  if (!process?.spawned || !process.stdioClosed || !process.diagnostics) return null;
  if (process.diagnosticBytes !== process.diagnostics.observedBytes) throw new Error('Diagnostic byte identity mismatch');
  const source = process.diagnostics;
  const coverage = process.cause === null && process.collection === 'complete' ? source.coverage : 'partial';
  return captureK6Diagnostics({format: 'beetle-k6-diagnostics', version: 1, scope, ...source, coverage});
}
