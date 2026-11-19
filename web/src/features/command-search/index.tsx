import { useEffect, useId, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { matching, navigation, searchContext } from './model.js';
import type { CommandItem, SearchContext } from './model.js';
import { useCommandItems } from './items.js';
import type { CommandGroup } from './items.js';
import { commandKeys } from './keyboard.js';
import './search.css';
export { useCommandNavigation } from './controller.js';
const RESULT_LIMIT = 40;
export function CommandPalette({ pathname, close }: { pathname: string; close: (navigate?: boolean) => void }) {
  const context = searchContext(pathname);
  return context.organizationId ? (
    <ScopedPalette context={context} close={close} organizationId={context.organizationId} />
  ) : (
    <Palette context={context} groups={[]} close={close} />
  );
}
function ScopedPalette({
  context,
  close,
  organizationId,
}: {
  context: SearchContext;
  close: (navigate?: boolean) => void;
  organizationId: string;
}) {
  const groups = useCommandItems(organizationId, context.workspaceId);
  return <Palette context={context} groups={groups} close={close} />;
}
/**
 * A typed query that names a suite also offers "Start <suite>", which opens the
 * suite where its Start run control lives (navigation only, nothing starts here).
 */
export function withActions(items: readonly CommandItem[], query: string): CommandItem[] {
  if (!query.trim()) return items.slice(0, RESULT_LIMIT);
  return items
    .flatMap((item) =>
      item.id.startsWith('suite:')
        ? [item, { id: 'start:' + item.id, label: 'Start ' + item.label, description: 'Action', path: item.path }]
        : [item],
    )
    .slice(0, RESULT_LIMIT);
}
type PaletteProps = { context: SearchContext; groups: CommandGroup[]; close: (navigate?: boolean) => void };
/** Keeps focus inside the dialog: initial focus, outside focus, and a refreshed group removing the focused link. */
function useFocusInside(dialog: RefObject<HTMLDivElement | null>, input: RefObject<HTMLInputElement | null>) {
  useEffect(() => {
    input.current?.focus();
    const focus = (event: FocusEvent) => {
      if (event.target instanceof Node && !dialog.current?.contains(event.target)) input.current?.focus();
    };
    document.addEventListener('focusin', focus);
    return () => document.removeEventListener('focusin', focus);
  }, [dialog, input]);
  useEffect(() => {
    if (dialog.current && !dialog.current.contains(document.activeElement)) input.current?.focus();
  });
}
function MatchNotes({ shown, total }: { shown: number; total: number }) {
  return (
    <>
      <p role="status" className="sr-only">
        {shown} of {total} matches.
      </p>
      {!total && <p className="command-empty">No matching commands or loaded items.</p>}
      {total > shown && (
        <p className="command-note">
          Showing {shown} of {total} matches. Type more to narrow them.
        </p>
      )}
    </>
  );
}
function Palette({ context, groups, close }: PaletteProps) {
  const heading = useId();
  const search = useId();
  const hint = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const navigate = useNavigate();
  const matches = matching([...navigation(context), ...groups.flatMap((group) => group.items)], query);
  const results = withActions(matches.items, query);
  useFocusInside(dialog, input);
  const pick = (item: CommandItem | undefined) => {
    if (item) {
      close(true);
      void navigate(item.path);
    }
  };
  return (
    <div
      className="command-mask"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      {/* eslint-disable-next-line jsx-a11y-x/no-noninteractive-element-interactions -- The dialog traps Tab and routes arrow keys to its results list. */}
      <div
        ref={dialog}
        className="command-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={heading}
        aria-describedby={hint}
        onKeyDown={(event) => {
          if (dialog.current && input.current)
            commandKeys(
              event,
              dialog.current,
              input.current,
              () => pick(results[0]),
              () => close(),
            );
        }}
      >
        <h2 id={heading} className="sr-only">
          Search commands
        </h2>
        <label htmlFor={search} className="sr-only">
          Search commands and recent items
        </label>
        <input
          ref={input}
          data-command-input
          id={search}
          type="search"
          className="command-input"
          placeholder="Search suites, runs and pages"
          autoComplete="off"
          maxLength={128}
          value={query}
          onChange={(event) => setQuery(event.target.value.slice(0, 128))}
        />
        <CommandResults items={results} query={query} close={close} />
        <MatchNotes shown={matches.items.length} total={matches.total} />
        <CommandGroups groups={groups} />
        <p id={hint} className="command-hint">
          <span aria-hidden="true">↑↓</span> to move, Enter to open, Esc to close. Searches the first 100 items of each
          list here.
        </p>
      </div>
    </div>
  );
}

function CommandGroups({ groups }: { groups: CommandGroup[] }) {
  const notes = groups.filter((group) => group.active && (group.loading || group.error || group.more));
  if (!notes.length) return null;
  return (
    <div className="command-groups">
      {notes.map((group) => (
        <div key={group.name} className="command-group">
          {group.loading && <p role="status">Loading {group.name}…</p>}
          {group.error && <p role="alert">Recent {group.name} could not be loaded.</p>}
          {group.more && <p>More {group.name} are available in the list view.</p>}
          {group.error && (
            <button
              type="button"
              className="command-retry"
              disabled={group.loading}
              onClick={() => void group.refresh()}
            >
              Retry recent {group.name}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

/** The label with the first case-insensitive match of the query in bold. */
function Highlight({ text, query }: { text: string; query: string }) {
  const needle = query.trim().toLowerCase();
  const at = needle ? text.toLowerCase().indexOf(needle) : -1;
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <strong>{text.slice(at, at + needle.length)}</strong>
      {text.slice(at + needle.length)}
    </>
  );
}

function CommandResults({
  items,
  query,
  close,
}: {
  items: CommandItem[];
  query: string;
  close(navigate?: boolean): void;
}) {
  return (
    <nav aria-label="Command search results">
      <ul className="command-results" role="list">
        {items.map((item) => (
          <li key={item.id}>
            <Link
              data-command-result
              to={item.path}
              onClick={(event) => {
                if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey)
                  close(true);
              }}
            >
              <span className="command-label">
                <Highlight text={item.label} query={query} />
              </span>
              <small>{item.description}</small>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
