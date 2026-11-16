import { runStagedExport } from '../wrapper/export/index.js';
import { exportImageOptions } from './export-profile.js';
import { stdoutEvents } from './event-output.js';
/** One admitted generation container; no load execution or performance fallback. */
async function main():Promise<void> {
  if (process.platform !== 'linux') {process.stderr.write('{"kind":"wrapper.error","reason":"profile"}\n');process.exitCode=1;return;}
  process.umask(0o077);const cancel=new AbortController();const stop=()=>cancel.abort();const output=stdoutEvents();
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  try {const receipt=await runStagedExport({...exportImageOptions(cancel.signal),onEvent:event=>output.send(event)});
    process.exitCode=receipt.ok?0:1;
    if (!receipt.ok) process.stderr.write(JSON.stringify({kind:'wrapper.error',reason:receipt.reason})+'\n');
  } finally {process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);output.close();}
}
void main().catch(()=>{process.stderr.write('{"kind":"wrapper.error","reason":"profile"}\n');process.exitCode=1;});
