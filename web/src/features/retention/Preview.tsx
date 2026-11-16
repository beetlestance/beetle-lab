import type { RetentionPreview } from '@beetle/contracts/api';
export function SnapshotSummary({preview}:{preview:RetentionPreview}){
 return <><p>Scanned {preview.scanned} runs. Estimated retained logical bytes: {preview.estimatedBytes}. Preview expires {preview.expiresAt}.</p>
  <div className="settings-table-wrap"><table><caption>Immutable deletion candidates</caption><thead><tr><th>Run</th><th>Version</th><th>Reason</th><th>Estimated logical bytes</th></tr></thead>
   <tbody>{preview.candidates.map(item=><tr key={item.id}><td>{item.id}</td><td>{item.version}</td><td>{item.reason}</td><td>{item.estimatedBytes}</td></tr>)}</tbody></table></div>
  {preview.protectedExclusions.map(item=><p key={item.reason}>Protected {item.reason}: {item.count}; logical bytes {item.estimatedBytes===null?'unknown':item.estimatedBytes}.</p>)}
</>;
}
