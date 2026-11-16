import { openAgentRuntime } from './index.js';
import type { AgentRuntime } from './index.js';
import { loadAgentConfiguration } from './configuration.js';

process.umask(0o077);
const abort = new AbortController();
let providerClose: (() => Promise<void>) | undefined;
let runtime: AgentRuntime | undefined;
let closing: Promise<void> | undefined;
function stop(): Promise<void> {
  if (closing) return closing;
  closing = Promise.resolve().then(async () => {
    await loading.catch(() => undefined);
    const outcomes = await Promise.allSettled([runtime?.close(), providerClose?.()]);
    if (outcomes.some(value => value.status === 'rejected')) throw new Error('Agent cleanup incomplete');
  });
  abort.abort();
  return closing;
}
function signal(): void { void stop().catch(() => { process.exitCode = 1; }); }
process.once('SIGINT', signal); process.once('SIGTERM', signal);
const loading = Promise.resolve().then(async () => {
  const loaded = await loadAgentConfiguration(process.env, new URL('./worker.js', import.meta.url), abort.signal);
  providerClose = loaded.close;
  if (abort.signal.aborted) return;
  runtime = await openAgentRuntime(loaded.runtime);
  if (abort.signal.aborted) return;
  await runtime.server.listen({ ...loaded.listen });
});
try { await loading; if (abort.signal.aborted) await stop(); }
catch {
  await stop().catch(() => undefined);
  process.stderr.write('Beetle Lab agent startup failed. Check private installation configuration and runtime access.\n');
  process.exitCode = 1;
}
