import { createHash, randomUUID } from "node:crypto";
import {
  contactDirectoryDocumentSchema,
  contactDirectoryIssues,
  planContactImport,
  type AdminContactDirectory,
  type ContactDirectoryDocument,
  type ContactDirectoryIssue,
  type ContactDirectoryRequest,
  type PublicContactDirectory,
} from "@animal-helper/contracts";
import type { Sql } from "postgres";
import { canonicalJson } from "./canonical-json.js";
import {
  loadGuidanceDocument,
  loadGuidancePublication,
  type GuidanceScope,
  type StoredGuidanceDocument,
} from "./guidance.js";
import { recordOperatorAudit } from "./operators.js";
import { lockGuidancePublication } from "./guidance-publication-lock.js";

export class ContactDirectoryError extends Error {
  readonly code: "conflict" | "invalid_content" | "not_found";
  readonly issues: readonly ContactDirectoryIssue[];
  constructor(
    code: "conflict" | "invalid_content" | "not_found",
    issues: readonly ContactDirectoryIssue[] = [],
  ) {
    super(code);
    this.name = "ContactDirectoryError";
    this.code = code;
    this.issues = issues;
  }
}

type ReleaseRow = {
  revision_id: string;
  document: unknown;
  published_at: Date;
};
const publicRelease = (row: ReleaseRow): PublicContactDirectory => {
  const document = contactDirectoryDocumentSchema.parse(row.document);
  return {
    ...document,
    entries: document.entries.filter((entry) => entry.enabled),
    revisionId: row.revision_id,
    publishedAt: row.published_at.toISOString(),
  };
};

export const loadContactDirectoryRelease = async (
  sql: Sql,
  revisionId: string,
): Promise<PublicContactDirectory | undefined> => {
  const rows = await sql<ReleaseRow[]>`
    select revision_id, document, published_at from ah.contact_directory_revisions
    where revision_id = ${revisionId}::uuid
  `;
  return rows[0] ? publicRelease(rows[0]) : undefined;
};

export const loadAdminContactDirectory = async (
  sql: Sql,
  scope: GuidanceScope,
): Promise<AdminContactDirectory> => {
  const rows = await sql<
    {
      revision: string;
      document: unknown;
      release_id: string | null;
      released_document: unknown;
      published_at: Date | null;
    }[]
  >`
    select d.revision, d.document, c.revision_id as release_id, c.document as released_document, c.published_at
    from ah.contact_directory_draft d
    left join ah.guidance_publications p on p.flow_key = ${scope.flowKey} and p.schema_version = ${scope.schemaVersion}
      and p.locale = ${scope.locale} and p.jurisdiction = ${scope.jurisdiction}
    left join ah.guidance_revisions g on g.revision_id = p.active_revision_id and g.status = 'published'
    left join ah.contact_directory_revisions c on c.revision_id = g.directory_revision_id
    where d.jurisdiction = 'SK'
  `;
  const draft = rows[0];
  if (!draft) throw new Error("contact directory draft missing");
  const released =
    draft.release_id && draft.published_at
      ? {
          revision_id: draft.release_id,
          document: draft.released_document,
          published_at: draft.published_at,
        }
      : undefined;
  const document = contactDirectoryDocumentSchema.parse(draft.document);
  return {
    revision: Number(draft.revision),
    document,
    published: released ? publicRelease(released) : null,
    hasUnpublishedChanges:
      !released ||
      canonicalJson(document) !==
        canonicalJson(contactDirectoryDocumentSchema.parse(released.document)),
  };
};

export const executeContactDirectoryCommand = async (
  sql: Sql,
  input: {
    request: ContactDirectoryRequest;
    actorEmail: string;
    now: Date;
    today: string;
    scope: GuidanceScope;
    fallback: {
      document: StoredGuidanceDocument;
      contentHash: string;
      sourceReferences: readonly string[];
    };
  },
): Promise<void> => {
  const { request, actorEmail, now } = input;
  const requestHash = createHash("sha256")
    .update(canonicalJson(request))
    .digest("hex");
  await sql.begin(async (transaction) => {
    const tx = transaction as unknown as Sql;
    await lockGuidancePublication(tx);
    const rows = await tx<{ revision: string; document: unknown }[]>`
      select revision, document from ah.contact_directory_draft where jurisdiction = 'SK' for update
    `;
    const draft = rows[0];
    if (!draft) throw new Error("contact directory draft missing");
    const receipts = await tx<
      { request_hash: string; operator_email: string }[]
    >`
      select request_hash, operator_email from ah.contact_directory_commands
      where command_id = ${request.commandId}::uuid
    `;
    const receipt = receipts[0];
    if (receipt) {
      if (
        receipt.request_hash !== requestHash ||
        receipt.operator_email !== actorEmail
      )
        throw new ContactDirectoryError("conflict");
      return;
    }
    if (Number(draft.revision) !== request.expectedRevision)
      throw new ContactDirectoryError("conflict");
    const document = contactDirectoryDocumentSchema.parse(draft.document);
    const command = request.command;
    let next: ContactDirectoryDocument = document;
    if (command.type === "save_entry") {
      next = {
        ...document,
        entries: [
          ...document.entries.filter((entry) => entry.id !== command.entry.id),
          command.entry,
        ],
      };
      if (!contactDirectoryDocumentSchema.safeParse(next).success)
        throw new ContactDirectoryError("invalid_content");
    } else if (command.type === "import_entries") {
      let added: ContactDirectoryDocument["entries"];
      try {
        added = planContactImport(document.entries, command.entries).added;
      } catch {
        throw new ContactDirectoryError("invalid_content");
      }
      next = { ...document, entries: [...document.entries, ...added] };
      if (!contactDirectoryDocumentSchema.safeParse(next).success)
        throw new ContactDirectoryError("invalid_content");
    } else if (command.type === "remove_entry") {
      if (!document.entries.some((entry) => entry.id === command.id))
        throw new ContactDirectoryError("not_found");
      next = {
        ...document,
        entries: document.entries.filter((entry) => entry.id !== command.id),
      };
    } else {
      const issues = contactDirectoryIssues(document, input.today);
      if (issues.length)
        throw new ContactDirectoryError("invalid_content", issues);
      const directoryRevisionId = randomUUID();
      await tx`
        insert into ah.contact_directory_revisions (revision_id, jurisdiction, document, published_at, published_by)
        values (${directoryRevisionId}::uuid, 'SK', ${tx.json(document)}, ${now}, ${actorEmail})
      `;
      const published = await loadGuidancePublication(tx, input.scope);
      const source = published
        ? await loadGuidanceDocument(tx, published.revisionId)
        : input.fallback.document;
      if (!source) throw new Error("published guidance missing");
      const revisionId = randomUUID();
      await tx`
        insert into ah.guidance_revisions (
          revision_id, flow_key, schema_version, locale, jurisdiction, status,
          based_on_revision_id, created_by, created_at, updated_at, published_at,
          description, content_hash, source_references, content_reviewed_at, directory_revision_id
        ) values (
          ${revisionId}::uuid, ${input.scope.flowKey}, ${input.scope.schemaVersion}, ${input.scope.locale}, ${input.scope.jurisdiction}, 'published',
          ${published?.revisionId ?? null}::uuid, ${actorEmail}, ${now}, ${now}, ${now},
          'Aktualizácia kontaktného adresára', ${published?.contentHash ?? input.fallback.contentHash},
          coalesce((select source_references from ah.guidance_revisions where revision_id = ${published?.revisionId ?? null}::uuid), ${tx.array([...input.fallback.sourceReferences])}),
          (select content_reviewed_at from ah.guidance_revisions where revision_id = ${published?.revisionId ?? null}::uuid),
          ${directoryRevisionId}::uuid
        )
      `;
      await tx`update ah.guidance_revisions set report_profiles = ${tx.json([...(source.reportProfiles ?? [])])} where revision_id = ${revisionId}::uuid`;
      await tx`
        insert into ah.guidance_copy (revision_id, copy_slot_key, plain_text)
        select ${revisionId}::uuid, key, value from jsonb_each_text(${tx.json(source.copy)}::jsonb)
      `;
      await tx`
        insert into ah.guidance_cells (revision_id, kind_key, instruction_key, applicability, sort_order, copy_json, action_target_key, clinic_variant)
        select ${revisionId}::uuid, c->>'kindKey', c->>'instructionKey', c->>'applicability',
          (c->>'sortOrder')::integer, c->'copy', c->>'actionTargetKey', c->>'clinicVariant'
        from jsonb_array_elements(${tx.json(source.cells)}::jsonb) c
      `;
      await tx`
        insert into ah.guidance_publications (flow_key, schema_version, locale, jurisdiction, active_revision_id, published_at)
        values (${input.scope.flowKey}, ${input.scope.schemaVersion}, ${input.scope.locale}, ${input.scope.jurisdiction}, ${revisionId}::uuid, ${now})
        on conflict (flow_key, schema_version, locale, jurisdiction)
        do update set active_revision_id = excluded.active_revision_id, published_at = excluded.published_at
      `;
    }
    await tx`
      update ah.contact_directory_draft set revision = revision + 1, document = ${tx.json(next)}, updated_at = ${now}, updated_by = ${actorEmail}
      where jurisdiction = 'SK'
    `;
    await tx`
      insert into ah.contact_directory_commands (command_id, request_hash, operator_email, accepted_at)
      values (${request.commandId}::uuid, ${requestHash}, ${actorEmail}, ${now})
    `;
    await recordOperatorAudit(tx, {
      operatorEmail: actorEmail,
      action: `contact_directory_${command.type}`,
      outcome: "accepted",
      streamId: request.commandId,
    });
  });
};
