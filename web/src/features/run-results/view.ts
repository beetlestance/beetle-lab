import type { EngineResult } from '@beetle/contracts';
import type { Run } from '@beetle/contracts/api';
import type { RunResultProps } from './types.js';

export type ResultView = { readonly status: 'loading' | 'unavailable' | 'error' }
  | { readonly status: 'ready'; readonly run: Readonly<Run>; readonly result: Readonly<EngineResult>; readonly provisional: boolean };
function matchingRun(props: RunResultProps): props is RunResultProps & { readonly run: Readonly<Run> } {
  return props.run !== null && props.run.id === props.runId
    && props.run.scope.organizationId === props.scope.organizationId && props.run.scope.workspaceId === props.scope.workspaceId;
}
function matchingResult(run: Readonly<Run>, result: Readonly<EngineResult>): boolean {
  return result.organizationId === run.scope.organizationId && result.workspaceId === run.scope.workspaceId
    && result.attemptId === run.activeAttemptId && result.engineId === run.engine.id && result.generation === 1;
}
/** No previous value survives a render; fence identity before inspecting evidence. */
export function resultView(props: RunResultProps): ResultView {
  if (props.status !== 'ready') return { status: props.status };
  if (!matchingRun(props) || !props.result || !matchingResult(props.run, props.result)) return { status: 'unavailable' };
  if (props.result.artifacts.length > 128 || props.result.thresholds.length > 256) return { status: 'error' };
  return { status: 'ready', run: props.run, result: props.result,
    provisional: !['finished', 'cancelled', 'errored'].includes(props.run.state) };
}
