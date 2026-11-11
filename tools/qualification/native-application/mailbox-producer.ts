// Synthetic producer for the isolated native archive proof, never a service entrypoint.
import { createHash } from 'node:crypto';
import { createMailboxSink, openNativeMailbox } from '../../../engines/k6/wrapper/live-mailbox/index.js';
import { LIVE_MAILBOX_PATH } from '@beetle/contracts/live-mailbox';
const file = await openNativeMailbox({uid: process.getuid!()});
const sink = createMailboxSink({file, maximumProducedBytes: 1000000,
  hash: bytes => createHash('sha256').update(bytes).digest('hex')});
await sink.write(new TextEncoder().encode(JSON.stringify({kind: 'mailbox-proof', platform: process.platform,
  architecture: process.arch, uid: process.getuid!()})), new AbortController().signal);
console.log(JSON.stringify({ready: true, path: LIVE_MAILBOX_PATH, bytes: await file.size()}));
setTimeout(() => {void sink.close().catch(() => {process.exitCode = 1;});}, 30000);
