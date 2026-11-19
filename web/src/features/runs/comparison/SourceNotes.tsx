import { Fragment, type ReactNode } from 'react';

export interface ComparisonSourceNote {
  readonly id: string;
  readonly attention: boolean;
  readonly content: ReactNode;
}

/** Healthy provenance stays inspectable; uncertainty is never hidden in details. */
export function ComparisonSourceNotes({
  notes,
  extra,
}: {
  notes: readonly ComparisonSourceNote[];
  extra?: readonly ReactNode[];
}) {
  const details = notes.filter((note) => !note.attention);
  return (
    <div className="compare-muted">
      {notes
        .filter((note) => note.attention)
        .map((note) => (
          <Fragment key={note.id}>{note.content}</Fragment>
        ))}
      {(details.length > 0 || Boolean(extra?.length)) && (
        <details className="compare-evidence compare-source-details">
          <summary>Recorded source details</summary>
          {details.map((note) => (
            <Fragment key={note.id}>{note.content}</Fragment>
          ))}
          {extra}
        </details>
      )}
    </div>
  );
}
