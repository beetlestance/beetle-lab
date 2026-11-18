import { useEffect, useState } from 'react';

/** One clock for the visible folder table, regardless of its number of live rows. */
export function useRunClock(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    const tick = () => setNow(Date.now());
    const visibility = () => {
      clearInterval(timer);
      timer = undefined;
      if (document.visibilityState === 'visible') {
        tick();
        timer = setInterval(tick, 1000);
      }
    };
    visibility();
    document.addEventListener('visibilitychange', visibility);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [active]);
  return now;
}
