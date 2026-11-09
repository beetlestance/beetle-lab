import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { InputRecord, Workspace } from '@beetle/contracts/api';
import { readResult, useApi } from '../../app/api.js';
import { queryKeys } from '../../app/queries.js';
import { Pagination, usePage } from '../../components/Pagination.js';
import { QueryState } from '../../components/QueryState.js';
import { InputStatus } from './InputStatus.js';
import './inputs.css';

/** One mounted workspace owns one page and one current-status/deletion panel. */
export function InputInventory(props: { workspace: Workspace; renderActions?: (record: InputRecord) => ReactNode }) {
  const { workspace } = props;
  const identity = JSON.stringify(queryKeys.inputs(workspace.scope.organizationId, workspace.id));
  return <InventoryScope key={identity} {...props} />;
}

function InventoryScope({ workspace, ...actions }: { workspace: Workspace; renderActions?: (record: InputRecord) => ReactNode }) {
  const api = useApi();
  const client = useQueryClient();
  const params = { organizationId: workspace.scope.organizationId, workspaceId: workspace.id };
  const key = queryKeys.inputs(params.organizationId, params.workspaceId);
  const identity = JSON.stringify(key);
  const page = usePage([...key, 'pages']);
  const [selected, select] = useState<string | null>(null);
  const query = useQuery({ queryKey: [...key, 'pages', page.cursor], gcTime: 0,
    queryFn: ({ signal }) => readResult(api.listInputs({ params, query: page.query, signal })) });
  useEffect(() => () => {
    const prefix = JSON.parse(identity) as string[];
    void client.cancelQueries({ queryKey: prefix });
    client.removeQueries({ queryKey: prefix });
  }, [client, identity]);
  return <section className="content-section input-inventory" aria-label="Input inventory">
    <header className="section-header"><div><h1>Inputs</h1>
      <p>Inspect input metadata and current status. Deletion is explicit and may require cleanup.</p></div>
      <button disabled={query.isFetching} onClick={() => void query.refetch()}>Refresh input list</button>
    </header>
    <QueryState query={query}>{data => <>
      <InputTable items={data.items} selected={selected} select={select} />
      {!data.items.length && <p className="notice">No inputs in this workspace.</p>}
      <Pagination page={page} next={data.nextCursor} />
    </>}</QueryState>
    {selected && <InputStatus key={selected} params={{ ...params, inputId: selected }} close={() => select(null)} {...actions} />}
  </section>;
}

function InputTable({ items, selected, select }: {
  items: readonly InputRecord[]; selected: string | null; select: (id: string) => void;
}) {
  return <div className="table-scroll"><table><caption className="sr-only">Workspace inputs</caption>
    <thead><tr><th>Input</th><th>Listed state</th><th>Committed bytes</th><th>Version</th><th>Inspect</th></tr></thead>
    <tbody>{items.map(input => <tr key={input.id}>
      <th scope="row">{input.name}</th><td>{input.state}</td>
      <td className="number">{input.offset} / {input.bytes}</td><td className="number">{input.version}</td>
      <td><button disabled={selected !== null} onClick={() => select(input.id)}
        aria-label={`Read current status for ${input.name}`}>Current status</button></td>
    </tr>)}</tbody>
  </table></div>;
}
