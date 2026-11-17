# Command search

Public hook owns opening location/invoker, global shortcut and focus restoration.
Palette owns labelled modal/focus trap/search and read-only navigation. App makes
background inert. Route-key visibility prevents new-scope query effects on close.
model.ts validates existing route patterns; no arbitrary backend URL is accepted.

items.ts reuses exact first-page QueryClient keys/100-item reads, no keystroke key,
second cache or automatic retry. Existing public client enforces response scopes.
Close removes only this observer; existing scope owners retain resource cleanup.
Query128chars/results40/pages100 are explicit. Error groups hide failed cached
items. Penpot "Overlay / Search": a typed query adds "Start" plus the suite name after each
matched suite, which opens the suite (navigation only). No engine, mutation or
global/full-history search.
Contract: docs/system/contracts/web-ui.md.
