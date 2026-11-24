import {
  parseCaseCommand,
  toDomainCaseCommand,
} from "@animal-helper/contracts";
import {
  capabilityAllowsMutation,
  capabilityAllowsStatusRead,
  hashCapability,
  hashCommandContent,
  type ApplyFailure,
} from "@animal-helper/event-store";

import { apiError, type ApiErrorCode } from "./errors.js";
import type { ApiGateway } from "./gateway.js";

const REPORTER_COMMANDS = new Set([
  "create_draft",
  "attach_private_data",
  "submit_draft",
]);

const toApiError = (code: ApplyFailure["code"]): ApiErrorCode => {
  switch (code) {
    case "ACTOR_NOT_PERMITTED":
    case "CAPABILITY_HASH_REQUIRED":
    case "EVENT_DECODE_FAILED":
    case "PRIVATE_RECORD_REQUIRED":
    case "STREAM_INVALID":
      return "INVALID_REQUEST";
    default:
      return code;
  }
};

export const handleCommand = async (
  body: unknown,
  capability: Buffer,
  gateway: ApiGateway,
  pepper: Buffer,
  now: Date,
) => {
  const parsed = parseCaseCommand(body);
  if (!parsed.success) {
    return apiError("INVALID_REQUEST");
  }

  const command = parsed.data;
  if (!REPORTER_COMMANDS.has(command.type)) {
    return apiError("UNSUPPORTED_COMMAND");
  }

  const capabilityHash = hashCapability(capability, pepper);
  const stored = await gateway.lookupCapabilityByHash(capabilityHash);

  if (command.type === "create_draft") {
    if (
      stored !== undefined &&
      (stored.streamId !== command.streamId ||
        !capabilityAllowsMutation(stored, now))
    ) {
      return apiError("NOT_FOUND");
    }
  } else if (
    stored === undefined ||
    stored.streamId !== command.streamId ||
    (!capabilityAllowsMutation(stored, now) &&
      !(
        command.type === "submit_draft" &&
        capabilityAllowsStatusRead(stored, now)
      ))
  ) {
    return apiError("NOT_FOUND");
  }

  const result = await gateway.applyCommand({
    commandId: command.commandId,
    streamId: command.streamId,
    expectedVersion: command.expectedVersion,
    occurredAt: command.occurredAt,
    correlationId: command.correlationId,
    actorKind: "reporter",
    domainCommand: toDomainCaseCommand(command),
    contentHash: hashCommandContent(command),
    capabilityHash,
    now,
    ...(stored !== undefined && !capabilityAllowsMutation(stored, now)
      ? { duplicateOnly: true }
      : {}),
    ...(command.type === "attach_private_data"
      ? {
          privateRecord: {
            id: command.privateRecordId,
            payload: command.privatePayload,
          },
        }
      : {}),
    ...(command.causationId === undefined
      ? {}
      : { causationId: command.causationId }),
  });

  if (!result.ok) {
    if (stored !== undefined && !capabilityAllowsMutation(stored, now))
      return apiError("NOT_FOUND");
    return apiError(toApiError(result.error.code));
  }

  return {
    ok: true as const,
    value: {
      outcome: result.value.outcome,
      committedVersion: result.value.committedVersion,
      publicState: result.value.publicState,
    },
  };
};
