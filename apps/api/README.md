# API

Local Node HTTP command and status boundary. Production runs this same handler
as a Vercel Function in `fra1`, on one origin with the backoffice build so admin
cookies stay first-party.

The API is the sole public domain-command boundary. It:

- validates versioned contracts;
- authenticates a case capability;
- invokes the event-store adapter;
- returns explicit, non-sensitive command and status results.

It does not proxy bulk media, expose tables directly to browsers, or log
capabilities, command bodies, or `Authorization` headers.

## Local endpoints

`npm run dev` starts Docker Postgres, this process on `http://127.0.0.1:8787`,
the customer Vite app on `http://localhost:5173`, and the backoffice on
`http://localhost:5174`. Loopback API processes default CORS to the customer
origin only. Admin routes are cookie-authenticated on the backoffice origin
([ADR 0009](../../docs/architecture/decisions/0009-passkey-admin-auth.md)).
Ctrl+C does not stop Postgres; use `pnpm db:down`.

| Method | Path        | Auth                                    | Purpose                                      |
| ------ | ----------- | --------------------------------------- | -------------------------------------------- |
| `GET`  | `/health`   | none                                    | liveness                                     |
| `GET`  | `/guidance` | none                                    | active injured guidance, or bundled fallback |
| `POST` | `/commands` | `Authorization: Capability <base64url>` | reporter draft commands                      |
| `GET`  | `/status`   | `Authorization: Capability <base64url>` | public `draft/received/closed`               |

Admin routes (same origin as the backoffice PWA; ceremony or session cookie):

| Method | Path                                     | Purpose                            |
| ------ | ---------------------------------------- | ---------------------------------- |
| `POST` | `/admin/auth/register/options`           | passkey registration options       |
| `POST` | `/admin/auth/register/verify`            | finish passkey registration        |
| `POST` | `/admin/auth/login/options`              | passkey assertion options          |
| `POST` | `/admin/auth/login/verify`               | finish passkey sign-in             |
| `POST` | `/admin/auth/logout`                     | revoke session                     |
| `GET`  | `/admin/session`                         | restore operator                   |
| `GET`  | `/admin/queue`                           | read-only case queue               |
| `GET`  | `/admin/guidance`                        | guidance draft/publication summary |
| `GET`  | `/admin/guidance/kind/injured/{kindKey}` | editable cells and preview items   |
| `POST` | `/admin/guidance/cells`                  | save one instruction cell          |
| `POST` | `/admin/guidance/publish`                | publish the current draft          |

Reporter commands in this slice: `create_draft`, `attach_private_data`,
`submit_draft`. Administrator domain commands still return
`UNSUPPORTED_COMMAND`. Query strings on `/commands`, `/status`, and `/guidance`
are rejected (`AH-SEC-007`, `AH-SEC-046`). Create operators with
`pnpm admin:bootstrap`.
