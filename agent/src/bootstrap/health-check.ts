import { probeListener } from './health-probe.js';
import { enterContainerIdentity } from './container-identity.js';
import { readInstalledConfiguration } from './configuration.js';

// Bounds configuration acquisition as well as the complete HTTP probe.
const deadline = setTimeout(() => process.exit(1), 2000);
try {
  if (process.getuid?.() === 0) enterContainerIdentity();
  const { config, receipt } = await readInstalledConfiguration(process.env, AbortSignal.timeout(2000));
  await receipt.assertCurrent();
  const listen = config.listen;
  process.exitCode = (await probeListener(listen, AbortSignal.timeout(2000))) ? 0 : 1;
} catch {
  process.exitCode = 1;
} finally {
  clearTimeout(deadline);
}
