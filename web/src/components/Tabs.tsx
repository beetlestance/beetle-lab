import { useRef } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import './primitives.css';

export type TabItem<T extends string> = {
  id: T;
  label: ReactNode;
  count?: ReactNode | undefined;
  disabled?: boolean | undefined;
};

/** Moves focus between enabled buttons with arrows, Home and End; returns the target index. */
export function rovingIndex(event: KeyboardEvent, current: number, enabled: readonly boolean[]): number | undefined {
  const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
  const count = enabled.length;
  const order =
    event.key === 'Home'
      ? [...enabled.keys()]
      : event.key === 'End'
        ? [...enabled.keys()].reverse()
        : step
          ? Array.from({ length: count - 1 }, (_, offset) => (current + step * (offset + 1) + count * count) % count)
          : [];
  return order.find((index) => enabled[index]);
}

export function tabId(base: string, id: string) {
  return `${base}-tab-${id}`;
}
export function panelId(base: string, id: string) {
  return `${base}-panel-${id}`;
}

/**
 * In-page tabs (role tablist). Selected uses the pressed fill; disabled tabs are for
 * sections a record does not have. Render the panel with TabPanel and the same idBase.
 */
export function Tabs<T extends string>({
  label,
  items,
  selected,
  onSelect,
  idBase,
  size = 'md',
}: {
  label: string;
  items: readonly TabItem<T>[];
  selected: T;
  onSelect: (id: T) => void;
  idBase: string;
  size?: 'md' | 'sm' | undefined;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKeyDown = (event: KeyboardEvent, index: number) => {
    const next = rovingIndex(
      event,
      index,
      items.map((item) => !item.disabled),
    );
    if (next === undefined) return;
    event.preventDefault();
    refs.current[next]?.focus();
    onSelect(items[next]!.id);
  };
  return (
    <div role="tablist" aria-label={label} className={size === 'sm' ? 'tabs tabs-sm' : 'tabs'}>
      {items.map((item, index) => (
        <button
          key={item.id}
          ref={(node) => {
            refs.current[index] = node;
          }}
          type="button"
          role="tab"
          id={tabId(idBase, item.id)}
          aria-controls={panelId(idBase, item.id)}
          aria-selected={item.id === selected}
          tabIndex={item.id === selected ? 0 : -1}
          disabled={item.disabled}
          className="tab"
          onClick={() => onSelect(item.id)}
          onKeyDown={(event) => onKeyDown(event, index)}
        >
          {item.label}
          {item.count !== undefined && (
            <>
              {' '}
              <span className="tab-count">{item.count}</span>
            </>
          )}
        </button>
      ))}
    </div>
  );
}

export function TabPanel({ idBase, id, children }: { idBase: string; id: string; children: ReactNode }) {
  return (
    <div role="tabpanel" id={panelId(idBase, id)} aria-labelledby={tabId(idBase, id)} tabIndex={0}>
      {children}
    </div>
  );
}

export type NavTabItem = { to: string; label: ReactNode; current: boolean; count?: ReactNode | undefined };

/** Tabs that navigate (for example a workspace's Suites, Runs, Inputs, Settings). */
export function NavTabs({
  label,
  items,
  size = 'sm',
}: {
  label: string;
  items: readonly NavTabItem[];
  size?: 'md' | 'sm' | undefined;
}) {
  return (
    <nav aria-label={label}>
      <ul className={size === 'sm' ? 'tabs tabs-sm' : 'tabs'} role="list">
        {items.map((item) => (
          <li key={item.to}>
            <Link className="tab" to={item.to} aria-current={item.current ? 'page' : undefined}>
              {item.label}
              {item.count !== undefined && (
                <>
                  {' '}
                  <span className="tab-count">{item.count}</span>
                </>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
