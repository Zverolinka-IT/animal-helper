import {
  decideCase,
  foldCaseEvents,
  toPublicCaseState,
  type ActorKind,
  type CaseCommand,
  type CaseDomainEvent,
  type PublicCaseState,
} from "@animal-helper/domain";
import {
  hashesEqual,
  type ApplyCommandInput,
  type ApplyFailure,
  type ApplyResult,
  type StoredCapability,
  type StoredPublicStatus,
} from "@animal-helper/event-store";

import type { ApiGateway } from "./gateway.js";

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

type AcceptedCommand = Readonly<{
  contentHash: Buffer;
  committedVersion: number;
  publicState: PublicCaseState;
}>;

export type MemoryGateway = ApiGateway &
  Readonly<{
    expireDraft: (streamId: string, now: Date) => void;
  }>;

const fail = (code: ApplyFailure["code"]): ApplyResult => ({
  ok: false,
  error: { code },
});

export const createMemoryGateway = (): MemoryGateway => {
  const capabilities: Array<
    Readonly<{ hash: Buffer; capability: StoredCapability }>
  > = [];
  const eventsByStream = new Map<string, CaseDomainEvent[]>();
  const acceptedCommands = new Map<string, AcceptedCommand>();
  const publicStatus = new Map<string, StoredPublicStatus>();

  const lookupCapabilityByHash = (
    capabilityHash: Buffer,
  ): StoredCapability | undefined => {
    for (const stored of capabilities) {
      if (hashesEqual(stored.hash, capabilityHash)) {
        return stored.capability;
      }
    }

    return undefined;
  };

  const replaceCapability = (
    streamId: string,
    next: StoredCapability,
  ): void => {
    for (const [index, stored] of capabilities.entries()) {
      if (stored.capability.streamId === streamId) {
        capabilities[index] = { hash: stored.hash, capability: next };
      }
    }
  };

  const applyCommand = (input: ApplyCommandInput): ApplyResult => {
    if (!allowedActors[input.domainCommand.type].includes(input.actorKind)) {
      return fail("ACTOR_NOT_PERMITTED");
    }

    if (
      input.domainCommand.type === "create_draft" &&
      input.capabilityHash === undefined
    ) {
      return fail("CAPABILITY_HASH_REQUIRED");
    }

    if (
      input.domainCommand.type === "attach_private_data" &&
      (input.privateRecord === undefined ||
        input.privateRecord.id !== input.domainCommand.privateRecordId)
    ) {
      return fail("PRIVATE_RECORD_REQUIRED");
    }

    const accepted = acceptedCommands.get(input.commandId);
    if (accepted !== undefined) {
      if (!hashesEqual(accepted.contentHash, input.contentHash)) {
        return fail("COMMAND_CONTENT_MISMATCH");
      }

      return {
        ok: true,
        value: {
          outcome: "duplicate",
          committedVersion: accepted.committedVersion,
          publicState: accepted.publicState,
          eventIds: [],
        },
      };
    }

    if (input.duplicateOnly === true) return fail("ACTOR_NOT_PERMITTED");

    const recorded = eventsByStream.get(input.streamId) ?? [];
    if (recorded.length !== input.expectedVersion) {
      return fail("VERSION_CONFLICT");
    }

    const currentState = foldCaseEvents(recorded);
    const decision = decideCase(currentState, input.domainCommand);
    if (!decision.ok) {
      return fail(decision.error.code);
    }

    const nextEvents = [...recorded, ...decision.value];
    eventsByStream.set(input.streamId, nextEvents);
    const nextState = foldCaseEvents(nextEvents);
    const publicState = toPublicCaseState(nextState.status);
    const previous = publicStatus.get(input.streamId);
    const acceptedAt = new Date(
      Math.max(
        input.now.getTime(),
        new Date(previous?.updatedAt ?? input.now).getTime(),
      ),
    ).toISOString();
    const createdAt = previous?.createdAt ?? acceptedAt;

    publicStatus.set(input.streamId, {
      streamId: input.streamId,
      publicState,
      createdAt,
      updatedAt: acceptedAt,
    });

    if (
      input.domainCommand.type === "create_draft" &&
      input.capabilityHash !== undefined
    ) {
      capabilities.push({
        hash: input.capabilityHash,
        capability: {
          streamId: input.streamId,
          mutationAllowed: true,
          expiresAt: new Date(input.now.getTime() + DRAFT_TTL_MS),
        },
      });
    }

    if (decision.value.some((event) => event.type === "draft_submitted")) {
      replaceCapability(input.streamId, {
        streamId: input.streamId,
        mutationAllowed: false,
        expiresAt: null,
      });
    }

    if (decision.value.some((event) => event.type === "draft_expired")) {
      replaceCapability(input.streamId, {
        streamId: input.streamId,
        mutationAllowed: false,
        expiresAt: input.now,
      });
    }

    acceptedCommands.set(input.commandId, {
      contentHash: input.contentHash,
      committedVersion: nextEvents.length,
      publicState,
    });

    return {
      ok: true,
      value: {
        outcome: "applied",
        committedVersion: nextEvents.length,
        publicState,
        eventIds: [],
      },
    };
  };

  return {
    lookupCapabilityByHash: (capabilityHash) =>
      Promise.resolve(lookupCapabilityByHash(capabilityHash)),
    getPublicStatus: (streamId) => Promise.resolve(publicStatus.get(streamId)),
    expireDraft: (streamId, now) => {
      replaceCapability(streamId, {
        streamId,
        mutationAllowed: false,
        expiresAt: now,
      });
    },
    applyCommand: (input) => Promise.resolve(applyCommand(input)),
  };
};
