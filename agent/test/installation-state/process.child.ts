import { openServingState, openRestoringState, InstallationStateError } from '../../src/installation-state/index.js';
const [mode, path, operation] = process.argv.slice(2);
try {
  if (!path) throw new Error('Missing synthetic path');
  if (mode === 'serve') {
    const owner = openServingState(path); process.send?.({ kind: 'ready', authority: owner.journalAuthority });
  } else if (mode === 'restore' && operation) {
    const owner = openRestoringState(path); const plan = owner.begin(operation);
    process.send?.({ kind: 'ready', authority: plan.pending });
  } else throw new Error('Unsupported synthetic mode');
  setInterval(() => undefined, 1000);
  process.on('disconnect', () => process.exit(0));
} catch (error) {
  process.send?.({ kind: 'error', code: error instanceof InstallationStateError ? error.code : 'fixture' }, () => process.disconnect());
  process.exitCode = 1;
}
