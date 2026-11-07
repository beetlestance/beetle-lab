import type { ReactNode } from 'react';

export function ResourceTable({ title, headings, children, empty }: {
  title: string; headings: string[]; children: ReactNode; empty: boolean;
}) {
  if (empty) return <div className="notice"><h2>No {title.toLowerCase()} yet</h2><p>Create one to get started.</p></div>;
  return <div className="table-scroll"><table><caption className="sr-only">{title}</caption>
    <thead><tr>{headings.map(heading => <th key={heading} scope="col">{heading}</th>)}</tr></thead>
    <tbody>{children}</tbody>
  </table></div>;
}
