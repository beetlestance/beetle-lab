import type { ReactNode, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import './primitives.css';

export type TableColumn = {
  key: string;
  label: ReactNode;
  /** Right-aligns header and cells with tabular figures. */
  numeric?: boolean | undefined;
  /** Marks the sorted column; the header shows the direction arrow. */
  sort?: 'ascending' | 'descending' | undefined;
};

/**
 * Data table: panel header row, zebra rows, rounded scroll container. Rows are
 * plain <tr> elements with Td cells; pass `numeric` on number cells.
 */
export function Table({
  caption,
  columns,
  children,
  captionVisible = false,
  className,
  scrollLabel,
}: {
  caption: string;
  columns: readonly TableColumn[];
  children: ReactNode;
  captionVisible?: boolean | undefined;
  className?: string | undefined;
  /** Names a keyboard-focusable horizontal scroll region when the table is wide. */
  scrollLabel?: string | undefined;
}) {
  return (
    <div
      className={['data-table-scroll', className].filter(Boolean).join(' ')}
      role={scrollLabel ? 'region' : undefined}
      aria-label={scrollLabel}
      tabIndex={scrollLabel ? 0 : undefined}
    >
      <table className="data-table">
        <caption className={captionVisible ? undefined : 'sr-only'}>{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <Th key={column.key} numeric={column.numeric} aria-sort={column.sort}>
                {column.label}
                {column.sort && <span aria-hidden="true">{column.sort === 'descending' ? ' ↓' : ' ↑'}</span>}
              </Th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Th({
  numeric,
  className,
  ...rest
}: ThHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean | undefined }) {
  return (
    <th
      scope="col"
      {...rest}
      className={[numeric ? 'numeric' : '', className].filter(Boolean).join(' ') || undefined}
    />
  );
}

/** Table cell. `numeric` right-aligns with tabular figures; `muted` uses secondary ink. */
export function Td({
  numeric,
  muted,
  className,
  ...rest
}: TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean | undefined; muted?: boolean | undefined }) {
  const classes = [numeric ? 'numeric' : '', muted ? 'muted' : '', className].filter(Boolean).join(' ');
  return <td {...rest} className={classes || undefined} />;
}
