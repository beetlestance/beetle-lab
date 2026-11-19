import { settleSetup } from './settlement.js';
import type { ProvisionRequest, ProvisionContext } from '../types.js';
import { BindingChangedError, UpgradeBlockedError } from '../types.js';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { join, resolve } from 'node:path';
import { enterContainerIdentity } from '../../../agent/src/bootstrap/index.js';
import { UnixDockerTransport } from '../../../agent/src/backends/docker/index.js';
import { provisionFreshInstallation, inspectReadyConfiguration, ProvisionError } from '../index.js';
import { upgradeInstallation } from '../upgrade/index.js';
import type { UpgradeAction } from '../upgrade/index.js';
import { canonical, digest, check } from '../src/capture.js';
import { ComposeHome } from './home.js';
import { ComposeGate } from './gate.js';
import { composeOptions } from './options.js';
import { createStarterRequest } from '../starter.js';
import { installedRequest } from '../src/installed-request.js';
const UPGRADE_DEADLINE_MS = 30 * 60_000;
/** `[]` is ordinary setup; `['upgrade', action?]` is the explicit offline upgrade command. */
export function setupAction(args: readonly string[]): UpgradeAction | undefined {
  if (args.length === 0) return undefined;
  const actions: readonly UpgradeAction[] = ['prepare', 'status', 'activate', 'rollback'];
  const action = (args[1] ?? 'prepare') as UpgradeAction;
  if (args[0] !== 'upgrade' || args.length > 2 || !actions.includes(action)) throw new ProvisionError('invalid_input');
  return action;
}
const bindingHint =
  'Setup values differ from the installation: use its original BEETLE_INSTANCE and BEETLE_HOME, or set up a new installation in another folder.\n';
const originHint =
  'This installation keeps the address it was set up with: unset BEETLE_ORIGIN, or set up a new installation in another folder.\n';
const networkHint =
  'An address or bind on another host needs BEETLE_ACCESS=network and an https:// BEETLE_ORIGIN. See the self-hosting guide.\n';
function report(error: unknown): void {
  if (error instanceof UpgradeBlockedError) process.stderr.write(`upgrade_blocked ${error.items.join(',')}\n`);
  else if (error instanceof BindingChangedError) {
    process.stderr.write(`binding_changed ${error.items.join(',')}\n`);
    process.stderr.write(error.items.includes('external_origin') ? originHint : bindingHint);
  } else process.stderr.write((error instanceof ProvisionError ? error.code : 'invalid_input') + '\n');
  if (error instanceof ProvisionError && error.code === 'network_access_required') process.stderr.write(networkHint);
  if (error instanceof ProvisionError && error.code === 'upgrade_required')
    process.stderr.write('Images moved: stop services, then run `docker compose run --rm setup upgrade`.\n');
}
/** Default Compose packaging only; advanced provisioner and serving startup stay separate. */
export async function runComposeSetup(
  environment: Readonly<Record<string, string | undefined>>,
  args: readonly string[] = [],
): Promise<number> {
  process.umask(0o077);
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  let home: ComposeHome | undefined;
  let gate: ComposeGate | undefined;
  let success = false;
  let result: { installationId: string | null; status: string } | undefined;
  let operation = { signal: controller.signal, deadline: performance.now() + 30000 };
  try {
    const action = setupAction(args);
    if (action) operation = { ...operation, deadline: performance.now() + UPGRADE_DEADLINE_MS };
    const captured = composeOptions(environment);
    home = new ComposeHome(captured.home, { uid: 1000, gid: 1000 }, operation);
    await home.prepare();
    enterContainerIdentity();
    const fresh = await home.adopt();
    const context = {
      ...operation,
      docker: new UnixDockerTransport('/var/run/docker.sock'),
      agentWorkerUrl: new URL('./agent-worker.js', import.meta.url),
      backendWorkerUrl: new URL('./backend-worker.js', import.meta.url),
    };
    const starter = createStarterRequest(captured.options);
    const request = fresh ? starter : await installedRequest(starter, context, captured.loopbackDefault);
    gate = new ComposeGate(home, { uid: 1000, gid: 1000 });
    await gate.open(fresh, digest(canonical(request)));
    result = action
      ? await upgrade({ fresh, home: captured.home, gate, request, context, action })
      : await initialize({ fresh, home, gate, request, context });
    check(operation);
    await gate.assertPin();
    success = true;
  } catch (error) {
    report(error);
  } finally {
    success = await settleSetup({ home, gate, success, operation });
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  }
  if (success && result) {
    process.stdout.write(JSON.stringify(result) + '\n');
    return 0;
  }
  return 1;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  process.exitCode = await runComposeSetup(process.env, process.argv.slice(2));

async function initialize(input: {
  fresh: boolean;
  home: ComposeHome;
  gate: ComposeGate;
  request: ProvisionRequest;
  context: ProvisionContext;
}) {
  const { fresh, home, gate, request, context } = input;
  if (fresh) {
    await home.clearEmptySkeleton();
    const installed = await provisionFreshInstallation(request, context);
    await gate.ready(installed.installationId);
    return { installationId: installed.installationId, status: 'created' };
  }
  const installed = await inspectReadyConfiguration(request, context);
  gate.matchInstallation(installed.installationId);
  return {
    installationId: installed.installationId,
    status: installed.upgrade === 'awaiting_activation' ? 'awaiting_activation' : 'unchanged',
  };
}
async function upgrade(input: {
  fresh: boolean;
  home: string;
  gate: ComposeGate;
  request: ProvisionRequest;
  context: ProvisionContext;
  action: UpgradeAction;
}) {
  if (input.fresh) throw new ProvisionError('invalid_input');
  const result = await upgradeInstallation(
    {
      request: input.request,
      action: input.action,
      upgradeDirectory: join(input.home, 'upgrade'),
      extras: [{ name: 'bootstrap.sqlite', path: join(input.home, 'bootstrap.sqlite') }],
    },
    input.context,
  );
  if (result.installationId !== null) input.gate.matchInstallation(result.installationId);
  return result;
}
