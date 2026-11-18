import type { ButtonHTMLAttributes, MouseEvent, ReactNode } from 'react';
import './primitives.css';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'inverse' | 'text';
export type ButtonSize = 'md' | 'sm';

/** Class names for a link or other element that should look like a button. */
export function buttonClass(variant: ButtonVariant = 'secondary', size: ButtonSize = 'md', extra?: string) {
  return ['btn', `btn-${variant}`, size === 'sm' ? 'btn-sm' : '', extra ?? ''].filter(Boolean).join(' ');
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant | undefined;
  size?: ButtonSize | undefined;
  /** Blocks a second press and shows `loadingLabel` (the -ing form) without changing width. */
  loading?: boolean | undefined;
  loadingLabel?: ReactNode | undefined;
};

/**
 * Primary, secondary, danger or text button. Loading keeps focus, sets aria-busy and
 * aria-disabled, and swallows clicks; disabled uses the native attribute.
 */
export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  loadingLabel,
  className,
  children,
  onClick,
  type = 'button',
  ...rest
}: ButtonProps) {
  const guarded = (event: MouseEvent<HTMLButtonElement>) => {
    if (loading) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  };
  return (
    <button
      {...rest}
      type={type}
      className={buttonClass(variant, size, className)}
      onClick={guarded}
      {...(loading ? { 'aria-busy': true, 'aria-disabled': true } : {})}
    >
      {loadingLabel === undefined ? (
        children
      ) : (
        <span className="btn-labels">
          <span {...(loading ? { 'data-hidden': '', 'aria-hidden': true } : {})}>{children}</span>
          <span {...(loading ? {} : { 'data-hidden': '', 'aria-hidden': true })}>
            <span className="spinner" aria-hidden="true">
              ◌
            </span>
            {loadingLabel}
          </span>
        </span>
      )}
    </button>
  );
}
