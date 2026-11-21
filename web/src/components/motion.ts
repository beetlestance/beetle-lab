function durationMs(value: string): number {
  const time = /^((?:\d+\.?\d*|\.\d+))(ms|s)$/.exec(value.trim());
  if (!time) return 0;
  return Number(time[1]) * (time[2] === 's' ? 1000 : 1);
}

export function animationTiming(element: HTMLElement | null): KeyframeAnimationOptions | null {
  if (!element?.animate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return null;
  const style = getComputedStyle(element);
  const duration = durationMs(style.getPropertyValue('--motion-dissolve'));
  return Number.isFinite(duration) && duration > 0
    ? { duration, easing: style.getPropertyValue('--ease-out').trim() }
    : null;
}
