# Target observation chart

Public entry: `TargetObservationChart({samples, metric})` renders one selected target-reported metric from already validated samples. It reads no API or lifecycle state.

The SVG plots only ready non-null readings against `observedAt`. Null or unavailable readings create gaps; paths also split when phase changes or timestamps stop increasing. A measured zero is a point. Empty/all-null input has an explicit no-readings status.

Metric names and values remain source-reported; tooltips name the timestamp, phase, metric and value. No unit conversion or absent-value inference occurs. Input is bounded to 256 samples by the report contract.

Focused test: `chart.test.tsx` in this directory.
