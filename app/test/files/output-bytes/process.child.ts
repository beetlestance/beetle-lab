import { join } from 'node:path';
import { nativePort } from '../../../src/adapters/outbound/files/custody/index.js';
import { openStore } from '../../../src/adapters/outbound/files/outputs/store.js';
import { openOutputLease } from '../../../src/adapters/outbound/files/outputs/lease.js';
import { OutputByteError } from '../../../src/ports/output-bytes.js';
import { context, pending, record } from './fixture.js';

const root = process.argv[2]; const mode = process.argv[3] ?? '';
if (!root || !['contender', 'cleanup', 'cleanup-directory', 'cleanup-removal', 'cleanup-removal-directory'].includes(mode ?? '')) throw new Error('Invalid synthetic process');
if (mode === 'contender') {
  try {
    const lease = await openOutputLease({ path: join(root, 'namespace.sqlite'), create: false }); await lease.close();
    process.send?.({ kind: 'acquired' });
  } catch { process.send?.({ kind: 'excluded' }); }
  process.disconnect?.();
} else {
  let closes = 0;
  const store = await openStore({ stagingRoot: join(root, 'staging'), publishedRoot: join(root, 'published'),
    leasePath: join(root, 'namespace.sqlite'), createLease: false }, { nativePort: { ...nativePort, close: async handle => {
    const file = !(await handle.stat()).isDirectory(); await nativePort.close(handle);
    if ((mode.endsWith('directory') ? !file : file) && closes === 0) { closes++; throw new Error('Synthetic unknown original close'); }
  } } });
  const encoded = process.argv[4] ?? '';
  if (encoded.length > 8192) throw new Error('Synthetic input bound');
  const job = mode.startsWith('cleanup-removal') ? store.remove(JSON.parse(encoded) as Parameters<typeof store.remove>[0], context()) : store.prepare(record(), context());
  let code = ''; let closed = '';
  try { await job.result; } catch (error) { code = error instanceof OutputByteError ? error.code : 'unexpected'; }
  const closing = store.close();
  try { await closing; } catch (error) { closed = error instanceof OutputByteError ? error.code : 'unexpected'; }
  let admission = '';
  try { await store.prepare(record(), context()).result; } catch (error) { admission = error instanceof OutputByteError ? error.code : 'unexpected'; }
  process.send?.({ kind: 'cleanup', code, closed, admission, closes, pending: await pending(job.settled), cached: closing === store.close() });
  process.on('message', () => { throw new Error('Unexpected synthetic child message'); });
}
