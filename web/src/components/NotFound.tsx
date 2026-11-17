import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import './primitives.css';

export type NotFoundKind = 'page' | 'organization' | 'workspace' | 'suite' | 'script' | 'run' | 'input';

const notFoundCopy: Record<NotFoundKind, { title: string; reason: string }> = {
  page: { title: 'Page not found', reason: 'This address is not part of Beetle Lab.' },
  organization: { title: "That organization isn't here", reason: 'It may have been deleted.' },
  workspace: { title: "That workspace isn't here", reason: 'It may belong to another organization.' },
  suite: { title: "That suite isn't here", reason: 'It may belong to another workspace.' },
  script: { title: "That script isn't here", reason: 'The suite may belong to another workspace.' },
  run: {
    title: "That run isn't here",
    reason: 'It may have been removed by retention, or it belongs to another workspace.',
  },
  input: { title: "That input isn't here", reason: 'It may have been deleted, or it belongs to another workspace.' },
};

/**
 * Not-found page for an invalid address or a missing record. `back` is the link
 * that follows the reason ("Back to runs"). `reason` overrides the default copy.
 */
export function NotFound({
  kind = 'page',
  back,
  reason,
}: {
  kind?: NotFoundKind | undefined;
  back?: { to: string; label: string } | undefined;
  reason?: ReactNode | undefined;
}) {
  const copy = notFoundCopy[kind];
  return (
    <section className="not-found">
      <h1>{copy.title}</h1>
      <p>
        {reason ?? copy.reason}
        {back && (
          <>
            {' '}
            <Link to={back.to}>{back.label}</Link>
          </>
        )}
      </p>
    </section>
  );
}
