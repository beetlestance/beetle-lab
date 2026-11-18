import { useEffect, useId, useRef } from 'react';
import type { KeyboardEvent, ReactNode, RefObject } from 'react';
import { createPortal } from 'react-dom';
import './primitives.css';

const focusable =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function trapTab(event: KeyboardEvent<HTMLElement>, container: HTMLElement) {
  const nodes = [...container.querySelectorAll<HTMLElement>(focusable)];
  if (nodes.length === 0) {
    event.preventDefault();
    container.focus();
    return;
  }
  const first = nodes[0]!;
  const last = nodes.at(-1)!;
  const active = document.activeElement;
  if (event.shiftKey && (active === first || active === container)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

/** Makes everything outside the dialog inert while it is open; returns the cleanup. */
function isolate(host: HTMLElement) {
  const siblings = [...document.body.children].filter(
    (node): node is HTMLElement => node instanceof HTMLElement && node !== host && !node.inert,
  );
  const overflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  siblings.forEach((node) => (node.inert = true));
  return () => {
    document.body.style.overflow = overflow;
    siblings.forEach((node) => (node.inert = false));
  };
}

function restoreFocus(invoker: Element | null) {
  if (invoker instanceof HTMLElement && invoker.isConnected) invoker.focus();
  else document.getElementById('main')?.focus();
}

export type DialogProps = {
  className?: string;
  title: ReactNode;
  /** Called on Escape, backdrop press and by your own cancel button. */
  onClose: () => void;
  description?: ReactNode | undefined;
  children?: ReactNode | undefined;
  /** Buttons row; put the safe action first. */
  actions?: ReactNode | undefined;
  /** Element to focus on open; defaults to the first focusable element. */
  initialFocus?: RefObject<HTMLElement | null> | undefined;
  /** Alert dialogs (destructive confirmations) use role alertdialog. */
  role?: 'dialog' | 'alertdialog' | undefined;
  /** Disables Escape and backdrop close, for example while a request is in flight. */
  dismissible?: boolean | undefined;
};

/**
 * Modal dialog. Mount it to open it, unmount to close. Traps Tab, closes on Escape,
 * makes the rest of the page inert and returns focus to the invoker (or #main).
 */
export function Dialog({
  title,
  className,
  onClose,
  description,
  children,
  actions,
  initialFocus,
  role = 'dialog',
  dismissible = true,
}: DialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  if (hostRef.current === null && typeof document !== 'undefined') hostRef.current = document.createElement('div');
  useEffect(() => {
    const host = hostRef.current!;
    const invoker = document.activeElement;
    document.body.appendChild(host);
    const release = isolate(host);
    const target = initialFocus?.current ?? ref.current?.querySelector<HTMLElement>(focusable) ?? ref.current;
    target?.focus();
    return () => {
      release();
      host.remove();
      restoreFocus(invoker);
    };
    // Open once per mount; later prop changes do not move focus.
  }, []);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && dismissible) {
      event.stopPropagation();
      onClose();
    } else if (event.key === 'Tab' && ref.current) trapTab(event, ref.current);
  };
  return createPortal(
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && dismissible) onClose();
      }}
    >
      <div
        ref={ref}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={['dialog', className].filter(Boolean).join(' ')}
        onKeyDown={onKeyDown}
      >
        <div className="dialog-handle" aria-hidden="true" />
        <h2 id={titleId} className="dialog-title">
          {title}
        </h2>
        {description && (
          <div id={descriptionId} className="dialog-description">
            {description}
          </div>
        )}
        {children}
        {actions && <div className="dialog-actions">{actions}</div>}
      </div>
    </div>,
    hostRef.current!,
  );
}
