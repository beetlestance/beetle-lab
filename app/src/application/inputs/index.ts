import { requireRule, sameScope, sameUuid } from '../../domain/namespaces/index.js';
import type { IntentDigest } from '../namespaces/index.js';
import { InputByteError } from '../../ports/input-bytes.js';
import type { InputChunkSource, InputContentRange, InputContentSink } from '../../ports/input-bytes.js';
import type { InputCommand, InputControl, InputControlResult, InputKey, InputList, InputPage,
  InputRecord, InputRecoveryPage } from '../../ports/inputs.js';
import type { InputOperationContext, InputRecoveryResult, InputService } from '../../ports/input-service.js';
import { Ownership } from './ownership.js';
import type { Owner } from './ownership.js';
import { capturedSignal, checkedRecord, commandSnapshot, inputPageSnapshot, keySnapshot, pageSnapshot, rangeSnapshot, snapshot } from './validation.js';
import { custodyFailure, reconcile, reserveBytes } from './reconcile.js';
import type { Dependencies } from './reconcile.js';
import { chunkSource, contentSink } from './transfer.js';

function createAcceptance(value: InputControlResult, command: Extract<InputCommand, { kind: 'createInput' }>): InputRecord {
  const record = checkedRecord(value as InputRecord);
  requireRule(sameScope(record.scope, command.request.scope), 'not_found');
  requireRule(record.state === 'staging' && record.version === 1 && record.offset === 0 && record.reason === null);
  requireRule(record.name === command.request.name && record.sha256 === command.request.sha256 && record.bytes === command.request.bytes);
  requireRule(command.request.folderId === undefined || sameUuid(record.folderId, command.request.folderId));
  return record;
}
function acceptance(value: InputControlResult, command: InputCommand): InputControlResult {
  if (command.kind === 'createInput') return createAcceptance(value, command);
  const receipt = snapshot(value);
  requireRule('acceptedVersion' in receipt && Number.isSafeInteger(receipt.acceptedVersion) && receipt.acceptedVersion === command.request.expectedVersion + 1);
  requireRule(Object.keys(receipt).every(field => ['id', 'scope', 'requestId', 'operation', 'acceptedVersion'].includes(field)));
  keySnapshot({ id: receipt.id, scope: receipt.scope });
  requireRule(sameUuid(receipt.id, command.id) && sameScope(receipt.scope, command.request.scope), 'not_found');
  requireRule(receipt.requestId === command.request.requestId && receipt.operation === (command.kind === 'sealInput' ? 'seal' : 'delete'));
  return receipt;
}
function checkedPage(page: InputPage, query: InputList | InputRecoveryPage): InputPage {
  requireRule(Array.isArray(page.items) && page.items.length <= query.limit);
  requireRule(page.nextCursor === null || (typeof page.nextCursor === 'string' && page.nextCursor.length <= 1024));
  const items = page.items.map(item => checkedRecord(item));
  if ('scope' in query) requireRule(items.every(item => sameScope(item.scope, query.scope)), 'not_found');
  return inputPageSnapshot({ items, nextCursor: page.nextCursor });
}
class Service implements InputService {
  private readonly ownership = new Ownership();
  constructor(private readonly deps: Dependencies & { digest: IntentDigest }) {}
  private async owned<T>(key: InputKey, signal: AbortSignal | undefined, work: (owner: Owner) => Promise<T>): Promise<T> {
    const owner = this.ownership.acquire(key, signal);
    try { owner.check(); return await work(owner); }
    finally { owner.finish(); }
  }
  private async current(key: InputKey): Promise<InputRecord> { return checkedRecord(await this.deps.store.get(key), key); }
  async control(command: InputControl, context?: InputOperationContext): Promise<InputControlResult> {
    const captured = commandSnapshot(command, this.deps.digest); const signal = capturedSignal(context);
    return this.ownership.call(async () => {
      if (signal?.aborted) throw new InputByteError('cancelled');
      if (captured.kind === 'createInput') return acceptance(await this.deps.store.control(captured), captured);
      const key = keySnapshot({ scope: captured.request.scope, id: captured.id });
      return this.owned(key, signal, async owner => {
        const result = acceptance(await this.deps.store.control(captured), captured);
        // Only a known acceptance authorizes observation and optional work. No control retry.
        try {
          owner.check(); const record = await this.current(key); owner.check();
          const expected = captured.kind === 'sealInput' ? 'publishing' : 'deleting';
          if (record.state === expected) await reconcile(this.deps, owner, record);
        } catch { /* The receipt is acceptance; latest status/recovery owns pending work. */ }
        return result;
      });
    });
  }
  async append(key: InputKey, offset: number, source: InputChunkSource, context?: InputOperationContext): Promise<InputRecord> {
    const captured = keySnapshot(key); const signal = capturedSignal(context);
    requireRule(Number.isSafeInteger(offset) && offset >= 0 && typeof source === 'function');
    return this.ownership.call(() => this.owned(captured, signal, async owner => {
      const record = await this.current(captured); owner.check();
      requireRule(record.state === 'staging' && offset <= record.offset && offset < record.bytes, 'conflict');
      const reserve = await reserveBytes(this.deps.store, owner);
      const chunk = chunkSource(owner, record, offset, source);
      let next: number;
      try {
        try { next = await owner.job(this.deps.bytes.append(record, offset, chunk.read, owner.context(reserve))); }
        finally { chunk.end(); }
        await owner.drainCustody(); owner.check(); requireRule(next === chunk.next());
      } catch (error) { await custodyFailure(this.deps.store, owner, record, error); throw error; }
      finally { chunk.end(); }
      if (next === record.offset) return record;
      return checkedRecord(await this.deps.store.advance({ kind: 'commitInputOffset', key: captured,
        expectedVersion: record.version, offset: next }), captured);
    }));
  }
  async read(key: InputKey, range: InputContentRange | undefined, sink: InputContentSink,
    context?: InputOperationContext): Promise<InputRecord> {
    const captured = keySnapshot(key); const selected = rangeSnapshot(range); const signal = capturedSignal(context);
    const write = sink.write.bind(sink);
    return this.ownership.call(() => this.owned(captured, signal, async owner => {
      const record = await this.current(captured); owner.check(); requireRule(record.state === 'published', 'conflict');
      const bounds = selected ?? { start: 0, endExclusive: record.bytes };
      requireRule(bounds.endExclusive <= record.bytes);
      const reserve = await reserveBytes(this.deps.store, owner);
      const consumer = contentSink(owner, { write }, bounds.endExclusive - bounds.start);
      try {
        try { await owner.job(this.deps.bytes.read(record, bounds, consumer, owner.context(reserve))); }
        finally { consumer.end(); }
        await owner.drainCustody(); owner.check(); consumer.complete(); return record;
      } catch (error) { await custodyFailure(this.deps.store, owner, record, error); throw error; }
      finally { consumer.end(); }
    }));
  }
  async recover(query: InputRecoveryPage, context?: InputOperationContext): Promise<InputRecoveryResult> {
    const captured = pageSnapshot(query, false); const signal = capturedSignal(context);
    return this.ownership.call(async () => {
      if (signal?.aborted) throw new InputByteError('cancelled');
      const page = checkedPage(await this.deps.store.recovery(captured), captured);
      const result = { examined: page.items.length, reconciled: 0, busy: 0, pending: 0, nextCursor: page.nextCursor };
      for (const item of page.items) {
        let admitted = false;
        try {
          await this.owned(keySnapshot({ id: item.id, scope: item.scope }), signal, async owner => {
            admitted = true;
            if (await reconcile(this.deps, owner, await this.current({ id: item.id, scope: item.scope }))) result.reconciled++;
            else result.pending++;
          });
        } catch (error) {
          if (!admitted && error instanceof InputByteError && error.code === 'busy') result.busy++;
          else result.pending++;
        }
      }
      return result;
    });
  }
  close(): Promise<void> { return this.ownership.close(); }
  async get(key: InputKey): Promise<InputRecord> {
    const copy = keySnapshot(key); return this.ownership.call(() => this.current(copy));
  }
  async list(query: InputList): Promise<InputPage> {
    const copy = pageSnapshot(query, true);
    return this.ownership.call(async () => checkedPage(await this.deps.store.list(copy), copy));
  }
}
export function createInputService(deps: Dependencies & { digest: IntentDigest }): InputService {
  return new Service({ ...deps });
}
