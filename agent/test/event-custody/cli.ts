import { relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openJournal, JournalError } from '../../src/journal/index.js';
import type { Journal } from '../../src/journal/index.js';
import { HttpHarness } from './http-harness.js';
import { inspectJournal } from './inspection.js';
import { checked, fields, key, MAXIMUM, object, send } from './wire.js';

async function supervisor(journal: Journal, input: unknown): Promise<unknown> {
  const value = fields(input, ['sourceOrdinal', 'event']);
  const event = checked('AgentEvent', { ...object(value.event), seq: 1 });
  if ('seq' in object(value.event) || event.source !== 'agent' || !Number.isSafeInteger(value.sourceOrdinal)
    || Number(value.sourceOrdinal) < 1) throw new Error('Invalid supervisor fixture');
  const { seq, ...draft } = event;
  if (seq !== 1) throw new Error('Invalid fixture sequence');
  return journal.appendSupervisor({ sourceOrdinal: Number(value.sourceOrdinal), event: draft });
}
async function journalCommand(journal: Journal, operation: string, input: unknown): Promise<unknown> {
  switch (operation) {
    case 'authority': return journal.journalAuthority();
    case 'offer': return journal.immutableOffer(checked('Offer', input));
    case 'appendWrapper': return journal.appendWrapper(checked('ControlEvent', input));
    case 'appendSupervisor': return supervisor(journal, input);
    case 'events': return events(journal, input);
    case 'ack': return journal.acknowledge(checked('Ack', input));
    case 'prune': return journal.prune(key(input));
    default: throw new Error('Unknown fixture journal operation');
  }
}
async function events(journal: Journal, input: unknown): Promise<unknown> {
  const value = fields(input, ['key', 'after']);
  if (!Number.isSafeInteger(value.after) || Number(value.after) < 0) throw new Error('Invalid fixture cursor');
  return journal.readEvents(key(value.key), Number(value.after));
}
async function dispatch(journal: Journal, http: HttpHarness, path: string, operation: string, input: unknown): Promise<unknown> {
  if (['authority', 'listen', 'traffic', 'stopServer', 'inspect', 'close'].includes(operation) && input !== null) throw new Error('Unexpected fixture input');
  switch (operation) {
    case 'listen': return http.listen();
    case 'configure': return http.configure(input);
    case 'traffic': return http.traffic();
    case 'stopServer': return http.close();
    case 'inspect': await http.close(); await journal.close(); return inspectJournal(path);
    case 'close': await http.close(); await journal.close(); return null;
    default: return journalCommand(journal, operation, input);
  }
}

function inputLane(journal: Journal, http: HttpHarness, path: string): Promise<void> {
  const pending = Buffer.alloc(MAXIMUM + 1);
  let size = 0; let busy = false; let count = 0; let chunks = 0; let closed = false;
  return new Promise((resolveLane, rejectLane) => {
    const fail = (error: unknown) => { process.stdin.pause(); rejectLane(error); };
    process.stdin.on('error', fail);
    process.stdin.on('end', () => { if (!closed || busy || size) fail(new Error('Incomplete fixture close')); else resolveLane(); });
    process.stdin.on('data', (chunk: Buffer) => {
      if (busy || closed || !Buffer.isBuffer(chunk) || ++chunks > 4096 || size + chunk.length > MAXIMUM + 1) return fail(new Error('Fixture input bound'));
      chunk.copy(pending, size); size += chunk.length;
      const end = pending.subarray(0, size).indexOf(10);
      if (end < 0) return;
      if (end !== size - 1 || ++count > 64) return fail(new Error('Fixture original bound'));
      busy = true;
      const line = pending.subarray(0, end); size = 0; chunks = 0;
      void (async () => {
        const value = fields(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(line)) as unknown, ['id', 'operation', 'input']);
        if (value.id !== count || typeof value.operation !== 'string') throw new Error('Invalid fixture command');
        try {
          const result = await dispatch(journal, http, path, value.operation, value.input);
          closed = value.operation === 'close';
          await send({ id: count, ok: true, value: result });
        } catch (error) {
          if (!(error instanceof JournalError)) throw error;
          await send({ id: count, ok: false, code: error.code });
        }
        busy = false;
      })().catch(fail);
    });
  });
}

function checkedPath(root: string, value: string): void {
  const local = relative(resolve(root), resolve(value));
  if (!local || local.startsWith('..') || local.startsWith('/') || value.length > 4096) throw new Error('Fixture path outside root');
}
async function main(): Promise<void> {
  const [path, worker, root] = process.argv.slice(2);
  if (!path || !worker || !root || root.length > 4096 || process.argv.length !== 5) throw new Error('Invalid fixture paths');
  for (const value of [path, worker]) checkedPath(root, value);
  const journal = await openJournal({ path, workerUrl: pathToFileURL(worker) });
  const http = new HttpHarness(journal, resolve(root));
  const deadline = setTimeout(() => { process.exitCode = 1; process.stdin.destroy(new Error('Fixture lifetime bound')); }, 30000);
  try { await send({ id: 0, ok: true, value: null }); await inputLane(journal, http, path); }
  finally { clearTimeout(deadline); await http.close(); await journal.abort(); }
}
void main().catch(() => { process.stderr.write('Agent custody fixture failed\n'); process.exitCode = 1; process.stdin.destroy(); });
