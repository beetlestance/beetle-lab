# Decision 012: redesign the UI after functional completion

Status: user-approved sequencing,2026-11-11.

## Decision

Finish the current functional rewrite plan before starting a separate UI audit and
redesign plan. The present screens are provisional and do not establish the final
product experience. This is a whole-product interaction/design task, not a polish
pass over the current layouts.

During the functional rewrite, add the views/controls needed to use its features
and fix blocking correctness, accessibility and safety issues. Defer visual
refinement, navigation/information architecture redesign and design-system work.
Compose startup and local-access corrections remain functional-plan concerns;
they are not deferred by this UI decision.

## Why

User review found the interface materially below the previous experience. Small
styling changes would not address the underlying workflows. Concrete functional
capabilities and real runs provide the basis for a useful end-to-end design audit.

## Follow-up

After functional completion, audit authoring, organization/workspace navigation,
execution/monitoring, analysis/comparison, settings and recovery against user
journeys and the earlier product. Produce a separate proposed UI architecture,
interaction model and implementation plan before starting the redesign.

Functional completion is not acceptance of the present UI, and does not by itself
establish public-release readiness. Existing functional browser/accessibility
checks remain in force; they do not constitute final visual or UX approval.
