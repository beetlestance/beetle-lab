import { validateApi } from '@beetle/contracts/api';
import type { ApiClient, ApiTypes } from '@beetle/contracts/api';
import { ClientError, ensureActive } from './errors.js';
import { readFileBounded } from './files.js';
import { clientFailure } from './auth.js';
import type { ClientOptions } from './options.js';
import { runExit, waitForRun, terminal } from './wait.js';
import type { WaitClock } from './wait.js';
interface ExecutionInput {options: ClientOptions; api: ApiClient; signal: AbortSignal; deadline: number; clock: WaitClock}
interface Execution {readonly value: object; readonly exit: number}
async function request<N extends 'CreateRunRequest' | 'CancelRunRequest' | 'RunComparisonRequest'>(options: ClientOptions, name: N): Promise<ApiTypes[N]> {
  let value: unknown;
  try {value = JSON.parse(await readFileBounded(options.requestFile!, 4096));} catch {throw new ClientError('invalid_input', 2);}
  const checked = validateApi(name, value); if (!checked.ok) throw new ClientError('invalid_input', 2); return checked.value;
}
export async function execute(input: ExecutionInput): Promise<Execution> {
  const {options, api, signal, clock, deadline} = input;
  ensureActive(signal);
  switch (options.command) {
    case 'run': return submit(input);
    case 'status': {
      const result = await api.getRun({params: options.run!, signal}); ensureReadBudget(input); if (!result.ok) clientFailure(result.error);
      const run = options.waitMs === undefined ? result.value : await waitForRun({api, run: result.value, signal, deadline, clock});
      return {value: {run, waiting: !terminal(run)}, exit: runExit(run)};
    }
    case 'result': {
      const result = await api.getRunResult({params: options.run!, signal}); ensureReadBudget(input); if (!result.ok) clientFailure(result.error);
      return {value: result.value, exit: 0};
    }
    case 'cancel': return cancel(input);
    case 'compare': {
      const body = await request(options, 'RunComparisonRequest'); ensureActive(signal); const {organizationId, workspaceId} = body.scope;
      const result = await api.compareRuns({params: {organizationId, workspaceId}, body, signal}); ensureReadBudget(input); if (!result.ok) clientFailure(result.error);
      return {value: result.value, exit: 0};
    }
    default: throw new ClientError('invalid_input', 2);
  }
}

async function submit(input: ExecutionInput): Promise<Execution> {
  const {options, api, signal, deadline, clock} = input;
  const body = await request(options, 'CreateRunRequest'); ensureActive(signal);
  const {organizationId, workspaceId} = body.scope; const result = await api.createRun({params: {organizationId, workspaceId}, body, signal});
  ensureMutationBudget(input, body.requestId);
  if (!result.ok) clientFailure(result.error, body.requestId);
  if (options.waitMs === undefined) return {value: {submitted: true, run: result.value}, exit: 0};
  const run = await waitForRun({api, run: result.value, signal, deadline, clock}); return {value: {run, waiting: !terminal(run)}, exit: runExit(run)};
}

async function cancel(input: ExecutionInput): Promise<Execution> {
  const {options, api, signal} = input;
  const body = await request(options, 'CancelRunRequest'); ensureActive(signal); const params = options.run!;
  if (body.scope.organizationId.toLowerCase() !== params.organizationId.toLowerCase() || body.scope.workspaceId.toLowerCase() !== params.workspaceId.toLowerCase()) throw new ClientError('invalid_input', 2);
  const result = await api.cancelRun({params, body, signal});
  ensureMutationBudget(input, body.requestId);
  if (!result.ok) clientFailure(result.error, body.requestId);
  return {value: result.value, exit: 0};
}

function ensureReadBudget({signal, deadline, clock}: ExecutionInput): void {
  ensureActive(signal); if (clock.now() >= deadline) throw new ClientError('interrupted', 5);
}

function ensureMutationBudget({signal, deadline, clock}: ExecutionInput, requestId: string): void {
  if (signal.aborted || clock.now() >= deadline) throw new ClientError('outcome_unknown', 3, requestId);
}
