import { readReleaseAuthority } from './github.js';
if (process.argv.length !== 2) throw Error('Release authority check takes no arguments');
await readReleaseAuthority();
process.stdout.write('Release approval policy verified; no publication performed.\n');
