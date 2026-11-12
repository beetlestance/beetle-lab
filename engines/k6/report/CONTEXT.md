# Performance report presentation
Public renderPerformanceReports consumes mapped k6 result body and admitted numeric
snapshot; output is text/CSV byte arrays, each bounded by explicit1..256KiB cap.
No I/O, compiler, outcome inference, target sampling or secret/config resolution.
Uses shared metric capture/projection and histogram percentile bounds. At most4600
observed unique series; missing series/statistics are unknown, never zero. Outcome,
assertion-definition units, discovery, result completeness and window coverage are
separate. CSV text neutralizes spreadsheet formulas; numeric cells stay numeric.
Fixed failures invalid_input/output_limit contain no raw data. Overflow rejects the
whole report; no truncation. Caller owns original signal/deadline, admitted collect
bytes, exclusive file custody and result publication. The wrapper carves512KiB
from existing total/collect ceilings and uses Artifacts for verified output files.
Checks: engines/k6/test/report and affected attempt tests; Node types/lint.
