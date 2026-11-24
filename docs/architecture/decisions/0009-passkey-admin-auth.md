# ADR 0009: Passkeys for administrator authentication

- Status: Accepted
- Date: 2026-09-08

## Context

Administrators must be individually named, allow-listed, and strongly
authenticated before they see case data. The baseline documents specified TOTP.
Passkeys with required user verification provide phishing-resistant
authentication without a second password or shared TOTP secret, and they match
the neighbouring Frames admin interface.

The backoffice is a static Vue PWA. Cookie sessions need a same-origin
relationship with the admin API: `SameSite=Strict` cookies are not sent on
cross-origin POSTs from `http://127.0.0.1:5173` to `:8787`, and those two ports
are same-site, so Fetch Metadata `same-site` must be rejected.

## Decision

- Authenticate operators with WebAuthn passkeys (`userVerification: required`,
  discoverable credentials / `residentKey: required`). Do not add TOTP.
- There is no public sign-up. A trusted CLI
  (`pnpm admin:bootstrap -- --email … [--open]`) creates or re-invites a named
  operator and writes a one-use, 15-minute token as a private `0600` HTML file.
  The bearer token is never printed. After initial enrolment, trusted
  maintenance can grant `can_manage_operators` to selected operators. These
  operators can issue or revoke setup links and grant/revoke account-management
  permission for other enrolled, enabled operators in the backoffice; invited
  accounts receive no account-management permission. Existing enrolled accounts
  cannot be re-invited through that interface.
- Account-management writes require authentication within five minutes. The UI
  requests a fresh passkey assertion bound to the initiating account and
  session; success rotates the session and revokes the previous one. Invitation
  tokens are returned once in a no-store response, then kept only in component
  memory. Invitation creation is limited to 20 per manager in 15 minutes;
  creation, revocation and their audit records are transactional. Permission
  changes use the same fresh authentication, serialize against other account
  changes, compare the expected previous permission, and record the target
  account separately from case stream IDs. Self-demotion is rejected, preserving
  a manager even when two managers attempt to demote each other concurrently.
- Ceremonies use an HttpOnly cookie (5 minutes) that is consumed even on
  failure. Sessions are opaque tokens stored as SHA-256 hashes, 30 minutes
  absolute, `SameSite=Strict`. Local cookies are `ah_dev_admin_{originHash}`;
  production uses `__Host-ah_admin` with `Secure`.
- CSRF protection is exact `Origin` plus Fetch Metadata: `cross-site` and
  `same-site` POSTs are rejected. There is no synchronizer token.
- The relying-party ID is the hostname of `ADMIN_ORIGIN`. Locally that is
  `localhost` (not `127.0.0.1`): IP addresses are not valid WebAuthn RP IDs, and
  Safari will reject passkeys there. The backoffice Vite app on port **5174**
  proxies `/admin` to the API on 8787 with `changeOrigin: false` so cookies stay
  first-party. The customer app on 5173 continues to call the reporter API with
  `credentials: omit`.
- Production requires `ADMIN_ORIGIN` as an exact `https` origin. Without it,
  admin routes stay disabled and the reporter API still starts. A later
  deployment should serve the admin SPA and admin API from that same origin.

The first backoffice slice is login plus a read-only case queue from
`ah.case_queue_projection` (workflow state and timestamps only, no private
payloads). Matrix editing and privileged commands remain later work.

## Consequences

Operators need a platform authenticator. Shared admin passwords and TOTP
enrolment are out of scope. Local development needs the 5174 proxy; calling
`/admin` directly on `:8787` is rejected because the `Host` header will not
match. Session idle timeout is not yet separate from the 30-minute absolute
lifetime. See [AH-SEC-011](../../security/security-requirements.md) and threat
model T11/T12.
