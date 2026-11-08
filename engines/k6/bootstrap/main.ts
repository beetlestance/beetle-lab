import { encodeJson } from '@beetle/contracts';
import { runStagedK6 } from '../wrapper/attempt/index.js';
import { imageOptions } from './profile.js';

/** One container/job. The enclosing agent owns hard containment of unresponsive original IO. */
async function main(): Promise<void> {
  if (process.platform !== 'linux') {
    process.stderr.write('{"kind":"wrapper.error","reason":"profile"}\n'); process.exitCode = 1; return;
  }
  process.umask(0o077);
  const cancel = new AbortController(); const stop = () => cancel.abort();
  let stdoutFailed = false;
  const stdoutError = () => { stdoutFailed = true; };
  process.once('SIGINT', stop); process.once('SIGTERM', stop); process.stdout.on('error', stdoutError);
  try {
    const receipt = await runStagedK6({ ...imageOptions(cancel.signal), onEvent: async event => {
      if (stdoutFailed) throw new Error('notification');
      const frame = encodeJson(event, 65_535) + '\n';
      await new Promise<void>((resolve, reject) => process.stdout.write(frame, error => error ? reject(error) : resolve()));
    } });
    process.exitCode = receipt.ok ? 0 : 1;
    if (!receipt.ok) process.stderr.write(encodeJson({ kind: 'wrapper.error', reason: receipt.reason }, 1024) + '\n');
  } finally {
    process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
    process.stdout.removeListener('error', stdoutError);
  }
}
void main().catch(() => { process.stderr.write('{"kind":"wrapper.error","reason":"profile"}\n'); process.exitCode = 1; });
