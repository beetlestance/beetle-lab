import { createContext, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { ApiClient, ApiClientResult } from '@beetle/contracts/api';
import { ApiContext, useApi } from '../../app/api.js';

/** True once any request in this tab was refused because the installation is paused for an upgrade. */
const PausedContext = createContext(false);
export function useUpgradePaused(): boolean {
  return useContext(PausedContext);
}

function refusedForUpgrade(result: unknown): boolean {
  const reply = result as ApiClientResult<unknown> | undefined;
  return !!reply && reply.ok === false && reply.error.protocol?.code === 'upgrade_pending';
}

/**
 * Watches every API reply for the `upgrade_pending` refusal so the shell can explain the
 * pause once, wherever the refused action was. Replies pass through unchanged.
 */
export function UpgradeWatch({ children }: { children: ReactNode }) {
  const api = useApi();
  const [paused, setPaused] = useState(false);
  const watched = useMemo(() => {
    const watch = (method: (...args: unknown[]) => unknown) => (...args: unknown[]) => {
      const result = method.apply(api, args);
      if (!(result instanceof Promise)) return result;
      return result.then((reply: unknown) => {
        if (refusedForUpgrade(reply)) setPaused(true);
        return reply;
      });
    };
    // The client is frozen, so a Proxy may not substitute its methods; a copy with wrapped methods may.
    const entries = Object.entries(api).map(([key, value]) => [
      key,
      typeof value === 'function' ? watch(value as (...args: unknown[]) => unknown) : value,
    ]);
    return Object.freeze(Object.fromEntries(entries)) as ApiClient;
  }, [api]);
  return (
    <ApiContext.Provider value={watched}>
      <PausedContext.Provider value={paused}>{children}</PausedContext.Provider>
    </ApiContext.Provider>
  );
}
