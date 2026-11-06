# Staging email diagnosis (read-only) and proposed repair

Nothing was changed. Checks run: a repo search, a read of `auth-email-hook` and the staged E0 containment SQL, `.env` ref, and the platform email-domain status.

## 1. Separate backends
- This project's preview and published app both use staging ref `ldxgejbzmpvsvozqmpfe`. That matches `.env` and the Cloud project info.
- The live linku99.com bundle points to `rwdgnapajxcxktmewlxb`, so it is a different backend. I cannot open that project from here.
- One catch: the sender domain `notify.linku99.com` is active and linked to **this staging project's** email setup, with auth emails enabled. So the staging backend sends under the linku99 brand, even though the linku99.com website runs on another backend.

## 2. Why dispatch and wake do nothing
- The repo never sets those bodies. The staged E0 containment file only changes permissions (revoke/grant) and search_path. It says outright that it "Changes NO function body".
- The platform now uses managed sending: emails go out synchronously through Lovable's email API, with no project queue, cron job or Vault key. The current platform guidance says so, and so does the managed-sending note in AGENTS.md.
- So the empty bodies, missing triggers, missing cron job and missing Vault secret are most likely the platform turning the old queue off on purpose. It is not broken scaffolding that needs finishing. (Unverified, see 5.)
- The real gap is the repo's `auth-email-hook`. It is still the old shape: it calls `rpc('enqueue_email')` and writes `email_send_log` pending rows. It does not use the managed `createAuthEmailHandler`. Because of that, auth emails land in a queue that nothing drains. That explains the 4 unread `q_auth_emails` rows and the 4 pending log rows.

## 3. process-email-queue
- Under managed sending it should not exist at all, neither run by Lovable nor as project source. Delivery and retries happen on Lovable's side.
- In the old design it was a project Edge Function, called by cron through Vault. Its absence from the repo fits the move to managed sending.

## 4. Staging-only repair (not performed)
1. Re-scaffold the auth email templates with overwrite confirmed. This replaces `auth-email-hook` with the managed `createAuthEmailHandler` shape and keeps all six email types.
2. Re-apply DECKS branding to the templates. Keep the email background white.
3. Deploy only `auth-email-hook` to `ldxgejbzmpvsvozqmpfe`.
4. Don't create a cron job, a wake trigger, a `process-email-queue` function or a dispatch body.
5. **Vault secret:** none is needed. Under managed sending no `email_queue_service_role_key` should be created. It also cannot be set up correctly on Lovable Cloud, because the service-role key is not available to us.
6. **The 4 queued rows:** they would stay untouched. Under managed sending they will never be sent. Clearing or replaying them is a separate decision for you. Replaying would send old confirmation emails.
7. **Verification:** send one confirmation to a safe test inbox that you authorize, then check the delivery logs. This step needs your separate approval, because sending is still blocked.

## 5. What I cannot verify
- That the platform itself (not root or an earlier migration) wrote the empty dispatch/wake bodies. I did not query the live database, per your instructions.
- What the currently deployed `auth-email-hook` contains, compared with the repo source.
- Whether auth is actually wired to the hook right now, and whether real auth emails are currently failing or using the default sender.
- Anything about the `rwdgnapajxcxktmewlxb` project, including whether it also uses `notify.linku99.com`.
- Whether you want staging sending under the production brand domain at all. If not, a separate staging sender domain is a different, larger change.
