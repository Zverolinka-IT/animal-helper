export type CaseStatus =
  | "uninitialized"
  | "draft"
  | "submitted"
  | "in_review"
  | "completed"
  | "expired";

export type PublicCaseState = "draft" | "received" | "closed";

export type PrivateRecordKind =
  "contact" | "text" | "location" | "media_ref" | "form_snapshot";

export type ActorKind = "reporter" | "administrator" | "system";

export type CaseState = Readonly<{
  status: CaseStatus;
  attachedPrivateRecordIds: readonly string[];
  attachedPrivateRecordKinds: readonly PrivateRecordKind[];
  privateDataPurged: boolean;
}>;

export const initialCaseState: CaseState = {
  status: "uninitialized",
  attachedPrivateRecordIds: [],
  attachedPrivateRecordKinds: [],
  privateDataPurged: false,
};

export const hasAvailablePrivateData = (state: CaseState): boolean =>
  state.attachedPrivateRecordIds.length > 0 && !state.privateDataPurged;

export const toPublicCaseState = (status: CaseStatus): PublicCaseState => {
  switch (status) {
    case "uninitialized":
    case "draft":
      return "draft";
    case "submitted":
    case "in_review":
      return "received";
    case "completed":
    case "expired":
      return "closed";
  }
};

export type CaseCommand =
  | Readonly<{ type: "create_draft" }>
  | Readonly<{
      type: "attach_private_data";
      privateRecordId: string;
      kind: PrivateRecordKind;
    }>
  | Readonly<{ type: "submit_draft" }>
  | Readonly<{ type: "start_review" }>
  | Readonly<{ type: "complete_case" }>
  | Readonly<{ type: "purge_private_data" }>
  | Readonly<{ type: "expire_draft" }>;

export type CaseDomainEvent =
  | Readonly<{ type: "draft_created" }>
  | Readonly<{
      type: "private_data_attached";
      privateRecordId: string;
      kind: PrivateRecordKind;
    }>
  | Readonly<{ type: "draft_submitted" }>
  | Readonly<{ type: "review_started" }>
  | Readonly<{ type: "case_completed" }>
  | Readonly<{ type: "private_data_purged" }>
  | Readonly<{ type: "draft_expired" }>;

export type CaseEventType =
  | "case.draft_created"
  | "case.private_data_attached"
  | "case.draft_submitted"
  | "case.review_started"
  | "case.case_completed"
  | "case.private_data_purged"
  | "case.draft_expired";

export const CASE_EVENT_TYPE = {
  draftCreated: "case.draft_created",
  privateDataAttached: "case.private_data_attached",
  draftSubmitted: "case.draft_submitted",
  reviewStarted: "case.review_started",
  caseCompleted: "case.case_completed",
  privateDataPurged: "case.private_data_purged",
  draftExpired: "case.draft_expired",
} as const satisfies Record<string, CaseEventType>;

export type CaseDomainError = Readonly<{
  code:
    | "CASE_ALREADY_EXISTS"
    | "CASE_NOT_FOUND"
    | "INVALID_TRANSITION"
    | "PRIVATE_RECORD_ALREADY_ATTACHED"
    | "INCOMPLETE_REPORT"
    | "NOTHING_TO_PURGE";
}>;

export type OutboxEffectType =
  | "schedule_draft_expiry"
  | "notify_case_queued"
  | "schedule_private_data_purge";

export type OutboxEffect = Readonly<{
  type: OutboxEffectType;
}>;
