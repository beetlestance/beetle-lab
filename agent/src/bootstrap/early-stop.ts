/**
 * The agent runs as PID 1 without an init, where the kernel drops a signal that has no handler.
 * The container entry installs these handlers before the large runtime bundle is even parsed, and
 * the command that then takes over releases them, learning whether a stop already arrived. State
 * crosses bundles through one registered global symbol; nothing else is shared.
 */
const key = Symbol.for('dev.beetle.agent.early-stop');
interface EarlyStop {
  stopped: boolean;
  release(): boolean;
}
type Holder = { [key]?: EarlyStop };

/** Container entry only, before importing the runtime bundle. */
export function installEarlyStop(): void {
  const holder = globalThis as Holder;
  if (holder[key]) return;
  const state: EarlyStop = {
    stopped: false,
    release: () => {
      process.off('SIGINT', record);
      process.off('SIGTERM', record);
      return state.stopped;
    },
  };
  function record(): void {
    state.stopped = true;
  }
  process.on('SIGINT', record);
  process.on('SIGTERM', record);
  holder[key] = state;
}

/**
 * Called by the owner after it installed its own SIGINT/SIGTERM handlers, so no stop can fall
 * between the two. True when a stop arrived before; false without an early entry (tests, main.js).
 */
export function releaseEarlyStop(): boolean {
  return (globalThis as Holder)[key]?.release() ?? false;
}
