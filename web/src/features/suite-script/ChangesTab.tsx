import { useState } from 'react';
import type { SuiteRevisionSummary } from '@beetle/contracts/api';
import { Select } from '../../components/Fields.js';
import { SegmentedFilter } from '../../components/SegmentedFilter.js';
import { LoadingState } from '../../components/States.js';
import { hunks, sideBySide } from './diff.js';
import type { Diff, DiffLine, Hunk } from './diff.js';

export type Comparison = {
  ordinal: number;
  other: { ordinal: number } | undefined;
  choices: readonly SuiteRevisionSummary[];
  otherId: string;
  setOtherId: (id: string) => void;
  diff: Diff | null | undefined;
  changes: readonly string[];
  failed: boolean;
};
type Layout = 'split' | 'unified';
const marks = { same: ' ', add: '+', del: '−' } as const;

function UnifiedRows({ lines }: { lines: readonly DiffLine[] }) {
  return lines.map((line, index) => (
    <tr key={index} className={`diff-${line.kind}`}>
      <td
        className="diff-mark"
        aria-label={line.kind === 'same' ? undefined : line.kind === 'add' ? 'added' : 'removed'}
      >
        {marks[line.kind]}
      </td>
      <td className="diff-number">{line.kind === 'add' ? '' : line.left}</td>
      <td className="diff-number">{line.kind === 'del' ? '' : line.right}</td>
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

function DiffTable({ diff, layout, caption }: { diff: Diff; layout: Layout; caption: string }) {
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set());
  const parts: Hunk[] = hunks(diff.lines);
  return (
    <div className="diff-scroll">
      <table className={`diff-table diff-${layout}`}>
        <caption className="sr-only">{caption}</caption>
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
      <p className="script-note">Lines are from the saved configuration JSON, not the generated script.</p>
      <DiffTable
        key={`${comparison.otherId}-${layout}`}
        diff={diff}
        layout={layout}
        caption={`${heading}${layout === 'unified' ? ', one column' : ''}`}
      />
    </>
  );
}

function DiffStatus({ comparison }: { comparison: Comparison }) {
  if (comparison.failed)
    return (
      <p role="alert" className="field-error">
        The other revision could not be read.
      </p>
    );
  if (comparison.diff === undefined) return <LoadingState label="Comparing revisions…" />;
  return <p className="script-note">These configurations are too large to compare here.</p>;
}

/** "Script / … / Changes" (and One column): a line diff of the two saved configurations. */
export function ChangesTab({ comparison }: { comparison: Comparison }) {
  const [layout, setLayout] = useState<Layout>('split');
  const { choices, otherId, setOtherId, diff } = comparison;
  if (!choices.length) return <p className="script-note">This is the only revision, so there is nothing to compare.</p>;
  return (
    <div className="script-changes">
      <div className="script-toolbar">
        <SegmentedFilter<Layout>
          label="Diff layout"
          value={layout}
          onChange={setLayout}
          options={[
            { value: 'split', label: 'Side by side' },
            { value: 'unified', label: 'One column' },
          ]}
        />
        <Select label="Compare with" value={otherId} onChange={(event) => setOtherId(event.target.value)}>
          {choices.map((choice) => (
            <option key={choice.id} value={choice.id}>
              Revision {choice.ordinal}
            </option>
          ))}
        </Select>
      </div>
      {diff && !comparison.failed ? (
        <DiffResult comparison={comparison} diff={diff} layout={layout} />
      ) : (
        <DiffStatus comparison={comparison} />
      )}
    </div>
  );
}
