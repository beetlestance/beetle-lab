import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { InputPage, InputRecord, Workspace } from '@beetle/contracts/api';
import { readResult, useApi } from '../../app/api.js';
import { queryKeys } from '../../app/queries.js';
import { Button } from '../../components/Button.js';
import { Pagination, usePage } from '../../components/Pagination.js';
import { QueryState } from '../../components/QueryState.js';
import { EmptyState, LoadingState } from '../../components/States.js';
import { InputStatus } from './InputStatus.js';
import { InputTable } from './InputTable.js';
import { formatBytes, plural } from './format.js';
import './inputs.css';

/** What the listed page tells header actions, such as the sample file's name check. */
export interface InventoryContext {
  readonly items: readonly InputRecord[];
  /** True only when the first page is also the last, so totals and name checks are exact. */
  readonly complete: boolean;
}

/** One mounted workspace owns one page and one current-status/deletion panel. */
interface InventoryProps {
  workspace: Workspace;
  renderActions?: (record: InputRecord) => ReactNode;
  /** Header actions (Upload files, Add a sample file); also offered by the empty state. */
  actions?: (context: InventoryContext) => ReactNode;
  children?: ReactNode;
}
export function InputInventory(props: InventoryProps) {
  const { workspace } = props;
  const identity = JSON.stringify(queryKeys.inputs(workspace.scope.organizationId, workspace.id));
  return <InventoryScope key={identity} {...props} />;
}

function InventoryScope({ workspace, children, actions, renderActions }: InventoryProps) {
  const api = useApi();
  const client = useQueryClient();
  const params = { organizationId: workspace.scope.organizationId, workspaceId: workspace.id };
  const key = queryKeys.inputs(params.organizationId, params.workspaceId);
  const identity = JSON.stringify(key);
  const page = usePage([...key, 'pages']);
  const [selected, select] = useState<string | null>(null);
  const query = useQuery({
    queryKey: [...key, 'pages', page.cursor],
    gcTime: 0,
    queryFn: ({ signal }) => readResult(api.listInputs({ params, query: page.query, signal })),
  });
  useEffect(
    () => () => {
      const prefix = JSON.parse(identity) as string[];
      void client.cancelQueries({ queryKey: prefix });
      client.removeQueries({ queryKey: prefix });
    },
    [client, identity],
  );
  const context = contextOf(query.data, page.hasBack);
  // A known-empty list offers its actions in the empty state; the header would only repeat them.
  const empty = query.data?.items.length === 0 && !page.hasBack;
  return (
    <section className="content-section input-inventory" aria-label="Input inventory">
      <header className="inputs-header">
        <div>
          <h2>Inputs</h2>
          <p className="inputs-summary">{summary(context, query.data !== undefined)}</p>
        </div>
        <div className="inputs-actions">
          {!empty && actions?.(context)}
          <Button variant="text" disabled={query.isFetching} onClick={() => void query.refetch()}>
            Refresh input list
          </Button>
        </div>
      </header>
      {children}
      <QueryState query={query} loading={<LoadingState label="Loading inputs…" variant="table" rows={4} />}>
        {(data) =>
          data.items.length === 0 && !page.hasBack ? (
            <EmptyState
              title="No input files yet"
              actions={actions?.(context)}
              note="Up to 8 MiB a file, sent in 64 KiB pieces, so a dropped connection can resume where it stopped."
            >
              Inputs are the files a suite reads: CSV rows to vary each request, and JSON bodies to send. Upload them
              once and every suite in this workspace can use them.
            </EmptyState>
          ) : (
            <>
              <InputTable
                workspace={workspace}
                items={data.items}
                selected={selected}
                select={select}
                filterFolders={!data.nextCursor && !page.hasBack}
              />
              <Pagination page={page} next={data.nextCursor} />
            </>
          )
        }
      </QueryState>
      {selected && (
        <InputStatus
          key={selected}
          params={{ ...params, inputId: selected }}
          close={() => select(null)}
          {...(renderActions ? { renderActions } : {})}
        />
      )}
    </section>
  );
}

function contextOf(data: InputPage | undefined, hasBack: boolean): InventoryContext {
  return { items: data?.items ?? [], complete: data !== undefined && data.nextCursor === null && !hasBack };
}

/** "5 files, 9.0 MB" only when the whole inventory is on screen; otherwise the page count. */
function summary(context: InventoryContext, loaded: boolean): string {
  if (!loaded) return 'Data files your suites read.';
  const live = context.items.filter((item) => item.state !== 'deleted');
  if (!context.complete) return `${plural(live.length, 'file')} on this page.`;
  const bytes = live.reduce((total, item) => total + item.bytes, 0);
  return `${plural(live.length, 'file')}, ${formatBytes(bytes)} in all. Suites read CSV rows and JSON bodies from here.`;
}
