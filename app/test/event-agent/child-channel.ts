import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { encodeJson } from '@beetle/contracts';

const maximum = 2_101_248;
export function record(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid child fixture object');
  return input as Record<string, unknown>;
}
interface Pending { id: number; resolve(value: unknown): void; reject(error: Error): void }
function errorCode(value: Record<string, unknown>): string {
  if (Object.keys(value).sort().join() !== 'code,id,ok' || typeof value.code !== 'string'
    || !/^[a-z_]{1,32}$/.test(value.code)) throw new Error('Invalid agent error reply');
  return value.code;
}

/** One bounded original, with ownership of both stdin write and stdout response. */
export class ChildChannel {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly exit: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  private readonly ready: Promise<unknown>;
  private pending: Pending | null = null;
  private sequence = 0;
  private busy = false;
  private failed: Error | null = null;
  private closed = false;
  private readonly bytes = Buffer.alloc(maximum + 1);
  private size = 0;
  private chunks = 0;
  private diagnostics = 0;
  constructor(paths: { journal: string; directory: string; root: string }) {
    this.child = spawn(process.execPath, ['--import', 'tsx',
      fileURLToPath(new URL('../../../agent/test/event-custody/cli.ts', import.meta.url)),
      paths.journal, paths.directory, paths.root], { stdio: ['pipe', 'pipe', 'pipe'], env: { PATH: process.env.PATH } });
    this.ready = new Promise((resolve, reject) => { this.pending = { id: 0, resolve, reject }; });
    this.exit = new Promise(resolve => {
      this.child.once('close', (code, signal) => {
        if (this.pending || !this.closed) this.fail(new Error(`Agent fixture exited (${code ?? signal})`));
        resolve({ code, signal });
      });
    });
    this.child.on('error', error => { this.fail(error); });
    this.child.stdin.on('error', error => { this.fail(error); });
    this.child.stdout.on('error', error => { this.fail(error); });
    this.child.stderr.on('error', error => { this.fail(error); });
    this.child.stderr.on('data', (chunk: Buffer) => {
      this.diagnostics += chunk.length;
      if (this.diagnostics > 8192) this.fail(new Error('Agent diagnostic byte bound'));
    });
    this.child.stdout.on('data', (chunk: Buffer) => { this.receive(chunk); });
  }
  async start(): Promise<void> {
    const timer = setTimeout(() => { this.fail(new Error('Agent startup deadline')); }, 5000);
    try { await this.ready; } finally { clearTimeout(timer); }
  }
  private receive(chunk: Buffer): void {
    try {
      if (!Buffer.isBuffer(chunk) || ++this.chunks > 4096 || this.size + chunk.length > maximum + 1) throw new Error('Agent reply bound');
      chunk.copy(this.bytes, this.size); this.size += chunk.length;
      const end = this.bytes.subarray(0, this.size).indexOf(10);
      if (end < 0) return;
      if (end !== this.size - 1) throw new Error('Multiple agent replies');
      const value = record(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(this.bytes.subarray(0, end))) as unknown);
      this.size = 0; this.chunks = 0;
      this.settle(value);
    } catch (error) { this.fail(error instanceof Error ? error : new Error('Invalid agent reply')); }
  }
  private settle(value: Record<string, unknown>): void {
    const pending = this.pending;
    if (!pending || value.id !== pending.id || typeof value.ok !== 'boolean') throw new Error('Unexpected agent reply');
    if (value.ok) {
      if (Object.keys(value).sort().join() !== 'id,ok,value') throw new Error('Invalid agent positive reply');
      this.pending = null; pending.resolve(value.value); return;
    }
    const code = errorCode(value);
    this.pending = null;
    pending.reject(Object.assign(new Error('Actual Journal rejected fixture command'), { code }));
  }
  private fail(error: Error): void {
    this.failed ??= error;
    this.pending?.reject(this.failed); this.pending = null;
    this.child.kill('SIGKILL');
  }
  async call(operation: string, input: unknown = null): Promise<unknown> {
    if (this.failed) throw this.failed;
    if (this.closed || this.busy || this.pending || this.sequence >= 64) throw new Error('Agent original bound');
    const text = encodeJson({ id: ++this.sequence, operation, input }, maximum) + '\n';
    this.busy = true;
    const timer = setTimeout(() => { this.fail(new Error('Agent command deadline')); }, 5000);
    try {
      const reply = new Promise<unknown>((resolve, reject) => { this.pending = { id: this.sequence, resolve, reject }; });
      const write = new Promise<void>((resolve, reject) => {
        this.child.stdin.write(text, error => { if (error) { this.fail(error); reject(error); } else resolve(); });
      });
      const [result] = await Promise.all([reply, write]);
      return result;
    } finally { clearTimeout(timer); this.busy = false; }
  }
  async close(): Promise<void> {
    if (this.closed) return;
    let failure: unknown;
    try { if (!this.failed) await this.call('close'); } catch (error) { failure = error; this.fail(new Error('Agent close failed')); }
    this.closed = true; this.child.stdin.end();
    const timer = setTimeout(() => { this.child.kill('SIGKILL'); }, 2000);
    try {
      const result = await this.exit;
      if (failure) throw failure;
      if (this.failed) throw this.failed;
      if (result.code !== 0 || result.signal) throw new Error('Agent close did not exit cleanly');
    } finally { clearTimeout(timer); }
  }
}
