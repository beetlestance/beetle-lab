/**
 * The agent image entry, also reached through container.js after the identity drop. No arguments
 * serves; `reconcile [--apply]` is the offline operator command (decision 030); anything else is
 * refused before any configuration, journal or Docker access.
 */
import { reconcileStopSignal } from './stop-signal.js';

const command = process.argv[2];
if (command === undefined) await import('./serve.js');
else if (command === 'reconcile') {
  // Capture a stop before the command loads; the module reuses this signal.
  reconcileStopSignal();
  await import('./reconcile.js');
} else {
  process.stderr.write('Usage: agent [reconcile [--apply]]\n');
  process.exitCode = 2;
}
