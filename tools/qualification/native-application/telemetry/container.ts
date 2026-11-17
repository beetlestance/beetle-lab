import { enterContainerIdentity } from '../../../../agent/src/bootstrap/index.js';
import { diagnosis } from './diagnosis.js';
try {
  enterContainerIdentity();
  console.log(JSON.stringify({ kind: 'telemetry.bootstrap', version: 1 }));
  await import('./main.js');
} catch (error) {
  console.error('Qualification telemetry bootstrap failed');
  console.error(diagnosis(error));
  process.exitCode = 1;
}
