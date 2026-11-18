import type { StarlightRouteData } from '@astrojs/starlight/route-data';

type Entry = StarlightRouteData['sidebar'][number];
type Link = Extract<Entry, { type: 'link' }>;

export interface Section {
  label: string;
  /** First page of the section; the header tab links here. */
  href: string;
  current: boolean;
  links: Link[];
}

function links(entries: Entry[]): Link[] {
  return entries.flatMap((entry) => (entry.type === 'link' ? [entry] : links(entry.entries)));
}

/** The top-level sidebar groups (Start, Concepts, Guides, Reference) as flat sections. */
export function sections(sidebar: Entry[]): Section[] {
  return sidebar.flatMap((entry) => {
    if (entry.type !== 'group') return [];
    const pages = links(entry.entries);
    if (!pages.length) return [];
    return [{ label: entry.label, href: pages[0]!.href, current: pages.some((page) => page.isCurrent), links: pages }];
  });
}
