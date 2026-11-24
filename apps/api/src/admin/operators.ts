import {
  operatorInvitationRequestSchema,
  operatorManagementRequestSchema,
} from "@animal-helper/contracts";
import {
  createOperatorInvitation,
  hashOpaqueToken,
  listOperatorInvitations,
  listOperatorAccounts,
  setOperatorManagement,
  revokeOperatorInvitation,
} from "@animal-helper/event-store";

import type { ApiRequest, ApiResponse } from "../handler.js";
import type { AdminHandlerOptions } from "./handle.js";

// The parent handler has already checked host, exact origin, method and query.
export const handleOperatorInvitations = async (
  request: ApiRequest,
  { sql, config }: AdminHandlerOptions,
  sessionToken: string | undefined,
  now: Date,
): Promise<ApiResponse> => {
  const json = (status: number, body: unknown): ApiResponse => ({
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
    },
    body,
  });
  const fail = (code: string, status: number) =>
    json(status, { ok: false, error: { code } });
  if (sessionToken === undefined) return fail("unauthenticated", 401);
  const sessionHash = hashOpaqueToken(sessionToken);
  if (
    request.method === "GET" &&
    request.pathname === "/admin/operators/accounts"
  ) {
    return json(200, {
      operators: await listOperatorAccounts(sql, sessionHash, now),
    });
  }
  const management =
    /^\/admin\/operators\/accounts\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/management$/.exec(
      request.pathname,
    );
  if (request.method === "POST" && management?.[1]) {
    const body = operatorManagementRequestSchema.safeParse(request.body);
    if (!body.success) return fail("invalid_request", 400);
    await setOperatorManagement(
      sql,
      sessionHash,
      management[1],
      body.data,
      now,
    );
    return json(204, null);
  }
  if (
    request.method === "GET" &&
    request.pathname === "/admin/operators/invitations"
  ) {
    return json(200, {
      invitations: await listOperatorInvitations(sql, sessionHash, now),
    });
  }
  if (
    request.method === "POST" &&
    request.pathname === "/admin/operators/invitations"
  ) {
    const body = operatorInvitationRequestSchema.safeParse(request.body);
    if (!body.success) return fail("invalid_request", 400);
    const { invitation, token } = await createOperatorInvitation(
      sql,
      sessionHash,
      body.data.email,
      now,
    );
    const url = new URL(config.origin);
    url.hash = `bootstrap=${token}`;
    return json(201, { invitation, setupUrl: url.href });
  }
  const revoke =
    /^\/admin\/operators\/invitations\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/revoke$/.exec(
      request.pathname,
    );
  if (request.method === "POST" && revoke?.[1] !== undefined) {
    await revokeOperatorInvitation(sql, sessionHash, revoke[1], now);
    return json(204, null);
  }
  return fail("not_found", 404);
};
