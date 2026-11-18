import { useEffect, useState } from 'react';
import { validateApi } from '@beetle/contracts/api';
import type { Suite, SuiteMetadataChanges } from '@beetle/contracts/api';
import type { Problem } from './problems.js';

export type MetadataValues = { name: string; folderId: string; description: string };
const fields = ['name', 'folderId', 'description'] as const;
export const metadataValues = (suite: Suite): MetadataValues => ({
  name: suite.name,
  folderId: suite.folderId,
  description: suite.description ?? '',
});
export const normalizedMetadata = (value: MetadataValues): MetadataValues => ({
  name: value.name.trim(),
  folderId: value.folderId.toLowerCase(),
  description: value.description.trim(),
});
export function metadataPatch(baseline: MetadataValues, draft: MetadataValues): SuiteMetadataChanges | undefined {
  const value = normalizedMetadata(draft);
  const patch: SuiteMetadataChanges = {
    ...(value.name !== baseline.name ? { name: value.name } : {}),
    ...(value.folderId !== baseline.folderId.toLowerCase() ? { folderId: value.folderId } : {}),
    ...(value.description !== baseline.description ? { description: value.description || null } : {}),
  };
  return Object.keys(patch).length ? patch : undefined;
}
function metadataProblems(patch: SuiteMetadataChanges | undefined): Problem[] {
  if (!patch) return [];
  const labels = {
    name: 'Name must contain 1–128 characters without control characters.',
    folderId: 'Choose a folder in this workspace.',
    description: 'Description must contain at most 280 characters without control characters.',
  };
  const checked = validateApi('SuiteMetadataChanges', patch);
  if (checked.ok) return [];
  return fields
    .filter((field) => checked.issues.some((issue) => issue.path === '/' + field))
    .map((field) => ({ path: '/metadata/' + field, message: labels[field] }));
}
/** Refresh untouched metadata fields while preserving edits and the separate optimistic draft version. */
export function useMetadataDraft(suite: Suite) {
  const [state, setState] = useState(() => ({ baseline: metadataValues(suite), value: metadataValues(suite) }));
  useEffect(() => {
    const fresh = metadataValues(suite);
    setState((previous) => {
      if (fields.every((field) => fresh[field] === previous.baseline[field])) return previous;
      const value = { ...previous.value };
      for (const field of fields) if (value[field] === previous.baseline[field]) value[field] = fresh[field];
      return { baseline: fresh, value };
    });
  }, [suite.name, suite.folderId, suite.description]);
  const patch = metadataPatch(state.baseline, state.value);
  return {
    value: state.value,
    patch,
    dirty: patch !== undefined,
    problems: metadataProblems(patch),
    change: (value: MetadataValues) => setState((previous) => ({ ...previous, value })),
    acknowledge: (snapshot: MetadataValues, patch: SuiteMetadataChanges | undefined, version: number) => {
      const fresh = metadataValues(suite);
      const committed = { ...fresh };
      for (const field of fields) if (patch && Object.hasOwn(patch, field)) committed[field] = snapshot[field];
      setState((previous) => {
        const value = { ...committed };
        const current = normalizedMetadata(previous.value);
        for (const field of fields) if (current[field] !== snapshot[field]) value[field] = previous.value[field];
        return { baseline: suite.version > version + 1 ? fresh : committed, value };
      });
    },
    discard: () => setState((previous) => ({ ...previous, value: previous.baseline })),
  };
}
