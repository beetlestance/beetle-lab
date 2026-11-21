import { artifactDownload } from '@beetle/contracts';
import type { Artifact } from '@beetle/contracts';
import { runArtifactContentPath } from '@beetle/contracts/api';
import type { RunArtifactParams } from '@beetle/contracts/api';
import { useMemo } from 'react';
import { useApi } from '../../../app/api.js';
import { buttonClass, Button } from '../../../components/Button.js';
import { Dialog } from '../../../components/Dialog.js';
import { useArtifactReport } from '../../../lib/use-artifact-report.js';
import type { ArtifactReader } from '../../../lib/use-artifact-report.js';
import { VerifiedArtifactReads } from '../../../lib/verified-artifact.js';
import { artifactPreview, previewLimit } from './preview.js';
import { formatBytes } from '../../run-results/format.js';

/** Explicit preview profile; other verified readers retain their 1 MiB cap. */
export const viewerLimit = 32 * 1048576;
const readers = new Map<string, VerifiedArtifactReads<string>>();
function readerFor(kind: string) {
  let reader = readers.get(kind);
  if (!reader) {
    reader = new VerifiedArtifactReads<string>({
      kind,
      maximumBytes: viewerLimit,
      profile: 'artifact-preview',
      decode: artifactPreview,
    });
    readers.set(kind, reader);
  }
  return reader;
}
/**
 * Overlay / Artifact viewer: reads the published bytes, checks size and SHA-256
 * against the sealed descriptor, then shows UTF-8 text (JSON indented). Nothing is
 * shown before full verification; only a bounded text excerpt is displayed.
 */
export function ArtifactViewer({
  params,
  artifact,
  onClose,
  reads,
}: {
  params: Omit<RunArtifactParams, 'artifactId'>;
  artifact: Artifact;
  onClose(): void;
  /** Test seam; production uses the shared verified reader for the artifact's kind. */
  reads?: ArtifactReader<string> | undefined;
}) {
  const full = { ...params, artifactId: artifact.artifactId };
  const href = runArtifactContentPath(full);
  const download = artifactDownload(artifact).filename;
  const readable = artifact.bytes > 0 && artifact.bytes <= viewerLimit;
  return (
    <Dialog
      className="artifact-viewer-dialog"
      dissolve
      title={artifact.relativePath}
      description={formatBytes(artifact.bytes)}
      onClose={onClose}
      actions={(close) => (
        <>
          <Button variant="text" onClick={close}>
            Close
          </Button>
          <a className={buttonClass('inverse')} href={href} download={download}>
            Download
          </a>
        </>
      )}
    >
      {readable ? (
        <VerifiedText params={full} artifact={artifact} reads={reads} />
      ) : (
        <p className="result-muted">
          {artifact.bytes === 0
            ? 'This artifact is empty.'
            : `Too large to verify in the browser (over ${formatBytes(viewerLimit)}). Download it instead.`}
        </p>
      )}
    </Dialog>
  );
}
function VerifiedText({
  params,
  artifact,
  reads,
}: {
  params: RunArtifactParams;
  artifact: Artifact;
  reads: ArtifactReader<string> | undefined;
}) {
  const reader = useMemo(() => reads ?? readerFor(artifact.kind), [reads, artifact.kind]);
  const { state, retry } = useArtifactReport({ params, artifact }, reader, useApi());
  if (state.status === 'loading') return <p role="status">Verifying size and SHA-256…</p>;
  if (state.status !== 'ready')
    return (
      <div role="alert" className="artifact-viewer-error">
        <p>The bytes could not be read or did not match the sealed manifest, or its preview is not UTF-8 text.</p>
        <Button size="sm" onClick={retry}>
          Verify again
        </Button>
      </div>
    );
  return (
    <>
      <p className="artifact-verified" role="status">
        ✓ Size and SHA-256 match the sealed manifest: <span className="number">{artifact.sha256.slice(0, 16)}…</span>
      </p>
      {artifact.bytes > previewLimit && (
        <p className="result-muted">
          Showing the first 64 KiB of text; size and SHA-256 were checked against the entire file. Download to inspect
          the remaining bytes.
        </p>
      )}
      <pre className="artifact-viewer-text" tabIndex={0} aria-label={`Contents of ${artifact.relativePath}`}>
        {state.value}
      </pre>
    </>
  );
}
