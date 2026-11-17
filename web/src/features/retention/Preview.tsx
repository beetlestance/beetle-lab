import { useState } from 'react';
import type { ProtectedExclusion, RetentionPreview } from '@beetle/contracts/api';
import { Button } from '../../components/Button.js';
import { Table, Td } from '../../components/Table.js';
import { bytes, clock, exclusionLine, exclusionTotal, policySentence, reasonLabel, runs, shortId } from './format.js';

/** Rows shown before "…and N more", as on the Retention preview board. */
const FIRST_ROWS = 7;

/** Heading and rule sentence of Settings / Workspace / Retention preview. */
export function PreviewIntro({ preview }: { preview: RetentionPreview }) {
  const count = preview.candidates.length;
  const rule = preview.kind === 'manual' ? 'Deleting one run by hand.' : policySentence(preview.policy);
  return (
    <header className="retention-intro">
      <h3>{count === 0 ? 'Preview: no runs would be removed' : `Preview: ${runs(count)} would be removed`}</h3>
      <p>
        {rule} Checked at <time dateTime={preview.capturedAt}>{clock(preview.capturedAt)}</time>. Nothing is removed
        until you apply, and this preview expires at{' '}
        <time dateTime={preview.expiresAt}>{clock(preview.expiresAt)}</time>.
      </p>
    </header>
  );
}

/** Totals, candidate table and protected exclusions of one immutable preview page. */
export function SnapshotSummary({ preview }: { preview: RetentionPreview }) {
  return (
    <>
      <dl className="retention-stats">
        <Stat label="Would remove" value={runs(preview.candidates.length)} />
        <Stat
          label="Would free (estimate)"
          value={bytes(preview.estimatedBytes)}
          note="Logical bytes counted against storage; disk space is reclaimed separately."
        />
        <Stat label="Kept by protection" value={exclusionTotal(preview.protectedExclusions)} tone="pass" />
      </dl>
      {preview.candidates.length > 0 && <Candidates preview={preview} />}
      <p className="retention-note">
        Scanned {runs(preview.scanned)} in this window.
        {preview.nextCursor
          ? ' Older runs are in the next window and are not part of this preview.'
          : ' No further window was reported.'}
      </p>
      <Protected items={preview.protectedExclusions} />
    </>
  );
}

function Stat({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: 'pass' }) {
  return (
    <div className="retention-stat">
      <dt>{label}</dt>
      <dd className={tone === 'pass' ? 'retention-stat-pass' : undefined}>{value}</dd>
      {note && <dd className="retention-stat-note">{note}</dd>}
    </div>
  );
}

const columns = [
  { key: 'run', label: 'Run' },
  { key: 'version', label: 'Version', numeric: true },
  { key: 'size', label: 'Size (estimate)', numeric: true },
  { key: 'why', label: 'Why' },
] as const;

function Candidates({ preview }: { preview: RetentionPreview }) {
  const [all, setAll] = useState(false);
  const shown = all ? preview.candidates : preview.candidates.slice(0, FIRST_ROWS);
  const hidden = preview.candidates.length - shown.length;
  return (
    <Table caption="Runs this preview would remove" columns={columns} className="retention-table">
      {shown.map((item) => (
        <tr key={item.id}>
          <Td title={item.id}>
            <span className="retention-run">{shortId(item.id)}</span>
            <span className="sr-only"> ({item.id})</span>
          </Td>
          <Td numeric>{item.version}</Td>
          <Td numeric>{bytes(item.estimatedBytes)}</Td>
          <Td>{reasonLabel(item.reason, preview.policy)}</Td>
        </tr>
      ))}
      {hidden > 0 && (
        <tr>
          <Td muted colSpan={columns.length}>
            …and {hidden} more.{' '}
            <Button variant="text" size="sm" onClick={() => setAll(true)}>
              Show all {preview.candidates.length}
            </Button>
          </Td>
        </tr>
      )}
    </Table>
  );
}

function Protected({ items }: { items: readonly ProtectedExclusion[] }) {
  const groups = items.filter((item) => item.count > 0);
  if (groups.length === 0) return null;
  return (
    <section className="retention-protected" aria-label="Never removed by this preview">
      <h4>Never removed by this preview</h4>
      <ul>
        {groups.map((item) => {
          const line = exclusionLine(item);
          return (
            <li key={item.reason}>
              <span>{line.title}</span>
              <span className="retention-muted">{line.note}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
