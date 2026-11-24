import { foldEvents } from "../event-stream.js";
import { assertNever } from "../result.js";
import {
  initialCaseState,
  type CaseDomainEvent,
  type CaseState,
} from "./types.js";

export const evolveCase = (
  state: Readonly<CaseState>,
  event: Readonly<CaseDomainEvent>,
): CaseState => {
  switch (event.type) {
    case "draft_created":
      return {
        ...state,
        status: "draft",
      };
    case "private_data_attached":
      return {
        ...state,
        attachedPrivateRecordIds: [
          ...state.attachedPrivateRecordIds,
          event.privateRecordId,
        ],
        attachedPrivateRecordKinds: state.attachedPrivateRecordKinds.includes(
          event.kind,
        )
          ? state.attachedPrivateRecordKinds
          : [...state.attachedPrivateRecordKinds, event.kind],
      };
    case "draft_submitted":
      return {
        ...state,
        status: "submitted",
      };
    case "review_started":
      return {
        ...state,
        status: "in_review",
      };
    case "case_completed":
      return {
        ...state,
        status: "completed",
      };
    case "private_data_purged":
      return {
        ...state,
        privateDataPurged: true,
      };
    case "draft_expired":
      return {
        ...state,
        status: "expired",
      };
    default:
      return assertNever(event);
  }
};

export const foldCaseEvents = (events: readonly CaseDomainEvent[]): CaseState =>
  foldEvents(initialCaseState, evolveCase, events);
