/** Shared offline custody; callers retain startup leases until every original drains. */
export { RecoveryIO } from './src/io.js';
export { openColdSource } from './src/source.js';
export { sourceLayout } from './src/layout.js';
export { RecoveryError } from './src/types.js';
export { nativeDatabase, checkDestination } from './src/database-custody.js';
