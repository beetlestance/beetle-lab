import type { Scope } from '../admission/index.js';
import { copyControlScope } from '../control-protocol/index.js';
import type { RunnablePage, RunnableRequest } from '../journal/index.js';
import { SchedulerError } from './types.js';

const lanes = ['charged', 'delivery', 'queued'] as const;
function requirePage(condition: unknown): asserts condition {
  if (!condition) throw new SchedulerError('invalid_input');
}
function continuation(request: RunnableRequest, page: RunnablePage): void {
  if (page.cursor === undefined) return;
  requirePage(Number.isSafeInteger(page.cursor) && page.cursor > (request.cursor ?? 0) && page.attempts.length > 0);
}
function delivery(request: RunnableRequest, page: RunnablePage): void {
  requirePage(typeof page.through === 'number' && Number.isSafeInteger(page.through) && page.through >= 0);
  if (request.through !== undefined) requirePage(page.through === request.through);
  if (page.cursor !== undefined) requirePage(page.cursor <= page.through);
  if (page.through === 0) requirePage(page.attempts.length === 0);
}
/** Keeps only bounded discovery positions, never a second queue of original work. */
export class Discovery {
  private first = 0;
  private queuedCursor: number | undefined;
  private deliveryCursor: number | undefined;
  private deliveryThrough: number | undefined;
  nextPass(): readonly RunnableRequest['lane'][] {
    const start = this.first; this.first = (start + 1) % lanes.length;
    return lanes.map((_, index) => lanes[(start + index) % lanes.length]!);
  }
  request(lane: RunnableRequest['lane'], available: number): RunnableRequest {
    if (lane === 'charged') return Object.freeze({ lane, limit: 100 });
    const cursor = lane === 'delivery' ? this.deliveryCursor : this.queuedCursor;
    return Object.freeze({ lane, limit: Math.min(32, available), ...(cursor === undefined ? {} : { cursor }),
      ...(lane === 'delivery' && this.deliveryThrough !== undefined ? { through: this.deliveryThrough } : {}) });
  }
  validate(request: RunnableRequest, page: RunnablePage): readonly Scope[] {
    requirePage(Array.isArray(page.attempts));
    requirePage(page.attempts.length <= (request.lane === 'charged' ? 64 : request.limit));
    if (request.lane === 'charged') requirePage(page.cursor === undefined);
    else continuation(request, page);
    if (request.lane === 'delivery') delivery(request, page);
    else requirePage(page.through === undefined);
    return Object.freeze(Array.from(page.attempts, key => copyControlScope(key)));
  }
  considered(request: RunnableRequest, page: RunnablePage): void {
    if (request.lane === 'queued') this.queuedCursor = page.cursor;
    if (request.lane === 'delivery') {
      this.deliveryCursor = page.cursor;
      this.deliveryThrough = page.cursor === undefined ? undefined : page.through;
    }
  }
}
