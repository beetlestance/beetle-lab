# Run views

RunDetail (runs/RunDetail.tsx) owns the run query, cancellation and header, then
picks a phase once per mount: nonterminal → `live/LiveRunView` (Wave 1 package D),
terminal → `result/RunResultView` (package E). A run that ends while watched stays
in the live view until it calls `showResult`, because switching remounts the view
and re-reads the result. Both views currently render the shared pre-redesign
`RunSnapshot` unchanged; `terminal()` lives in `runs/terminal.ts`.
Packages D and E each replace only their own folder. Shared pieces stay in
RunSnapshot until one owner moves them; coordinate before changing it.
