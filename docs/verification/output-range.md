# Native output range evidence

Status: locally verified and independently reviewed native file component. Source
`2fd20effb9f0974dc01820d57a050cb70668ace1`, integrated at
`66953a9ff2f0c84d6766b8b0f4b53d1272a362dd`.
Contract: [native ranges](../design/lld/output-range.md).

readOutputRange reuses OutputFiles and shared OutputLifetime for exact stored root,
file/ancestor identity, size, modes/UID/links, original IO and cached descriptor
closes. It reads at most65536 bytes, supports short reads, and opens/checks/closes
even explicit EOF. Independent range/collector caps each remain2; caller capture
cannot bypass them and an early negative result cannot release native originals.
Success follows all original closes and final named checks. Before-read same-size
mutation remains provisional: backend whole-file expected SHA256 is still required.

99 native/affected collector cases passed4.126s;15 selected source root/vector cases
passed1.263s; a final string-bound case passed0.926s. Node TypeScript passed once
8.728s. Initial root-capture complexity11 lint failure was corrected by a grammar
helper; final lint passed1.118s, whitespace0.043s. Final runtime string guards had
no type/interface change and their added case passed separately. No full rerun.

Independent review matched all29 inputs and15 changed paths, found no blocker,
took293s and reused checks. Inspected real temporary files, replaced roots/files/
ancestors, modes/links/symlinks, mutation around close, sparse large EOF, and held
actual open/read/close/post-close metadata. Original close failure stays rejected.
Existing collector ordering and source grammar/preimages are preserved.

Evidence is native synthetic files, not k6/container/platform qualification.
HTTP/client composition, backend adoption/publication, file deletion, refunds and
complete result delivery remain required. This is not a complete rewrite claim.
