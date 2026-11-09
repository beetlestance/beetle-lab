import type { DeliveryRuntime, DeliveryRuntimeOptions, DeliveryRuntimeState } from '../../../../ports/delivery.js';
import { deliver } from './attempt.js';
import type { DeliveryOperations } from './attempt.js';
import { discovery } from './discovery.js';

function capture(options: DeliveryRuntimeOptions) {
  const interval = options.intervalMs ?? 250;
  if (!Number.isSafeInteger(interval) || interval < 25 || interval > 60_000) throw new Error('Invalid delivery interval');
  const store = options.store;
  const runs = options.runs;
  const gateway = options.gateway;
  return { interval, onFailure: options.onFailure.bind(options),
    store: { scan: store.scan.bind(store), readOffer: store.readOffer.bind(store),
      claim: store.claim.bind(store), observe: store.observe.bind(store) },
    runs: { getRun: runs.getRun.bind(runs) }, attempt: gateway.attempt.bind(gateway) };
}

/** One bounded loop; close retains every original and never closes the gateway. */
export function startDeliveryRuntime(options: DeliveryRuntimeOptions): DeliveryRuntime {
  const captured = capture(options);
  const controller = new AbortController();
  const next = discovery(captured.store.scan);
  let stopped = false;
  let status: DeliveryRuntimeState['status'] = 'running';
  let reason: DeliveryRuntimeState['reason'] = null;
  let failure: unknown;
  let active: Promise<void> | undefined;
  let closing: Promise<void> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const operations: DeliveryOperations = { ...captured, signal: controller.signal, stopped: () => stopped };
  function stop(): void {
    stopped = true;
    if (timer !== undefined) clearTimeout(timer);
    controller.abort();
  }
  async function fail(error: unknown): Promise<void> {
    status = 'failed'; reason = 'operation_failure'; failure = error;
    stop();
    try { await captured.onFailure(error); }
    catch (notification: unknown) {
      reason = 'failure_notification';
      failure = new AggregateError([error, notification], 'Delivery failure notification failed');
    }
  }
  async function turn(): Promise<void> {
    try {
      const candidate = await next();
      if (!stopped && candidate) await deliver(operations, candidate.key);
    } catch (error: unknown) { await fail(error); }
    finally {
      active = undefined;
      if (!stopped) schedule(captured.interval);
    }
  }
  function schedule(delay: number): void {
    timer = setTimeout(() => { timer = undefined; active = Promise.resolve().then(turn); }, delay);
  }
  function close(): Promise<void> {
    if (closing) return closing;
    stop();
    closing = (async () => {
      await active;
      if (status === 'failed') throw failure;
      status = 'closed';
    })();
    return closing;
  }
  schedule(0);
  return Object.freeze({ state: () => Object.freeze({ status, active: active !== undefined, reason }), close });
}
