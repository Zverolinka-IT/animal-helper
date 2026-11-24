import type { Sql } from "postgres";
import {
  parseFormSnapshot,
  type FormSnapshotV1,
  type ReportOutcome,
} from "@animal-helper/contracts";
import {
  initialAdminDocument,
  type AdminCaseDocument,
} from "@animal-helper/domain";
export {
  applyAdminCommand,
  initialAdminDocument,
  type AdminCaseDocument,
  type AdminCommand,
  type AdminMode,
  type AdminUrgency,
} from "@animal-helper/domain";

export type AppCaseFacts = Readonly<{
  situationType: string;
  speciesKey: string;
  address: string;
  latitude?: number;
  longitude?: number;
  symptoms: readonly string[];
  description: string;
  condition?: FormSnapshotV1["condition"];
  report?: Pick<
    FormSnapshotV1,
    "dead" | "cruelty" | "other" | "closure" | "species"
  >;
  outcome?: ReportOutcome;
  reporterName: string;
  reporterPhone: string;
  reporterEmail: string;
  shareWithAuthorities: boolean;
  mediaCount: number;
}>;

export type PrivateRecordRow = Readonly<{
  kind: string;
  payload: unknown;
}>;

const emptyFacts = (): AppCaseFacts => ({
  situationType: "",
  speciesKey: "",
  address: "",
  symptoms: [],
  description: "",
  reporterName: "",
  reporterPhone: "",
  reporterEmail: "",
  shareWithAuthorities: false,
  mediaCount: 0,
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

export const parseAdminDocument = (
  value: unknown,
  situationType: string,
): AdminCaseDocument => {
  const base = initialAdminDocument(situationType);
  if (!isRecord(value)) {
    return base;
  }
  const mode = value.mode;
  const urgency = value.urgency;
  return {
    ...base,
    mode:
      mode === "passive" ||
      mode === "review" ||
      mode === "active" ||
      mode === "closed"
        ? mode
        : base.mode,
    urgency:
      urgency === "acute" || urgency === "high" || urgency === "normal"
        ? urgency
        : base.urgency,
    ownerEmail: text(value.ownerEmail),
    nextStep: text(value.nextStep).slice(0, 500),
    deadline: text(value.deadline),
    note: text(value.note).slice(0, 4000),
    seenBy: isRecord(value.seenBy)
      ? Object.fromEntries(
          Object.entries(value.seenBy).flatMap(([key, seen]) =>
            typeof seen === "string" ? [[key, seen]] : [],
          ),
        )
      : {},
    ...(isRecord(value.volunteer)
      ? {
          volunteer: {
            name: text(value.volunteer.name).slice(0, 200),
            task: text(value.volunteer.task).slice(0, 200),
            result: text(value.volunteer.result).slice(0, 2000),
          },
        }
      : {}),
    actions: Array.isArray(value.actions)
      ? value.actions.flatMap((item) => {
          if (!isRecord(item) || text(item.id) === "") {
            return [];
          }
          return [
            {
              id: text(item.id),
              kind: text(item.kind).slice(0, 80),
              at: text(item.at),
              by: text(item.by).slice(0, 200),
              result: text(item.result).slice(0, 2000),
            },
          ];
        })
      : [],
    steps: Array.isArray(value.steps)
      ? value.steps.flatMap((item) => {
          if (!isRecord(item) || text(item.id) === "") {
            return [];
          }
          return [
            {
              id: text(item.id),
              text: text(item.text).slice(0, 500),
              due: text(item.due),
              done: item.done === true,
            },
          ];
        })
      : [],
    referrals: Array.isArray(value.referrals)
      ? value.referrals.flatMap((item) => {
          if (!isRecord(item) || text(item.id) === "") {
            return [];
          }
          return [
            {
              id: text(item.id),
              recipient: text(item.recipient).slice(0, 200),
              sentOn: text(item.sentOn),
              replyFileName: text(item.replyFileName).slice(0, 300),
              inspections: Array.isArray(item.inspections)
                ? item.inspections.flatMap((inspection) => {
                    if (!isRecord(inspection) || text(inspection.id) === "") {
                      return [];
                    }
                    return [
                      {
                        id: text(inspection.id),
                        on: text(inspection.on),
                        by: text(inspection.by).slice(0, 200),
                        outcome: text(inspection.outcome).slice(0, 80),
                        findings: text(inspection.findings).slice(0, 2000),
                      },
                    ];
                  })
                : [],
            },
          ];
        })
      : [],
  };
};

export const appFactsFromRecords = (
  records: readonly PrivateRecordRow[],
): AppCaseFacts => {
  const facts = emptyFacts();
  let description = "";
  let mediaCount = 0;
  let situationType = "";
  let speciesKey = "";
  let address = "";
  let latitude: number | undefined;
  let longitude: number | undefined;
  let symptoms: string[] = [];
  let reporterName = "";
  let reporterPhone = "";
  let reporterEmail = "";
  let shareWithAuthorities = false;
  let conditionDetails: FormSnapshotV1["condition"] | undefined;
  let outcome: ReportOutcome | undefined;
  let report: AppCaseFacts["report"];

  for (const record of records) {
    if (!isRecord(record.payload)) {
      if (record.kind === "media_ref") {
        mediaCount += 1;
      }
      continue;
    }
    if (record.kind === "form_snapshot") {
      const snapshot = parseFormSnapshot(record.payload);
      conditionDetails = snapshot.success ? snapshot.data.condition : undefined;
      outcome = snapshot.success ? snapshot.data.outcome : undefined;
      report = snapshot.success
        ? {
            species: snapshot.data.species,
            ...(snapshot.data.dead ? { dead: snapshot.data.dead } : {}),
            ...(snapshot.data.cruelty
              ? { cruelty: snapshot.data.cruelty }
              : {}),
            ...(snapshot.data.other ? { other: snapshot.data.other } : {}),
            ...(snapshot.data.closure
              ? { closure: snapshot.data.closure }
              : {}),
          }
        : undefined;
      situationType = text(record.payload.situationType) || situationType;
      const species = isRecord(record.payload.species)
        ? record.payload.species
        : undefined;
      speciesKey = text(species?.kindKey);
      const condition = isRecord(record.payload.condition)
        ? record.payload.condition
        : undefined;
      if (Array.isArray(condition?.symptoms)) {
        symptoms = condition.symptoms.flatMap((item) =>
          typeof item === "string" ? [item] : [],
        );
      }
      description = text(condition?.otherText);
    }
    if (record.kind === "location") {
      address = text(record.payload.address) || address;
      const coordinates = isRecord(record.payload.coordinates)
        ? record.payload.coordinates
        : undefined;
      latitude = undefined;
      longitude = undefined;
      if (typeof coordinates?.latitude === "number") {
        latitude = coordinates.latitude;
      }
      if (typeof coordinates?.longitude === "number") {
        longitude = coordinates.longitude;
      }
    }
    if (record.kind === "contact") {
      reporterName = text(record.payload.name);
      reporterPhone = text(record.payload.phone);
      reporterEmail = text(record.payload.email);
      shareWithAuthorities = record.payload.shareWithAuthorities === true;
    }
    if (record.kind === "media_ref") {
      mediaCount += 1;
    }
  }

  return {
    ...facts,
    situationType,
    speciesKey,
    address,
    ...(latitude === undefined ? {} : { latitude }),
    ...(longitude === undefined ? {} : { longitude }),
    symptoms,
    description,
    ...(conditionDetails ? { condition: conditionDetails } : {}),
    ...(outcome ? { outcome } : {}),
    ...(report ? { report } : {}),
    reporterName,
    reporterPhone,
    reporterEmail,
    shareWithAuthorities,
    mediaCount,
  };
};

export const caseNumber = (streamId: string, createdAt: Date): string =>
  `ZV-${createdAt.getUTCFullYear()}-${streamId.replaceAll("-", "").slice(0, 8).toUpperCase()}`;

export const isUnread = (
  document: AdminCaseDocument,
  email: string,
  updatedAt: string,
): boolean => {
  const seen = document.seenBy[email];
  return seen === undefined || seen < updatedAt;
};

type QueueRow = {
  stream_id: string;
  workflow_state: string;
  created_at: Date;
  updated_at: Date;
  document: unknown;
  revision: number | null;
};

type PrivateRow = {
  stream_id: string;
  kind: string;
  payload: unknown;
};

export type StoredAdminCase = Readonly<{
  streamId: string;
  workflowState: string;
  createdAt: Date;
  updatedAt: Date;
  document: AdminCaseDocument;
  facts: AppCaseFacts;
  revision: number;
}>;

const groupFacts = (
  rows: readonly PrivateRow[],
): Map<string, PrivateRecordRow[]> => {
  const grouped = new Map<string, PrivateRecordRow[]>();
  for (const row of rows) {
    const current = grouped.get(row.stream_id) ?? [];
    current.push({ kind: row.kind, payload: row.payload });
    grouped.set(row.stream_id, current);
  }
  return grouped;
};

export const loadAdminCases = async (
  sql: Sql,
  options: Readonly<{
    streamId?: string;
    offset?: number;
    limit?: number;
  }> = {},
): Promise<readonly StoredAdminCase[]> => {
  const queues = await sql<QueueRow[]>`
    select
      queue.stream_id,
      queue.workflow_state,
      queue.created_at,
      greatest(queue.updated_at, work.updated_at) as updated_at,
      work.document,
      work.revision
    from ah.case_queue_projection queue
    left join ah.admin_case_work work on work.stream_id = queue.stream_id
    where queue.workflow_state not in ('draft', 'expired')
      ${options.streamId === undefined ? sql`` : sql`and queue.stream_id = ${options.streamId}::uuid`}
    order by greatest(queue.updated_at, work.updated_at) desc, queue.stream_id desc
    limit ${options.limit ?? 100}
    offset ${options.offset ?? 0}
  `;
  if (queues.length === 0) {
    return [];
  }
  const ids = queues.map((row) => row.stream_id);
  const records = await sql<PrivateRow[]>`
    select records.stream_id, records.kind, records.payload
    from ah.private_records records
    left join ah.events event on event.stream_id = records.stream_id
      and event.payload->>'privateRecordId' = records.private_record_id::text
    where records.deleted_at is null
      and records.stream_id in ${sql(ids)}
    order by records.created_at, event.stream_version, records.private_record_id
  `;
  const facts = groupFacts(records);
  return queues.map((row) => {
    const app = appFactsFromRecords(facts.get(row.stream_id) ?? []);
    const document = parseAdminDocument(row.document, app.situationType);
    const mode =
      row.workflow_state === "completed"
        ? "closed"
        : row.workflow_state === "in_review"
          ? "active"
          : document.mode === "closed"
            ? "passive"
            : document.mode;
    return {
      streamId: row.stream_id,
      workflowState: row.workflow_state,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      document: { ...document, mode },
      facts: app,
      revision: row.revision ?? 0,
    };
  });
};

export const saveAdminDocument = async (
  sql: Sql,
  streamId: string,
  document: AdminCaseDocument,
): Promise<void> => {
  await sql`
    insert into ah.admin_case_work (stream_id, document, updated_at)
    values (${streamId}::uuid, ${sql.json(document)}, now())
    on conflict (stream_id) do update
    set document = excluded.document,
        updated_at = now()
  `;
};
