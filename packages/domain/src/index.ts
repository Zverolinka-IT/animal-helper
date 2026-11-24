export {
  foldEvents,
  validateEventStream,
  type Evolver,
  type RecordedEvent,
  type StreamValidationError,
  type StreamValidationResult,
} from "./event-stream.js";
export {
  assertNever,
  err,
  ok,
  type Err,
  type Ok,
  type Result,
} from "./result.js";
export {
  CASE_EVENT_TYPE,
  hasAvailablePrivateData,
  initialCaseState,
  toPublicCaseState,
  type ActorKind,
  type CaseCommand,
  type CaseDomainError,
  type CaseDomainEvent,
  type CaseEventType,
  type CaseState,
  type CaseStatus,
  type OutboxEffect,
  type OutboxEffectType,
  type PrivateRecordKind,
  type PublicCaseState,
} from "./case/types.js";
export { decideCase } from "./case/decide.js";
export { evolveCase, foldCaseEvents } from "./case/evolve.js";
export { effectsFromTransition } from "./case/effects.js";
export {
  decodeRecordedCaseEvent,
  decodeRecordedCaseEvents,
  encodeCaseEventPayload,
  recordedTypeFor,
  type CaseEventDecodeError,
  type CaseEventPayload,
  type RecordedCaseEvent,
} from "./case/recorded.js";

export {
  applyAdminCommand,
  initialAdminDocument,
  type AdminCaseDocument,
  type AdminCommand,
  type AdminMode,
  type AdminUrgency,
} from "./case/admin-work.js";
