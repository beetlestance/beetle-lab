import { enterContainerIdentity } from './container-identity.js';
try {
  enterContainerIdentity();
  // `reconcile [--apply]` is the offline operator command (decision 030); anything else serves.
  if (process.argv[2] === 'reconcile') await import('./reconcile.js');
  else await import('./main.js');
} catch {
  process.stderr.write('Beetle Lab container identity setup failed.\n');
  process.exitCode = 1;
}
