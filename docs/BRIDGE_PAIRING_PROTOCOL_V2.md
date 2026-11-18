# DECKS Bridge Pairing Protocol v2

Status: source candidate, not installed or deployed. Staging backend only.
Protocol v1 (six-digit codes) is retired with no compatibility path: v1 requests are refused and no rollback restores them.

Sources: `supabase/repair-staged/10_bridge_pairing_security.sql`, `supabase/functions/bridge-pair`, `supabase/functions/bridge-revoke`, `supabase/functions/_shared/bridge-protocol.ts`, `supabase/functions/_shared/bridge-admission.ts`, `src/components/BridgePairing.tsx`.

This document supersedes every earlier description of Bridge pairing. `supabase/repair-staged/README.md` (including its "Pairing network limitation" section and the shared `unverified-gateway` bucket) and `05_bridge.sql` are historical evidence of the previous repair and are kept unedited because they are hash-recorded; where they differ from this contract, this contract applies.

## Rules for future changes

- Bridge pairing is Protocol v2 only. Never restore six-digit issuance or acceptance, including in a rollback.
- Pairing codes, client nonces and ingest tokens never enter URLs, QR payloads, deep links, logs or analytics.
- Pairing secrets are stored only as SHA-256, in a table with no grants and no policies.
- A refused attempt must have no lasting effect. Never reintroduce a failure counter or a persistent or rate-based shared bucket that a valid code has to pass. The one exception is the per-worker pending-claim limit (see below): it counts only claim calls still in flight, keeps nothing after a call settles, and answers with the retryable `503`, never the `404`.

## Pairing code

| Property | Value |
| --- | --- |
| Alphabet (canonical) | `0123456789ABCDEFGHJKMNPQRSTVWXYZ` (Crockford Base32; no `I`, `L`, `O`, `U`) |
| Length | exactly 16 symbols = 80 bits, from ten bytes of `extensions.gen_random_bytes` |
| Display form | `XXXX-XXXX-XXXX-XXXX` |
| Canonical form | uppercase, spaces and hyphens removed; the only form hashed and compared |
| Stored form | SHA-256 of the canonical form (`bytea`, 32 bytes). Plaintext is returned once, to the authenticated event owner, at generation |
| Lifetime | five minutes from generation |
| Use | single use; a new code for the same event supersedes any unclaimed one |

### Normalization (client and server apply the same steps, in this order)

1. Reject unless the input is a string of 1–64 characters, all of them ASCII letters, digits, space (U+0020) or hyphen (U+002D).
2. Remove every space and hyphen.
3. Uppercase.
4. Replace `O` with `0`, and `I` and `L` with `1`.
5. Accept only if the result is exactly 16 symbols of the alphabet. `U` is never valid.

The ASCII check comes before uppercasing so that no Unicode character can case-fold or alias into a valid symbol.

## Pair request

`POST {backend}/functions/v1/bridge-pair`, `Content-Type: application/json`, body at most 1024 bytes.

```json
{
  "protocol_version": 2,
  "code": "XXXX-XXXX-XXXX-XXXX",
  "client_nonce": "<128-bit random value>"
}
```

- `protocol_version` must be the number `2`.
- `code` may be sent in display or canonical form, or any input the normalization accepts.
- `client_nonce` is 22–64 characters of `A–Z a–z 0–9 - _`: 128 random bits as unpadded base64url (22 characters) or hex (32 characters). Generate one per pairing attempt, reuse it for retries of that attempt only, and never persist it after pairing completes.
- The code is accepted in the JSON body only: never in a URL, query string, header, QR payload or deep link.
- The request URL must have no query string at all. Any query, even an empty `?`, is refused before the body is parsed.
- `Content-Type` must be `application/json`, optionally with `; charset=utf-8`. Any other or missing media type is refused before the body is parsed.

**What authenticates a pairing request.** The 80-bit pairing code is the credential. The client nonce is not authentication. It is chosen by the caller, proves nothing about the caller, and exists only so that a retry of the same attempt, after a lost response, gets the same result instead of a refusal. A request with a valid code and any well-formed nonce is authorized; a request without a valid code is never authorized, whatever its nonce.
- Forwarded-address headers are ignored; no network address is read, stored or trusted.

## Callers, origins and gateway authentication

Only the desktop app claims and revokes. The website generates codes and never calls `bridge-pair` or `bridge-revoke`.

| `Origin` header | Result |
| --- | --- |
| absent (native HTTP client) | accepted, no CORS grant |
| `tauri://localhost` | accepted, echoed in `Access-Control-Allow-Origin` |
| `http://tauri.localhost` | accepted, echoed |
| anything else | `403` before the body is read or the database is called |

Matching is exact and case-sensitive. The staging site, its preview origin, `https://linku99.com`, every `localhost` origin (including `http://localhost:1420`) and every suffix, scheme, port or case variant are refused. Local development uses mocked or local handlers, not a deployed allowlist entry.

Every response carries `Access-Control-Allow-Methods: POST,OPTIONS`, `Access-Control-Expose-Headers: x-correlation-id`, `Cache-Control: no-store` and `Vary: Origin`. An allowed preflight returns `204`. The allowed request headers are endpoint-specific and exact:

| Endpoint | `Access-Control-Allow-Headers` |
| --- | --- |
| `bridge-pair` | `content-type` |
| `bridge-revoke` | `x-ingest-token` |

Neither endpoint allows `authorization`, `apikey` or `x-client-info`.

CORS is not the authorization boundary. Both functions set `verify_jwt = false` in `supabase/config.toml` because the desktop has no user JWT; the handlers authenticate at the application layer before any protected action: `bridge-pair` by the one-time 80-bit pairing code, `bridge-revoke` by the current ingest token. Both refuse to run against any backend other than staging.

**Unresolved deployment gate.** With `verify_jwt = false`, `bridge-pair` is reachable by anyone on the internet. Guessing a code is infeasible, but nothing in this patch limits request volume. The per-worker pending-claim limit below is database backpressure, not request-volume limiting, and does not satisfy this gate. Lovable support has reported in writing (not independently verified here) that Lovable Cloud has no configurable trusted gateway or per-function rate limiter that runs before the Edge Function handler. Before deployment, the public pairing endpoint needs independently verified trusted gateway or platform request limiting. That evidence does not exist in this repository. Do not substitute throttling keyed on a forwarded-address header (spoofable) or a database failure bucket (lets invalid traffic deny valid codes); both are deliberately absent.

## Pair response

Success, `200`, `Cache-Control: no-store`:

```json
{
  "event_id": "<uuid>",
  "event_name": "<string, omitted when unavailable>",
  "ingest_token": "<exactly 64 lowercase hexadecimal characters>",
  "endpoint_url": "https://<backend>/functions/v1/now-playing-ingest"
}
```

`endpoint_url` is the only endpoint field. It is always the HTTPS ingest endpoint of the staging backend, built by the function from its own configuration and never taken from the database or the request. The obsolete `edge_function_url` field is not emitted.

`ingest_token` in a pairing success always matches `^[0-9a-f]{64}$`. The function refuses to forward anything else, including the legacy 48-character shape.

A client must treat a `200` as a failure and store nothing unless `event_id`, `ingest_token` and `endpoint_url` are all present, `ingest_token` matches `^[0-9a-f]{64}$`, and `endpoint_url` is exactly `https://<staging backend host>/functions/v1/now-playing-ingest` (scheme `https`, expected host, no port, credentials, query or fragment). The client must not fall back to a built-in endpoint.

## Error categories

| Category | Status | Body | Meaning | Client action |
| --- | --- | --- | --- | --- |
| Pairing unavailable | `404` | `{"error":"pairing_unavailable"}` | Malformed request or code or wrong protocol version (refused before admission, so always `404`), or a well-formed code that the database reports unknown, expired or already claimed (only once the claim is admitted; while the worker is full it gets the `503` instead). Deliberately indistinguishable. Any future throttle that depends on the code, the nonce or past attempts must use this same response; load shedding that depends on none of them uses `503` | Ask for a new code. Do not retry the same code with a new nonce |
| Service unavailable | `503` | `{"error":"service_unavailable"}` plus `x-correlation-id` when the database was reached | Backend not available or busy (including this worker's pending-claim limit being full), or not the staging backend. A busy `503` never reaches the database and carries no `x-correlation-id` | Retry the same code with the **same** nonce |
| Origin not allowed | `403` | `{"error":"origin_not_allowed"}` | Browser origin outside the allowlist | None |
| Method not allowed | `405` | `{"error":"method_not_allowed"}` | Not `POST`/`OPTIONS` | None |

## Expiration and single use

- A code is claimable while `expires_at > now` and its event is active, not ended, and still owned by the user who generated it.
- The claim locks the event row, then the code row, and marks the code claimed in the same transaction that rotates the token. Concurrent claims of one code with different nonces produce exactly one winner.
- A refused attempt writes nothing. There is no failure counter, evidence row or persistent budget, and invalid traffic can never make a valid claim return `404`. It can delay one: while a worker's pending-claim limit is full, a valid claim gets the retryable `503` (see below). Nothing accumulates. The control is the 80-bit single-use code with a five-minute life: guessing one live code needs on the order of 2^79 requests. Persistent evidence was removed because it enforced nothing; `public.bridge_pair_attempts` is no longer written, and its existing rows age out under the installed 24-hour retention job. Request-volume limiting belongs at the gateway and is an unresolved deployment gate (see above).
- Cleanup of claimed rows is lazy. A claimed row is not removed when its retry window ends; it only stops being usable. It is deleted the next time a code is generated for the same event, if it is then more than one hour old, or when the owner rotates the token, or with its event. No scheduled job removes it, so an event that never generates another code keeps its last claimed row (hashes only) until the event is deleted. Unclaimed rows are deleted by the next generation for that event.

## Pending-claim limit

Status: source only, provisional and uncalibrated. Source: `supabase/functions/_shared/bridge-admission.ts`, used only by `bridge-pair`.

- Each `bridge-pair` worker allows at most **four** claim calls in flight at once. This is database backpressure, not request-volume limiting: it bounds how many claim calls one worker has waiting on Postgres. It is not shared between workers (the total across the service is four times the number of workers, which is not known), keeps no counter of past requests or failures, reads no network address, and starts empty whenever a worker starts.
- Malformed input (body, media type, query, protocol version, code or nonce) gets the `404` before admission. It takes no slot and makes no claim call, whether or not the worker is full.
- A slot is taken only for a well-formed request, immediately before the claim call. When all four slots are taken, a well-formed request, whatever the state of its code, is answered at once with `503 {"error":"service_unavailable"}`: no queue, no database call, no log line and no `x-correlation-id`. Nothing about the code changes; it stays claimable until it expires.
- An admitted claim that the database refuses (unknown, expired or already claimed) gets the `404`, and its slot is freed.
- A slot is released exactly once, when the claim call itself settles (success, refusal, database error, invalid response or thrown error). A claim call that throws before returning a promise frees its slot immediately. A caller disconnect or a timer never frees a slot while its call is still pending.
- If a claim call never settles, its slot stays taken for the life of that worker. Four hung calls make that worker answer every valid claim with `503` until the platform replaces the worker. How long a hung call can last depends on database, PostgREST and HTTP-client timeouts that are not verified from this repository. Freeing a slot early would instead let unbounded concurrent calls reach Postgres.
- `bridge-revoke` has no such limit and never shares this one, so pairing overload never sheds a revoke at the function. Both still share the same database.

**What a DJ with a valid code experiences.** If a worker is full, the desktop's claim gets the `503` and, under the client rule above, retries the same code with the same nonce until a slot is free. If a successful response is lost, a retry with the same nonce returns the same token within the two-minute retry window, provided it is admitted. Sustained overload can exhaust the five-minute first-claim window (the code then expires and the DJ must generate a new one) or the two-minute same-nonce recovery window (the claim has already rotated the event's token, so every earlier device has stopped working, and the desktop can no longer recover the issued token through pairing; the DJ must generate a new code and pair again). The server cannot tell whether a lost response reached anyone; the issued token remains the event's current token until the next pairing, owner rotation or revoke. Desktop retry and backoff behaviour is not verified from this repository.

## Idempotent retry

A repeat of a successful claim returns the same token only when all of these hold:

1. Same canonical code and same `client_nonce` (compared by SHA-256; neither is stored in plaintext). The nonce selects which earlier attempt is being repeated; it does not authenticate anything.
2. Within two minutes of the first claim.
3. The token issued by that claim is still the event's current token (compared by SHA-256). Any later pairing, owner rotation or revoke ends the retry.
4. The event is still active.

A different nonce never reclaims a claimed code. Retry needs no stored plaintext code: the token is read from the integration row, where it already lives.

## Token rotation and revocation

- **Token shapes.** Pairing and every rotation issue exactly 64 lowercase hexadecimal characters (`^[0-9a-f]{64}$`). Revocation accepts exactly a legacy 48-character or a v2 64-character lowercase hexadecimal token (`^(?:[0-9a-f]{48}|[0-9a-f]{64})$`); the same rule is applied in the Edge Function and in `bridge_revoke_v2`. Uppercase, underscores, hyphens, other URL-safe strings and every other length are rejected before the database is called.
- **One token, one integration.** A unique index on non-null `event_integrations.ingest_token` enforces it, and the migration refuses to install while any two integrations share a token.
- **Pairing rotates.** The first successful claim replaces the event's ingest token with 32 fresh random bytes. Every previously issued token for that event stops working at once, including a manually copied one.
- **Owner rotation.** `regenerate_ingest_token` replaces the token and deletes the event's v2 pairing rows.
- **Device revoke.** `POST {backend}/functions/v1/bridge-revoke` with header `X-Ingest-Token: <current token>` and no body.
  - The token is read from that header only: never the URL, the body or `Authorization`. A missing or malformed header never reaches the database.
  - The request must be exactly that header. A request with any query string, any body or an `Authorization` header is a `204` no-op that never reaches the database, even if the header token is valid, so a token duplicated into one of those places cannot work by accident. The desktop must therefore send no body, no query and no `Authorization` header.
  - The response is the same `204` with no body for a live, unknown, previously revoked, missing or malformed token. `503` (backend unavailable) means retry.
  - Rotation is atomic: under the event lock the stored token is replaced only if it still equals the presented one. Concurrent or repeated revokes of one token rotate once; a spent token can never rotate that or any other integration.
- One event has one integration and one current token, so a second device paired to the same event replaces the first.

## No-secret-logging requirements

Pairing codes, client nonces, ingest tokens, authorization values and pair response bodies must never appear in logs, error context, URLs, analytics, crash reports, clipboard history beyond the user's own copy action, or diagnostics output. Server logs carry only an event name, a random correlation id, a SQLSTATE, a coarse category and a duration. The web UI holds the code in component memory only.

## Desktop test vectors

Typed input → canonical (hashed/sent) → display:

| Typed | Canonical | Display |
| --- | --- | --- |
| `0123456789ABCDEF` | `0123456789ABCDEF` | `0123-4567-89AB-CDEF` |
| `0123-4567-89AB-CDEF` | `0123456789ABCDEF` | `0123-4567-89AB-CDEF` |
| `GHJK-MNPQ-RSTV-WXYZ` | `GHJKMNPQRSTVWXYZ` | `GHJK-MNPQ-RSTV-WXYZ` |
| `ghjk-mnpq-rstv-wxyz` | `GHJKMNPQRSTVWXYZ` | `GHJK-MNPQ-RSTV-WXYZ` |
| ` ghjk mnpq  rstv wxyz ` | `GHJKMNPQRSTVWXYZ` | `GHJK-MNPQ-RSTV-WXYZ` |
| `g-h-j-k-m-n-p-q-r-s-t-v-w-x-y-z` | `GHJKMNPQRSTVWXYZ` | `GHJK-MNPQ-RSTV-WXYZ` |
| `OIL0-oil1-ABCD-EFGH` | `01100111ABCDEFGH` | `0110-0111-ABCD-EFGH` |
| `OOOO-IIII-LLLL-oilo` | `0000111111110110` | `0000-1111-1111-0110` |

Must be rejected: empty; `123456`; `123-456`; 15 or 17 symbols; any `U`; `_`, tab, newline or other punctuation; any non-ASCII character (for example dotless `ı`, long `ſ`, full-width digits); more than 64 input characters.

The same vectors are executable in `supabase/functions/_shared/bridge-protocol_cases.ts`.

## Separate finding, not changed here

In the repository's reconstruction of the staging catalog, `anon` and `authenticated` hold table-level `SELECT` on `public.bridge_pairing_codes`, `public.bridge_pair_attempts` and `public.event_integrations`, and the owner policy on `event_integrations` lets an event owner read `ingest_token` directly. This patch leaves those ACLs and policies exactly as they are. It avoids depending on them by keeping v2 secrets in `public.bridge_pairing_v2`, which has no grants and no policies. The ACLs need their own review.

## Before installing the migration

**Preflight.** Run `supabase/repair-staged/10_bridge_pairing_preflight.sql` with a read-only database tool. Every statement begins with `SELECT`. It returns catalog metadata (signatures, owners, ACLs, definitions, hashes) and aggregate counts only; it executes no application function and returns no application row, token, pairing code, event identifier or user identifier. Its first statement must return 16 rows, all `MATCH`; the expected values are listed at the top of that file. Its third statement gives the size of the destructive cutover as counts: legacy pairing rows, live unclaimed legacy codes, integrations, Bridge integrations, non-null tokens, duplicate-token groups and token shapes. On any `MISMATCH`, stop and review: the migration's guards are fail-closed and must not be edited to fit an unexplained difference. The preflight has not been executed against any hosted database.

**One transaction.** The migration and the containment script may be run only through a mechanism independently confirmed to execute the complete file in one transaction. Neither file contains `BEGIN`/`COMMIT`, because how the deployment runner frames statements is not known from this repository and adding them blindly could nest or split the transaction. Each file sets a transaction-local marker first; its guards refuse to continue if the marker has not survived, which is what happens when statements are committed one by one.

**Trusted owner.** The migration must be executed as `postgres`, the owner recorded for every captured application function, and refuses to run as any other role or if a prior Bridge routine or table has a different owner. Its post-apply gate uses `aclexplode` and fails on any non-owner grantee other than the intended one: `service_role` for claim and revoke, `authenticated` for generation and owner rotation, nobody for the retired routine and the private table.

**Still requires hosted evidence** (not obtainable from the repository, and not invented here):

- The role the migration runner actually connects as.
- That the runner executes the whole file in one transaction.
- The owners of `events`, `event_integrations` and `bridge_pairing_codes` (expected `postgres`; only function owners are in the captured evidence).
- The three function-body hashes on the hosted database.
- The cutover counts from the preflight's third statement.
- Trusted gateway or platform request limiting for the public pairing endpoint.
