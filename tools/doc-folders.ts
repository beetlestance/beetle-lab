/** Folder ownership rules from decision 017. Paths are repository-relative. */
interface FolderRule {
  readonly applies: (file: string) => boolean;
  readonly violates: (text: string) => boolean;
  readonly message: string;
}
const isReadme = (file: string): boolean => file.endsWith('/README.md');
const head = (text: string): string => text.split('\n').slice(0, 6).join('\n');
const rules: readonly FolderRule[] = [
  {
    applies: (file) => /^docs\/[^/]+\.md$/.test(file) && file !== 'docs/README.md',
    violates: () => true,
    message: 'loose file in docs/; move it into an owning folder',
  },
  {
    applies: (file) => file.startsWith('docs/system/'),
    violates: (text) => /^Status:|\b(planned|not yet implemented|TODO)\b/im.test(text),
    message: 'system/ describes current behaviour; remove status or plan wording',
  },
  {
    applies: (file) => file.startsWith('docs/plans/') && !isReadme(file),
    violates: (text) => !/^Status: /m.test(head(text)),
    message: 'plans/ pages need a "Status:" line near the top',
  },
  {
    applies: (file) => file.startsWith('docs/evidence/') && !isReadme(file),
    violates: (text) => !/\b[0-9a-f]{7,40}\b/.test(text),
    message: 'evidence/ pages must name the commit they measured',
  },
];

export function folderIssues(file: string, text: string): readonly string[] {
  return rules.filter((rule) => rule.applies(file) && rule.violates(text)).map((rule) => `${file}: ${rule.message}`);
}
