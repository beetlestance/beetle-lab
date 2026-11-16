import { DatabaseSync } from 'node:sqlite';
import { openOutputLease, OutputLeaseError } from '../../src/adapters/outbound/files/outputs/lease.js';

const path = process.argv[2]; const mode = process.argv[3];
if (!path || !['hold', 'try', 'sticky'].includes(mode ?? '')) throw new Error('Invalid synthetic lease child');
try {
  const owner = await openOutputLease({ path, create: false });
  if (mode === 'sticky') {
    let calls = 0;
    DatabaseSync.prototype.close = () => { calls++; throw new Error('Synthetic uncertain close'); };
    const closing = owner.close(); let code = ''; let duplicate = '';
    try { await closing; } catch (error) { code = error instanceof OutputLeaseError ? error.code : 'unexpected'; }
    try { await openOutputLease({ path, create: false }); } catch (error) { duplicate = error instanceof OutputLeaseError ? error.code : 'unexpected'; }
    process.send?.({ kind: 'sticky', code, duplicate, calls, cached: closing === owner.close() });
  } else process.send?.({ kind: 'ready' });
  if (mode === 'try') { await owner.close(); process.disconnect?.(); }
  else {
    process.on('message', async message => {
      if (message === 'close') { await owner.close(); process.disconnect?.(); }
    });
  }
} catch (error) {
  process.send?.({ kind: 'refused', code: error instanceof OutputLeaseError ? error.code : 'unexpected' });
  process.disconnect?.();
}
