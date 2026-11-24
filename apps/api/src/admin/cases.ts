import {
  adminCaseRequestSchema,
  type AdminCaseRequest,
  type AdminCaseSearch,
} from "@animal-helper/contracts";
import { findAnimalKind } from "@animal-helper/guidance";
import { t } from "@animal-helper/i18n";
import { createSearchMatcher } from "@animal-helper/search";
import {
  executeAdminCaseCommand,
  hashCommandContent,
  caseNumber,
  isUnread,
  loadAdminCases,
  type AdminCaseDocument,
  type AdminCommand,
  type AdminUrgency,
  type StoredAdminCase,
} from "@animal-helper/event-store";
import type { Sql } from "postgres";

const urgencyOf = (value: unknown): AdminUrgency | undefined =>
  value === "acute" || value === "high" || value === "normal"
    ? value
    : undefined;

const text = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

export const adminCommandFromBody = (
  body: unknown,
  email: string,
  now: Date,
  createId: () => string,
): AdminCommand | undefined => {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return undefined;
  }
  const record = body as Record<string, unknown>;
  const at = now.toISOString();
  switch (record.type) {
    case "seen":
      return { type: "seen", at, email };
    case "take_over":
      return { type: "take_over", at, email };
    case "leave_passive":
      return { type: "leave_passive" };
    case "close":
      return { type: "close" };
    case "set_work": {
      const urgency = urgencyOf(record.urgency);
      if (urgency === undefined) {
        return undefined;
      }
      return {
        type: "set_work",
        urgency,
        nextStep: text(record.nextStep),
        deadline: text(record.deadline),
        note: text(record.note),
      };
    }
    case "add_action":
      return {
        type: "add_action",
        id: createId(),
        at,
        email,
        kind: text(record.kind),
        result: text(record.result),
      };
    case "add_step":
      return {
        type: "add_step",
        id: createId(),
        text: text(record.text),
        due: text(record.due),
      };
    case "remove_step":
      return text(record.id) === ""
        ? undefined
        : { type: "remove_step", id: text(record.id) };
    case "add_volunteer":
      return {
        type: "add_volunteer",
        name: text(record.name),
        task: text(record.task),
        result: text(record.result),
      };
    case "add_referral":
      return {
        type: "add_referral",
        id: createId(),
        recipient: text(record.recipient),
        sentOn: text(record.sentOn) || at.slice(0, 10),
        replyFileName: text(record.replyFileName),
      };
    case "add_inspection":
      return text(record.referralId) === ""
        ? undefined
        : {
            type: "add_inspection",
            id: createId(),
            referralId: text(record.referralId),
            on: text(record.on) || at.slice(0, 10),
            by: text(record.by),
            outcome: text(record.outcome),
            findings: text(record.findings),
          };
    default:
      return undefined;
  }
};

const summaryOf = (item: StoredAdminCase, email: string) => ({
  streamId: item.streamId,
  revision: item.revision,
  caseNumber: caseNumber(item.streamId, item.createdAt),
  createdAt: item.createdAt.toISOString(),
  updatedAt: item.updatedAt.toISOString(),
  workflowState: item.workflowState,
  situationType: item.facts.situationType,
  speciesKey: item.facts.speciesKey,
  address: item.facts.address,
  reporterEmail: item.facts.reporterEmail,
  mode: item.document.mode,
  urgency: item.document.urgency,
  ownerEmail: item.document.ownerEmail,
  nextStep: item.document.nextStep,
  deadline: item.document.deadline,
  unread: isUnread(item.document, email, item.updatedAt.toISOString()),
  waitingOnAuthority: item.document.referrals.some(
    (referral) => referral.sentOn !== "" && referral.inspections.length === 0,
  ),
});

const detailOf = (item: StoredAdminCase, email: string) => ({
  ...summaryOf(item, email),
  facts: item.facts,
  work: item.document,
});

const situationLabel = (value: string): string =>
  ["injured", "stray", "dead", "cruelty", "other"].includes(value)
    ? t(`backoffice.queue.situation.${value}`)
    : value;

export const adminCaseList = async (
  sql: Sql,
  email: string,
  page = 0,
  filters: Pick<AdminCaseSearch, "query" | "reporterEmail" | "ownerEmail"> = {
    query: "",
    reporterEmail: "",
    ownerEmail: "",
  },
) => {
  const pageSize = 100;
  if (
    ![filters.query, filters.reporterEmail, filters.ownerEmail].some(
      (value) => value.trim() !== "",
    )
  ) {
    const items = await loadAdminCases(sql, {
      offset: page * pageSize,
      limit: pageSize + 1,
    });
    return {
      cases: items.slice(0, pageSize).map((item) => summaryOf(item, email)),
      nextPage: items.length > pageSize ? page + 1 : null,
    };
  }
  const matchesText = createSearchMatcher(filters.query);
  const matchesReporter = createSearchMatcher(filters.reporterEmail);
  const matchesOwner = createSearchMatcher(filters.ownerEmail);
  // Scan bounded batches using one database snapshot. Apply the same pure
  // matcher as the other admin screens before counting/skipping matched cases,
  // rather than paginating first or maintaining a second SQL fuzzy algorithm.
  return sql.begin("isolation level repeatable read read only", async (tx) => {
    // postgres's TransactionSql type omits the client's callable signatures.
    const reader = tx as unknown as Sql;
    const cases: ReturnType<typeof summaryOf>[] = [];
    let skip = page * pageSize;
    const batchSize = 250;
    for (let offset = 0; ; offset += batchSize) {
      const batch = await loadAdminCases(reader, { offset, limit: batchSize });
      for (const item of batch) {
        if (
          !matchesReporter([item.facts.reporterEmail]) ||
          !matchesOwner([item.document.ownerEmail])
        )
          continue;
        const summary = summaryOf(item, email);
        if (
          !matchesText([
            summary.caseNumber,
            summary.speciesKey,
            findAnimalKind(summary.speciesKey)?.labelSk,
            summary.address,
            summary.nextStep,
            summary.situationType,
            situationLabel(summary.situationType),
            summary.reporterEmail,
            summary.ownerEmail,
          ])
        )
          continue;
        if (skip > 0) {
          skip--;
          continue;
        }
        cases.push(summary);
        if (cases.length > pageSize) {
          return { cases: cases.slice(0, pageSize), nextPage: page + 1 };
        }
      }
      if (batch.length < batchSize) return { cases, nextPage: null };
    }
  });
};

export const adminCaseDetail = async (
  sql: Sql,
  streamId: string,
  email: string,
) => {
  const item = (await loadAdminCases(sql, { streamId, limit: 1 }))[0];
  return item === undefined ? undefined : detailOf(item, email);
};

export const adminUpdateCase = async (
  sql: Sql,
  streamId: string,
  email: string,
  command: AdminCommand,
  now: Date,
  request?: AdminCaseRequest,
) => {
  const result = await executeAdminCaseCommand(sql, {
    streamId,
    email,
    command,
    now,
    ...(request
      ? {
          mutation: {
            commandId: request.commandId,
            expectedRevision: request.expectedRevision,
            contentHash: hashCommandContent(request),
          },
        }
      : {}),
  });
  return result.ok
    ? { ok: true as const, case: detailOf(result.case, email) }
    : result;
};

export const parseAdminCaseRequest = (body: unknown) =>
  adminCaseRequestSchema.safeParse(body);

export type { AdminCaseDocument };
