import type { RunEventPage } from '@beetle/contracts/api';
import type { RunKey } from './runs.js';

export interface RunEventsQuery extends RunKey { readonly limit: number; readonly cursor?: string }
/** Scoped finite reads of existing durable events; no ACK, mutation or execution. */
export interface RunEventReader { getRunEvents(query: RunEventsQuery): Promise<RunEventPage> }
