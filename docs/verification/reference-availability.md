# Public operation availability

Status: original reviewed reference correction atb70b33c, reconciled through21aa880.
Current source catalogue:62 JSON descriptors,59 implemented,3 planned namespace
DELETE operations. Retention parent previews and workspace/manual controls are now
implemented; unshipped parent Apply descriptors were retired. The original runtime
registration fixture/evidence below belongs to its recorded source. Contract: [embedded reference](../design/lld/embedded-reference.md).

Every generated JSON operation now declares implemented or planned. The generator
rejects missing/unknown status. Planned schemas and client methods remain available
as contracts; route registration refuses planned entries. Reference filtering,
selected-operation guidance, downloadable Markdown/JSON and agent instructions
carry the same status. Implemented describes a route in the standard configured
application; local access, service setup and engine capability still apply.

## Original registration evidence

The fixture opens the real application with its compiled metadata worker and
private input directories, then checks every JSON descriptor against Fastify's
registered routes. It found three absent namespace DELETE routes in addition to
four known retention preview/apply routes. All seven are now explicitly planned:
organisation/workspace/folder deletion, plus installation/organisation retention
preview/apply. No deletion handler was fabricated to obtain a pass.

A separate case proves planned descriptors cannot be registered as implemented.
DOM reference tests expose all seven planned rows and their explanation without
runtime API calls. Existing generated-client binding tests still exercise future
contract methods; those mocks do not establish shipped HTTP handlers.

Initial focused selection:65 cases passed; two failed. The asset HTTP fixture was
denied by sandbox EPERM; only that fixture was retried with permission and passed
in2.00s. The application fixture first used a noncanonical private temp path, which
was corrected to its realpath without changing directory guards. Its next run
exposed the three absent delete routes; the catalogue and parity checklist were
corrected. No existing namespace deletion behavior was removed.

Final corrected route/DOM selection: five cases passed in6.33s. All57 JSON
descriptors match the configured application:50 implemented and7 planned. The
source-built Markdown/JSON/skill preserve those statuses; the emitted skill also
passed quick_validate.

Node/frontend types, changed lint, generated drift, architecture/docs and source
API/web builds passed. The standalone skill passed quick_validate; its existing
frontmatter, authorization boundaries and public-only workflow were preserved.
Independent review accepted the source and corrected status inventory; no duplicate
reviewer check lane ran.

## Limits

Registration is not endpoint outcome, engine execution or release qualification.
The actual native HTTP asset test verifies source serving and fixed content bounds;
no new Docker image was built or published. Running services were not redeployed.
Namespace deletion remains unimplemented. Retention and history controls/scalars/
search are now locally implemented; see [retention](retention-accounting.md),
[parent traversal](retention-parent.md), [history](run-history-query.md) and the
[full inventory audit](inventory-audit.md). Current totals are catalogue inspection,
not a new actual registration test or release qualification.
