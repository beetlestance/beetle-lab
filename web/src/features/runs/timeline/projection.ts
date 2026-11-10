import type { RunEventPage } from '@beetle/contracts/api';
export type Event = RunEventPage['items'][number];
export interface Row { seq: number; at: string; phase: Event['phase']; text: string }
export interface Progress { phase: Event['phase']; completed: number; total: number; usefulAt: string | null; finished: boolean }
export interface Timeline {
  rows: Row[]; cursor: string; backlog: boolean; omitted: boolean; through: number;
  coverage: RunEventPage['coverage']; blocked: RunEventPage['blockedReason']; retainedStart: number | null;
  progress: Progress | null; resources: string | null;
}
const measured = (value: number | null, unit = '') => value === null ? 'not reported' : `${value}${unit}`;
const resourceText = (p: Extract<Event, { kind: 'resource.summary' }>['payload']) =>
  `Container aggregate (${p.source}): last observed CPU time ${measured(p.cpuMillis, ' ms')}; sampled peak memory ${measured(p.peakMemoryBytes, ' bytes')}; sampled peak PIDs ${measured(p.peakPids)}; output ${measured(p.outputBytes, ' bytes')}. Samples ${p.samples}; missed ${p.missedSamples}; last sample ${p.lastSampleAt ?? 'not reported'}; observation ${p.reason ?? 'reported'}. Declared enforced controls: ${p.enforcedControls.join(', ') || 'none'}.`;

function wrapperText(event: Extract<Event, { source: 'wrapper' }>): string {
  switch (event.kind) {
    case 'phase.started': return 'Phase started';
    case 'phase.finished': return 'Phase finished';
    case 'progress': return event.payload.heartbeat ? 'Heartbeat received' : `Progress reported: ${event.payload.completedUnits} completed units`;
    case 'case.result': return `Case result reported: ${event.payload.outcome}`;
    case 'artifact.sealed': return `Artifact sealed: ${event.payload.bytes} bytes`;
    case 'engine.result': return `Provisional engine report: ${event.payload.outcome}; application outcome remains authoritative`;
  }
}
function agentText(event: Extract<Event, { source: 'agent' }>): string {
  switch (event.kind) {
    case 'admitted': return 'Admission accepted';
    case 'runtime.started': return 'Runtime started';
    case 'resource.summary': return resourceText(event.payload);
    case 'cancellation.requested': return 'Cancellation requested; awaiting stop confirmation';
    case 'runtime.exited': return `Native runtime exited: code ${event.payload.exitCode ?? 'not reported'}; this does not establish test success`;
    case 'execution.lost': return 'Execution observation lost';
  }
}
function finishedProgress(previous: Progress | null, event: Extract<Event, { kind: 'phase.finished' }>): Progress {
  const samePhase = previous?.phase === event.phase;
  if (samePhase && previous.finished && event.payload.completedUnits <= previous.completed) return previous;
  return { phase: event.phase, completed: Math.max(event.payload.completedUnits, samePhase ? previous.completed : 0), total: samePhase ? previous.total : 0, usefulAt: event.observedAt, finished: true };
}
function progressAfter(previous: Progress | null, event: Event): Progress | null {
  if (event.kind === 'phase.started' && previous?.phase !== event.phase) {
    return { phase: event.phase, completed: 0, total: event.payload.budget.workUnits, usefulAt: event.observedAt, finished: false };
  }
  if (event.kind === 'phase.finished') return finishedProgress(previous, event);
  if (event.kind !== 'progress' || event.payload.heartbeat || !event.payload.usefulProgress) return previous;
  return usefulProgress(previous, event);
}
function usefulProgress(previous: Progress | null, event: Extract<Event, { kind: 'progress' }>): Progress | null {
  const samePhase = previous?.phase === event.phase;
  const completed = samePhase ? previous.completed : 0;
  if (event.payload.completedUnits <= completed) return previous;
  return { phase: event.phase, completed: event.payload.completedUnits, total: event.payload.totalUnits, usefulAt: event.observedAt, finished: false };
}
function emptyTimeline(page: RunEventPage): Timeline {
  return { rows: [], progress: null, resources: null, omitted: false, cursor: page.resumeCursor,
    backlog: false, through: 0, coverage: page.coverage, blocked: null, retainedStart: null };
}
/** No raw payload survives this projection. Bounds apply to serialized UTF-8 rows. */
export function project(page: RunEventPage, previous?: Timeline, skipped = false): Timeline {
  const data = previous ? { ...previous, rows: [...previous.rows] } : emptyTimeline(page);
  data.omitted ||= skipped;
  for (const event of page.items) {
    if (event.seq <= data.through) continue;
    const text = event.source === 'wrapper' ? wrapperText(event) : agentText(event);
    data.rows.push({ seq: event.seq, at: event.observedAt, phase: event.phase, text });
    data.progress = progressAfter(data.progress, event);
    if (event.kind === 'resource.summary') data.resources = resourceText(event.payload);
  }
  while (data.rows.length > 100 || new TextEncoder().encode(JSON.stringify(data.rows)).byteLength > 65536) {
    data.rows.shift(); data.omitted = true;
  }
  return { ...data, cursor: page.resumeCursor, backlog: page.nextCursor !== null,
    through: Math.max(data.through, page.afterSeq + page.items.length), coverage: page.coverage,
    blocked: page.blockedReason, retainedStart: page.retainedStartSeq };
}
