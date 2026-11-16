import { constants } from 'node:fs';
import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
import type { HistoricalOutputRead } from '../../../../app/src/bootstrap/historical.js';
import { HistoricalByteError } from '../../../../app/src/bootstrap/historical.js';
import { outputPublicationPath } from '../../../../app/src/adapters/outbound/files/outputs/index.js';
import type { RecoveryEntry, RecoveryHeader } from '@beetle/contracts/recovery';
import type { HistoryClaim } from '../claim.js';
import { checkClaimDirectories, rootIdentity } from '../claim.js';
import { CHUNK, child, directory, regular, stable } from '../files.js';
import { RecoveryIO } from '../io.js';
import type { attest } from '../attestation.js';
import type { RecoveryOperation } from '../types.js';
interface Read {path: string; bytes: number; sha256: string; start: number; endExclusive: number; sink: {write(bytes: Uint8Array): Promise<void>}}
/** Two originals shared by inputs/artifacts; no queued work or live receipts. */
export class HistoryReader {
  private readonly active = new Map<string, Promise<void>>();
  private readonly entries: Map<string, RecoveryEntry>;
  private closing?: Promise<void>;
  private closed = false;
  constructor(private readonly claim: HistoryClaim, private readonly header: RecoveryHeader, entries: readonly RecoveryEntry[],
    private readonly proof: Awaited<ReturnType<typeof attest>>) {this.entries = new Map(entries.map(entry => [entry.path, entry]));}
  readonly outputs: HistoricalOutputRead = {read: (request, context) => {
    const artifact = request.record.artifact;
    if (artifact.phase !== 'published' || artifact.writer !== null || artifact.offset !== artifact.bytes) throw new HistoricalByteError('invalid_input');
    if (!this.header.roles.outputs) throw new HistoricalByteError('custody_missing');
    return this.read({path: this.header.roles.outputs + '/' + outputPublicationPath(request.record), bytes: artifact.bytes, sha256: artifact.sha256,
      start: request.start, endExclusive: request.endExclusive, sink: request.sink}, {signal: context.signal ?? new AbortController().signal, deadline: context.deadline});
  }};
  read(request: Read, operation: RecoveryOperation) {
    if (this.closed) throw new HistoricalByteError('closed');
    if (this.active.size >= 2 || this.active.has(request.path)) throw new HistoricalByteError('busy');
    this.validate(request); const io = new RecoveryIO(operation);
    let release!: () => void; const settled = new Promise<void>(resolve => {release = resolve;});
    const result = Promise.resolve().then(async () => {
      try {await this.stream(io, request);}
      finally {await io.closeAll(); this.active.delete(request.path); release();}
    });
    this.active.set(request.path, result); void result.catch(() => {});
    return Object.freeze({result, settled});
  }
  private validate(request: Read): void {
    const expected = this.entries.get(request.path);
    if (expected?.kind !== 'file' || expected.bytes !== request.bytes || expected.sha256 !== request.sha256) throw new HistoricalByteError('integrity');
    if (!Number.isSafeInteger(request.start) || !Number.isSafeInteger(request.endExclusive) || request.start < 0 || request.endExclusive < request.start || request.endExclusive > request.bytes) throw new HistoricalByteError('invalid_input');
  }
  private async ancestors(io: RecoveryIO, relative: string): Promise<void> {
    checkClaimDirectories(this.claim); const parts = relative.split('/'); parts.pop(); let prefix = '';
    for (const part of ['', ...parts]) {
      prefix = prefix && part ? prefix + '/' + part : part;
      const path = prefix ? child(join(this.claim.destination, 'data'), prefix) : join(this.claim.destination, 'data');
      if (rootIdentity(await directory(io, path)) !== this.proof.directories.get(prefix)) throw new HistoricalByteError('integrity');
    }
  }
  private async stream(io: RecoveryIO, request: Read): Promise<void> {
    await this.ancestors(io, request.path); const path = child(join(this.claim.destination, 'data'), request.path);
    const file = await io.acquireFile(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const before = await io.issue(() => file.value.stat({bigint: true})); regular(before, request.bytes);
      if (stable(before) !== this.proof.files.get(request.path)) throw new HistoricalByteError('integrity');
      const buffer = new Uint8Array(CHUNK); let position = request.start;
      while (position < request.endExclusive) {
        const part = await io.issue(() => file.value.read(buffer, 0, Math.min(CHUNK, request.endExclusive - position), position));
        if (part.bytesRead < 1) throw new HistoricalByteError('integrity');
        await io.issue(() => request.sink.write(buffer.slice(0, part.bytesRead))); position += part.bytesRead;
      }
      if (stable(await io.issue(() => file.value.stat({bigint: true}))) !== this.proof.files.get(request.path)) throw new HistoricalByteError('integrity');
    } finally {await io.close(file);}
    if (stable(await io.issue(() => lstat(path, {bigint: true}))) !== this.proof.files.get(request.path)) throw new HistoricalByteError('integrity');
    await this.ancestors(io, request.path);
  }
  close(): Promise<void> {
    this.closed = true;
    if (!this.closing) this.closing = Promise.allSettled([...this.active.values()]).then(() => {
      if (this.active.size) throw new HistoricalByteError('cleanup');
    }); return this.closing;
  }
}
