# Staging integration deployment — 2026-11-03 06:07 UTC

## Scope and source

Continuation of refinement `72605e46036a12a6392be6d40ca82c71b5e1696e`.
Checkout initially reported `18c1610470e32dc23569ac98164e2cd6e8c63b81` (work-in-progress
descendant); tested/deployed authored source checkpoint:
`cdca549681effd699dc10da6b5290b29fb7b9b81`.
Later changes only update review evidence/roadmap, not deployed source.

Root reported targeted bootstrap+001..008+010+011 installed in one transaction,
118 Auth users/protected profiles/Auth principals, no new guest principals,
both markers false, original profile hash `e1b040347ab25fc835230154e6127e93`,
91 requests/206 votes/2 events/0 tips unchanged. These catalog counts and rolled-back
canonical/manual/privacy/consent/report/ledger/expiry assertions are root evidence,
not repeated or represented as agent verification. No SQL was reapplied.

## Exact deployments and configuration

Deployment tool succeeded in two ordered calls:

1. `guest-event`, `guest-event-stream`
2. `music-search`, `tip-create-checkout`

Explicit configuration entries are exactly:

```toml
[functions.guest-event]
verify_jwt = false
[functions.guest-event-stream]
verify_jwt = false
[functions.music-search]
verify_jwt = false
[functions.tip-create-checkout]
verify_jwt = false
```

Existing isolated probe entry is unchanged; no global settings or other functions
were changed/deployed. Public contract discloses only contract/enablement metadata.
Application operations require in-handler Auth getUser or fixed service-validated
event proof. Socket proof is first-frame only; no app access before validation.

Tool-reported submitted source SHA-256 (files/settings, not independently fetched
deployed artifact hashes):

| Endpoint | SHA-256 |
|---|---|
| guest-event | `6ab64ccf7b9864c58f0adfd0bf3c5a1802844ce7aa9327f622fb1113899a5b30` |
| guest-event-stream | `095190018e3fe8dc763d44822f8609c7e83ab8a0d54ae329cd59acc46c9d2a10` |
| music-search | `c7c9e8eba3981580432e01cdc6da46cf626d8660cb73ac5732ee0b15ed8856cc` |
| tip-create-checkout | `ec7a4dfef90a9c91d230a1ce8698cc7b1a2cd791bd9ced5e1586560a70e75d91` |

Hosted public types regenerated using the actual hosted schema; separate actor/
repair adapters retained. No dependency/API/SDK version changes.

## Live read-only observations

All HTTP probes explicitly use invalid Authorization, preventing automatic session
minting/injection. Synthetic unknown event/invalid proof; no identities created.

| Probe | Before | After |
|---|---|---|
| guest-event contract | 200, guest-integration-v1, enabled=false | Same |
| guest-event snapshot, correctly shaped but invalid proof | 503 guest_disabled | Same |
| music-search q=x, malformed proof | 401 Unauthorized | 401 UNAUTHORIZED |
| music-search q=x, correctly shaped but invalid proof | 503 service unavailable | 503 SERVICE_FAILED |
| tip check_only, malformed proof | 401 UNAUTHORIZED, ready=false | Same |
| tip check_only, correctly shaped but invalid proof | 503 SERVICE_FAILED, ready=false | Same |

The disabled SQL gate precedes session validation: **syntactically valid but invalid
credentials return 503 while disabled**, not 401. No false readiness asserted.
Valid guest proof cannot be acquired without enabling/creating a guest, which was
not authorized; valid-proof q=x and readiness verification remain root-owned after
enablement. q=x exits before rate logging/cache/provider search when authorized;
no external provider request was made by these probes.

After deployment: malformed/nonobject JSON and invalid UTF-8 return typed 400;
8193-byte bodies return typed 413 for all three POST handlers. One native socket
with an unknown-event, correctly shaped invalid token received
`service_unavailable, retry=true`, then closed 1013. This verifies fail-closed
disabled transport, **not** valid socket operation or 100-socket capacity.

An attempted SELECT of the service-only contract RPC through the SQL read tool
was denied (42501), with no writes. HTTP subsequently verified disabled contract.
Private marker tables were not directly read/bypassed; root reports both false,
and disabled stream behavior was observed. The source frontend flag remains false.

## Tests and remaining gates

- 46 no-network Deno tests passed: actor/body, guest handler, stream transport,
  reservation checkout and read-only readiness.
- Deno checks passed for all four deployed entrypoints.
- ESLint passed with zero warnings; generated MCP exclusion unchanged.
- Full frontend: 132 passed, nine missing production-bundle failures unchanged.
  No manual build and no tests weakened; root owns final production bundle checks.
- Automatic source-check log: build OK after authored changes.
- No SQL, Auth accounts/sessions, provider/checkout/refund/payment/email calls,
  secrets/quotas changes, site publication, or isolated-probe changes.

Root must independently enable/test HTTP, valid-proof readiness (Stripe config
remains unready), browser/account-link flows and 100 WebSockets before turning on
the source flag. Existing rollback/containment instructions remain authoritative.