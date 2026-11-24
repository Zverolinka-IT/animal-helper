import { randomUUID } from "node:crypto";

import type {
  OperatorAccount,
  OperatorInvitation,
} from "@animal-helper/contracts";
import type { Sql } from "postgres";

import {
  hashOpaqueToken,
  newOpaqueToken,
  normalizeOperatorEmail,
  OPERATOR_BOOTSTRAP_SECONDS,
  recordOperatorAudit,
  withOperatorTransaction,
} from "./operators.js";

export const OPERATOR_FRESH_AUTH_SECONDS = 5 * 60;
const INVITATION_LIMIT = 20;

type ManagementErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "reauth_required"
  | "operator_exists"
  | "not_found"
  | "conflict"
  | "self_management"
  | "rate_limited";

export class OperatorManagementError extends Error {
  readonly code: ManagementErrorCode;
  readonly status: number;

  constructor(code: ManagementErrorCode, status: number) {
    super(code);
    this.name = "OperatorManagementError";
    this.code = code;
    this.status = status;
  }
}

type Manager = {
  operator_id: string;
  email: string;
  created_at: Date;
  can_manage_operators: boolean;
};

const requireManager = async (
  sql: Sql,
  sessionHash: Buffer,
  now: Date,
  fresh = false,
): Promise<Manager> => {
  const [manager] = await sql<Manager[]>`
    select o.operator_id, o.email, s.created_at, o.can_manage_operators
    from ah.operators o join ah.operator_sessions s on s.operator_id = o.operator_id
    where s.token_hash = ${sessionHash} and s.revoked_at is null
      and s.expires_at > ${now} and o.enabled
    for update of o, s
  `;
  if (!manager) throw new OperatorManagementError("unauthenticated", 401);
  if (!manager.can_manage_operators)
    throw new OperatorManagementError("forbidden", 403);
  if (
    fresh &&
    (manager.created_at.getTime() <
      now.getTime() - OPERATOR_FRESH_AUTH_SECONDS * 1000 ||
      manager.created_at > now)
  ) {
    throw new OperatorManagementError("reauth_required", 403);
  }
  return manager;
};

export const listOperatorInvitations = async (
  sql: Sql,
  sessionHash: Buffer,
  now: Date,
): Promise<readonly OperatorInvitation[]> =>
  withOperatorTransaction(sql, async (tx) => {
    const actor = await requireManager(tx, sessionHash, now);
    const rows = await tx<
      {
        invitation_id: string;
        email: string;
        created_at: Date;
        expires_at: Date;
      }[]
    >`
    select b.invitation_id, o.email, b.created_at, b.expires_at
    from ah.operator_bootstraps b join ah.operators o on o.operator_id = b.operator_id
    where b.consumed_at is null and b.expires_at > ${now} and o.enabled
      and not exists (select 1 from ah.operator_passkeys p where p.operator_id = o.operator_id)
    order by b.created_at desc limit 100
  `;
    await recordOperatorAudit(tx, {
      operatorEmail: actor.email,
      action: "operator_invitations_read",
      outcome: "accepted",
    });
    return rows.map((row) => ({
      id: row.invitation_id,
      email: row.email,
      createdAt: row.created_at.toISOString(),
      expiresAt: row.expires_at.toISOString(),
    }));
  });

export const createOperatorInvitation = async (
  sql: Sql,
  sessionHash: Buffer,
  rawEmail: string,
  now: Date,
): Promise<{ invitation: OperatorInvitation; token: string }> => {
  const email = normalizeOperatorEmail(rawEmail);
  return withOperatorTransaction(sql, async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext('animal-helper-operator-management'))`;
    const actor = await requireManager(tx, sessionHash, now, true);
    const [count] = await tx<{ count: number }[]>`
      select count(*)::integer as count from ah.operator_bootstraps
      where issued_by = ${actor.operator_id}::uuid
        and created_at > ${new Date(now.getTime() - 15 * 60 * 1000)}
    `;
    if ((count?.count ?? 0) >= INVITATION_LIMIT)
      throw new OperatorManagementError("rate_limited", 429);

    await tx`
      insert into ah.operators (operator_id, email, enabled, created_at)
      values (${randomUUID()}::uuid, ${email}, true, ${now})
      on conflict (email) do nothing
    `;
    const [account] = await tx<{ operator_id: string; enabled: boolean }[]>`
      select operator_id, enabled from ah.operators where email = ${email} for update
    `;
    if (!account?.enabled)
      throw new OperatorManagementError("operator_exists", 409);
    const [key] =
      await tx`select 1 from ah.operator_passkeys where operator_id = ${account.operator_id}::uuid limit 1`;
    if (key) throw new OperatorManagementError("operator_exists", 409);
    await tx`
      update ah.operator_bootstraps set expires_at = least(expires_at, ${now})
      where operator_id = ${account.operator_id}::uuid and consumed_at is null
    `;
    const token = newOpaqueToken();
    const invitation = {
      id: randomUUID(),
      email,
      createdAt: now.toISOString(),
      expiresAt: new Date(
        now.getTime() + OPERATOR_BOOTSTRAP_SECONDS * 1000,
      ).toISOString(),
    };
    await tx`
      insert into ah.operator_bootstraps (token_hash, operator_id, expires_at, invitation_id, created_at, issued_by)
      values (${hashOpaqueToken(token)}, ${account.operator_id}::uuid, ${invitation.expiresAt}, ${invitation.id}::uuid, ${now}, ${actor.operator_id}::uuid)
    `;
    await recordOperatorAudit(tx, {
      operatorEmail: actor.email,
      action: "operator_invitation_created",
      outcome: "accepted",
    });
    return { invitation, token };
  });
};

export const revokeOperatorInvitation = async (
  sql: Sql,
  sessionHash: Buffer,
  invitationId: string,
  now: Date,
): Promise<void> =>
  withOperatorTransaction(sql, async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext('animal-helper-operator-management'))`;
    const actor = await requireManager(tx, sessionHash, now, true);
    const result = await tx`
    update ah.operator_bootstraps set expires_at = least(expires_at, ${now})
    where invitation_id = ${invitationId}::uuid and consumed_at is null and expires_at > ${now}
  `;
    if (result.count === 0) throw new OperatorManagementError("not_found", 404);
    await recordOperatorAudit(tx, {
      operatorEmail: actor.email,
      action: "operator_invitation_revoked",
      outcome: "accepted",
    });
  });

export const listOperatorAccounts = async (
  sql: Sql,
  sessionHash: Buffer,
  now: Date,
): Promise<readonly OperatorAccount[]> =>
  withOperatorTransaction(sql, async (tx) => {
    const actor = await requireManager(tx, sessionHash, now);
    const rows = await tx<
      { operator_id: string; email: string; can_manage_operators: boolean }[]
    >`
      select o.operator_id, o.email, o.can_manage_operators from ah.operators o
      where o.enabled and exists (
        select 1 from ah.operator_passkeys p where p.operator_id = o.operator_id
      ) order by o.email
    `;
    await recordOperatorAudit(tx, {
      operatorEmail: actor.email,
      action: "operator_accounts_read",
      outcome: "accepted",
    });
    return rows.map((row) => ({
      id: row.operator_id,
      email: row.email,
      canManageOperators: row.can_manage_operators,
    }));
  });

export const setOperatorManagement = async (
  sql: Sql,
  sessionHash: Buffer,
  operatorId: string,
  input: { canManageOperators: boolean; expectedCanManageOperators: boolean },
  now: Date,
): Promise<void> =>
  withOperatorTransaction(sql, async (tx) => {
    // Serialize with invitations and other role changes, then recheck authority.
    await tx`select pg_advisory_xact_lock(hashtext('animal-helper-operator-management'))`;
    const actor = await requireManager(tx, sessionHash, now, true);
    if (actor.operator_id === operatorId)
      throw new OperatorManagementError("self_management", 409);
    const [target] = await tx<{ can_manage_operators: boolean }[]>`
      select o.can_manage_operators from ah.operators o
      where o.operator_id = ${operatorId}::uuid and o.enabled
        and exists (select 1 from ah.operator_passkeys p where p.operator_id = o.operator_id)
      for update of o
    `;
    if (!target) throw new OperatorManagementError("not_found", 404);
    if (target.can_manage_operators !== input.expectedCanManageOperators)
      throw new OperatorManagementError("conflict", 409);
    await tx`
      update ah.operators set can_manage_operators = ${input.canManageOperators}
      where operator_id = ${operatorId}::uuid
    `;
    await recordOperatorAudit(tx, {
      operatorEmail: actor.email,
      action: input.canManageOperators
        ? "operator_management_granted"
        : "operator_management_revoked",
      outcome: "accepted",
      targetOperatorId: operatorId,
    });
  });

// Recovery/bootstrap permission grant for trusted maintenance.
export const grantOperatorManagement = async (
  sql: Sql,
  rawEmail: string,
): Promise<void> => {
  const email = normalizeOperatorEmail(rawEmail);
  await withOperatorTransaction(sql, async (tx) => {
    const result = await tx`
      update ah.operators set can_manage_operators = true
      where email = ${email} and enabled
        and exists (select 1 from ah.operator_passkeys p where p.operator_id = ah.operators.operator_id)
    `;
    if (result.count !== 1)
      throw new Error("An enabled, enrolled operator is required.");
    await recordOperatorAudit(tx, {
      operatorEmail: "trusted_production_maintenance",
      action: "operator_management_granted",
      outcome: "accepted",
    });
  });
};
