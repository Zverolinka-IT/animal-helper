import type { ReportGuidanceProfile } from "@animal-helper/contracts";
import { randomUUID } from "node:crypto";

import type { Sql } from "postgres";
import { lockGuidancePublication } from "./guidance-publication-lock.js";
import { recordOperatorAudit } from "./operators.js";

export class GuidanceConflictError extends Error {
  readonly code = "conflict";

  constructor() {
    super("conflict");
    this.name = "GuidanceConflictError";
  }
}

export type GuidanceScope = Readonly<{
  flowKey: string;
  schemaVersion: number;
  locale: string;
  jurisdiction: string;
}>;

export type StoredGuidanceCell = Readonly<{
  kindKey: string;
  instructionKey: string;
  applicability: "on" | "off";
  sortOrder: number;
  copy: Readonly<Record<string, string>>;
  actionTargetKey?: string;
  clinicVariant?: "standard" | "protected";
}>;

export type StoredGuidanceDocument = Readonly<{
  reportProfiles?: readonly ReportGuidanceProfile[];
  copy: Readonly<Record<string, string>>;
  cells: readonly StoredGuidanceCell[];
}>;

export type GuidanceRevisionRecord = Readonly<{
  revisionId: string;
  status: "draft" | "published" | "withdrawn";
  contentHash: string;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  publishedAt?: Date;
  description?: string;
  basedOnRevisionId?: string;
  sourceReferences: readonly string[];
  contentReviewedAt?: Date;
}>;

export type GuidancePublicationRecord = Readonly<{
  revisionId: string;
  contentHash: string;
  publishedAt: Date;
  description?: string;
  directoryRevisionId?: string;
}>;

type RevisionRow = {
  revision_id: string;
  status: "draft" | "published" | "withdrawn";
  content_hash: string;
  created_by: string;
  created_at: Date;
  updated_at: Date;
  published_at: Date | null;
  description: string | null;
  based_on_revision_id: string | null;
  source_references: string[] | null;
  content_reviewed_at: Date | null;
};

type CellRow = {
  kind_key: string;
  instruction_key: string;
  applicability: "on" | "off";
  sort_order: number;
  copy_json: unknown;
  action_target_key: string | null;
  clinic_variant: "standard" | "protected" | null;
};

type CopyRow = {
  copy_slot_key: string;
  plain_text: string;
};

const readCopy = (value: unknown): Record<string, string> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  const copy: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string" && entry !== "") {
      copy[key] = entry;
    }
  }
  return copy;
};

const toRevision = (row: RevisionRow): GuidanceRevisionRecord => ({
  revisionId: row.revision_id,
  status: row.status,
  contentHash: row.content_hash,
  createdBy: row.created_by,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  sourceReferences: row.source_references ?? [],
  ...(row.published_at === null ? {} : { publishedAt: row.published_at }),
  ...(row.description === null ? {} : { description: row.description }),
  ...(row.based_on_revision_id === null
    ? {}
    : { basedOnRevisionId: row.based_on_revision_id }),
  ...(row.content_reviewed_at === null
    ? {}
    : { contentReviewedAt: row.content_reviewed_at }),
});

const toCell = (row: CellRow): StoredGuidanceCell => ({
  kindKey: row.kind_key,
  instructionKey: row.instruction_key,
  applicability: row.applicability,
  sortOrder: row.sort_order,
  copy: readCopy(row.copy_json),
  ...(row.action_target_key === null
    ? {}
    : { actionTargetKey: row.action_target_key }),
  ...(row.clinic_variant == null ? {} : { clinicVariant: row.clinic_variant }),
});

const withReservedTransaction = async <T>(
  sql: Sql,
  operation: (tx: Sql) => Promise<T>,
): Promise<T> => {
  const reserved = await sql.reserve();
  try {
    await reserved.unsafe("begin");
    try {
      const result = await operation(reserved);
      await reserved.unsafe("commit");
      return result;
    } catch (error) {
      try {
        await reserved.unsafe("rollback");
      } catch {
        // Keep the original failure.
      }
      throw error;
    }
  } finally {
    reserved.release();
  }
};

export const loadGuidanceDraft = async (
  sql: Sql,
  scope: GuidanceScope,
): Promise<GuidanceRevisionRecord | undefined> => {
  const rows = await sql<RevisionRow[]>`
    select
      revision_id,
      status,
      content_hash,
      created_by,
      created_at,
      updated_at,
      published_at,
      description,
      based_on_revision_id,
      source_references,
      content_reviewed_at
    from ah.guidance_revisions
    where
      flow_key = ${scope.flowKey}
      and schema_version = ${scope.schemaVersion}
      and locale = ${scope.locale}
      and jurisdiction = ${scope.jurisdiction}
      and status = 'draft'
    limit 1
  `;
  const row = rows[0];
  return row === undefined ? undefined : toRevision(row);
};

export const loadGuidancePublication = async (
  sql: Sql,
  scope: GuidanceScope,
): Promise<GuidancePublicationRecord | undefined> => {
  const rows = await sql<
    {
      revision_id: string;
      content_hash: string;
      published_at: Date;
      description: string | null;
      directory_revision_id: string | null;
    }[]
  >`
    select
      r.revision_id,
      r.content_hash,
      p.published_at,
      r.description,
      r.directory_revision_id
    from ah.guidance_publications p
    inner join ah.guidance_revisions r on r.revision_id = p.active_revision_id
    where
      p.flow_key = ${scope.flowKey}
      and p.schema_version = ${scope.schemaVersion}
      and p.locale = ${scope.locale}
      and p.jurisdiction = ${scope.jurisdiction}
      and r.status = 'published'
    limit 1
  `;
  const row = rows[0];
  if (row === undefined) {
    return undefined;
  }
  return {
    revisionId: row.revision_id,
    contentHash: row.content_hash,
    publishedAt: row.published_at,
    ...(row.description === null ? {} : { description: row.description }),
    ...(row.directory_revision_id === null
      ? {}
      : { directoryRevisionId: row.directory_revision_id }),
  };
};

export const loadGuidanceDocument = async (
  sql: Sql,
  revisionId: string,
): Promise<StoredGuidanceDocument | undefined> => {
  const profileRows = await sql<
    { report_profiles: ReportGuidanceProfile[] }[]
  >`select report_profiles from ah.guidance_revisions where revision_id = ${revisionId}::uuid`;
  const reportProfiles = profileRows[0]?.report_profiles ?? [];
  const copyRows = await sql<CopyRow[]>`
    select copy_slot_key, plain_text
    from ah.guidance_copy
    where revision_id = ${revisionId}::uuid
  `;
  const cellRows = await sql<CellRow[]>`
    select
      kind_key,
      instruction_key,
      applicability,
      sort_order,
      copy_json,
      action_target_key,
      clinic_variant
    from ah.guidance_cells
    where revision_id = ${revisionId}::uuid
  `;
  if (copyRows.length === 0 && cellRows.length === 0) {
    const exists = await sql<{ revision_id: string }[]>`
      select revision_id
      from ah.guidance_revisions
      where revision_id = ${revisionId}::uuid
    `;
    if (exists[0] === undefined) {
      return undefined;
    }
  }

  const copy: Record<string, string> = {};
  for (const row of copyRows) {
    copy[row.copy_slot_key] = row.plain_text;
  }
  return {
    copy,
    cells: cellRows.map(toCell),
    ...(reportProfiles.length ? { reportProfiles } : {}),
  };
};

const insertDocumentRows = async (
  sql: Sql,
  revisionId: string,
  document: StoredGuidanceDocument,
): Promise<void> => {
  await sql`update ah.guidance_revisions set report_profiles = ${sql.json([...(document.reportProfiles ?? [])])} where revision_id = ${revisionId}::uuid`;
  for (const [slotKey, text] of Object.entries(document.copy)) {
    if (text === "") {
      continue;
    }
    await sql`
      insert into ah.guidance_copy (revision_id, copy_slot_key, plain_text)
      values (${revisionId}::uuid, ${slotKey}, ${text})
    `;
  }
  for (const cell of document.cells) {
    await sql`
      insert into ah.guidance_cells (
        revision_id,
        kind_key,
        instruction_key,
        applicability,
        sort_order,
        copy_json,
        action_target_key,
        clinic_variant
      )
      values (
        ${revisionId}::uuid,
        ${cell.kindKey},
        ${cell.instructionKey},
        ${cell.applicability},
        ${cell.sortOrder},
        ${sql.json(cell.copy)},
        ${cell.actionTargetKey ?? null},
        ${cell.clinicVariant ?? null}
      )
    `;
  }
};

export const insertGuidanceDraft = async (
  sql: Sql,
  input: {
    actorEmail: string;
    now: Date;
    scope: GuidanceScope;
    document: StoredGuidanceDocument;
    contentHash: string;
    basedOnRevisionId?: string;
    sourceReferences: readonly string[];
  },
): Promise<GuidanceRevisionRecord> =>
  withReservedTransaction(sql, async (tx) => {
    const revisionId = randomUUID();
    const rows = await tx<RevisionRow[]>`
      insert into ah.guidance_revisions (
        revision_id,
        flow_key,
        schema_version,
        locale,
        jurisdiction,
        status,
        based_on_revision_id,
        created_by,
        created_at,
        updated_at,
        content_hash,
        source_references
      )
      values (
        ${revisionId}::uuid,
        ${input.scope.flowKey},
        ${input.scope.schemaVersion},
        ${input.scope.locale},
        ${input.scope.jurisdiction},
        'draft',
        ${input.basedOnRevisionId ?? null}::uuid,
        ${input.actorEmail},
        ${input.now},
        ${input.now},
        ${input.contentHash},
        ${tx.array([...input.sourceReferences])}
      )
      returning
        revision_id,
        status,
        content_hash,
        created_by,
        created_at,
        updated_at,
        published_at,
        description,
        based_on_revision_id,
        source_references,
        content_reviewed_at
    `;
    const row = rows[0];
    if (row === undefined) {
      throw new Error("failed to insert guidance draft");
    }
    await insertDocumentRows(tx, revisionId, input.document);
    return toRevision(row);
  });

export const saveGuidanceCell = async (
  sql: Sql,
  input: {
    revisionId: string;
    expectedHash: string;
    now: Date;
    cell: StoredGuidanceCell;
    nextHash: string;
  },
): Promise<void> =>
  withReservedTransaction(sql, async (tx) => {
    const updated = await tx<{ revision_id: string }[]>`
      update ah.guidance_revisions
      set
        content_hash = ${input.nextHash},
        updated_at = ${input.now}
      where
        revision_id = ${input.revisionId}::uuid
        and status = 'draft'
        and content_hash = ${input.expectedHash}
      returning revision_id
    `;
    if (updated[0] === undefined) {
      throw new GuidanceConflictError();
    }
    await tx`
      insert into ah.guidance_cells (
        revision_id,
        kind_key,
        instruction_key,
        applicability,
        sort_order,
        copy_json,
        action_target_key,
        clinic_variant
      )
      values (
        ${input.revisionId}::uuid,
        ${input.cell.kindKey},
        ${input.cell.instructionKey},
        ${input.cell.applicability},
        ${input.cell.sortOrder},
        ${tx.json(input.cell.copy)},
        ${input.cell.actionTargetKey ?? null},
        ${input.cell.clinicVariant ?? null}
      )
      on conflict (revision_id, kind_key, instruction_key)
      do update set
        applicability = excluded.applicability,
        sort_order = excluded.sort_order,
        copy_json = excluded.copy_json,
        action_target_key = excluded.action_target_key,
        clinic_variant = excluded.clinic_variant
    `;
  });

export const replaceGuidanceContacts = async (
  sql: Sql,
  input: {
    revisionId: string;
    expectedHash: string;
    nextHash: string;
    kindKey: string;
    cells: readonly StoredGuidanceCell[];
    actorEmail: string;
    now: Date;
  },
): Promise<void> =>
  withReservedTransaction(sql, async (tx) => {
    const updated =
      await tx`update ah.guidance_revisions set content_hash = ${input.nextHash}, updated_at = ${input.now}
    where revision_id = ${input.revisionId}::uuid and status = 'draft' and content_hash = ${input.expectedHash}
    returning revision_id`;
    if (!updated.length) throw new GuidanceConflictError();
    await tx`delete from ah.guidance_cells where revision_id = ${input.revisionId}::uuid and kind_key = ${input.kindKey}
    and (instruction_key in ('contact.primary', 'contact.secondary', 'volunteers') or instruction_key like 'contact.option.%')`;
    for (const cell of input.cells) {
      await tx`insert into ah.guidance_cells (revision_id, kind_key, instruction_key, applicability, sort_order, copy_json, action_target_key, clinic_variant)
      values (${input.revisionId}::uuid, ${cell.kindKey}, ${cell.instructionKey}, ${cell.applicability}, ${cell.sortOrder}, ${tx.json(cell.copy)}, ${cell.actionTargetKey ?? null}, ${cell.clinicVariant ?? null})`;
    }
    await recordOperatorAudit(tx, {
      operatorEmail: input.actorEmail,
      action: "guidance_contacts_saved",
      outcome: "accepted",
      streamId: input.revisionId,
    });
  });

export const publishGuidanceDraft = async (
  sql: Sql,
  input: {
    draftRevisionId: string;
    expectedHash: string;
    actorEmail: string;
    now: Date;
    description: string;
    contentHash: string;
    scope: GuidanceScope;
  },
): Promise<GuidanceRevisionRecord> =>
  withReservedTransaction(sql, async (tx) => {
    await lockGuidancePublication(tx);
    const previousPublication = await loadGuidancePublication(tx, input.scope);
    const locked = await tx<RevisionRow[]>`
      select
        revision_id,
        status,
        content_hash,
        created_by,
        created_at,
        updated_at,
        published_at,
        description,
        based_on_revision_id,
        source_references,
        content_reviewed_at
      from ah.guidance_revisions
      where
        revision_id = ${input.draftRevisionId}::uuid
        and status = 'draft'
      for update
    `;
    const draft = locked[0];
    if (draft === undefined || draft.content_hash !== input.expectedHash) {
      throw new GuidanceConflictError();
    }

    const publishedId = randomUUID();
    const inserted = await tx<RevisionRow[]>`
      insert into ah.guidance_revisions (
        revision_id,
        flow_key,
        schema_version,
        locale,
        jurisdiction,
        status,
        based_on_revision_id,
        created_by,
        created_at,
        updated_at,
        published_at,
        description,
        content_hash,
        source_references,
        content_reviewed_at,
        directory_revision_id
      )
      values (
        ${publishedId}::uuid,
        ${input.scope.flowKey},
        ${input.scope.schemaVersion},
        ${input.scope.locale},
        ${input.scope.jurisdiction},
        'published',
        ${input.draftRevisionId}::uuid,
        ${input.actorEmail},
        ${input.now},
        ${input.now},
        ${input.now},
        ${input.description},
        ${input.contentHash},
        ${tx.array([...(draft.source_references ?? [])])},
        ${draft.content_reviewed_at},
        ${previousPublication?.directoryRevisionId ?? null}::uuid
      )
      returning
        revision_id,
        status,
        content_hash,
        created_by,
        created_at,
        updated_at,
        published_at,
        description,
        based_on_revision_id,
        source_references,
        content_reviewed_at
    `;
    const published = inserted[0];
    if (published === undefined) {
      throw new Error("failed to insert published guidance");
    }

    await tx`update ah.guidance_revisions set report_profiles = (select report_profiles from ah.guidance_revisions where revision_id = ${input.draftRevisionId}::uuid) where revision_id = ${publishedId}::uuid`;
    await tx`
      insert into ah.guidance_copy (
        revision_id,
        copy_slot_key,
        plain_text
      )
      select
        ${publishedId}::uuid,
        copy_slot_key,
        plain_text
      from ah.guidance_copy
      where revision_id = ${input.draftRevisionId}::uuid
    `;
    await tx`
      insert into ah.guidance_cells (
        revision_id,
        kind_key,
        instruction_key,
        applicability,
        sort_order,
        copy_json,
        action_target_key,
        clinic_variant
      )
      select
        ${publishedId}::uuid,
        kind_key,
        instruction_key,
        applicability,
        sort_order,
        copy_json,
        action_target_key,
        clinic_variant
      from ah.guidance_cells
      where revision_id = ${input.draftRevisionId}::uuid
    `;
    await tx`
      insert into ah.guidance_publications (
        flow_key,
        schema_version,
        locale,
        jurisdiction,
        active_revision_id,
        published_at
      )
      values (
        ${input.scope.flowKey},
        ${input.scope.schemaVersion},
        ${input.scope.locale},
        ${input.scope.jurisdiction},
        ${publishedId}::uuid,
        ${input.now}
      )
      on conflict (flow_key, schema_version, locale, jurisdiction)
      do update set
        active_revision_id = excluded.active_revision_id,
        published_at = excluded.published_at
    `;
    return toRevision(published);
  });

export const saveReportGuidanceProfiles = async (
  sql: Sql,
  input: {
    revisionId: string;
    expectedHash: string;
    nextHash: string;
    profiles: readonly ReportGuidanceProfile[];
    actorEmail: string;
    now: Date;
  },
): Promise<void> =>
  withReservedTransaction(sql, async (tx) => {
    const rows = await tx`update ah.guidance_revisions
    set report_profiles = ${tx.json([...input.profiles])}, content_hash = ${input.nextHash}, updated_at = ${input.now}
    where revision_id = ${input.revisionId}::uuid and status = 'draft' and content_hash = ${input.expectedHash}
    returning revision_id`;
    if (!rows.length) throw new GuidanceConflictError();
    await recordOperatorAudit(tx, {
      operatorEmail: input.actorEmail,
      action: "report_guidance_saved",
      outcome: "accepted",
      streamId: input.revisionId,
    });
  });
