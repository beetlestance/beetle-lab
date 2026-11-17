import { probeListener } from './health-probe.js';
import { listener } from './configuration.js';

// Bounds configuration acquisition as well as the complete HTTP probe.
const deadline = setTimeout(() => process.exit(1), 2000);
try {
  const listen = listener(process.env);
  process.exitCode = (await probeListener(listen, AbortSignal.timeout(2000))) ? 0 : 1;
} catch {
  process.exitCode = 1;
} finally {
  clearTimeout(deadline);
}
