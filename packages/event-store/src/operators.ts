import { randomBytes, randomUUID } from "node:crypto";

import type { Sql } from "postgres";

import { sha256Buffer } from "./hash.js";

export const OPERATOR_BOOTSTRAP_SECONDS = 15 * 60;

export type OperatorRecord = Readonly<{
  operatorId: string;
  email: string;
  enabled: boolean;
  canManageOperators: boolean;
}>;

export type OperatorPasskeyRecord = Readonly<{
  credentialId: string;
  operatorId: string;
  publicKey: Buffer;
  counter: number;
  transports: readonly string[];
}>;

export type OperatorChallengeRecord = Readonly<{
  kind: "registration" | "authentication";
  challenge: string;
  operatorId: string | null;
  bootstrapHash: Buffer | null;
  sessionTokenHash: Buffer | null;
}>;

export type OperatorSessionRecord = Readonly<{
  operatorId: string;
  email: string;
  createdAt: Date;
  expiresAt: Date;
  canManageOperators: boolean;
}>;

export type QueueCaseRecord = Readonly<{
  streamId: string;
  workflowState: string;
  hasPrivateData: boolean;
  privateDataPurged: boolean;
  createdAt: Date;
  updatedAt: Date;
}>;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const normalizeOperatorEmail = (value: string): string => {
  const email = value.trim().toLowerCase();
  if (email.length === 0 || email.length > 254 || !EMAIL_PATTERN.test(email)) {
    throw new Error("Enter a valid operator email.");
  }
  return email;
};

export const newOpaqueToken = (): string =>
  randomBytes(32).toString("base64url");

export const hashOpaqueToken = (token: string): Buffer => sha256Buffer(token);

export const bootstrapOperator = async (
  sql: Sql,
  rawEmail: string,
  now: Date = new Date(),
  bootstrapSeconds: number = OPERATOR_BOOTSTRAP_SECONDS,
): Promise<string> => {
  const email = normalizeOperatorEmail(rawEmail);
  const token = newOpaqueToken();
  const tokenHash = hashOpaqueToken(token);
  const expiresAt = new Date(now.getTime() + bootstrapSeconds * 1000);

  await withOperatorTransaction(sql, async (tx) => {
    const existing = await tx<{ operator_id: string; enabled: boolean }[]>`
      select operator_id, enabled from ah.operators where email = ${email}
    `;
    const operatorId = existing[0]?.operator_id ?? randomUUID();
    if (existing[0] === undefined) {
      await tx`
        insert into ah.operators (operator_id, email, enabled, created_at)
        values (${operatorId}::uuid, ${email}, true, ${now})
      `;
    } else if (!existing[0].enabled) {
      throw new Error("Operator is disabled.");
    }

    await tx`
      update ah.operator_bootstraps
      set expires_at = least(expires_at, ${now})
      where operator_id = ${operatorId}::uuid
        and consumed_at is null
    `;
    await tx`
      insert into ah.operator_bootstraps (
        token_hash, operator_id, expires_at, consumed_at
      )
      values (${tokenHash}, ${operatorId}::uuid, ${expiresAt}, null)
    `;
  });

  return token;
};

export const lookupActiveBootstrap = async (
  sql: Sql,
  tokenHash: Buffer,
  now: Date,
): Promise<OperatorRecord | undefined> => {
  const [row] = await sql<
    {
      operator_id: string;
      email: string;
      enabled: boolean;
      can_manage_operators: boolean;
    }[]
  >`
    select o.operator_id, o.email, o.enabled, o.can_manage_operators
    from ah.operator_bootstraps b
    join ah.operators o on o.operator_id = b.operator_id
    where b.token_hash = ${tokenHash}
      and b.consumed_at is null
      and b.expires_at > ${now}
  `;
  return row === undefined ? undefined : toOperator(row);
};

export const listOperatorPasskeys = async (
  sql: Sql,
  operatorId: string,
): Promise<
  readonly { credentialId: string; transports: readonly string[] }[]
> => {
  const rows = await sql<{ credential_id: string; transports: unknown }[]>`
    select credential_id, transports
    from ah.operator_passkeys
    where operator_id = ${operatorId}::uuid
  `;
  return rows.map((row) => ({
    credentialId: row.credential_id,
    transports: readTransports(row.transports),
  }));
};

export const listEnabledOperatorPasskeys = async (
  sql: Sql,
): Promise<
  readonly { credentialId: string; transports: readonly string[] }[]
> => {
  const rows = await sql<{ credential_id: string; transports: unknown }[]>`
    select p.credential_id, p.transports
    from ah.operator_passkeys p
    join ah.operators o on o.operator_id = p.operator_id
    where o.enabled
  `;
  return rows.map((row) => ({
    credentialId: row.credential_id,
    transports: readTransports(row.transports),
  }));
};

export const deleteOperatorPasskeys = async (
  sql: Sql,
  rawEmail: string,
): Promise<number> => {
  const email = normalizeOperatorEmail(rawEmail);
  const result = await sql`
    delete from ah.operator_passkeys p
    using ah.operators o
    where p.operator_id = o.operator_id
      and o.email = ${email}
  `;
  return result.count;
};

export const deleteOperatorAccount = async (
  sql: Sql,
  rawEmail: string,
): Promise<void> => {
  const email = normalizeOperatorEmail(rawEmail);
  await withOperatorTransaction(sql, async (tx) => {
    const [row] = await tx<{ operator_id: string }[]>`
      select operator_id from ah.operators where email = ${email}
    `;
    if (row === undefined) {
      return;
    }
    const operatorId = row.operator_id;
    await tx`
      delete from ah.operator_challenges
      where operator_id = ${operatorId}::uuid
         or bootstrap_hash in (
           select token_hash
           from ah.operator_bootstraps
           where operator_id = ${operatorId}::uuid
         )
    `;
    await tx`
      delete from ah.operator_sessions
      where operator_id = ${operatorId}::uuid
    `;
    await tx`
      delete from ah.operator_passkeys
      where operator_id = ${operatorId}::uuid
    `;
    await tx`
      delete from ah.operator_bootstraps
      where operator_id = ${operatorId}::uuid
    `;
    await tx`
      delete from ah.operators
      where operator_id = ${operatorId}::uuid
    `;
  });
};

export const insertOperatorChallenge = async (
  sql: Sql,
  input: {
    tokenHash: Buffer;
    kind: "registration" | "authentication";
    challenge: string;
    operatorId: string | null;
    bootstrapHash: Buffer | null;
    expiresAt: Date;
    sessionTokenHash?: Buffer;
  },
): Promise<void> => {
  await sql`
    insert into ah.operator_challenges (
      token_hash, kind, challenge, operator_id, bootstrap_hash, expires_at, session_token_hash
    )
    values (
      ${input.tokenHash},
      ${input.kind},
      ${input.challenge},
      ${input.operatorId},
      ${input.bootstrapHash},
      ${input.expiresAt},
      ${input.sessionTokenHash ?? null}
    )
  `;
};

export const takeOperatorChallenge = async (
  sql: Sql,
  tokenHash: Buffer,
  kind: "registration" | "authentication",
  now: Date,
): Promise<OperatorChallengeRecord | undefined> => {
  const [row] = await sql<
    {
      kind: "registration" | "authentication";
      challenge: string;
      operator_id: string | null;
      bootstrap_hash: Buffer | null;
      session_token_hash: Buffer | null;
    }[]
  >`
    delete from ah.operator_challenges
    where token_hash = ${tokenHash}
      and kind = ${kind}
      and expires_at > ${now}
    returning kind, challenge, operator_id, bootstrap_hash, session_token_hash
  `;
  if (row === undefined) {
    return undefined;
  }
  return {
    kind: row.kind,
    challenge: row.challenge,
    operatorId: row.operator_id,
    bootstrapHash: row.bootstrap_hash,
    sessionTokenHash: row.session_token_hash,
  };
};

export const finishOperatorRegistration = async (
  sql: Sql,
  input: {
    operatorId: string;
    bootstrapHash: Buffer;
    credentialId: string;
    publicKey: Buffer;
    counter: number;
    transports: readonly string[];
    sessionTokenHash: Buffer;
    now: Date;
    sessionExpiresAt: Date;
  },
): Promise<OperatorRecord> => {
  return withOperatorTransaction(sql, async (tx) => {
    const [account] = await tx<
      { enabled: boolean; can_manage_operators: boolean }[]
    >`
      select enabled, can_manage_operators from ah.operators
      where operator_id = ${input.operatorId}::uuid for update
    `;
    if (!account?.enabled) throw new OperatorAuthError("bootstrap_invalid");
    const consumed = await tx<{ operator_id: string; email: string }[]>`
      update ah.operator_bootstraps
      set consumed_at = ${input.now}
      where token_hash = ${input.bootstrapHash}
        and operator_id = ${input.operatorId}::uuid
        and consumed_at is null
        and expires_at > ${input.now}
      returning operator_id, (
        select email from ah.operators where operator_id = ${input.operatorId}::uuid
      ) as email
    `;
    const operator = consumed[0];
    if (operator === undefined) {
      throw new OperatorAuthError("bootstrap_invalid");
    }

    await tx`
      insert into ah.operator_passkeys (
        credential_id, operator_id, public_key, counter, transports, created_at
      )
      values (
        ${input.credentialId},
        ${input.operatorId}::uuid,
        ${input.publicKey},
        ${input.counter},
        ${tx.json([...input.transports])},
        ${input.now}
      )
    `;
    await tx`
      insert into ah.operator_sessions (
        token_hash, operator_id, created_at, expires_at
      )
      values (
        ${input.sessionTokenHash},
        ${input.operatorId}::uuid,
        ${input.now},
        ${input.sessionExpiresAt}
      )
    `;
    return {
      operatorId: operator.operator_id,
      email: operator.email,
      enabled: true,
      canManageOperators: account.can_manage_operators,
    };
  });
};

export const finishOperatorAuthentication = async (
  sql: Sql,
  input: {
    credentialId: string;
    expectedOperatorId: string | undefined;
    verify: (passkey: OperatorPasskeyRecord) => Promise<{
      newCounter: number;
      userVerified: boolean;
    }>;
    sessionTokenHash: Buffer;
    now: Date;
    sessionExpiresAt: Date;
    previousSessionTokenHash?: Buffer;
  },
): Promise<OperatorRecord> => {
  return withOperatorTransaction(sql, async (tx) => {
    const [row] = await tx<
      {
        credential_id: string;
        operator_id: string;
        public_key: Buffer;
        counter: string;
        transports: unknown;
        email: string;
        enabled: boolean;
        can_manage_operators: boolean;
      }[]
    >`
      select
        p.credential_id,
        p.operator_id,
        p.public_key,
        p.counter::text as counter,
        p.transports,
        o.email,
        o.enabled,
        o.can_manage_operators
      from ah.operator_passkeys p
      join ah.operators o on o.operator_id = p.operator_id
      where p.credential_id = ${input.credentialId}
      for update of p, o
    `;
    if (row === undefined || !row.enabled) {
      throw new OperatorAuthError("passkey_failed");
    }
    if (input.previousSessionTokenHash !== undefined) {
      const [session] = await tx`
        select token_hash from ah.operator_sessions
        where token_hash = ${input.previousSessionTokenHash}
          and operator_id = ${row.operator_id}::uuid
          and revoked_at is null and expires_at > ${input.now}
        for update
      `;
      if (session === undefined) throw new OperatorAuthError("passkey_failed");
    }
    if (
      input.expectedOperatorId !== undefined &&
      input.expectedOperatorId !== row.operator_id
    ) {
      throw new OperatorAuthError("passkey_failed");
    }

    const passkey: OperatorPasskeyRecord = {
      credentialId: row.credential_id,
      operatorId: row.operator_id,
      publicKey: Buffer.from(row.public_key),
      counter: Number(row.counter),
      transports: readTransports(row.transports),
    };
    const verified = await input.verify(passkey);
    if (!verified.userVerified) {
      throw new OperatorAuthError("passkey_failed");
    }
    if (input.previousSessionTokenHash !== undefined) {
      await tx`
        update ah.operator_sessions set revoked_at = ${input.now}
        where token_hash = ${input.previousSessionTokenHash}
      `;
    }

    await tx`
      update ah.operator_passkeys
      set counter = ${verified.newCounter}
      where credential_id = ${input.credentialId}
    `;
    await tx`
      insert into ah.operator_sessions (
        token_hash, operator_id, created_at, expires_at
      )
      values (
        ${input.sessionTokenHash},
        ${row.operator_id}::uuid,
        ${input.now},
        ${input.sessionExpiresAt}
      )
    `;
    return {
      operatorId: row.operator_id,
      email: row.email,
      enabled: true,
      canManageOperators: row.can_manage_operators,
    };
  });
};

export const lookupOperatorSession = async (
  sql: Sql,
  tokenHash: Buffer,
  now: Date,
): Promise<OperatorSessionRecord | undefined> => {
  const [row] = await sql<
    {
      operator_id: string;
      email: string;
      created_at: Date;
      expires_at: Date;
      can_manage_operators: boolean;
    }[]
  >`
    select s.operator_id, o.email, s.created_at, s.expires_at, o.can_manage_operators
    from ah.operator_sessions s
    join ah.operators o on o.operator_id = s.operator_id
    where s.token_hash = ${tokenHash}
      and s.revoked_at is null
      and s.expires_at > ${now}
      and o.enabled
  `;
  if (row === undefined) {
    return undefined;
  }
  return {
    operatorId: row.operator_id,
    email: row.email,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    canManageOperators: row.can_manage_operators,
  };
};

export const revokeOperatorSession = async (
  sql: Sql,
  tokenHash: Buffer,
  now: Date,
): Promise<void> => {
  await sql`
    update ah.operator_sessions
    set revoked_at = ${now}
    where token_hash = ${tokenHash}
      and revoked_at is null
  `;
};

export const listQueueCases = async (
  sql: Sql,
): Promise<readonly QueueCaseRecord[]> => {
  const rows = await sql<
    {
      stream_id: string;
      workflow_state: string;
      has_private_data: boolean;
      private_data_purged: boolean;
      created_at: Date;
      updated_at: Date;
    }[]
  >`
    select
      stream_id,
      workflow_state,
      has_private_data,
      private_data_purged,
      created_at,
      updated_at
    from ah.case_queue_projection
    order by updated_at desc
    limit 100
  `;
  return rows.map((row) => ({
    streamId: row.stream_id,
    workflowState: row.workflow_state,
    hasPrivateData: row.has_private_data,
    privateDataPurged: row.private_data_purged,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
};

export const recordOperatorAudit = async (
  sql: Sql,
  input: {
    operatorEmail: string;
    action: string;
    outcome: "accepted" | "rejected";
    streamId?: string;
    targetOperatorId?: string;
    errorCode?: string;
  },
): Promise<void> => {
  await sql`
    insert into ah.audit_events (
      audit_id,
      actor_kind,
      actor_reference,
      action,
      stream_id,
      target_operator_id,
      outcome,
      error_code
    )
    values (
      ${randomUUID()}::uuid,
      'administrator',
      ${input.operatorEmail},
      ${input.action},
      ${input.streamId ?? null},
      ${input.targetOperatorId ?? null},
      ${input.outcome},
      ${input.errorCode ?? null}
    )
  `;
};

export class OperatorAuthError extends Error {
  readonly code:
    "bootstrap_invalid" | "passkey_failed" | "passkey_unregistered";

  constructor(
    code: "bootstrap_invalid" | "passkey_failed" | "passkey_unregistered",
  ) {
    super(code);
    this.name = "OperatorAuthError";
    this.code = code;
  }
}

const toOperator = (row: {
  operator_id: string;
  email: string;
  enabled: boolean;
  can_manage_operators: boolean;
}): OperatorRecord => ({
  operatorId: row.operator_id,
  email: row.email,
  enabled: row.enabled,
  canManageOperators: row.can_manage_operators,
});

const readTransports = (value: unknown): readonly string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item) => typeof item === "string");
};

export const withOperatorTransaction = async <T>(
  sql: Sql,
  operation: (tx: Sql) => Promise<T>,
): Promise<T> => {
  const reserved = await sql.reserve();
  try {
    await reserved.unsafe("begin");
    try {
      const result = await operation(reserved);
      await reserved.unsafe("commit");
      return result;
    } catch (error) {
      try {
        await reserved.unsafe("rollback");
      } catch {
        // Keep the original failure.
      }
      throw error;
    }
  } finally {
    reserved.release();
  }
};
