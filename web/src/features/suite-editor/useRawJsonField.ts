import { useEffect, useState } from 'react';
import { SUITE_MAXIMUM_CONFIG_BYTES } from '@beetle/contracts/api';
import { validateK6DraftPart } from '@beetle/contracts/engine-config/k6';
import { draftText, formatDraft } from '../suites/draft.js';
import { useRawDraftOwner } from './raw-drafts.js';
import type { RawField, RawReason } from './raw-drafts.js';

const messages: Record<RawReason, string> = {
  invalid_json: 'Enter valid JSON. Your unfinished text is kept and cannot be saved.',
  invalid_scalar: 'Use a JSON string, number, true, false or null. Your unfinished text is kept.',
  configuration_limit: 'This edit exceeds the configuration limits. Reduce it before saving; your text is kept.',
};
function parse(raw: string, scalar: boolean): { ok: true; value: unknown } | { ok: false; reason: RawReason } {
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    return { ok: false, reason: scalar ? 'invalid_scalar' : 'invalid_json' };
  }
  if (scalar && !validateK6DraftPart('scalar', value)) return { ok: false, reason: 'invalid_scalar' };
  try {
    draftText(value);
    return { ok: true, value };
  } catch {
    return { ok: false, reason: 'configuration_limit' };
  }
}
function initialText(value: unknown): string {
  try {
    return formatDraft(value);
  } catch {
    return '';
  }
}
/** Invalid text stays with the editor; valid values enter the canonical configuration only after acceptance. */
export function useRawJsonField(
  field: RawField | null,
  value: unknown,
  apply: (value: unknown) => void | boolean,
  scalar = false,
) {
  const owner = useRawDraftOwner();
  const existing = field ? owner.get(field) : undefined;
  const [text, setText] = useState(() => existing?.raw ?? initialText(value));
  const [error, setError] = useState(() =>
    existing
      ? messages[existing.reason]
      : value === undefined
        ? messages[scalar ? 'invalid_scalar' : 'invalid_json']
        : '',
  );
  const identity = field === null ? '' : JSON.stringify(field);
  useEffect(() => {
    if (field && value === undefined && !existing) owner.keep(field, '', scalar ? 'invalid_scalar' : 'invalid_json');
  }, [identity]);
  const retain = (raw: string, reason: RawReason) => {
    if (field && owner.keep(field, raw, reason)) {
      setText(raw);
      setError(messages[reason]);
    } else setError('That edit exceeds the unfinished-text budget. The previous text is kept.');
  };
  const change = (raw: string) => {
    if (!field) return;
    if (
      raw.length > SUITE_MAXIMUM_CONFIG_BYTES ||
      new TextEncoder().encode(raw).byteLength > SUITE_MAXIMUM_CONFIG_BYTES
    ) {
      setError('That edit exceeds 1 MiB. The previous text is kept.');
      return;
    }
    const parsed = parse(raw, scalar);
    if (!parsed.ok) {
      retain(raw, parsed.reason);
      return;
    }
    if (apply(parsed.value) === false) {
      retain(raw, 'configuration_limit');
      return;
    }
    owner.clear(field);
    setText(raw);
    setError('');
  };
  return {
    text,
    change,
    error: field ? error : 'Use unique request and check IDs in the complete configuration to edit this JSON field.',
    readOnly: field === null,
  };
}
