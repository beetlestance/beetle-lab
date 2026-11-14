import type { HistoricalInputService, HistoricalInputStore } from '../../../../app/src/bootstrap/historical.js';
import { HistoricalByteError } from '../../../../app/src/bootstrap/historical.js';
import { inputPublicationPath } from '../../../../app/src/adapters/outbound/files/inputs/index.js';
import type { HistoryReader } from './reader.js';
export function historicalInputs(store: HistoricalInputStore, reader: HistoryReader, prefix: string | null): HistoricalInputService {
  let closed = false;
  const denied = async (): Promise<never> => {throw new HistoricalByteError('closed');};
  const check = () => {if (closed) throw new HistoricalByteError('closed');};
  const service: HistoricalInputService = {control: denied, append: denied, recover: denied,
    get: async key => {check(); return store.get(key);}, list: async query => {check(); return store.list(query);},
    read: async (key, range, sink, context) => {
      check(); const record = await store.get(key);
      if (record.state !== 'published' || prefix === null) throw new HistoricalByteError('custody_missing');
      const selection = range ?? {start: 0, endExclusive: record.bytes};
      const job = reader.read({path: prefix + '/' + inputPublicationPath(record), bytes: record.bytes, sha256: record.sha256,
        ...selection, sink}, {signal: context?.signal ?? new AbortController().signal, deadline: performance.now() + 30000});
      await job.result; check(); return record;
    }, close: () => {closed = true; return reader.close();}};
  return Object.freeze(service);
}
