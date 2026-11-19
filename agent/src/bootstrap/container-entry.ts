/**
 * The image's `container.js`: catches a stop before the runtime bundle (several MiB) is parsed,
 * then loads it. tools/build-agent.ts keeps container-main.js a separate file.
 */
import { installEarlyStop } from './early-stop.js';

installEarlyStop();
await import('./container-main.js');
