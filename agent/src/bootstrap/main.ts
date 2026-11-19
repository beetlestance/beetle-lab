/**
 * The agent image entry, also reached through container.js after the identity drop. No arguments
 * serves; `reconcile [--apply]` is the offline operator command (decision 030); anything else is
 * refused before any configuration, journal or Docker access.
 */
const command = process.argv[2];
if (command === undefined) await import('./serve.js');
else if (command === 'reconcile') await import('./reconcile.js');
else {
  process.stderr.write('Usage: agent [reconcile [--apply]]\n');
  process.exitCode = 2;
}

export {};
