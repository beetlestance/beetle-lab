import { useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { routes } from '../app/routes.js';

function durationMs(value: string): number {
  const time = /^((?:\d+\.?\d*|\.\d+))(ms|s)$/.exec(value.trim());
  if (!time) return 0;
  return Number(time[1]) * (time[2] === 's' ? 1000 : 1);
}

export function useNavigationMotion(key: string) {
  const element = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = element.current;
    if (!node?.animate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const style = getComputedStyle(node);
    const duration = durationMs(style.getPropertyValue('--motion-base'));
    if (!Number.isFinite(duration) || duration <= 0) return;
    const animation = node.animate([{ opacity: 0.65 }, { opacity: 1 }], {
      duration,
      easing: style.getPropertyValue('--ease-out').trim(),
    });
    return () => animation.cancel();
  }, [key]);
  return element;
}

export function PageTransition({ children }: { children: ReactNode }) {
  const { pathname, search } = useLocation();
  const motion = useNavigationMotion(pathname === routes.settings ? pathname + search : pathname);
  return <div ref={motion}>{children}</div>;
}
