# Artifact HTTP reads

Public entrypoint: registerRunArtifactRoutes in index.ts; requires actual local-session authorization.
Metadata uses the shipped list operation and its bounded semantic application read.
Content validates five UUIDs, no body/query and existing shared single-range semantics.
One no-queue HTTP lifetime includes metadata, native and socket originals for a fixed30s deadline.
The installed read capability shares the existing two-job native owner and zero write reserve.
One native range job awaits socket callback/drain, result and original settlement.
Nonempty framing is chunked; EOF waits for exact selected length and full-read SHA verification.
Empty files undergo the same native verification before zero-length headers.
Midstream failures destroy the response; disconnect/close fences admission and drains originals.
Focused checks: app/test/run-artifacts/http.test.ts and lifetime.test.ts.
