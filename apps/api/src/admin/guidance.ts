import {
  actionTargetForInstruction,
  assertPublishableDocument,
  bundledContentHash,
  cellsForKind,
  findAnimalKind,
  guidanceScope,
  instructionKeys,
  instructionSlotKeys,
  instructionSortOrder,
  isInstructionKey,
  parseGuidanceDocument,
  resolveKindItems,
  screenForInstruction,
  GuidanceValidationError,
  type GuidanceCell,
  type GuidanceDocument,
  contactOptionsForKind,
  contactOptionCells,
  isContactInstruction,
  isContactOptionInstruction,
  sortOrderForInstruction,
} from "@animal-helper/guidance";
import {
  adminGuidanceContactsSchema,
  adminReportGuidanceSchema,
} from "@animal-helper/contracts";
import {
  GuidanceConflictError,
  insertGuidanceDraft,
  loadGuidanceDraft,
  loadGuidancePublication,
  publishGuidanceDraft,
  recordOperatorAudit,
  saveGuidanceCell,
  replaceGuidanceContacts,
  saveReportGuidanceProfiles,
} from "@animal-helper/event-store";
import type { Sql } from "postgres";

import type { ApiResponse } from "../handler.js";
import {
  editableGuidance,
  GUIDANCE_SOURCE_REFERENCES,
  hashGuidanceDocument,
} from "../guidance.js";

export class GuidanceAdminError extends Error {
  readonly code: "conflict" | "invalid_content" | "not_found";
  readonly status: number;

  constructor(
    code: "conflict" | "invalid_content" | "not_found",
    status: number,
  ) {
    super(code);
    this.name = "GuidanceAdminError";
    this.code = code;
    this.status = status;
  }
}

const securityHeaders = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
} as const;

const json = (status: number, body: unknown): ApiResponse => ({
  status,
  headers: securityHeaders,
  body,
});

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  error.code === "23505";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const replaceCell = (
  document: GuidanceDocument,
  cell: GuidanceCell,
): GuidanceDocument => ({
  ...document,
  cells: [
    ...document.cells.filter(
      (existing) =>
        !(
          existing.kindKey === cell.kindKey &&
          existing.instructionKey === cell.instructionKey
        ),
    ),
    cell,
  ],
});

const toStoredCell = (cell: GuidanceCell) => ({
  kindKey: cell.kindKey,
  instructionKey: cell.instructionKey,
  applicability: cell.applicability,
  sortOrder: cell.sortOrder,
  copy: Object.fromEntries(
    Object.entries(cell.copy).filter(
      (entry): entry is [string, string] =>
        typeof entry[1] === "string" && entry[1] !== "",
    ),
  ),
  ...(cell.actionTargetKey === undefined
    ? {}
    : { actionTargetKey: cell.actionTargetKey }),
  ...(cell.clinicVariant === undefined
    ? {}
    : { clinicVariant: cell.clinicVariant }),
});

const ensureDraft = async (sql: Sql, actorEmail: string, now: Date) => {
  const existing = await loadGuidanceDraft(sql, guidanceScope);
  if (existing !== undefined) {
    const current = await editableGuidance(sql);
    if (current.source !== "draft") {
      throw new Error("draft disappeared");
    }
    return {
      revisionId: existing.revisionId,
      contentHash: existing.contentHash,
      document: current.document,
    };
  }

  const current = await editableGuidance(sql);
  try {
    const inserted = await insertGuidanceDraft(sql, {
      actorEmail,
      now,
      scope: guidanceScope,
      document: current.document,
      contentHash: hashGuidanceDocument(current.document),
      sourceReferences: [...GUIDANCE_SOURCE_REFERENCES],
      ...(current.source === "published"
        ? { basedOnRevisionId: current.revisionId }
        : {}),
    });
    return {
      revisionId: inserted.revisionId,
      contentHash: inserted.contentHash,
      document: current.document,
    };
  } catch (error) {
    if (!isUniqueViolation(error)) {
      throw error;
    }
    const raced = await editableGuidance(sql);
    if (raced.source !== "draft") {
      throw error;
    }
    return {
      revisionId: raced.revisionId,
      contentHash: raced.contentHash,
      document: raced.document,
    };
  }
};

const editorCells = (document: GuidanceDocument, kindKey: string) => {
  const kind = findAnimalKind(kindKey);
  const injured = kind?.injured;
  if (injured === undefined) {
    throw new GuidanceAdminError("not_found", 404);
  }
  const existing = new Map(
    cellsForKind(document, kindKey).map((cell) => [cell.instructionKey, cell]),
  );
  return instructionKeys.map((instructionKey) => {
    const cell = existing.get(instructionKey);
    const copy: Record<string, string> = {};
    for (const slot of instructionSlotKeys[instructionKey]) {
      copy[slot] = cell?.copy[slot] ?? "";
    }
    const actionTargetKey =
      cell?.actionTargetKey ??
      actionTargetForInstruction(
        instructionKey,
        injured.primaryContact,
        injured.secondaryContact,
      );
    return {
      instructionKey,
      applicability: cell?.applicability ?? "off",
      sortOrder: cell?.sortOrder ?? instructionSortOrder[instructionKey],
      copy,
      slotKeys: instructionSlotKeys[instructionKey],
      screenKey: screenForInstruction(instructionKey, injured.flowKey),
      ...(actionTargetKey === undefined ? {} : { actionTargetKey }),
    };
  });
};

export const adminGuidanceSummary = async (sql: Sql): Promise<ApiResponse> => {
  const current = await editableGuidance(sql);
  const published = await loadGuidancePublication(sql, guidanceScope);
  return json(200, {
    source: current.source,
    contentHash: current.contentHash,
    revisionId: current.revisionId,
    bundled: { contentHash: bundledContentHash() },
    ...(published === undefined
      ? {}
      : {
          published: {
            revisionId: published.revisionId,
            contentHash: published.contentHash,
            publishedAt: published.publishedAt.toISOString(),
            ...(published.description === undefined
              ? {}
              : { description: published.description }),
          },
        }),
  });
};

export const adminGuidanceKind = async (
  sql: Sql,
  kindKey: string,
): Promise<ApiResponse> => {
  const kind = findAnimalKind(kindKey);
  if (kind?.injured === undefined) {
    throw new GuidanceAdminError("not_found", 404);
  }
  const current = await editableGuidance(sql);
  return json(200, {
    source: current.source,
    revisionId: current.revisionId,
    contentHash: current.contentHash,
    kindKey,
    cells: editorCells(current.document, kindKey),
    items: resolveKindItems(kindKey, current.document),
    contactOptions: contactOptionsForKind(current.document, kindKey),
  });
};

const parseCellBody = (
  body: unknown,
  document: GuidanceDocument,
): GuidanceCell => {
  if (!isRecord(body)) {
    throw new GuidanceAdminError("invalid_content", 400);
  }
  const kindKey = body.kindKey;
  const instructionKey = body.instructionKey;
  const applicability = body.applicability;
  if (
    typeof kindKey !== "string" ||
    findAnimalKind(kindKey)?.injured === undefined
  ) {
    throw new GuidanceAdminError("invalid_content", 400);
  }
  if (typeof instructionKey !== "string" || !isInstructionKey(instructionKey)) {
    throw new GuidanceAdminError("invalid_content", 400);
  }
  if (applicability !== "on" && applicability !== "off") {
    throw new GuidanceAdminError("invalid_content", 400);
  }
  const existing = cellsForKind(document, kindKey).find(
    (cell) => cell.instructionKey === instructionKey,
  );
  const actionTargetKey =
    typeof body.actionTargetKey === "string" && body.actionTargetKey.length > 0
      ? body.actionTargetKey
      : existing?.actionTargetKey;
  try {
    const parsed = parseGuidanceDocument({
      copy: {},
      cells: [
        {
          kindKey,
          instructionKey,
          applicability,
          sortOrder:
            existing?.sortOrder ?? sortOrderForInstruction(instructionKey),
          copy: isRecord(body.copy) ? body.copy : {},
          ...(actionTargetKey === undefined ? {} : { actionTargetKey }),
        },
      ],
    });
    const cell = parsed.cells[0];
    if (cell === undefined) {
      throw new GuidanceAdminError("invalid_content", 400);
    }
    return cell;
  } catch (error) {
    if (error instanceof GuidanceValidationError) {
      throw new GuidanceAdminError("invalid_content", 400);
    }
    throw error;
  }
};

export const adminSaveGuidanceCell = async (
  sql: Sql,
  body: unknown,
  actorEmail: string,
  now: Date,
): Promise<ApiResponse> => {
  try {
    return await saveGuidanceCellUnchecked(sql, body, actorEmail, now);
  } catch (error) {
    if (error instanceof GuidanceAdminError) {
      return json(error.status, {
        ok: false,
        error: { code: error.code, message: error.message },
      });
    }
    throw error;
  }
};

const saveGuidanceCellUnchecked = async (
  sql: Sql,
  body: unknown,
  actorEmail: string,
  now: Date,
): Promise<ApiResponse> => {
  if (!isRecord(body) || typeof body.expectedHash !== "string") {
    throw new GuidanceAdminError("invalid_content", 400);
  }
  const draft = await ensureDraft(sql, actorEmail, now);
  if (draft.contentHash !== body.expectedHash) {
    throw new GuidanceAdminError("conflict", 409);
  }
  const cell = parseCellBody(body, draft.document);
  if (
    isContactInstruction(cell.instructionKey) &&
    (isContactOptionInstruction(cell.instructionKey) ||
      draft.document.cells.some(
        (entry) =>
          entry.kindKey === cell.kindKey &&
          isContactOptionInstruction(entry.instructionKey),
      ))
  ) {
    throw new GuidanceAdminError("invalid_content", 400);
  }
  const nextDocument = replaceCell(draft.document, cell);
  parseGuidanceDocument(nextDocument);
  const nextHash = hashGuidanceDocument(nextDocument);
  try {
    await saveGuidanceCell(sql, {
      revisionId: draft.revisionId,
      expectedHash: body.expectedHash,
      now,
      cell: toStoredCell(cell),
      nextHash,
    });
  } catch (error) {
    if (error instanceof GuidanceConflictError) {
      throw new GuidanceAdminError("conflict", 409);
    }
    throw error;
  }
  await recordOperatorAudit(sql, {
    operatorEmail: actorEmail,
    action: "guidance_draft_saved",
    outcome: "accepted",
    streamId: draft.revisionId,
  });
  return json(200, {
    source: "draft",
    revisionId: draft.revisionId,
    contentHash: nextHash,
    kindKey: cell.kindKey,
    cells: editorCells(nextDocument, cell.kindKey),
    items: resolveKindItems(cell.kindKey, nextDocument),
    contactOptions: contactOptionsForKind(nextDocument, cell.kindKey),
  });
};

export const adminSaveGuidanceContacts = async (
  sql: Sql,
  body: unknown,
  actorEmail: string,
  now: Date,
): Promise<ApiResponse> => {
  const parsed = adminGuidanceContactsSchema.safeParse(body);
  if (
    !parsed.success ||
    findAnimalKind(parsed.data.kindKey)?.injured === undefined
  ) {
    throw new GuidanceAdminError("invalid_content", 400);
  }
  const { expectedHash, kindKey, options } = parsed.data;
  const draft = await ensureDraft(sql, actorEmail, now);
  if (draft.contentHash !== expectedHash)
    throw new GuidanceAdminError("conflict", 409);
  const cells = contactOptionCells(kindKey, options);
  let nextDocument: GuidanceDocument;
  try {
    nextDocument = parseGuidanceDocument({
      ...draft.document,
      cells: [
        ...draft.document.cells.filter(
          (cell) =>
            cell.kindKey !== kindKey ||
            !isContactInstruction(cell.instructionKey),
        ),
        ...cells,
      ],
    });
  } catch (error) {
    if (error instanceof GuidanceValidationError)
      throw new GuidanceAdminError("invalid_content", 400);
    throw error;
  }
  const nextHash = hashGuidanceDocument(nextDocument);
  try {
    await replaceGuidanceContacts(sql, {
      revisionId: draft.revisionId,
      expectedHash,
      nextHash,
      kindKey,
      cells: cells.map(toStoredCell),
      actorEmail,
      now,
    });
  } catch (error) {
    if (error instanceof GuidanceConflictError)
      throw new GuidanceAdminError("conflict", 409);
    throw error;
  }
  return json(200, {
    source: "draft",
    revisionId: draft.revisionId,
    contentHash: nextHash,
    kindKey,
    cells: editorCells(nextDocument, kindKey),
    items: resolveKindItems(kindKey, nextDocument),
    contactOptions: contactOptionsForKind(nextDocument, kindKey),
  });
};

export const adminPublishGuidance = async (
  sql: Sql,
  body: unknown,
  actorEmail: string,
  now: Date,
): Promise<ApiResponse> => {
  if (!isRecord(body)) {
    throw new GuidanceAdminError("invalid_content", 400);
  }
  const expectedHash = body.expectedHash;
  const description = body.description;
  if (typeof expectedHash !== "string" || typeof description !== "string") {
    throw new GuidanceAdminError("invalid_content", 400);
  }
  const trimmed = description.trim();
  if (trimmed.length === 0 || trimmed.length > 500) {
    throw new GuidanceAdminError("invalid_content", 400);
  }
  const existing = await loadGuidanceDraft(sql, guidanceScope);
  if (existing === undefined) {
    throw new GuidanceAdminError("invalid_content", 400);
  }
  const current = await editableGuidance(sql);
  if (current.source !== "draft" || current.contentHash !== expectedHash) {
    throw new GuidanceAdminError("conflict", 409);
  }
  try {
    assertPublishableDocument(current.document);
  } catch (error) {
    if (error instanceof GuidanceValidationError) {
      throw new GuidanceAdminError("invalid_content", 400);
    }
    throw error;
  }
  let published;
  try {
    published = await publishGuidanceDraft(sql, {
      draftRevisionId: existing.revisionId,
      expectedHash,
      actorEmail,
      now,
      description: trimmed,
      contentHash: current.contentHash,
      scope: guidanceScope,
    });
  } catch (error) {
    if (error instanceof GuidanceConflictError) {
      throw new GuidanceAdminError("conflict", 409);
    }
    throw error;
  }
  await recordOperatorAudit(sql, {
    operatorEmail: actorEmail,
    action: "guidance_published",
    outcome: "accepted",
    streamId: published.revisionId,
  });
  return json(200, {
    source: "published",
    revisionId: published.revisionId,
    contentHash: published.contentHash,
    publishedAt: published.publishedAt?.toISOString(),
    description: published.description,
  });
};

export const adminReportGuidance = async (sql: Sql): Promise<ApiResponse> => {
  const current = await editableGuidance(sql);
  return json(200, {
    contentHash: current.contentHash,
    source: current.source,
    profiles: current.document.reportProfiles ?? [],
  });
};

export const adminSaveReportGuidance = async (
  sql: Sql,
  body: unknown,
  actorEmail: string,
  now: Date,
): Promise<ApiResponse> => {
  const parsed = adminReportGuidanceSchema.safeParse(body);
  if (!parsed.success) throw new GuidanceAdminError("invalid_content", 400);
  const draft = await ensureDraft(sql, actorEmail, now);
  if (draft.contentHash !== parsed.data.expectedHash)
    throw new GuidanceAdminError("conflict", 409);
  const profile = parsed.data.profile;
  let document: GuidanceDocument;
  try {
    document = parseGuidanceDocument({
      ...draft.document,
      reportProfiles: [
        ...(draft.document.reportProfiles ?? []).filter(
          (entry) =>
            entry.context !== profile.context ||
            entry.kindKey !== profile.kindKey,
        ),
        profile,
      ],
    });
  } catch (error) {
    if (error instanceof GuidanceValidationError)
      throw new GuidanceAdminError("invalid_content", 400);
    throw error;
  }
  const nextHash = hashGuidanceDocument(document);
  try {
    await saveReportGuidanceProfiles(sql, {
      revisionId: draft.revisionId,
      expectedHash: parsed.data.expectedHash,
      nextHash,
      profiles: document.reportProfiles ?? [],
      actorEmail,
      now,
    });
  } catch (error) {
    if (error instanceof GuidanceConflictError)
      throw new GuidanceAdminError("conflict", 409);
    throw error;
  }
  return json(200, {
    source: "draft",
    contentHash: nextHash,
    profiles: document.reportProfiles ?? [],
  });
};
