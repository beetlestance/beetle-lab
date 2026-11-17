import { visit } from 'unist-util-visit';

/** Prefixes root-relative Markdown links with the site base, so content can say `/start/install/`. */
export function remarkBaseLinks(base) {
  const prefix = base.replace(/\/$/, '');
  return () => (tree) => {
    visit(tree, 'link', (node) => {
      if (prefix && node.url.startsWith('/') && !node.url.startsWith('//') && !node.url.startsWith(`${prefix}/`)) node.url = prefix + node.url;
    });
  };
}
