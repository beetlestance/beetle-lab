import { capacityTarget } from './capacity/arguments.js';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { validatePrimitive } from '@beetle/contracts';
import { enterContainerIdentity } from '../../agent/src/bootstrap/index.js';
import { UnixDockerTransport } from '../../agent/src/backends/docker/index.js';
import { composeOptions } from './compose/options.js';
import { ComposeHome } from './compose/home.js';
import { ComposeGate } from './compose/gate.js';
import { settleSetup } from './compose/settlement.js';
import { createStarterRequest } from './starter.js';
import { canonical, digest, requireInput, capture } from './src/capture.js';
import { ProvisionError } from './types.js';
import { changeInstalledCapacity } from './capacity/index.js';
import { filesFor, readState } from './capacity/state.js';
import { RecoveryError } from '../recovery/offline.js';
/** Same fixed Compose identity/options and configuration gate as initial setup. */
export async function runComposeCapacity(
  argv: readonly string[],
  environment: Readonly<Record<string, string | undefined>>,
): Promise<number> {
  process.umask(0o077);
  const controller = new AbortController();
  const abort = () => controller.abort();
  const operation = { signal: controller.signal, deadline: performance.now() + 30000 };
  process.once('SIGINT', abort);
  process.once('SIGTERM', abort);
  let home: ComposeHome | undefined;
  let gate: ComposeGate | undefined;
  let success = false;
  let result: Awaited<ReturnType<typeof changeInstalledCapacity>> | undefined;
  try {
    requireInput(argv.length === 4 && argv[2] === '--operation-id');
    const increase = capacityTarget(argv[0], argv[1]);
    requireInput(validatePrimitive('uuid', argv[3]).ok);
    const captured = composeOptions(environment);
    home = new ComposeHome(captured.home, { uid: 1000, gid: 1000 }, operation);
    await home.prepare();
    enterContainerIdentity();
    requireInput(!(await home.adopt()));
    const request = createStarterRequest(captured.options);
    gate = new ComposeGate(home, { uid: 1000, gid: 1000 });
    await gate.open(false, digest(canonical(request)));
    const context = {
      ...operation,
      docker: new UnixDockerTransport('/var/run/docker.sock'),
      agentWorkerUrl: new URL('./agent-worker.js', import.meta.url),
      backendWorkerUrl: new URL('./backend-worker.js', import.meta.url),
    };
    const c = capture(request, context);
    const files = await filesFor(c);
    try {
      gate.matchInstallation((await readState(c, files)).receipt.installationId);
    } finally {
      await files.close();
    }
    result = await changeInstalledCapacity({ request, increase, operationId: argv[3]! }, context);
    gate.matchInstallation(result.installationId);
    await gate.assertPin();
    success = true;
  } catch (error) {
    process.stderr.write(
      (error instanceof ProvisionError || error instanceof RecoveryError ? error.code : 'recovery_required') + '\n',
    );
  } finally {
    success = await settleSetup({ home, gate, success, operation });
    process.removeListener('SIGINT', abort);
    process.removeListener('SIGTERM', abort);
  }
  if (success) {
    process.stdout.write(JSON.stringify(result) + '\n');
    return 0;
  }
  return 1;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  process.exitCode = await runComposeCapacity(process.argv.slice(2), process.env);
