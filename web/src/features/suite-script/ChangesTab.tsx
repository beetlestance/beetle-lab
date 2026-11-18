import { useState } from 'react';
import type { SuiteRevision } from '@beetle/contracts/api';
import { ComparisonStatus } from './ComparisonStatus.js';
import type { Comparison, Layout } from './comparison-model.js';
import { hunks, sideBySide } from './diff.js';
import type { Diff, DiffLine, Hunk } from './diff.js';

const marks = { same: ' ', add: '+', del: '−' } as const;

function UnifiedRows({ lines }: { lines: readonly DiffLine[] }) {
  return lines.map((line, index) => (
    <tr key={index} className={`diff-${line.kind}`}>
      <td className="diff-number">{line.kind === 'add' ? '' : line.left}</td>
      <td className="diff-number">{line.kind === 'del' ? '' : line.right}</td>
      <td
        className="diff-mark"
        aria-label={line.kind === 'same' ? undefined : line.kind === 'add' ? 'added' : 'removed'}
      >
        {marks[line.kind]}
      </td>
      <td className="diff-text">
        <code>{line.text || ' '}</code>
      </td>
    </tr>
  ));
}

function Cell({ line, side }: { line: DiffLine | null; side: 'left' | 'right' }) {
  if (!line) return <td className="diff-empty" colSpan={2} />;
  const number = side === 'left' ? (line.kind === 'add' ? '' : line.left) : line.kind === 'del' ? '' : line.right;
  return (
    <>
      <td className="diff-number">{number}</td>
      <td className={`diff-text diff-${line.kind}`}>
        <code>{line.text || ' '}</code>
      </td>
    </>
  );
}

function SplitRows({ lines }: { lines: readonly DiffLine[] }) {
  return sideBySide(lines).map(([left, right], index) => (
    <tr key={index}>
      <Cell line={left} side="left" />
      <Cell line={right} side="right" />
    </tr>
  ));
}

function DiffTable({
  diff,
  layout,
  caption,
  before,
  after,
}: {
  diff: Diff;
  layout: Layout;
  caption: string;
  before: number;
  after: number;
}) {
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set());
  const parts: Hunk[] = hunks(diff.lines);
  return (
    <div className="diff-scroll">
      <table className={`diff-table diff-${layout}`}>
        <caption className="sr-only">{caption}</caption>
        <colgroup>
          {layout === 'split' ? (
            <>
              <col style={{ width: 40 }} />
              <col />
              <col style={{ width: 40 }} />
              <col />
            </>
          ) : (
            <>
              <col style={{ width: 34 }} />
              <col style={{ width: 34 }} />
              <col style={{ width: 24 }} />
              <col />
            </>
          )}
        </colgroup>
        <thead>
          <tr>
            {layout === 'split' ? (
              <>
                <th colSpan={2}>Revision {before}</th>
                <th colSpan={2}>Revision {after}</th>
              </>
            ) : (
              <th colSpan={4}>{caption}</th>
            )}
          </tr>
        </thead>
        <tbody>
          {parts.map((part, index) =>
            part.kind === 'fold' && !open.has(index) ? (
              <tr key={index} className="diff-fold">
                <td colSpan={4}>
                  <button type="button" onClick={() => setOpen(new Set([...open, index]))}>
                    Show {part.lines.length} unchanged lines
                  </button>
                </td>
              </tr>
            ) : layout === 'split' ? (
              <SplitRows key={index} lines={part.lines} />
            ) : (
              <UnifiedRows key={index} lines={part.lines} />
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}

function DiffResult({ comparison, diff, layout }: { comparison: Comparison; diff: Diff; layout: Layout }) {
  const heading = comparison.other ? `Revision ${comparison.other.ordinal} → revision ${comparison.ordinal}` : '';
  return (
    <>
      <p className="script-diff-summary">
        {heading} · {diff.added} {diff.added === 1 ? 'line' : 'lines'} added, {diff.removed} removed
      </p>
      {comparison.changes.length > 0 && (
        <ul className="script-bullets">
          {comparison.changes.map((change) => (
            <li key={change}>{change}</li>
          ))}
        </ul>
      )}
      <DiffTable
        key={`${comparison.otherId}-${layout}`}
        diff={diff}
        layout={layout}
        caption={`${heading}${layout === 'unified' ? ', one column' : ''}`}
        before={comparison.other!.ordinal}
        after={comparison.ordinal}
      />
    </>
  );
}

/** Verified exported JavaScript, with independent summaries from the saved configurations. */
export function ChangesTab({
  comparison,
  layout,
  revision,
  openCurrent,
}: {
  comparison: Comparison;
  layout: Layout;
  revision: SuiteRevision;
  openCurrent(): void;
}) {
  return (
    <div className="script-changes">
      {comparison.status === 'ready' && comparison.diff ? (
        <DiffResult comparison={comparison} diff={comparison.diff} layout={layout} />
      ) : (
        <ComparisonStatus comparison={comparison} revision={revision} openCurrent={openCurrent} />
      )}
    </div>
  );
}
