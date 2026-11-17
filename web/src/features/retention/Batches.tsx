import type { RetentionBatchList } from '@beetle/contracts/api';
import { Status } from '../../components/Badge.js';
import { Button } from '../../components/Button.js';
import { Table, Td } from '../../components/Table.js';
import { batchResult, formatTime, kindLabel, shortId } from './format.js';

const columns = [
  { key: 'started', label: 'Captured' },
  { key: 'kind', label: 'Kind' },
  { key: 'runs', label: 'Runs', numeric: true },
  { key: 'result', label: 'Result' },
  { key: 'open', label: 'Batch' },
] as const;

/**
 * Saved batches (at most eight). The board's "Freed" column is omitted: summaries
 * carry no settled bytes, and a status read per row would not be bounded to one view.
 */
export function SavedBatches({
  list,
  selected,
  blocked,
  select,
}: {
  list: RetentionBatchList;
  selected: string | null;
  blocked: boolean;
  select(id: string): void;
}) {
  if (list.items.length === 0) return <p className="retention-note">No saved batches.</p>;
  return (
    <Table caption="Saved retention batches" columns={columns} className="retention-table">
      {list.items.map((item) => {
        const result = batchResult(item);
        const current = item.id === selected;
        return (
          <tr key={item.id} aria-current={current ? 'true' : undefined}>
            <Td>
              <time dateTime={item.capturedAt}>{formatTime(item.capturedAt)}</time>
            </Td>
            <Td>{kindLabel(item.kind)}</Td>
            <Td numeric>{item.candidateCount}</Td>
            <Td>
              <Status tone={result.tone}>{result.label}</Status>
            </Td>
            <Td>
              <Button
                variant="text"
                size="sm"
                disabled={blocked || current}
                aria-label={`Open batch ${item.id}`}
                onClick={() => select(item.id)}
              >
                {current ? 'Showing' : `Open ${shortId(item.id)}`}
              </Button>
            </Td>
          </tr>
        );
      })}
    </Table>
  );
}
