import { describe, expect, it } from "vitest";

import {
  CASE_EVENT_TYPE,
  decideCase,
  decodeRecordedCaseEvent,
  effectsFromTransition,
  encodeCaseEventPayload,
  evolveCase,
  foldCaseEvents,
  hasAvailablePrivateData,
  initialCaseState,
  recordedTypeFor,
  toPublicCaseState,
  type CaseCommand,
  type CaseDomainEvent,
  type CaseState,
  type RecordedEvent,
} from "../src/index.js";

const requiredAttachments: readonly CaseCommand[] = (
  ["location", "form_snapshot", "contact"] as const
).map((kind) => ({
  type: "attach_private_data",
  kind,
  privateRecordId: `required-${kind}`,
}));

const applyFrom = (
  start: CaseState,
  commands: readonly CaseCommand[],
): CaseState => {
  let state = start;

  for (const command of commands) {
    const decision = decideCase(state, command);
    expect(decision.ok).toBe(true);
    if (!decision.ok) {
      throw new Error(decision.error.code);
    }

    state = decision.value.reduce(evolveCase, state);
  }

  return state;
};

describe("decideCase and evolveCase", () => {
  it("creates a draft from an empty stream", () => {
    expect(foldCaseEvents([{ type: "draft_created" }]).status).toBe("draft");

    const state = applyFrom(initialCaseState, [{ type: "create_draft" }]);

    expect(state).toEqual({
      status: "draft",
      attachedPrivateRecordIds: [],
      attachedPrivateRecordKinds: [],
      privateDataPurged: false,
    });
  });

  it("rejects a second create_draft", () => {
    const draft = applyFrom(initialCaseState, [{ type: "create_draft" }]);

    expect(decideCase(draft, { type: "create_draft" })).toEqual({
      ok: false,
      error: { code: "CASE_ALREADY_EXISTS" },
    });
  });

  it("rejects mutations on an unknown case", () => {
    expect(decideCase(initialCaseState, { type: "submit_draft" })).toEqual({
      ok: false,
      error: { code: "CASE_NOT_FOUND" },
    });
  });

  it("attaches opaque private-record references only while drafting", () => {
    const draft = applyFrom(initialCaseState, [{ type: "create_draft" }]);
    const attached = applyFrom(draft, [
      {
        type: "attach_private_data",
        privateRecordId: "record-1",
        kind: "text",
      },
    ]);

    expect(attached.attachedPrivateRecordIds).toEqual(["record-1"]);
    expect(
      decideCase(attached, {
        type: "attach_private_data",
        privateRecordId: "record-1",
        kind: "text",
      }),
    ).toEqual({
      ok: false,
      error: { code: "PRIVATE_RECORD_ALREADY_ATTACHED" },
    });

    const submitted = applyFrom(attached, [
      ...requiredAttachments,
      { type: "submit_draft" },
    ]);
    expect(
      decideCase(submitted, {
        type: "attach_private_data",
        privateRecordId: "record-2",
        kind: "location",
      }),
    ).toEqual({
      ok: false,
      error: { code: "INVALID_TRANSITION" },
    });
  });

  it("walks submitted, in review, completed, then purge", () => {
    const completed = applyFrom(initialCaseState, [
      { type: "create_draft" },
      {
        type: "attach_private_data",
        privateRecordId: "record-1",
        kind: "contact",
      },
      ...requiredAttachments,
      { type: "submit_draft" },
      { type: "start_review" },
      { type: "complete_case" },
    ]);

    expect(completed.status).toBe("completed");
    expect(hasAvailablePrivateData(completed)).toBe(true);
    expect(toPublicCaseState(completed.status)).toBe("closed");

    expect(decideCase(completed, { type: "submit_draft" })).toEqual({
      ok: false,
      error: { code: "INVALID_TRANSITION" },
    });

    const purged = applyFrom(completed, [{ type: "purge_private_data" }]);
    expect(purged.privateDataPurged).toBe(true);
    expect(purged.status).toBe("completed");
    expect(hasAvailablePrivateData(purged)).toBe(false);
    expect(decideCase(purged, { type: "purge_private_data" })).toEqual({
      ok: false,
      error: { code: "NOTHING_TO_PURGE" },
    });
  });

  it("requires location, animal details, and contact choices before submission", () => {
    const draft = applyFrom(initialCaseState, [{ type: "create_draft" }]);
    expect(decideCase(draft, { type: "submit_draft" })).toEqual({
      ok: false,
      error: { code: "INCOMPLETE_REPORT" },
    });
    for (const missing of ["location", "form_snapshot", "contact"]) {
      const partial = applyFrom(
        draft,
        requiredAttachments.filter(
          (command) =>
            command.type === "attach_private_data" && command.kind !== missing,
        ),
      );
      expect(decideCase(partial, { type: "submit_draft" })).toEqual({
        ok: false,
        error: { code: "INCOMPLETE_REPORT" },
      });
    }
    expect(
      decideCase(applyFrom(draft, requiredAttachments), {
        type: "submit_draft",
      }).ok,
    ).toBe(true);
  });

  it("rejects complete_case before review", () => {
    const submitted = applyFrom(initialCaseState, [
      { type: "create_draft" },
      ...requiredAttachments,
      { type: "submit_draft" },
    ]);

    expect(decideCase(submitted, { type: "complete_case" })).toEqual({
      ok: false,
      error: { code: "INVALID_TRANSITION" },
    });
  });

  it("expires a draft and purges any remaining private references", () => {
    const draft = applyFrom(initialCaseState, [
      { type: "create_draft" },
      {
        type: "attach_private_data",
        privateRecordId: "record-1",
        kind: "text",
      },
    ]);

    const decision = decideCase(draft, { type: "expire_draft" });
    expect(decision).toEqual({
      ok: true,
      value: [{ type: "private_data_purged" }, { type: "draft_expired" }],
    });

    if (!decision.ok) {
      throw new Error(decision.error.code);
    }

    const expired = decision.value.reduce(evolveCase, draft);
    expect(expired.status).toBe("expired");
    expect(expired.privateDataPurged).toBe(true);
    expect(toPublicCaseState(expired.status)).toBe("closed");
  });
});

describe("effectsFromTransition", () => {
  it("schedules expiry, queue notification, and purge without private content", () => {
    const created = applyFrom(initialCaseState, [{ type: "create_draft" }]);
    expect(effectsFromTransition(created, [{ type: "draft_created" }])).toEqual(
      [{ type: "schedule_draft_expiry" }],
    );

    const submitted = applyFrom(created, [
      ...requiredAttachments,
      { type: "submit_draft" },
    ]);
    expect(
      effectsFromTransition(submitted, [{ type: "draft_submitted" }]),
    ).toEqual([{ type: "notify_case_queued" }]);

    const withPrivateData: CaseState = {
      ...submitted,
      attachedPrivateRecordIds: ["record-1"],
    };
    const completed = evolveCase(withPrivateData, { type: "case_completed" });
    expect(
      effectsFromTransition(completed, [{ type: "case_completed" }]),
    ).toEqual([{ type: "schedule_private_data_purge" }]);

    const completedEmpty = evolveCase(submitted, { type: "case_completed" });
    expect(
      effectsFromTransition(completedEmpty, [{ type: "case_completed" }]),
    ).toEqual([{ type: "schedule_private_data_purge" }]);
    expect(decideCase(completedEmpty, { type: "purge_private_data" })).toEqual({
      ok: true,
      value: [{ type: "private_data_purged" }],
    });
  });
});

describe("recorded case events", () => {
  it("round-trips privacy-safe payloads", () => {
    const events: readonly CaseDomainEvent[] = [
      { type: "draft_created" },
      {
        type: "private_data_attached",
        privateRecordId: "11111111-1111-4111-8111-111111111111",
        kind: "text",
      },
      { type: "draft_submitted" },
    ];

    for (const event of events) {
      const payload = encodeCaseEventPayload(event);
      expect(JSON.stringify(payload)).not.toMatch(/@|email|capability/i);

      const recorded: RecordedEvent = {
        id: "event-1",
        streamId: "22222222-2222-4222-8222-222222222222",
        streamVersion: 1,
        type: recordedTypeFor(event),
        schemaVersion: 1,
        occurredAt: "2026-08-22T12:00:00.000Z",
        commandId: "33333333-3333-4333-8333-333333333333",
        correlationId: "44444444-4444-4444-8444-444444444444",
        payload,
      };

      expect(decodeRecordedCaseEvent(recorded)).toEqual({
        ok: true,
        value: event,
      });
    }
  });

  it("rejects an unknown or versioned-incompatible recorded event", () => {
    const base: RecordedEvent = {
      id: "event-1",
      streamId: "22222222-2222-4222-8222-222222222222",
      streamVersion: 1,
      type: CASE_EVENT_TYPE.draftCreated,
      schemaVersion: 2,
      occurredAt: "2026-08-22T12:00:00.000Z",
      commandId: "33333333-3333-4333-8333-333333333333",
      correlationId: "44444444-4444-4444-8444-444444444444",
      payload: {},
    };

    expect(decodeRecordedCaseEvent(base).ok).toBe(false);
    expect(
      decodeRecordedCaseEvent({
        ...base,
        schemaVersion: 1,
        type: "case.unknown",
      }).ok,
    ).toBe(false);
  });
});
