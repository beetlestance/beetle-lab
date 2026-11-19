import { enterContainerIdentity } from './container-identity.js';
try {
  enterContainerIdentity();
  // main.js dispatches serving or the offline `reconcile [--apply]` command (decision 030).
  await import('./main.js');
} catch {
  process.stderr.write('Beetle Lab container identity setup failed.\n');
  process.exitCode = 1;
}
