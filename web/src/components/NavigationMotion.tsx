import { useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { animationTiming } from './motion.js';

export function useNavigationMotion(key: string) {
  const element = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = element.current;
    const timing = animationTiming(node);
    if (!node || !timing) return;
    const animation = node.animate([{ opacity: 0 }, { opacity: 1 }], timing);
    return () => animation.cancel();
  }, [key]);
  return element;
}

export function PageTransition({ children }: { children: ReactNode }) {
  const { pathname, search } = useLocation();
  const motion = useNavigationMotion(pathname.endsWith('/settings') ? pathname + search : pathname);
  return <div ref={motion}>{children}</div>;
}
