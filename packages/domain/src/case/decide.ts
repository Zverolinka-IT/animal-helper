import { err, ok, type Result } from "../result.js";
import {
  type CaseCommand,
  type CaseDomainError,
  type CaseDomainEvent,
  type CaseState,
} from "./types.js";

const notFound: CaseDomainError = { code: "CASE_NOT_FOUND" };
const invalidTransition: CaseDomainError = { code: "INVALID_TRANSITION" };

export const decideCase = (
  state: CaseState,
  command: CaseCommand,
): Result<readonly CaseDomainEvent[], CaseDomainError> => {
  switch (command.type) {
    case "create_draft":
      if (state.status !== "uninitialized") {
        return err({ code: "CASE_ALREADY_EXISTS" });
      }

      return ok([{ type: "draft_created" }]);
    case "attach_private_data":
      if (state.status === "uninitialized") {
        return err(notFound);
      }

      if (state.status !== "draft" || state.privateDataPurged) {
        return err(invalidTransition);
      }

      if (state.attachedPrivateRecordIds.includes(command.privateRecordId)) {
        return err({ code: "PRIVATE_RECORD_ALREADY_ATTACHED" });
      }

      return ok([
        {
          type: "private_data_attached",
          privateRecordId: command.privateRecordId,
          kind: command.kind,
        },
      ]);
    case "submit_draft":
      if (state.status === "uninitialized") {
        return err(notFound);
      }

      if (state.status !== "draft" || state.privateDataPurged) {
        return err(invalidTransition);
      }

      if (
        !(["location", "form_snapshot", "contact"] as const).every((kind) =>
          state.attachedPrivateRecordKinds.includes(kind),
        )
      ) {
        return err({ code: "INCOMPLETE_REPORT" });
      }
      return ok([{ type: "draft_submitted" }]);
    case "start_review":
      if (state.status === "uninitialized") {
        return err(notFound);
      }

      if (state.status !== "submitted") {
        return err(invalidTransition);
      }

      return ok([{ type: "review_started" }]);
    case "complete_case":
      if (state.status === "uninitialized") {
        return err(notFound);
      }

      if (state.status !== "in_review") {
        return err(invalidTransition);
      }

      return ok([{ type: "case_completed" }]);
    case "purge_private_data":
      if (state.status === "uninitialized") {
        return err(notFound);
      }

      if (state.status !== "completed") {
        return err(invalidTransition);
      }

      // Admin working data is erasable too, even for a report with no reporter
      // attachments. The first purge verifies cleanup of every private store.
      if (state.privateDataPurged) {
        return err({ code: "NOTHING_TO_PURGE" });
      }

      return ok([{ type: "private_data_purged" }]);
    case "expire_draft":
      if (state.status === "uninitialized") {
        return err(notFound);
      }

      if (state.status !== "draft") {
        return err(invalidTransition);
      }

      return ok(
        !state.privateDataPurged
          ? [{ type: "private_data_purged" }, { type: "draft_expired" }]
          : [{ type: "draft_expired" }],
      );
  }
};
