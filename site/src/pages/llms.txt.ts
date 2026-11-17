import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';

// llms.txt (https://llmstxt.org): the page list with one-line summaries, so tools
// that read documentation can find the right page without crawling.
const sections = ['start', 'concepts', 'guides', 'reference'];

export const GET: APIRoute = async ({ site }) => {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const origin = site ? site.origin : '';
  const pages = (await getCollection('docs')).filter(page => sections.includes(page.id.split('/')[0]));
  const lines = ['# Beetle Lab', '', '> Self-hosted k6 performance testing with isolated execution and trustworthy results.', ''];
  for (const section of sections) {
    lines.push(`## ${section[0].toUpperCase()}${section.slice(1)}`, '');
    const inSection = pages.filter(page => page.id.startsWith(`${section}/`))
      .sort((a, b) => (a.data.sidebar.order ?? 99) - (b.data.sidebar.order ?? 99));
    for (const page of inSection) {
      lines.push(`- [${page.data.title}](${origin}${base}/${page.id}/): ${page.data.description ?? ''}`.trimEnd());
    }
    lines.push('');
  }
  return new Response(lines.join('\n'), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
