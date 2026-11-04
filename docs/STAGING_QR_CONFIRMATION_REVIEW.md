# Staging QR and confirmation review — 2026-11-04

## Boundaries

Source/UI changes only. No SQL, migrations, function deployments, Auth configuration changes, account creation, session minting, email sending, provider calls, secrets, publication or production operations. Staging guest feature flag unchanged ON. GUESTQB fixtures untouched. Managed welcome sender remains fail-closed; signup no longer invokes it before/after confirmation.

## QR

- Inspected the existing official `public/brand/decks-logo-mark-transparent.png`: blue-to-purple disc with horizontal opposing arrows; unchanged.
- Management header (`DJEventManage`, 160px) and dashboard modal (`DJDashboard`, 260px) both already use `EventQR`; both now inherit the same branded configuration. Their existing copy links use the same current-origin room-code destination. No camera scanner or Bridge pairing changes.
- Black square modules on white, H correction, four **internal** quiet-zone modules, centered excavated logo box 18% of total canvas size. Because the official image includes transparent space, visible disc is smaller than that box.
- Separate 1024px export uses the identical destination/configuration. Download disabled until embedded image load; actual export requires complete/nonzero image, successful decode and two animation frames for the QR library's paint effect. Missing/decode/taint/export failures never silently save an unbranded image.
- Native browser check mounted the actual shared component without signing in or touching fixtures. Independent ZXing decoding passed for GUESTQB and ROOM2 at 160px and 260px, and all four actual PNG downloads (1024×1024), each pointing to current localhost origin `/join?code=<code>`. Download top border was confirmed white. This checks renderer/export, not physical phone scanning or signed-in management navigation.

## Confirmation

- `Auth` signup without a confirmed session stays in a reload-persistent tab-scoped check-email state; password cleared, no account-success/welcome claim or welcome dispatch.
- `UpgradeAccountDialog` event guest binds claim intent to submitted email, retains proof, stays open awaiting confirmation, and does not attempt claim with a missing/unconfirmed session.
- Legacy anonymous `updateUser` supplies the same-origin callback redirect and awaits confirmation without claiming verification. Legacy profile completion is deferred to a verified same-identity callback.
- All callback URLs use `window.location.origin` + `/auth/callback?next=<safe local destination>`; DJ onboarding, event and profile continuations covered. Off-origin, backslash, control-character and protocol-relative destinations are rejected.
- Pending state stores only email, next, resend deadline/type and optional legacy profile completion identifiers; never passwords, tokens or guest proof. It survives reload/dialog reopen in that tab. Guest proof/intent remain in their existing store across confirmation.
- Explicit resend uses hosted Auth `signup` or legacy `email_change`, with 60-second cooldown persisted across remount. Failed attempts also consume cooldown and show an inline retryable error; successful request does not assert delivery.
- Callback errors remain visible with a return-to-confirmation/sign-in action, including error-only query/hash links. Callback uses server-revalidated `getUser`, requires a confirmed registered account and matching pending email, checks legacy identity before profile completion, then invokes the existing matching-email guest claim. Guest claim itself now revalidates via `getUser`; failed claim keeps proof and confirmation state.
- No real confirmation send/click or new-tab legacy-upgrade acceptance was performed. Pending confirmation UI is deliberately tab-scoped; cross-tab guest proof remains unchanged. Root should test legacy completion and provider-specific callback hydration with the safe inbox.

## Hosted read-only findings

Read public hosted `/auth/v1/settings` without logging credentials or addresses:

| Setting | Actual observed value |
| --- | --- |
| `mailer_autoconfirm` | false — confirmation ON |
| `disable_signup` | false — signup enabled |
| `external.email` | true |
| `external.anonymous_users` | true — legacy setting unchanged |

Read-only redirect tool showed the staging preview wildcard `https://id-preview*--3bde3db6-ee77-4460-95f2-891bb19a0278.lovable.app/**`, which covers this staging callback and query. Site URL is the published app, `https://encore-request-rally.lovable.app`; source now supplies an explicit staging callback to avoid falling back to it. Settings were not altered.

Bounded Auth log query over 2026-11-03 00:00 UTC through 2026-11-04 05:20 UTC grouped only path/status counts for HTTP ≥400 or error-level entries and returned zero rows. No addresses, payloads or raw error text were requested. This does **not** prove email delivery or absence of unlogged sender errors. The separate Lovable Auth CLI settings read reported that its product is not enabled; it was not used to infer Cloud settings. Actual Cloud settings above came from the successful hosted settings read.

## Checks

- Focused Vitest suite: QR configuration/export, confirmation persistence/cooldown/errors, Auth signup/legacy upgrade, callback verified/mismatch/failure continuations, guest claim, upgrade dialog and existing GuestProvider regressions.
- Typecheck: `tsgo -p tsconfig.app.json --noEmit`.
- Authored changed TypeScript lint: ESLint with zero warnings.
- Native automatic preview build only; no manual build or full SQL suite.
- Browser confirmed persistent check-email state on desktop/mobile and invalid callback error state. No real signup/resend form was submitted.

## Exact changed source files

```
AGENTS.md
roadmap.md
docs/STAGING_QR_CONFIRMATION_REVIEW.md
src/index.css
src/components/EventQR.tsx
src/components/EmailConfirmationNotice.tsx
src/components/UpgradeAccountDialog.tsx
src/components/UpgradeAccountDialog.guest.test.tsx
src/hooks/useEmailConfirmation.ts
src/hooks/useEmailConfirmation.test.tsx
src/lib/eventQR.ts
src/lib/eventQR.test.ts
src/lib/emailConfirmation.ts
src/lib/emailConfirmation.test.ts
src/lib/authCallback.ts
src/lib/authCallback.test.ts
src/lib/guestClient.ts
src/lib/guestClient.claim.test.ts
src/pages/Auth.tsx
src/pages/Auth.confirmation.test.tsx
src/pages/AuthCallback.tsx
src/pages/AuthCallback.confirmation.test.tsx
```

Project constraint memory/index additionally record the user's QR styling and no-email-until-safe-inbox requirements. No global logo asset changed.

## Remaining gate

User must supply a safe test inbox address and authorize the bounded delivery test. Only then verify actual delivery and clicked confirmation continuation/guest claim; do not change Auth settings or managed welcome sender/domain as a substitute. Root independently runs final full build/tests.