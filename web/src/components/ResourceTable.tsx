import type { ReactNode } from 'react';
import { EmptyState } from './States.js';
import './primitives.css';

/** Legacy list table used by namespace screens; new code uses Table with typed columns. */
export function ResourceTable({
  title,
  headings,
  children,
  empty,
}: {
  title: string;
  headings: string[];
  children: ReactNode;
  empty: boolean;
}) {
  if (empty)
    return (
      <EmptyState compact title={`No ${title.toLowerCase()} yet`}>
        Create one to get started.
      </EmptyState>
    );
  return (
    <div className="data-table-scroll">
      <table className="data-table">
        <caption className="sr-only">{title}</caption>
        <thead>
          <tr>
            {headings.map((heading) => (
              <th key={heading} scope="col">
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
