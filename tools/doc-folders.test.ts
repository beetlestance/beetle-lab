import { expect, it } from 'vitest';
import { folderIssues } from './doc-folders.js';

it('rejects loose files at the top of docs/ except the map', () => {
  expect(folderIssues('docs/README.md', '# Map')).toEqual([]);
  expect(folderIssues('docs/STATUS.md', '# Status')).toHaveLength(1);
  expect(folderIssues('README.md', '# Root')).toEqual([]);
});
it('keeps system/ in the present tense', () => {
  expect(folderIssues('docs/system/overview.md', 'Status: proposed')).toHaveLength(1);
  expect(folderIssues('docs/system/a.md', 'This is planned for R5.')).toHaveLength(1);
  expect(folderIssues('docs/system/a.md', 'Runs move from pending to running.')).toEqual([]);
});
it('requires a status line on plans but not on their README', () => {
  expect(folderIssues('docs/plans/roadmap.md', '# Roadmap\n\nStatus: active.')).toEqual([]);
  expect(folderIssues('docs/plans/active/x.md', '# X\n\nNo status.')).toHaveLength(1);
  expect(folderIssues('docs/plans/README.md', '# Plans')).toEqual([]);
});
it('requires evidence to name a commit', () => {
  expect(folderIssues('docs/evidence/run.md', 'Measured at 40c4a5c1.')).toEqual([]);
  expect(folderIssues('docs/evidence/run.md', 'Measured recently.')).toHaveLength(1);
});
