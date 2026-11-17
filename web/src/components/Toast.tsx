import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import './primitives.css';

type ToastEntry = { id: number; message: string };
type ToastApi = { show: (message: string) => void };

const ToastContext = createContext<ToastApi | null>(null);
const visibleMs = 5000;
const maxToasts = 3;

/**
 * Owns the single polite live region for confirmations ("Run c3d1 is pinned.").
 * A toast confirms an outcome the backend has recorded; never use it for
 * hand-offs, progress or errors (errors stay inline next to their cause).
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const next = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const dismiss = useCallback((id: number) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);
  const show = useCallback(
    (message: string) => {
      const id = ++next.current;
      setToasts((current) => [...current, { id, message }].slice(-maxToasts));
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), visibleMs),
      );
    },
    [dismiss],
  );
  useEffect(() => {
    const owned = timers.current;
    return () => owned.forEach((timer) => clearTimeout(timer));
  }, []);
  const api = useMemo(() => ({ show }), [show]);
  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-region" aria-live="polite">
        {toasts.map((toast) => (
          <p key={toast.id} className="toast">
            {toast.message}
          </p>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** Returns `show(message)`; a no-op outside ToastProvider (for isolated feature tests). */
export function useToast(): ToastApi {
  return useContext(ToastContext) ?? noop;
}
const noop: ToastApi = { show: () => undefined };
