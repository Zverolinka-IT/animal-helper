import { randomBytes, randomUUID } from "node:crypto";
import path from "node:path";

import {
  applyCheckoutLocalEnvironment,
  applyMigrations,
  bootstrapOperator,
  createSqlOptions,
  defaultMigrationsDirectory,
  deleteOperatorAccount,
  ensureIntegrationDatabase,
  grantOperatorManagement,
  resolveIntegrationDatabaseUrl,
} from "@animal-helper/event-store";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { loadAdminConfig } from "../src/admin/config.js";
import { createApiHandler, type ApiRequest } from "../src/handler.js";
import { createMemoryGateway } from "../src/memory-gateway.js";
import { softwarePasskey } from "./software-passkey.js";

applyCheckoutLocalEnvironment(
  path.resolve(import.meta.dirname, "../../.."),
  process.env,
);
const origin = "http://localhost:5174";
const config = loadAdminConfig({
  DATABASE_ENVIRONMENT: "local",
  ADMIN_ORIGIN: origin,
});
if (!config) throw new Error("admin config required");
const cookies = (values: readonly string[] | undefined) =>
  (values ?? [])
    .map((v) => v.split(";")[0])
    .filter((value) => value !== undefined && !value.endsWith("="))
    .join("; ");
type RegistrationOptions = Parameters<
  ReturnType<typeof softwarePasskey>["register"]
>[0];
type AuthenticationOptions = Parameters<
  ReturnType<typeof softwarePasskey>["authenticate"]
>[0];

describe.skipIf(resolveIntegrationDatabaseUrl(process.env) === undefined)(
  "operator invitations",
  () => {
    let sql: Sql;
    let handle: ReturnType<typeof createApiHandler>;
    let now = new Date();
    const emails = new Set<string>();
    const address = () => {
      const email = `invitation-${randomUUID()}@example.invalid`;
      emails.add(email);
      return email;
    };
    const request = (
      partial: Partial<ApiRequest> & Pick<ApiRequest, "pathname" | "method">,
    ) =>
      handle({
        search: "",
        authorization: undefined,
        body: undefined,
        origin,
        host: "localhost:5174",
        ...partial,
      });
    beforeAll(async () => {
      const url = await ensureIntegrationDatabase(process.env);
      if (!url) throw new Error("test database required");
      sql = postgres(url, createSqlOptions(process.env, { max: 4 }));
      await applyMigrations(sql, defaultMigrationsDirectory);
      handle = createApiHandler({
        gateway: createMemoryGateway(),
        pepper: randomBytes(32),
        admin: { sql, config },
        now: () => now,
      });
    });
    beforeEach(() => {
      now = new Date();
    });
    afterAll(async () => {
      for (const email of emails) await deleteOperatorAccount(sql, email);
      await sql.end();
    });

    const registrationOptions = async (token: string) => {
      const r = await request({
        method: "POST",
        pathname: "/admin/auth/register/options",
        body: { bootstrapToken: token },
      });
      return {
        r,
        options: (r.body as { options: RegistrationOptions }).options,
        cookie: cookies(r.cookies),
      };
    };
    const enrol = async (manager = false) => {
      const email = address();
      const token = await bootstrapOperator(sql, email, now);
      const key = softwarePasskey();
      const o = await registrationOptions(token);
      expect(o.r.status).toBe(200);
      const registered = await request({
        method: "POST",
        pathname: "/admin/auth/register/verify",
        cookie: o.cookie,
        body: { response: key.register(o.options, origin) },
      });
      expect(registered.status).toBe(200);
      if (manager) await grantOperatorManagement(sql, email);
      return { email, key, cookie: cookies(registered.cookies) };
    };
    const reauthOptions = (cookie: string) =>
      request({
        method: "POST",
        pathname: "/admin/auth/reauth/options",
        cookie,
        body: {},
      });
    const confirm = async (operator: Awaited<ReturnType<typeof enrol>>) => {
      const o = await reauthOptions(operator.cookie);
      expect(o.status).toBe(200);
      const options = (o.body as { options: AuthenticationOptions }).options;
      const verified = await request({
        method: "POST",
        pathname: "/admin/auth/reauth/verify",
        cookie: `${operator.cookie}; ${cookies(o.cookies)}`,
        body: { response: operator.key.authenticate(options, origin) },
      });
      expect(verified.status).toBe(200);
      return cookies(verified.cookies);
    };
    const invite = (cookie: string, email = address()) =>
      request({
        method: "POST",
        pathname: "/admin/operators/invitations",
        cookie,
        body: { email },
      });
    const list = (cookie?: string) =>
      request({
        method: "GET",
        pathname: "/admin/operators/invitations",
        ...(cookie === undefined ? {} : { cookie }),
      });
    const created = (response: Awaited<ReturnType<typeof invite>>) =>
      response.body as {
        invitation: { id: string; email: string };
        setupUrl: string;
      };
    const token = (url: string) =>
      new URLSearchParams(new URL(url).hash.slice(1)).get("bootstrap") ?? "";

    it("enforces permission, exact origin and a strict invitation body on the server", async () => {
      const ordinary = await enrol();
      expect((await list()).status).toBe(401);
      expect((await list(ordinary.cookie)).status).toBe(403);
      expect((await invite(ordinary.cookie)).status).toBe(403);
      const manager = await enrol(true);
      const email = address();
      expect(
        (
          await request({
            method: "POST",
            pathname: "/admin/operators/invitations",
            cookie: manager.cookie,
            body: { email, canManageOperators: true },
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await request({
            method: "POST",
            pathname: "/admin/operators/invitations",
            cookie: manager.cookie,
            origin: "https://untrusted.example",
            body: { email },
          })
        ).status,
      ).toBe(403);
      expect(
        (await sql`select 1 from ah.operators where email = ${email}`).length,
      ).toBe(0);
    });

    it("requires fresh authentication, rotates the session, and enrols the invited person without management permission", async () => {
      const manager = await enrol(true);
      now = new Date(now.getTime() + 6 * 60 * 1000);
      expect((await invite(manager.cookie)).body).toMatchObject({
        error: { code: "reauth_required" },
      });
      const fresh = await confirm(manager);
      expect((await list(manager.cookie)).status).toBe(401);
      const result = await invite(fresh);
      expect(result.status).toBe(201);
      expect(result.headers["cache-control"]).toBe("no-store");
      const link = created(result);
      expect(new URL(link.setupUrl).origin).toBe(origin);
      expect(new URL(link.setupUrl).search).toBe("");
      const pending = await list(fresh);
      expect(JSON.stringify(pending.body)).not.toContain(token(link.setupUrl));
      expect(
        (pending.body as { invitations: { id: string }[] }).invitations.map(
          (i) => i.id,
        ),
      ).toContain(link.invitation.id);
      const o = await registrationOptions(token(link.setupUrl));
      const key = softwarePasskey();
      const registered = await request({
        method: "POST",
        pathname: "/admin/auth/register/verify",
        cookie: o.cookie,
        body: { response: key.register(o.options, origin) },
      });
      expect(registered.body).toMatchObject({
        operator: { email: link.invitation.email, canManageOperators: false },
      });
      expect((await list(cookies(registered.cookies))).status).toBe(403);
      expect((await registrationOptions(token(link.setupUrl))).r.status).toBe(
        401,
      );
      expect((await invite(fresh, link.invitation.email)).status).toBe(409);
    });

    it("invalidates superseded links and revokes an invitation even after its registration ceremony starts", async () => {
      const manager = await enrol(true);
      const email = address();
      const first = created(await invite(manager.cookie, email));
      const second = created(await invite(manager.cookie, email));
      expect((await registrationOptions(token(first.setupUrl))).r.status).toBe(
        401,
      );
      const o = await registrationOptions(token(second.setupUrl));
      expect(o.r.status).toBe(200);
      expect(
        (
          await request({
            method: "POST",
            pathname: `/admin/operators/invitations/${second.invitation.id}/revoke`,
            cookie: manager.cookie,
            body: {},
          })
        ).status,
      ).toBe(204);
      const key = softwarePasskey();
      const verified = await request({
        method: "POST",
        pathname: "/admin/auth/register/verify",
        cookie: o.cookie,
        body: { response: key.register(o.options, origin) },
      });
      expect(verified.status).toBe(401);
      expect((await registrationOptions(token(second.setupUrl))).r.status).toBe(
        401,
      );
    });

    it("binds passkey confirmation to the same account, session and ceremony type", async () => {
      const manager = await enrol(true);
      const another = await enrol(true);
      const o = await reauthOptions(manager.cookie);
      const options = (
        o.body as {
          options: AuthenticationOptions & {
            allowCredentials: { id: string }[];
          };
        }
      ).options;
      expect(options.allowCredentials).toHaveLength(1);
      const wrongKey = await request({
        method: "POST",
        pathname: "/admin/auth/reauth/verify",
        cookie: `${manager.cookie}; ${cookies(o.cookies)}`,
        body: { response: another.key.authenticate(options, origin) },
      });
      expect(wrongKey.status).toBe(401);
      const bound = await reauthOptions(manager.cookie);
      const exchanged = await request({
        method: "POST",
        pathname: "/admin/auth/reauth/verify",
        cookie: `${another.cookie}; ${cookies(bound.cookies)}`,
        body: {
          response: manager.key.authenticate(
            (bound.body as { options: AuthenticationOptions }).options,
            origin,
          ),
        },
      });
      expect(exchanged.status).toBe(401);
      const ordinary = await request({
        method: "POST",
        pathname: "/admin/auth/login/options",
        body: {},
      });
      expect(
        (
          await request({
            method: "POST",
            pathname: "/admin/auth/reauth/verify",
            cookie: `${manager.cookie}; ${cookies(ordinary.cookies)}`,
            body: {
              response: manager.key.authenticate(
                (ordinary.body as { options: AuthenticationOptions }).options,
                origin,
              ),
            },
          })
        ).status,
      ).toBe(401);
      const revoked = await reauthOptions(manager.cookie);
      await request({
        method: "POST",
        pathname: "/admin/auth/logout",
        cookie: manager.cookie,
        body: {},
      });
      expect(
        (
          await request({
            method: "POST",
            pathname: "/admin/auth/reauth/verify",
            cookie: `${manager.cookie}; ${cookies(revoked.cookies)}`,
            body: {
              response: manager.key.authenticate(
                (revoked.body as { options: AuthenticationOptions }).options,
                origin,
              ),
            },
          })
        ).status,
      ).toBe(401);
    });

    it("checks permission changes immediately and rejects expired invitations", async () => {
      const manager = await enrol(true);
      const link = created(await invite(manager.cookie));
      now = new Date(now.getTime() + 16 * 60 * 1000);
      expect((await registrationOptions(token(link.setupUrl))).r.status).toBe(
        401,
      );
      await sql`update ah.operators set can_manage_operators = false where email = ${manager.email}`;
      expect((await list(manager.cookie)).status).toBe(403);
      expect((await invite(manager.cookie)).status).toBe(403);
    });

    it("lets a manager grant and revoke account management after fresh passkey authentication", async () => {
      const manager = await enrol(true);
      const ordinary = await enrol();
      const accounts = (cookie?: string) =>
        request({
          method: "GET",
          pathname: "/admin/operators/accounts",
          ...(cookie ? { cookie } : {}),
        });
      expect((await accounts()).status).toBe(401);
      expect((await accounts(ordinary.cookie)).status).toBe(403);
      const enrolled = await accounts(manager.cookie);
      expect(enrolled.status).toBe(200);
      const people = (
        enrolled.body as { operators: { id: string; email: string }[] }
      ).operators;
      const id = people.find((person) => person.email === ordinary.email)?.id;
      const ownId = people.find((person) => person.email === manager.email)?.id;
      if (!id || !ownId)
        throw new Error("Enrolled accounts missing from management list");
      const change = (
        cookie: string,
        target: string,
        value: boolean,
        expected: boolean,
      ) =>
        request({
          method: "POST",
          pathname: `/admin/operators/accounts/${target}/management`,
          cookie,
          body: {
            canManageOperators: value,
            expectedCanManageOperators: expected,
          },
        });
      expect((await change(ordinary.cookie, id, true, false)).status).toBe(403);
      expect(
        (await change(manager.cookie, ownId, false, true)).body,
      ).toMatchObject({ error: { code: "self_management" } });
      now = new Date(now.getTime() + 6 * 60 * 1000);
      expect(
        (await change(manager.cookie, id, true, false)).body,
      ).toMatchObject({ error: { code: "reauth_required" } });
      manager.cookie = await confirm(manager);
      expect((await change(manager.cookie, id, true, false)).status).toBe(204);
      // Existing sessions pick up permission changes without re-enrolment.
      expect((await accounts(ordinary.cookie)).status).toBe(200);
      expect(
        (await change(manager.cookie, id, false, false)).body,
      ).toMatchObject({ error: { code: "conflict" } });
      expect((await change(manager.cookie, id, false, true)).status).toBe(204);
      expect((await accounts(ordinary.cookie)).status).toBe(403);
      const audit = await sql<{ action: string; stream_id: string | null }[]>`
        select action, stream_id from ah.audit_events where target_operator_id = ${id}::uuid order by occurred_at
      `;
      expect(audit.map((row) => row.action)).toEqual([
        "operator_management_granted",
        "operator_management_revoked",
      ]);
      expect(audit.every((row) => row.stream_id === null)).toBe(true);
      expect(
        (
          await request({
            method: "POST",
            pathname: `/admin/operators/accounts/${id}/management`,
            cookie: manager.cookie,
            origin: "https://untrusted.example",
            body: {
              canManageOperators: true,
              expectedCanManageOperators: false,
            },
          })
        ).status,
      ).toBe(403);
    });

    it("serializes mutual demotion so a manager always remains", async () => {
      const a = await enrol(true);
      const b = await enrol(true);
      const rows = await sql<
        { operator_id: string; email: string }[]
      >`select operator_id, email from ah.operators where email in (${a.email}, ${b.email})`;
      const demote = (actor: typeof a, email: string) => {
        const target = rows.find((row) => row.email === email);
        if (!target) throw new Error("Enrolled target missing");
        return request({
          method: "POST",
          pathname: `/admin/operators/accounts/${target.operator_id}/management`,
          cookie: actor.cookie,
          body: { canManageOperators: false, expectedCanManageOperators: true },
        });
      };
      const result = await Promise.all([
        demote(a, b.email),
        demote(b, a.email),
      ]);
      expect(result.map((item) => item.status).sort()).toEqual([204, 403]);
      const [remaining] = await sql<
        { count: number }[]
      >`select count(*)::integer as count from ah.operators where email in (${a.email}, ${b.email}) and can_manage_operators`;
      expect(remaining?.count).toBe(1);
    });

    it("serializes simultaneous reissues and bounds invitation creation per manager", async () => {
      const manager = await enrol(true);
      const email = address();
      const [a, b] = await Promise.all([
        invite(manager.cookie, email),
        invite(manager.cookie, email),
      ]);
      expect(a.status).toBe(201);
      expect(b.status).toBe(201);
      const tokens = [token(created(a).setupUrl), token(created(b).setupUrl)];
      const active = await Promise.all(
        tokens.map(async (t) => (await registrationOptions(t)).r.status),
      );
      expect(active.sort()).toEqual([200, 401]);
      for (let i = 0; i < 18; i++)
        expect((await invite(manager.cookie)).status).toBe(201);
      expect((await invite(manager.cookie)).status).toBe(429);
    });
  },
);
