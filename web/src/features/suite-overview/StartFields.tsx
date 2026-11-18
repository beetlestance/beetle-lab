import { useMemo, useState } from 'react';
import type { Suite, SuiteRevision, WorkspaceSettings } from '@beetle/contracts/api';
import { Button } from '../../components/Button.js';
import { Select, TextInput } from '../../components/Fields.js';
import type { RunValues } from '../execution-request/index.js';
import { LoadShape } from './LoadShape.js';
import { clock, planSummary } from './plan.js';
import type { FriendlyKey } from './budget.js';
import {
  budgetSentence,
  defaultBudget,
  friendly,
  friendlyValues,
  fromFriendly,
  limitText,
  sourceText,
  toFriendly,
} from './budget.js';

/** Friendly budget text for this run. Only edited fields are converted back; the rest keep their exact API value. */
export function useBudgetDraft(values: RunValues) {
  const [text, setText] = useState(() => friendlyValues(values));
  const [edited, setEdited] = useState<ReadonlySet<FriendlyKey>>(new Set());
  const budget = { ...values.budget };
  for (const key of edited) budget[key] = fromFriendly(key, text[key]);
  const change = (key: FriendlyKey, value: string) => {
    setText({ ...text, [key]: value });
    setEdited(new Set([...edited, key]));
  };
  return { text, budget, change };
}
export function RevisionSelect({
  suite,
  options,
  value,
  onChange,
}: {
  suite: Suite;
  options: readonly Pick<SuiteRevision, 'id' | 'ordinal' | 'message'>[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <Select label="Revision" value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map((item) => (
        <option key={item.id} value={item.id}>
          {`Revision ${item.ordinal}${item.message ? `: ${item.message}` : ''}${item.id === suite.currentRevisionId ? ' (latest)' : ''}`}
        </option>
      ))}
    </Select>
  );
}
export function BudgetFacts({
  settings,
  workspaceName,
  changing,
  change,
  target,
  revision,
  limitMs,
}: {
  settings: WorkspaceSettings;
  workspaceName: string;
  changing: boolean;
  change: () => void;
  target: string | null;
  revision: SuiteRevision | undefined;
  limitMs: number;
}) {
  const total = useMemo(() => (revision ? planSummary(revision.config).totalMs : null), [revision]);
  return (
    <dl className="start-run-facts">
      <dt>Length</dt>
      <dd>{lengthText(total, limitMs)}</dd>
      <dt>Budget</dt>
      <dd>
        {changing ? (
          'Set for this run only. Settings stay as they are.'
        ) : (
          <>
            {budgetSentence(defaultBudget(settings))}, {sourceText(settings, workspaceName)}.{' '}
            <Button variant="text" size="sm" onClick={change}>
              Change for this run
            </Button>
          </>
        )}
      </dd>
      <dt>Target</dt>
      <dd className="number">{target ?? 'Unknown'}</dd>
    </dl>
  );
}
export function BudgetFields({
  settings,
  text,
  change,
}: {
  settings: WorkspaceSettings;
  text: Record<FriendlyKey, string>;
  change: (key: FriendlyKey, value: string) => void;
}) {
  const ranges = settings.effective.runDefaults.budget;
  return (
    <div className="start-run-budget">
      {friendly.map((field) => (
        <TextInput
          key={field.key}
          label={`${field.label}, up to ${toFriendly(field.key, ranges[field.key].allowedRange.maximum)}${field.unit ? ` ${field.unit}` : ''}`}
          inputMode="decimal"
          required
          maxLength={16}
          value={text[field.key]}
          onChange={(event) => change(field.key, event.target.value)}
        />
      ))}
    </div>
  );
}
function lengthText(totalMs: number | null, limitMs: number): string {
  const limit = Number.isSafeInteger(limitMs) && limitMs > 0 ? limitText(limitMs) : null;
  if (totalMs === null) return `Depends on the target.${limit ? ` The run stops at the ${limit} limit.` : ''}`;
  if (!limit) return `${clock(totalMs)}.`;
  return totalMs <= limitMs
    ? `${clock(totalMs)}. Within the ${limit} limit.`
    : `${clock(totalMs)}. Longer than the ${limit} limit, so the run stops early.`;
}
export function Preview({ revision }: { revision: SuiteRevision }) {
  const plan = useMemo(() => planSummary(revision.config), [revision.config]);
  return (
    <div className="start-run-preview">
      <LoadShape plan={plan} compact />
    </div>
  );
}
