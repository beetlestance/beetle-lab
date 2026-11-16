# Backend settlement values
Entry:index.ts. Owning contract:docs/design/lld/output-settlement.md.
Canonical<=2048 plus512 row allowance;2560 permanent floor. Source/absence credit is
retained payload+65536 old metadata+65536 control-2560; unsent has zero output debt.
Pure scalar codecs cannot establish file/agent cleanup, witness, purge or SQL authority.
