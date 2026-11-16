# Artifact page presentation

Public entrypoint: listArtifacts in index.ts.
Input: exact scoped Run/attempt and bounded page query with optional canonical cursor.
Output: schema-validated immutable publication page with semantic ownership and <=73728-byte bound.
Reader failures propagate; invalid replies fail explicitly before public serialization.
No native IO, publication, writer claim or accounting effect is owned here.
Focused checks: app/test/run-artifacts and contracts/test/api/client/run-artifacts.test.ts.
