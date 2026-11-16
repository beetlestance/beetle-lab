# Metric archive

MetricArchive owns one serial append/seal operation over MetricFiles' fixed data,
index and root descriptors. Data records hold existing approved MetricWindows;
headers bind scope/data UUID, index offsets count UTF8 bytes, footer binds whole
closed data bytes/hash. No corpus or index array is retained. Data frames <=1MiB,
index records <=256B, count<=65536, combined allowance<=256MiB. Footer room is held
before accepting another record. Collection can only lower the remaining ceiling.
Files use exclusive/no-follow creation, one link, UID/mode0600 and retained root
identity. Writes/verification reads <=64KiB, bounded partial-IO call counts. Verify
streamed hash/exact EOF and metadata, sync/close, then named/root rechecks precede
sealed descriptors. No whole-file allocation, detached IO or speculative deletion.
Close fences intake and drains active originals; cleanup failure stays failed.
Only complete metric processing receives sealed history descriptors. Failed
processing closes partial local files and numeric-final reports no retained pair.
No lifecycle spool change, new ACK/result authority or public sample route.
Contract: docs/design/lld/k6-metric-archive.md. Focused checks:
vitest run engines/k6/test/metric-archive engines/k6/test/attempt.
