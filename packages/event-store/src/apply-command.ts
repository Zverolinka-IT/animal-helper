import { randomUUID } from "node:crypto";

import type { PrivateRecordPayload } from "@animal-helper/contracts";
import {
  decideCase,
  decodeRecordedCaseEvents,
  effectsFromTransition,
  encodeCaseEventPayload,
  foldCaseEvents,
  recordedTypeFor,
  toPublicCaseState,
  validateEventStream,
  type ActorKind,
  type CaseCommand,
  type CaseDomainError,
  type PublicCaseState,
} from "@animal-helper/domain";
import type { Sql } from "postgres";

import { loadRecordedEvents } from "./events.js";
import { hashesEqual } from "./hash.js";
import { projectCase } from "./projections.js";
import type { Queryable } from "./sql.js";

const DRAFT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const allowedActors: Record<CaseCommand["type"], readonly ActorKind[]> = {
  create_draft: ["reporter"],
  attach_private_data: ["reporter"],
  submit_draft: ["reporter"],
  start_review: ["administrator"],
  complete_case: ["administrator"],
  purge_private_data: ["administrator", "system"],
  expire_draft: ["system"],
};

export type ApplyCommandInput = Readonly<{
  commandId: string;
  streamId: string;
  expectedVersion: number;
  occurredAt: string;
  correlationId: string;
  causationId?: string;
  actorKind: ActorKind;
  actorReference?: string;
  domainCommand: CaseCommand;
  contentHash: Buffer;
  capabilityHash?: Buffer;
  privateRecord?: Readonly<{
    id: string;
    payload: PrivateRecordPayload;
  }>;
  // A read-only reporter capability may recover an earlier acknowledgement,
  // but must never apply a new command.
  duplicateOnly?: boolean;
  now: Date;
}>;

export type ApplySuccess = Readonly<{
  outcome: "applied" | "duplicate";
  committedVersion: number;
  publicState: PublicCaseState;
  eventIds: readonly string[];
}>;

export type ApplyFailure = Readonly<{
  code:
    | CaseDomainError["code"]
    | "ACTOR_NOT_PERMITTED"
    | "CAPABILITY_HASH_REQUIRED"
    | "COMMAND_CONTENT_MISMATCH"
    | "EVENT_DECODE_FAILED"
    | "PRIVATE_RECORD_REQUIRED"
    | "STREAM_INVALID"
    | "VERSION_CONFLICT";
}>;

export type ApplyResult =
  | Readonly<{ ok: true; value: ApplySuccess }>
  | Readonly<{ ok: false; error: ApplyFailure }>;

type AcceptedCommandRow = {
  command_id: string;
  content_hash: Buffer;
  committed_version: number;
  public_state: PublicCaseState;
};

const writeAudit = async (
  sql: Queryable,
  input: Readonly<{
    actorKind: ActorKind;
    actorReference?: string;
    action: string;
    streamId: string;
    outcome: "accepted" | "rejected";
    errorCode?: string;
  }>,
): Promise<void> => {
  await sql`
    insert into ah.audit_events (
      audit_id,
      actor_kind,
      actor_reference,
      action,
      stream_id,
      outcome,
      error_code
    )
    values (
      ${randomUUID()}::uuid,
      ${input.actorKind},
      ${input.actorReference ?? null},
      ${input.action},
      ${input.streamId}::uuid,
      ${input.outcome},
      ${input.errorCode ?? null}
    )
  `;
};

const reject = async (
  sql: Queryable,
  input: ApplyCommandInput,
  error: ApplyFailure,
): Promise<ApplyResult> => {
  await writeAudit(sql, {
    actorKind: input.actorKind,
    ...(input.actorReference === undefined
      ? {}
      : { actorReference: input.actorReference }),
    action: input.domainCommand.type,
    streamId: input.streamId,
    outcome: "rejected",
    errorCode: error.code,
  });

  return { ok: false, error };
};

const isVersionConflict = (error: unknown): boolean =>
  error instanceof Error && error.message.includes("STREAM_VERSION_CONFLICT");

export const applyCommand = async (
  sql: Sql,
  input: ApplyCommandInput,
): Promise<ApplyResult> => {
  try {
    return await sql.begin((transaction) =>
      applyCommandInTransaction(transaction as unknown as Sql, input),
    );
  } catch (error) {
    if (isVersionConflict(error)) {
      await writeAudit(sql, {
        actorKind: input.actorKind,
        ...(input.actorReference === undefined
          ? {}
          : { actorReference: input.actorReference }),
        action: input.domainCommand.type,
        streamId: input.streamId,
        outcome: "rejected",
        errorCode: "VERSION_CONFLICT",
      });

      return { ok: false, error: { code: "VERSION_CONFLICT" } };
    }

    throw error;
  }
};

export const applyCommandInTransaction = async (
  sql: Queryable,
  input: ApplyCommandInput,
): Promise<ApplyResult> => {
  if (!allowedActors[input.domainCommand.type].includes(input.actorKind)) {
    return reject(sql, input, { code: "ACTOR_NOT_PERMITTED" });
  }

  if (
    input.domainCommand.type === "create_draft" &&
    input.capabilityHash === undefined
  ) {
    return reject(sql, input, { code: "CAPABILITY_HASH_REQUIRED" });
  }

  if (
    input.domainCommand.type === "attach_private_data" &&
    (input.privateRecord === undefined ||
      input.privateRecord.id !== input.domainCommand.privateRecordId)
  ) {
    return reject(sql, input, { code: "PRIVATE_RECORD_REQUIRED" });
  }

  // Serialize before checking the receipt or reading events. Creating the row
  // first also serializes simultaneous create retries for a new stream.
  if (input.domainCommand.type === "create_draft") {
    await sql`insert into ah.streams (stream_id) values (${input.streamId}::uuid)
      on conflict (stream_id) do nothing`;
  }
  await sql`select stream_id from ah.streams where stream_id = ${input.streamId}::uuid for update`;

  const [accepted] = await sql<AcceptedCommandRow[]>`
    select command_id, content_hash, committed_version, public_state
    from ah.accepted_commands
    where command_id = ${input.commandId}::uuid
  `;

  if (accepted !== undefined) {
    if (!hashesEqual(Buffer.from(accepted.content_hash), input.contentHash)) {
      return reject(sql, input, { code: "COMMAND_CONTENT_MISMATCH" });
    }

    return {
      ok: true,
      value: {
        outcome: "duplicate",
        committedVersion: accepted.committed_version,
        publicState: accepted.public_state,
        eventIds: [],
      },
    };
  }

  if (input.duplicateOnly === true) {
    return reject(sql, input, { code: "ACTOR_NOT_PERMITTED" });
  }

  const recordedEvents = await loadRecordedEvents(sql, input.streamId);
  const streamValidation = validateEventStream(recordedEvents);

  if (!streamValidation.ok) {
    return reject(sql, input, { code: "STREAM_INVALID" });
  }

  if (recordedEvents.length !== input.expectedVersion) {
    return reject(sql, input, { code: "VERSION_CONFLICT" });
  }

  const decoded = decodeRecordedCaseEvents(recordedEvents);

  if (!decoded.ok) {
    return reject(sql, input, { code: "EVENT_DECODE_FAILED" });
  }

  const currentState = foldCaseEvents(decoded.value);
  const decision = decideCase(currentState, input.domainCommand);

  if (!decision.ok) {
    return reject(sql, input, { code: decision.error.code });
  }

  const nextState = foldCaseEvents([...decoded.value, ...decision.value]);
  // Client clocks can be wrong or deliberately forged. Canonical event times
  // are server acceptance times and never move backwards within a stream.
  const eventTime = new Date(
    Math.max(
      input.now.getTime(),
      new Date(recordedEvents.at(-1)?.occurredAt ?? input.now).getTime(),
    ),
  );
  const eventIds: string[] = [];
  let version = input.expectedVersion;

  for (const domainEvent of decision.value) {
    const eventId = randomUUID();
    eventIds.push(eventId);

    await sql`
      select ah.append_event(
        ${eventId}::uuid,
        ${input.streamId}::uuid,
        ${version}::integer,
        ${recordedTypeFor(domainEvent)},
        1::integer,
        ${eventTime}::timestamptz,
        ${input.actorKind},
        ${input.actorReference ?? null},
        ${input.commandId}::uuid,
        ${input.correlationId}::uuid,
        ${input.causationId ?? null}::uuid,
        ${sql.json({ ...encodeCaseEventPayload(domainEvent) })}
      )
    `;

    version += 1;
  }

  if (input.domainCommand.type === "attach_private_data") {
    await sql`
      insert into ah.private_records (
        private_record_id,
        stream_id,
        kind,
        payload
      )
      values (
        ${input.domainCommand.privateRecordId}::uuid,
        ${input.streamId}::uuid,
        ${input.domainCommand.kind},
        ${sql.json({ ...(input.privateRecord?.payload ?? {}) })}
      )
    `;
  }

  if (
    input.domainCommand.type === "create_draft" &&
    input.capabilityHash !== undefined
  ) {
    await sql`
      insert into ah.capabilities (
        stream_id,
        capability_hash,
        created_at,
        expires_at,
        mutation_allowed
      )
      values (
        ${input.streamId}::uuid,
        ${input.capabilityHash},
        ${input.now},
        ${new Date(input.now.getTime() + DRAFT_TTL_MS)},
        true
      )
    `;
  }

  if (decision.value.some((event) => event.type === "draft_submitted")) {
    await sql`
      update ah.capabilities
      set mutation_allowed = false, expires_at = null
      where stream_id = ${input.streamId}::uuid
    `;
  }

  if (decision.value.some((event) => event.type === "draft_expired")) {
    await sql`
      update ah.capabilities
      set mutation_allowed = false, expires_at = ${input.now}
      where stream_id = ${input.streamId}::uuid
    `;
  }

  if (decision.value.some((event) => event.type === "private_data_purged")) {
    await sql`
      update ah.private_records
      set payload = null, deleted_at = ${input.now}
      where stream_id = ${input.streamId}::uuid
        and deleted_at is null
    `;
    await sql`delete from ah.admin_case_work where stream_id = ${input.streamId}::uuid`;
  }

  const createdAt = new Date(recordedEvents.at(0)?.occurredAt ?? eventTime);
  const updatedAt = eventTime;

  await projectCase(sql, {
    streamId: input.streamId,
    state: nextState,
    createdAt,
    updatedAt,
  });

  for (const effect of effectsFromTransition(nextState, decision.value)) {
    await sql`
      insert into ah.outbox (
        outbox_id,
        stream_id,
        command_id,
        effect_type,
        payload,
        idempotency_key
      )
      values (
        ${randomUUID()}::uuid,
        ${input.streamId}::uuid,
        ${input.commandId}::uuid,
        ${effect.type},
        '{}'::jsonb,
        ${`${input.commandId}:${effect.type}`}
      )
    `;
  }

  const publicState = toPublicCaseState(nextState.status);

  await sql`
    insert into ah.accepted_commands (
      command_id,
      stream_id,
      content_hash,
      committed_version,
      public_state
    )
    values (
      ${input.commandId}::uuid,
      ${input.streamId}::uuid,
      ${input.contentHash},
      ${version},
      ${publicState}
    )
  `;

  await writeAudit(sql, {
    actorKind: input.actorKind,
    ...(input.actorReference === undefined
      ? {}
      : { actorReference: input.actorReference }),
    action: input.domainCommand.type,
    streamId: input.streamId,
    outcome: "accepted",
  });

  return {
    ok: true,
    value: {
      outcome: "applied",
      committedVersion: version,
      publicState,
      eventIds,
    },
  };
};
