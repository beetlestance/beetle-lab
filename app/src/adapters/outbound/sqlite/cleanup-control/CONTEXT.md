# Backend cleanup control
Public entry: index.ts. Contract: docs/design/lld/backend-cleanup-control.md.
Policy1 original-keyed65536 separatefromoldoutputmetadata. Same sharedusage counter.
New Run enqueue reserves before intent/outbox; old rows never implicitly backfilled.
Claim counts only missing control; funded replay needs no extra allowance.
Explicitlegacy/unsenttopup usesconfiguredcapacity; missingreserveblocksdestruction.
SQLguards positiveoriginal/configuredceiling/safeinteger/immutability; no refundhere.
