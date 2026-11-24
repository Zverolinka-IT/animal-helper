import {
  parseApiErrorBody,
  parseCommandAcceptedBody,
  parsePublicCaseStatusBody,
  parseFormSnapshot,
  type ContactPayloadV1,
  type FormSnapshotV1,
  type LocationPayloadV1,
  type MediaRefPayloadV1,
  type TextPayload,
  type TransportCaseCommand,
} from "@animal-helper/contracts";
import { err, ok, type Result } from "@animal-helper/domain";

import {
  capabilityAuthorization,
  capabilityFragment as toCapabilityFragment,
  createCapability,
  decodeCapability,
  encodeCapability,
  parseCapabilityFragment,
} from "./capability.js";
import {
  buildAttachContactCommand,
  buildAttachFormSnapshotCommand,
  buildAttachLocationCommand,
  buildAttachMediaRefCommand,
  buildAttachTextCommand,
  buildCreateDraftCommand,
  buildSubmitDraftCommand,
  type CommandClock,
} from "./commands.js";
import {
  apiError,
  caseAlreadyOpen,
  caseReadOnly,
  invalidResponse,
  invalidCommand,
  networkFailure,
  storageUnavailable,
  noOpenCase,
  versionConflict,
  type ClientError,
} from "./errors.js";
import {
  durabilityOf,
  hydrateStoredCase,
  withCaseStoreLock,
  type CaseStore,
  type Durability,
  type StoredCase,
} from "./store.js";
import type { ApiTransport } from "./transport.js";

export type CaseSnapshot = Readonly<{
  streamId: string;
  expectedVersion: number;
  durability: Durability;
  pendingCount: number;
  pendingCommandIds: readonly string[];
  mutationAllowed: boolean;
  publicState?: "draft" | "received" | "closed";
  lastError?: ClientError;
}>;

export type CaseSession = Readonly<{
  openDraft: () => Promise<Result<CaseSnapshot, ClientError>>;
  importFromFragment: (
    fragment: string,
  ) => Promise<Result<CaseSnapshot, ClientError>>;
  attachFormSnapshot: (
    payload: FormSnapshotV1,
  ) => Promise<Result<CaseSnapshot, ClientError>>;
  attachLocation: (
    payload: LocationPayloadV1,
  ) => Promise<Result<CaseSnapshot, ClientError>>;
  attachContact: (
    payload: ContactPayloadV1,
  ) => Promise<Result<CaseSnapshot, ClientError>>;
  attachMediaRef: (
    payload: MediaRefPayloadV1,
  ) => Promise<Result<CaseSnapshot, ClientError>>;
  attachText: (
    payload: TextPayload,
  ) => Promise<Result<CaseSnapshot, ClientError>>;
  submit: (
    contact?: ContactPayloadV1,
    formSnapshot?: FormSnapshotV1,
  ) => Promise<Result<CaseSnapshot, ClientError>>;
  flush: () => Promise<Result<CaseSnapshot, ClientError>>;
  refreshStatus: () => Promise<Result<CaseSnapshot, ClientError>>;
  snapshot: () => Promise<CaseSnapshot | undefined>;
  exportCapabilityToken: () => Promise<string | undefined>;
  capabilityFragment: () => Promise<string | undefined>;
  removeLocal: () => Promise<void>;
}>;

export type CaseSessionOptions = Readonly<{
  store: CaseStore;
  transport: ApiTransport;
  now?: () => Date;
  createId?: () => string;
  createCapabilityBytes?: () => Uint8Array;
}>;

const snapshotOf = (record: StoredCase): CaseSnapshot => ({
  streamId: record.streamId,
  expectedVersion: record.expectedVersion,
  durability: durabilityOf(record),
  pendingCount: record.queue.length,
  pendingCommandIds: record.queue.map((command) => command.commandId),
  mutationAllowed: record.mutationAllowed,
  ...(record.lastPublicStatus === undefined
    ? {}
    : { publicState: record.lastPublicStatus.publicState }),
  ...(record.lastError === undefined ? {} : { lastError: record.lastError }),
});

const withoutError = (record: StoredCase): StoredCase => ({
  capabilityToken: record.capabilityToken,
  streamId: record.streamId,
  correlationId: record.correlationId,
  expectedVersion: record.expectedVersion,
  mutationAllowed: record.mutationAllowed,
  acknowledgedCommandIds: record.acknowledgedCommandIds,
  queue: record.queue,
  ...(record.submissionContact === undefined
    ? {}
    : { submissionContact: record.submissionContact }),
  ...(record.submissionFormSnapshot === undefined
    ? {}
    : { submissionFormSnapshot: record.submissionFormSnapshot }),
  ...(record.lastPublicStatus === undefined
    ? {}
    : { lastPublicStatus: record.lastPublicStatus }),
});

const withError = (record: StoredCase, lastError: ClientError): StoredCase => ({
  ...record,
  lastError,
});

const authorizationFor = (record: StoredCase): Result<string, ClientError> => {
  const capability = decodeCapability(record.capabilityToken);
  if (!capability.ok) {
    return capability;
  }

  return ok(capabilityAuthorization(capability.value));
};

const mapApiFailure = (body: unknown): ClientError => {
  const parsed = parseApiErrorBody(body);
  if (!parsed.success) {
    return invalidResponse;
  }

  return parsed.data.error.code === "VERSION_CONFLICT"
    ? versionConflict
    : apiError(parsed.data.error.code);
};

export const createCaseSession = (options: CaseSessionOptions): CaseSession => {
  let boundStreamId: string | undefined;
  const clock: CommandClock = {
    now: options.now ?? (() => new Date()),
    createId: options.createId ?? (() => crypto.randomUUID()),
  };

  const load = async (): Promise<
    Result<StoredCase | undefined, ClientError>
  > => {
    let record;
    try {
      record = await options.store.load();
    } catch {
      return err(storageUnavailable);
    }
    if (record === undefined) {
      return ok(undefined);
    }

    if (boundStreamId !== undefined && boundStreamId !== record.streamId)
      return err(caseAlreadyOpen);
    boundStreamId = record.streamId;

    return hydrateStoredCase(record);
  };

  const saveRecord = async (
    record: StoredCase,
  ): Promise<Result<void, ClientError>> => {
    try {
      await options.store.save(record);
      return ok(undefined);
    } catch {
      return err(storageUnavailable);
    }
  };

  const saveSnapshot = async (
    record: StoredCase,
  ): Promise<Result<CaseSnapshot, ClientError>> => {
    const saved = await saveRecord(record);
    if (!saved.ok) return saved;
    return ok(snapshotOf(record));
  };

  const requireRecord = async (): Promise<Result<StoredCase, ClientError>> => {
    const loaded = await load();
    if (!loaded.ok) {
      return loaded;
    }

    return loaded.value === undefined ? err(noOpenCase) : ok(loaded.value);
  };

  const enqueue = async (
    build: (draft: {
      streamId: string;
      correlationId: string;
      expectedVersion: number;
    }) => Result<TransportCaseCommand, ClientError>,
    supersedeSubmission = false,
  ): Promise<Result<CaseSnapshot, ClientError>> => {
    const loaded = await requireRecord();
    if (!loaded.ok) {
      return loaded;
    }

    const record = loaded.value;
    if (!record.mutationAllowed) {
      return err(caseReadOnly);
    }

    const queue = supersedeSubmission
      ? record.queue.filter((command) => command.type !== "submit_draft")
      : record.queue;
    const built = build({
      streamId: record.streamId,
      correlationId: record.correlationId,
      expectedVersion: record.expectedVersion + queue.length,
    });
    if (!built.ok) {
      return built;
    }

    const result = await flushRecord({
      ...withoutError(record),
      queue: [...queue, built.value],
    });
    if (
      supersedeSubmission &&
      !result.ok &&
      (result.error.code === "API" || result.error.code === "VERSION_CONFLICT")
    ) {
      const status = await operations.refreshStatus();
      if (status.ok && !status.value.mutationAllowed) return err(caseReadOnly);
    }
    return result;
  };

  const flushRecord = async (
    record: StoredCase,
  ): Promise<Result<CaseSnapshot, ClientError>> => {
    let current = record;
    const authorization = authorizationFor(current);
    if (!authorization.ok) {
      return authorization;
    }

    // Persist the capability and exact command envelope before its first send.
    // A killed tab must be able to retry a request the server may have accepted.
    const queued = await saveRecord(current);
    if (!queued.ok) return queued;

    while (current.queue[0] !== undefined) {
      const command = current.queue[0];
      let response;
      try {
        response = await options.transport.sendCommand({
          authorization: authorization.value,
          command,
        });
      } catch {
        const failed = withError(current, networkFailure);
        const saved = await saveRecord(failed);
        if (!saved.ok) return saved;
        return err(networkFailure);
      }

      const accepted = parseCommandAcceptedBody(response.body);
      if (response.status >= 200 && response.status < 300 && accepted.success) {
        current = {
          ...withoutError(current),
          expectedVersion: accepted.data.value.committedVersion,
          mutationAllowed:
            current.mutationAllowed &&
            accepted.data.value.publicState === "draft",
          acknowledgedCommandIds: [
            ...current.acknowledgedCommandIds,
            command.commandId,
          ],
          queue:
            accepted.data.value.publicState === "draft"
              ? current.queue.slice(1)
              : [],
          lastPublicStatus: {
            streamId: current.streamId,
            publicState: accepted.data.value.publicState,
            createdAt:
              current.lastPublicStatus?.createdAt ?? command.occurredAt,
            updatedAt: command.occurredAt,
          },
        };
        const saved = await saveRecord(current);
        if (!saved.ok) return saved;
        continue;
      }

      const failure = mapApiFailure(response.body);
      const failed = withError(
        failure.code === "API" && failure.apiCode === "INCOMPLETE_REPORT"
          ? { ...current, queue: current.queue.slice(1) }
          : current,
        failure,
      );
      const saved = await saveRecord(failed);
      if (!saved.ok) return saved;
      return err(failure);
    }

    return saveSnapshot(current);
  };

  const operations: CaseSession = {
    openDraft: async () => {
      const loaded = await load();
      if (!loaded.ok) {
        return loaded;
      }

      if (loaded.value !== undefined) {
        return err(caseAlreadyOpen);
      }

      const streamId = clock.createId();
      boundStreamId = streamId;
      const correlationId = clock.createId();
      const created = buildCreateDraftCommand(
        { streamId, correlationId },
        clock,
      );
      if (!created.ok) {
        return created;
      }

      const capability =
        options.createCapabilityBytes?.() ?? createCapability();

      return flushRecord({
        capabilityToken: encodeCapability(capability),
        streamId,
        correlationId,
        expectedVersion: 0,
        mutationAllowed: true,
        acknowledgedCommandIds: [],
        queue: [created.value],
      });
    },

    importFromFragment: async (fragment) => {
      const loaded = await load();
      if (!loaded.ok) {
        return loaded;
      }

      if (loaded.value !== undefined) {
        return err(caseAlreadyOpen);
      }

      const capability = parseCapabilityFragment(fragment);
      if (!capability.ok) {
        return capability;
      }

      let response;
      try {
        response = await options.transport.getStatus({
          authorization: capabilityAuthorization(capability.value),
        });
      } catch {
        return err(networkFailure);
      }

      const status = parsePublicCaseStatusBody(response.body);
      if (!status.success) {
        return err(mapApiFailure(response.body));
      }

      return saveSnapshot({
        capabilityToken: encodeCapability(capability.value),
        streamId: status.data.value.streamId,
        correlationId: clock.createId(),
        expectedVersion: 0,
        mutationAllowed: false,
        acknowledgedCommandIds: [],
        queue: [],
        lastPublicStatus: status.data.value,
      });
    },

    attachFormSnapshot: (payload) =>
      enqueue(
        (draft) => buildAttachFormSnapshotCommand(draft, payload, clock),
        true,
      ),

    attachLocation: (payload) =>
      enqueue(
        (draft) => buildAttachLocationCommand(draft, payload, clock),
        true,
      ),

    attachContact: (payload) =>
      enqueue(
        (draft) => buildAttachContactCommand(draft, payload, clock),
        true,
      ),

    attachMediaRef: (payload) =>
      enqueue(
        (draft) => buildAttachMediaRefCommand(draft, payload, clock),
        true,
      ),

    attachText: (payload) =>
      enqueue((draft) => buildAttachTextCommand(draft, payload, clock), true),

    submit: async (contact, formSnapshot) => {
      if (formSnapshot !== undefined) {
        const parsed = parseFormSnapshot(formSnapshot);
        if (!parsed.success) return err(invalidCommand);
        // Canonical property order and trimmed values keep equivalent retries identical.
        formSnapshot = parsed.data;
      }
      if (contact === undefined && formSnapshot !== undefined)
        return err(invalidCommand);
      if (contact === undefined)
        return enqueue((draft) => buildSubmitDraftCommand(draft, clock));
      const loaded = await requireRecord();
      if (!loaded.ok) return loaded;
      const record = loaded.value;
      if (!record.mutationAllowed) return err(caseReadOnly);

      const sameContact =
        record.submissionContact !== undefined &&
        (
          [
            "name",
            "phone",
            "email",
            "shareWithAuthorities",
            "newsletter",
          ] as const
        ).every((key) => record.submissionContact?.[key] === contact[key]);
      if (
        sameContact &&
        JSON.stringify(record.submissionFormSnapshot) ===
          JSON.stringify(formSnapshot) &&
        record.queue.some((command) => command.type === "submit_draft")
      )
        return flushRecord(record);

      // A changed intent supersedes an unacknowledged submission. The first
      // attachment competes at that submission's version: it cannot change a report
      // already accepted, and makes any delayed old submission stale.
      const queue = record.queue.filter(
        (command) => command.type !== "submit_draft",
      );
      const draft = {
        streamId: record.streamId,
        correlationId: record.correlationId,
        expectedVersion: record.expectedVersion + queue.length,
      };
      const form =
        formSnapshot === undefined
          ? undefined
          : buildAttachFormSnapshotCommand(draft, formSnapshot, clock);
      if (form && !form.ok) return form;
      const attached = buildAttachContactCommand(
        { ...draft, expectedVersion: draft.expectedVersion + (form ? 1 : 0) },
        contact,
        clock,
      );
      if (!attached.ok) return attached;
      const submitted = buildSubmitDraftCommand(
        { ...draft, expectedVersion: draft.expectedVersion + (form ? 2 : 1) },
        clock,
      );
      if (!submitted.ok) return submitted;
      const withoutPreviousForm = { ...withoutError(record) };
      delete withoutPreviousForm.submissionFormSnapshot;
      const result = await flushRecord({
        ...withoutPreviousForm,
        submissionContact: contact,
        ...(formSnapshot ? { submissionFormSnapshot: formSnapshot } : {}),
        queue: [
          ...queue,
          ...(form?.ok ? [form.value] : []),
          attached.value,
          submitted.value,
        ],
      });
      if (
        !result.ok &&
        (result.error.code === "API" ||
          result.error.code === "VERSION_CONFLICT")
      ) {
        const status = await operations.refreshStatus();
        if (status.ok && !status.value.mutationAllowed)
          return err(caseReadOnly);
      }
      return result;
    },

    flush: async () => {
      const loaded = await requireRecord();
      if (!loaded.ok) {
        return loaded;
      }

      return flushRecord(loaded.value);
    },

    refreshStatus: async () => {
      const loaded = await requireRecord();
      if (!loaded.ok) {
        return loaded;
      }

      const authorization = authorizationFor(loaded.value);
      if (!authorization.ok) {
        return authorization;
      }

      let response;
      try {
        response = await options.transport.getStatus({
          authorization: authorization.value,
        });
      } catch {
        const failed = withError(loaded.value, networkFailure);
        const saved = await saveRecord(failed);
        if (!saved.ok) return saved;
        return err(networkFailure);
      }

      const status = parsePublicCaseStatusBody(response.body);
      if (!status.success) {
        const failure = mapApiFailure(response.body);
        const failed = withError(loaded.value, failure);
        const saved = await saveRecord(failed);
        if (!saved.ok) return saved;
        return err(failure);
      }

      return saveSnapshot({
        ...withoutError(loaded.value),
        lastPublicStatus: status.data.value,
        mutationAllowed:
          loaded.value.mutationAllowed &&
          status.data.value.publicState === "draft",
        queue:
          status.data.value.publicState === "draft" ? loaded.value.queue : [],
      });
    },

    snapshot: async () => {
      const loaded = await load();
      if (!loaded.ok || loaded.value === undefined) {
        return undefined;
      }

      return snapshotOf(loaded.value);
    },

    exportCapabilityToken: async () => {
      const loaded = await load();
      if (!loaded.ok || loaded.value === undefined) {
        return undefined;
      }

      return loaded.value.capabilityToken;
    },

    capabilityFragment: async () => {
      const loaded = await load();
      if (!loaded.ok || loaded.value === undefined) {
        return undefined;
      }

      const capability = decodeCapability(loaded.value.capabilityToken);
      return capability.ok ? toCapabilityFragment(capability.value) : undefined;
    },

    removeLocal: async () => {
      const current = await options.store.load();
      if (boundStreamId === undefined || current?.streamId === boundStreamId)
        await options.store.clear();
      boundStreamId = undefined;
    },
  };

  const locked = async (
    operation: () => Promise<Result<CaseSnapshot, ClientError>>,
  ) => {
    try {
      return await withCaseStoreLock(options.store, operation);
    } catch {
      return err(storageUnavailable);
    }
  };
  return {
    ...operations,
    openDraft: () => locked(operations.openDraft),
    importFromFragment: (fragment) =>
      locked(() => operations.importFromFragment(fragment)),
    attachFormSnapshot: (payload) =>
      locked(() => operations.attachFormSnapshot(payload)),
    attachLocation: (payload) =>
      locked(() => operations.attachLocation(payload)),
    attachContact: (payload) => locked(() => operations.attachContact(payload)),
    attachMediaRef: (payload) =>
      locked(() => operations.attachMediaRef(payload)),
    attachText: (payload) => locked(() => operations.attachText(payload)),
    submit: (contact, formSnapshot) =>
      locked(() => operations.submit(contact, formSnapshot)),
    flush: () => locked(operations.flush),
    refreshStatus: () => locked(operations.refreshStatus),
    removeLocal: () => withCaseStoreLock(options.store, operations.removeLocal),
  };
};
