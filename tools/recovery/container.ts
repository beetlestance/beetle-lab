import { enterContainerIdentity } from '../../agent/src/bootstrap/index.js';
import { runRecoveryCli } from './run.js';
/** Optional socket-group adoption for offline backup; no filesystem permission repair. */
try {enterContainerIdentity(); process.exitCode = await runRecoveryCli(process.argv.slice(2));}
catch {process.stderr.write('identity\n'); process.exitCode = 1;}
