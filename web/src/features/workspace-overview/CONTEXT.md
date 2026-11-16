# Workspace overview

One fixed generated-client query under the existing workspace key. Server owns
counts, 24 hourly buckets and bounded recent/active lists. Explicit snapshot and
manual refresh, no polling. Errors hide cached cards and mean unknown, never zero.
Parent workspace scope key/cleanup retires late old-scope data. Run links use scope
from the validated reply. No mutations or configuration reads. See owning LLD.
