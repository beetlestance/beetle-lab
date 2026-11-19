# Shared primitives
Penpot "States / Controls" source of truth; styles in primitives.css, tokens in
styles/tokens.css (`--s-*` spacing, `--r-*` radii, `--fs-*` type, motion zeroed
under reduced motion). Legacy aliases (`--surface`, `--space-*`) remain for
unconverted features; new code uses the new tokens. Optional props accept undefined.
- Button: variant primary|secondary|danger|text, size md|sm, loading, loadingLabel.
  Loading keeps focus, sets aria-busy and swallows presses; width never shifts.
  `buttonClass(variant, size, extra)` styles a Link as a button. Default type=button.
- TextInput, Select, Checkbox: label, hideLabel, hint, error (aria-invalid plus
  described-by). Select adds loading (disabled, aria-busy) and placeholder.
- Tabs: label, items {id,label,count,disabled}, selected, onSelect, idBase, size;
  arrows, Home, End; pair with TabPanel {idBase,id}. NavTabs: link tabs with
  aria-current, items {to,label,current,count}.
- SegmentedFilter: label, options {value,label,count,disabled}, value, onChange.
  Radiogroup; a missing count is omitted, never shown as zero.
- Badge tone neutral|strong|amber|pass|fail|history; Status tone
  running|pass|fail|info|skipped|neutral (dot plus text, never colour alone).
- Banner: tone neutral|info|warning|danger|history, title, actions, live (danger is
  an alert, others status; live=false for static notes).
- Dialog: title, onClose, description, actions, initialFocus, role, dismissible.
  Mount to open; traps Tab, inerts the page, Escape/backdrop close, focus returns.
- Table: caption, columns {key,label,numeric,sort}, captionVisible; Th/Td numeric
  right-aligns tabular figures, Td muted. Optional scrollLabel names and focuses
  the existing scroll container for keyboard navigation; default tables unchanged.
- EmptyState: title, actions, note, art, compact, headingLevel. LoadingState: label,
  variant inline|page|table|cards, rows. QueryState wraps both plus Retry.
- NotFound: kind page|organization|workspace|suite|script|run|input, back {to,label},
  reason. App's invalid-route page uses kind page; features reuse the other kinds.
- Pagination + usePage: keyset pages of 100, 20 retained back cursors, 1-based
  `position` (no total). `order` newest|oldest gives Newer/Older in list order; lists
  in identifier order omit it and keep Back/Next. `label` names the nav.
- Toast: ToastProvider in App; `useToast().show(message)`, five seconds, three max.
- ThemeSwitch: Darkroom/Scarab, stored as `beetle.theme`, sets html data-theme.
Shell (app/shell): AppShell takes onSearch and activeRuns (Workspaces badge, unwired
until a real active-run read exists). Nav targets come from app/navigation.ts;
routes.ts stays the only URL source (adds `engines`, `suiteScript`).
Runs: RunDetail picks a phase once per mount: nonterminal runs render
runs/live (package D), terminal runs runs/result (package E). Live calls showResult
to hand off; both currently wrap RunSnapshot unchanged.
Check: npx --no-install vitest run web/src/components web/src/app.
