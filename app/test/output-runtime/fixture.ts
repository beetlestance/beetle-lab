import { vi } from 'vitest';
import type { OutputRuntimeOptions } from '../../src/ports/output-runtime.js';
import type { OutputArtifactStore } from '../../src/ports/output-artifacts.js';
import type { OutputTransferJob, OutputTransferOutcome } from '../../src/ports/output-transfer.js';
import type { OutputFinalizationReply, OutputFinalizationRequest } from '../../src/ports/output-finalization.js';
import type { EventBinding } from '../../src/ports/events.js';
import { OutputScheduler } from '../../src/bootstrap/output-runtime/scheduler.js';
import { claimsFixture } from '../storage/dispatch-claim-fixtures.js';
import { fixture as transferFixture } from '../output-transfer/controlled-fixture.js';
import { deferred } from '../runner/fixtures.js';

export { deferred } from '../runner/fixtures.js';
export function fixture(count = 1) {
  const f = claimsFixture(); const bindings: EventBinding[] = Array.from({length: count}, (_, index) => ({
    key: f.add(70 + index), journalAuthority: f.runtime.journalAuthority}));
  const scans: (string | undefined)[] = [];
  const transfers = {transfer: vi.fn<(binding: EventBinding, signal?: AbortSignal) => OutputTransferJob>(() => {
    return {result: Promise.resolve({kind: 'pending'}), settled: Promise.resolve()};
  }), close: vi.fn(async () => {})};
  const files = {close: vi.fn(async () => {})};
  const finalize = vi.fn<(request: OutputFinalizationRequest) => Promise<OutputFinalizationReply>>(async () => ({kind: 'pending', reason: 'events'}));
  const getRun = vi.fn(async (key: Parameters<OutputRuntimeOptions['runs']['getRun']>[0]) => f.reads.get(key));
  const outputs = {...transferFixture().metadata, scan: vi.fn<OutputArtifactStore['scan']>(async query => {
    scans.push(query.cursor); const index = query.cursor === undefined ? 0 : Number(query.cursor);
    const selected = bindings.slice(index, index + query.limit);
    return {items: selected.map((binding, offset) => ({kind: 'ready' as const, binding,
      order: index + offset, after: String(index + offset + 1)})), nextCursor: selected.length ? String(index + selected.length) : null};
  })};
  const options: OutputRuntimeOptions = {dataRoot: '/synthetic', outputs, gateway: transferFixture().gateway,
    runs: {getRun}, finalizations: {finalize}, freeSpaceReserveBytes: 0, intervalMs: 25, onFailure: vi.fn(async () => {})};
  const scheduler = new OutputScheduler(options, transfers, files);
  return {scheduler, transfers, files, options, finalize, getRun, outputs, bindings, scans, dispose: () => f.db.close()};
}
export function published(binding: EventBinding): OutputTransferOutcome {
  return {kind: 'published', binding, sourceDigest: 'c'.repeat(64), manifestDigest: 'b'.repeat(64)};
}
export function held() { return {result: deferred<OutputTransferOutcome>(), settled: deferred<void>()}; }
