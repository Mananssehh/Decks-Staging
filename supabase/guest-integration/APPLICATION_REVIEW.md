# Application source review

Status (2026-11-03): root independently installed targeted bootstrap+001..008+010+011
in one transaction, disabled. Four authorized staging endpoints are deployed;
frontend flag remains OFF. This turn did not execute SQL, create Auth/guest identities,
call providers, publish, or change secrets/quotas. Reviewed SQL remains unchanged.

Deployment evidence: [STAGING_DEPLOYMENT.md](STAGING_DEPLOYMENT.md).

Install order: targeted bootstrap, preflight, 001..008, 010, 011, 009 catalog and
011 postcondition assertions; single independent transaction, markers disabled.

011 replacements: common request kernel (manual canonical identity/dedup/HTTPS),
guest API (authorized returning nickname/session resume), profile insert guard,
registered retirement evidence and shared safe snapshot including privacy fields.
New service RPCs: guest_application_actor, guest_event_public_profile,
guest_tip_summary, application_actor_aliases. application_own_ledger derives Auth
or validates service-supplied guest token; browser UUID alone does not authorize.
Private tables: application_before and retired_identities, RLS/no direct access.
900 containment preserves evidence; 950 empty restore drops application RPCs;
910 refuses application dependencies rather than removing snapshot safety.

Tests: 16 new SQL, 100 core guest, 15 bootstrap, 39 stream, 57 financial assertions;
exact empty rollback/catalog and containment pass. 25 no-network Edge/transport
tests, Deno checks, zero-warning eslint, automatic typecheck build OK.
Frontend full suite: **109 passed, 9 failed**; nine production-bundle
failures are missing compiled assets, not skipped/weakened; no manual build.

Remaining gates: root-owned enablement/valid-guest endpoint acceptance,
real email-confirm/PKCE claim and actual
two-tab event lifecycle tests; 100 integrated guests/sockets/reconnects and provider
configuration remain root-owned acceptance, not claimed here. SQL test fixture is
not a substitute for inspecting managed hosted report/consent trigger definitions.