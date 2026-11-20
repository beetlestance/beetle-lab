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
  const watched = useMemo(
    () =>
      new Proxy(api, {
        get(target, key, receiver) {
          const value: unknown = Reflect.get(target, key, receiver);
          if (typeof value !== 'function') return value;
          return (...args: unknown[]) => {
            const result: unknown = (value as (...a: unknown[]) => unknown).apply(target, args);
            if (!(result instanceof Promise)) return result;
            return result.then((reply: unknown) => {
              if (refusedForUpgrade(reply)) setPaused(true);
              return reply;
            });
          };
        },
      }) as ApiClient,
    [api],
  );
  return (
    <ApiContext.Provider value={watched}>
      <PausedContext.Provider value={paused}>{children}</PausedContext.Provider>
    </ApiContext.Provider>
  );
}
