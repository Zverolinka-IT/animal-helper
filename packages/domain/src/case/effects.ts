import {
  type CaseDomainEvent,
  type CaseState,
  type OutboxEffect,
} from "./types.js";

export const effectsFromTransition = (
  nextState: CaseState,
  events: readonly CaseDomainEvent[],
): readonly OutboxEffect[] => {
  const effects: OutboxEffect[] = [];

  for (const event of events) {
    switch (event.type) {
      case "draft_created":
        effects.push({ type: "schedule_draft_expiry" });
        break;
      case "draft_submitted":
        effects.push({ type: "notify_case_queued" });
        break;
      case "case_completed":
        if (!nextState.privateDataPurged) {
          effects.push({ type: "schedule_private_data_purge" });
        }
        break;
      case "private_data_attached":
      case "review_started":
      case "private_data_purged":
      case "draft_expired":
        break;
    }
  }

  return effects;
};
