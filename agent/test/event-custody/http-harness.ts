import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import type { IncomingMessage } from 'node:http';
import type { AckReceipt } from '@beetle/contracts';
import type { FastifyInstance } from 'fastify';
import { createAgentServer } from '../../src/transport/index.js';
import type { Journal } from '../../src/journal/index.js';
import { checked, fields } from './wire.js';

function observation(path: string): unknown {
  const fd = openSync(path, 'r');
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > 4096) throw new Error('Commit observation bound');
    const bytes = Buffer.alloc(4097); const length = readSync(fd, bytes, 0, bytes.length, 0);
    if (length > 4096 || length !== stat.size) throw new Error('Commit observation bound');
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length))) as unknown;
  } finally { closeSync(fd); }
}

/** Observes actual traffic; the fault drops a response only after Journal ACK completed. */
export class HttpHarness {
  private server: FastifyInstance | undefined;
  private loseAck = false;
  private commitPath: string | null = null;
  private readonly state = { requests: [] as string[], receipts: [] as AckReceipt[], statuses: [] as number[],
    observations: [] as unknown[], fault: null as string | null };
  constructor(private readonly journal: Journal, private readonly root: string) {}
  async listen(): Promise<string> {
    if (this.server) throw new Error('Server already open');
    const unexpected = async (): Promise<never> => { throw new Error('Unexpected installation/execution call'); };
    const server = createAgentServer({ credential: 'S'.repeat(64), journalAuthority: await this.journal.journalAuthority(),
      journal: this.journal, installation: { cancelExportOriginal: unexpected, enqueueExport: unexpected, enqueue: unexpected, cancel: unexpected, cancelOriginal: unexpected }, capabilities: unexpected });
    this.server = server;
    server.server.prependListener('request', request => {
      try { this.arrival(request); }
      catch { this.state.fault = 'Agent arrival observation failed'; request.destroy(); }
    });
    server.addHook('onSend', async (request, reply, payload) => {
      if (this.state.statuses.length >= 16) throw new Error('Response bound');
      this.state.statuses.push(reply.statusCode);
      if (!request.url.endsWith('/ack') || reply.statusCode !== 200) return payload;
      if (typeof payload !== 'string' || Buffer.byteLength(payload) > 4096 || this.state.receipts.length >= 8) throw new Error('ACK response bound');
      this.state.receipts.push(checked('AckReceipt', JSON.parse(payload) as unknown));
      if (this.loseAck) { this.loseAck = false; reply.raw.destroy(); }
      return payload;
    });
    return server.listen({ host: '127.0.0.1', port: 0 });
  }
  private arrival(request: IncomingMessage): void {
    if (this.state.requests.length >= 16 || (request.url?.length ?? 0) > 2048) throw new Error('Request bound');
    this.state.requests.push(`${request.method} ${request.url}`);
    // Runs inside the agent process at native arrival, before Fastify/body awaits.
    if (request.method !== 'POST' || !request.url?.endsWith('/ack') || !this.commitPath) return;
    if (this.state.observations.length >= 8) throw new Error('Observation bound');
    this.state.observations.push(observation(this.commitPath));
  }
  configure(input: unknown): null {
    const value = fields(input, ['loseAck', 'commitPath']);
    if (typeof value.loseAck !== 'boolean' || value.commitPath !== null && typeof value.commitPath !== 'string') throw new Error('Invalid fault config');
    if (typeof value.commitPath === 'string') {
      const local = relative(this.root, resolve(value.commitPath));
      if (!local || local.startsWith('..') || local.startsWith('/') || value.commitPath.length > 4096) throw new Error('Commit path outside fixture');
    }
    this.loseAck = value.loseAck; this.commitPath = value.commitPath as string | null;
    return null;
  }
  traffic(): unknown { return this.state; }
  async close(): Promise<null> { await this.server?.close(); this.server = undefined; return null; }
}
