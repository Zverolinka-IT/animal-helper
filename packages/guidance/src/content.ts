import { parseReportProfiles } from "./report-flows.js";
import fallbackJson from "./generated/guidance-fallback.json" with { type: "json" };
import {
  publicContactDirectorySchema,
  contactServiceKeys,
  type PublicContactDirectory,
  type ReportGuidanceProfile,
} from "@animal-helper/contracts";

import { animalKinds, findAnimalKind } from "./catalog.js";
import { copyLooksSafe } from "./copy.js";
import { isScreenKey, type ScreenKey } from "./keys.js";
import {
  BUNDLED_REVISION_ID,
  COPY_MAX_LENGTH,
  GUIDANCE_FLOW_KEY,
  GUIDANCE_JURISDICTION,
  GUIDANCE_LOCALE,
  GUIDANCE_SCHEMA_VERSION,
  slotsForInstruction,
  polarityForInstruction,
  isContactOptionInstruction,
  isContactInstruction,
  isCopySlotKey,
  isInstructionKey,
  isInstructionPolarity,
  screenForInstruction,
  type CopySlotKey,
  type InstructionKey,
  type InstructionPolarity,
} from "./slots.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH_PATTERN = /^[0-9a-f]{64}$/;

export class GuidanceValidationError extends Error {
  readonly code = "invalid_content";

  constructor(message: string) {
    super(message);
    this.name = "GuidanceValidationError";
  }
}

export type Applicability = "on" | "off";

export type GuidanceCell = {
  kindKey: string;
  instructionKey: InstructionKey;
  applicability: Applicability;
  sortOrder: number;
  copy: Readonly<Partial<Record<CopySlotKey, string>>>;
  actionTargetKey?: string;
  clinicVariant?: "standard" | "protected";
};

export type GuidanceDocument = {
  reportProfiles?: readonly ReportGuidanceProfile[];
  copy: Readonly<Record<string, string>>;
  cells: readonly GuidanceCell[];
};

export type GuidanceAction = {
  kind: "call-contact";
  targetKey: string;
};

export type GuidanceItem = {
  screenKey: ScreenKey;
  instructionKey: InstructionKey;
  polarity: InstructionPolarity;
  slots: Readonly<Partial<Record<CopySlotKey, string>>>;
  action?: GuidanceAction;
  clinicVariant?: "standard" | "protected";
};

function parseClinicVariant(
  value: unknown,
  service: string | undefined,
): "standard" | "protected" | undefined {
  if (value === undefined) return undefined;
  if (
    (value !== "standard" && value !== "protected") ||
    !["vet_clinic", "vet_exotic"].includes(service ?? "")
  )
    throw new GuidanceValidationError(
      "invalid veterinary presentation variant",
    );
  return value;
}

export type PublicGuidanceKind = {
  items: readonly GuidanceItem[];
};

export type PublicGuidance = {
  reportProfiles?: readonly ReportGuidanceProfile[];
  schemaVersion: typeof GUIDANCE_SCHEMA_VERSION;
  locale: typeof GUIDANCE_LOCALE;
  jurisdiction: typeof GUIDANCE_JURISDICTION;
  flowKey: typeof GUIDANCE_FLOW_KEY;
  revisionId: string;
  contentHash: string;
  source: "bundled" | "published";
  kinds: Readonly<Record<string, PublicGuidanceKind>>;
  contactDirectory?: PublicContactDirectory;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const requiredString = (value: unknown, path: string): string => {
  if (typeof value !== "string") {
    throw new GuidanceValidationError(`invalid ${path}`);
  }
  return value;
};

const requiredNumber = (value: unknown, path: string): number => {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new GuidanceValidationError(`invalid ${path}`);
  }
  return value;
};

const parseCopyMap = (value: unknown, path: string): Record<string, string> => {
  if (!isRecord(value)) {
    throw new GuidanceValidationError(`invalid ${path}`);
  }
  const copy: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    const text = requiredString(entry, `${path}.${key}`);
    if (text.length > COPY_MAX_LENGTH || !copyLooksSafe(text)) {
      throw new GuidanceValidationError(`unsafe copy at ${path}.${key}`);
    }
    if (text !== "") {
      copy[key] = text;
    }
  }
  return copy;
};

const parseCellCopy = (
  value: unknown,
  instructionKey: InstructionKey,
  path: string,
): GuidanceCell["copy"] => {
  const copy = parseCopyMap(value, path);
  const allowed = new Set(slotsForInstruction(instructionKey));
  for (const key of Object.keys(copy)) {
    if (!isCopySlotKey(key) || !allowed.has(key)) {
      throw new GuidanceValidationError(`unknown copy slot ${key}`);
    }
  }
  return copy;
};

const parseApplicability = (value: unknown, path: string): Applicability => {
  const text = requiredString(value, path);
  if (text !== "on" && text !== "off") {
    throw new GuidanceValidationError(`invalid ${path}`);
  }
  return text;
};

const parseCell = (value: unknown, path: string): GuidanceCell => {
  if (!isRecord(value)) {
    throw new GuidanceValidationError(`invalid ${path}`);
  }
  const kindKey = requiredString(value.kindKey, `${path}.kindKey`);
  if (findAnimalKind(kindKey)?.injured === undefined) {
    throw new GuidanceValidationError(`unknown injured kind ${kindKey}`);
  }
  const instructionKey = requiredString(
    value.instructionKey,
    `${path}.instructionKey`,
  );
  if (!isInstructionKey(instructionKey)) {
    throw new GuidanceValidationError(`unknown instruction ${instructionKey}`);
  }
  const actionTargetKey =
    value.actionTargetKey === undefined || value.actionTargetKey === null
      ? undefined
      : requiredString(value.actionTargetKey, `${path}.actionTargetKey`);
  if (
    actionTargetKey !== undefined &&
    !contactServiceKeys.some((key) => key === actionTargetKey)
  ) {
    throw new GuidanceValidationError(
      `invalid action target ${actionTargetKey}`,
    );
  }

  const cell: GuidanceCell = {
    kindKey,
    instructionKey,
    applicability: parseApplicability(
      value.applicability,
      `${path}.applicability`,
    ),
    sortOrder: requiredNumber(value.sortOrder, `${path}.sortOrder`),
    copy: parseCellCopy(value.copy, instructionKey, `${path}.copy`),
  };
  if (actionTargetKey !== undefined) {
    cell.actionTargetKey = actionTargetKey;
  }
  const clinicVariant = parseClinicVariant(
    value.clinicVariant,
    actionTargetKey,
  );
  if (clinicVariant) cell.clinicVariant = clinicVariant;
  return cell;
};

export const parseGuidanceDocument = (value: unknown): GuidanceDocument => {
  if (!isRecord(value)) {
    throw new GuidanceValidationError("invalid guidance document");
  }
  const copy = parseCopyMap(value.copy, "copy");
  if (!Array.isArray(value.cells)) {
    throw new GuidanceValidationError("invalid cells");
  }
  const cells = value.cells.map((entry, index) =>
    parseCell(entry, `cells[${index}]`),
  );
  const seen = new Set<string>();
  for (const cell of cells) {
    const key = `${cell.kindKey}:${cell.instructionKey}`;
    if (seen.has(key)) {
      throw new GuidanceValidationError(`duplicate cell ${key}`);
    }
    seen.add(key);
  }
  for (const kindKey of new Set(
    cells
      .filter((cell) => isContactOptionInstruction(cell.instructionKey))
      .map((cell) => cell.kindKey),
  )) {
    const contacts = cells.filter(
      (cell) =>
        cell.kindKey === kindKey && isContactInstruction(cell.instructionKey),
    );
    if (
      contacts.some(
        (cell) => !isContactOptionInstruction(cell.instructionKey),
      ) ||
      !contacts.some((cell) => cell.applicability === "on")
    ) {
      throw new GuidanceValidationError(
        `invalid contact options for ${kindKey}`,
      );
    }
  }
  return { copy, cells, ...readProfiles(value.reportProfiles) };
};

const parseAction = (value: unknown, path: string): GuidanceAction => {
  if (!isRecord(value)) {
    throw new GuidanceValidationError(`invalid ${path}`);
  }
  if (value.kind !== "call-contact") {
    throw new GuidanceValidationError(`invalid ${path}.kind`);
  }
  const targetKey = requiredString(value.targetKey, `${path}.targetKey`);
  if (!contactServiceKeys.some((key) => key === targetKey)) {
    throw new GuidanceValidationError(`invalid ${path}.targetKey`);
  }
  return { kind: "call-contact", targetKey };
};

const parseItem = (value: unknown, path: string): GuidanceItem => {
  if (!isRecord(value)) {
    throw new GuidanceValidationError(`invalid ${path}`);
  }
  const screenKey = requiredString(value.screenKey, `${path}.screenKey`);
  if (!isScreenKey(screenKey)) {
    throw new GuidanceValidationError(`invalid ${path}.screenKey`);
  }
  const instructionKey = requiredString(
    value.instructionKey,
    `${path}.instructionKey`,
  );
  if (!isInstructionKey(instructionKey)) {
    throw new GuidanceValidationError(`invalid ${path}.instructionKey`);
  }
  const polarity = requiredString(value.polarity, `${path}.polarity`);
  if (
    !isInstructionPolarity(polarity) ||
    polarity !== polarityForInstruction(instructionKey)
  ) {
    throw new GuidanceValidationError(`invalid ${path}.polarity`);
  }
  if (!isRecord(value.slots)) {
    throw new GuidanceValidationError(`invalid ${path}.slots`);
  }
  const slots: Partial<Record<CopySlotKey, string>> = {};
  const allowed = new Set(slotsForInstruction(instructionKey));
  for (const [key, entry] of Object.entries(value.slots)) {
    if (!isCopySlotKey(key) || !allowed.has(key)) {
      throw new GuidanceValidationError(`unknown slot ${key}`);
    }
    const text = requiredString(entry, `${path}.slots.${key}`);
    if (text.length > COPY_MAX_LENGTH || !copyLooksSafe(text)) {
      throw new GuidanceValidationError(`unsafe slot ${key}`);
    }
    if (text !== "") {
      slots[key] = text;
    }
  }
  const item: GuidanceItem = {
    screenKey,
    instructionKey,
    polarity,
    slots,
  };
  if (value.action !== undefined) {
    item.action = parseAction(value.action, `${path}.action`);
  }
  const clinicVariant = parseClinicVariant(
    value.clinicVariant,
    item.action?.targetKey,
  );
  if (clinicVariant) item.clinicVariant = clinicVariant;
  return item;
};

const parseKinds = (value: unknown): Record<string, PublicGuidanceKind> => {
  if (!isRecord(value)) {
    throw new GuidanceValidationError("invalid kinds");
  }
  const kinds: Record<string, PublicGuidanceKind> = {};
  for (const [kindKey, entry] of Object.entries(value)) {
    if (findAnimalKind(kindKey)?.injured === undefined) {
      throw new GuidanceValidationError(`unknown public kind ${kindKey}`);
    }
    if (!isRecord(entry) || !Array.isArray(entry.items)) {
      throw new GuidanceValidationError(`invalid kinds.${kindKey}`);
    }
    kinds[kindKey] = {
      items: entry.items.map((item, index) =>
        parseItem(item, `kinds.${kindKey}.items[${index}]`),
      ),
    };
  }
  return kinds;
};

export const parsePublicGuidance = (value: unknown): PublicGuidance => {
  if (!isRecord(value)) {
    throw new GuidanceValidationError("invalid public guidance");
  }
  if (value.schemaVersion !== GUIDANCE_SCHEMA_VERSION) {
    throw new GuidanceValidationError("incompatible schema version");
  }
  if (value.locale !== GUIDANCE_LOCALE) {
    throw new GuidanceValidationError("incompatible locale");
  }
  if (value.jurisdiction !== GUIDANCE_JURISDICTION) {
    throw new GuidanceValidationError("incompatible jurisdiction");
  }
  if (value.flowKey !== GUIDANCE_FLOW_KEY) {
    throw new GuidanceValidationError("incompatible flow");
  }
  const revisionId = requiredString(value.revisionId, "revisionId");
  if (revisionId !== BUNDLED_REVISION_ID && !UUID_PATTERN.test(revisionId)) {
    throw new GuidanceValidationError("invalid revisionId");
  }
  const contentHash = requiredString(value.contentHash, "contentHash");
  if (!HASH_PATTERN.test(contentHash)) {
    throw new GuidanceValidationError("invalid contentHash");
  }
  const source = requiredString(value.source, "source");
  if (source !== "bundled" && source !== "published") {
    throw new GuidanceValidationError("invalid source");
  }
  const kinds = parseKinds(value.kinds);
  assertCompleteKinds(kinds);
  const directory =
    value.contactDirectory === undefined
      ? undefined
      : publicContactDirectorySchema.safeParse(value.contactDirectory);
  if (directory && !directory.success)
    throw new GuidanceValidationError("invalid contact directory");
  return {
    schemaVersion: GUIDANCE_SCHEMA_VERSION,
    locale: GUIDANCE_LOCALE,
    jurisdiction: GUIDANCE_JURISDICTION,
    flowKey: GUIDANCE_FLOW_KEY,
    revisionId,
    contentHash,
    source,
    kinds,
    ...readProfiles(value.reportProfiles),
    ...(directory?.success ? { contactDirectory: directory.data } : {}),
  };
};

const nonemptySlots = (
  copy: GuidanceCell["copy"],
  instructionKey: InstructionKey,
): Partial<Record<CopySlotKey, string>> => {
  const slots: Partial<Record<CopySlotKey, string>> = {};
  for (const key of slotsForInstruction(instructionKey)) {
    const text = copy[key];
    if (text !== undefined && text.trim() !== "") {
      slots[key] = text;
    }
  }
  return slots;
};

export const resolveKindItems = (
  kindKey: string,
  document: GuidanceDocument,
): GuidanceItem[] => {
  const kind = findAnimalKind(kindKey);
  if (kind?.injured === undefined) {
    return [];
  }

  const items: GuidanceItem[] = [];
  for (const cell of document.cells) {
    if (cell.kindKey !== kindKey || cell.applicability !== "on") {
      continue;
    }
    const screenKey = screenForInstruction(
      cell.instructionKey,
      kind.injured.flowKey,
    );
    if (screenKey === undefined) {
      continue;
    }
    const slots = nonemptySlots(cell.copy, cell.instructionKey);
    if (Object.keys(slots).length === 0) {
      continue;
    }
    const item: GuidanceItem = {
      screenKey,
      instructionKey: cell.instructionKey,
      polarity: polarityForInstruction(cell.instructionKey),
      slots,
      ...(cell.clinicVariant ? { clinicVariant: cell.clinicVariant } : {}),
    };
    if (
      (cell.instructionKey === "contact.primary" ||
        cell.instructionKey === "contact.secondary" ||
        isContactOptionInstruction(cell.instructionKey)) &&
      cell.actionTargetKey !== undefined
    ) {
      item.action = {
        kind: "call-contact",
        targetKey: cell.actionTargetKey,
      };
    }
    items.push(item);
  }

  return items.sort((left, right) => {
    if (left.screenKey === right.screenKey) {
      const leftCell = document.cells.find(
        (cell) =>
          cell.kindKey === kindKey &&
          cell.instructionKey === left.instructionKey,
      );
      const rightCell = document.cells.find(
        (cell) =>
          cell.kindKey === kindKey &&
          cell.instructionKey === right.instructionKey,
      );
      return (leftCell?.sortOrder ?? 0) - (rightCell?.sortOrder ?? 0);
    }
    return left.screenKey.localeCompare(right.screenKey);
  });
};

export const resolvePublicGuidance = (
  document: GuidanceDocument,
  meta: {
    revisionId: string;
    contentHash: string;
    source: "bundled" | "published";
  },
): PublicGuidance => {
  const kinds: Record<string, PublicGuidanceKind> = {};
  for (const kind of animalKinds) {
    if (kind.injured === undefined) {
      continue;
    }
    kinds[kind.key] = { items: resolveKindItems(kind.key, document) };
  }
  return {
    schemaVersion: GUIDANCE_SCHEMA_VERSION,
    locale: GUIDANCE_LOCALE,
    jurisdiction: GUIDANCE_JURISDICTION,
    flowKey: GUIDANCE_FLOW_KEY,
    revisionId: meta.revisionId,
    contentHash: meta.contentHash,
    source: meta.source,
    kinds,
    ...(document.reportProfiles?.length
      ? { reportProfiles: document.reportProfiles }
      : {}),
  };
};

export const itemsForScreen = (
  items: readonly GuidanceItem[],
  screenKey: ScreenKey,
): readonly GuidanceItem[] =>
  items.filter((item) => item.screenKey === screenKey);

export const itemsForScreens = (
  items: readonly GuidanceItem[],
  screenKeys: readonly ScreenKey[],
): readonly GuidanceItem[] =>
  items.filter((item) => screenKeys.includes(item.screenKey));

export const cellsForKind = (
  document: GuidanceDocument,
  kindKey: string,
): readonly GuidanceCell[] =>
  document.cells
    .filter((cell) => cell.kindKey === kindKey)
    .slice()
    .sort((left, right) => {
      if (left.sortOrder !== right.sortOrder) {
        return left.sortOrder - right.sortOrder;
      }
      return left.instructionKey.localeCompare(right.instructionKey);
    });

export const assertPublishableDocument = (document: GuidanceDocument): void => {
  parseGuidanceDocument(document);
  for (const profile of document.reportProfiles ?? []) {
    if (
      profile.contacts.some(
        (contact) =>
          contact.enabled && (!contact.title.trim() || !contact.body.trim()),
      )
    )
      throw new GuidanceValidationError("incomplete report guidance contact");
  }
  for (const cell of document.cells) {
    if (cell.applicability !== "on") {
      continue;
    }
    if (
      slotsForInstruction(cell.instructionKey).some(
        (key) => !cell.copy[key]?.trim(),
      )
    ) {
      throw new GuidanceValidationError(
        `incomplete ${cell.instructionKey} for ${cell.kindKey}`,
      );
    }
    if (
      (cell.instructionKey === "contact.primary" ||
        cell.instructionKey === "contact.secondary" ||
        isContactOptionInstruction(cell.instructionKey)) &&
      cell.actionTargetKey === undefined
    ) {
      throw new GuidanceValidationError(
        `contact ${cell.instructionKey} for ${cell.kindKey} is on without a contact key`,
      );
    }
  }
  const kinds: Record<string, PublicGuidanceKind> = {};
  for (const kind of animalKinds) {
    if (kind.injured)
      kinds[kind.key] = { items: resolveKindItems(kind.key, document) };
  }
  assertCompleteKinds(kinds);
};

// A structurally valid but empty/truncated publication must not replace the
// bundled fallback. Optional warning cells can be switched off; every supported
// kind still needs its code-owned primary contact and nonempty instruction copy.
const assertCompleteKinds = (
  kinds: Readonly<Record<string, PublicGuidanceKind>>,
): void => {
  for (const kind of animalKinds) {
    if (!kind.injured) continue;
    const items = kinds[kind.key]?.items;
    if (!items?.length)
      throw new GuidanceValidationError(`missing guidance for ${kind.key}`);
    const seen = new Set<string>();
    for (const item of items) {
      if (
        seen.has(item.instructionKey) ||
        item.screenKey !==
          screenForInstruction(item.instructionKey, kind.injured.flowKey)
      ) {
        throw new GuidanceValidationError(
          `invalid instruction mapping for ${kind.key}`,
        );
      }
      seen.add(item.instructionKey);
      if (isContactOptionInstruction(item.instructionKey) && !item.action) {
        throw new GuidanceValidationError(
          `missing contact service for ${kind.key}`,
        );
      }
      if (
        slotsForInstruction(item.instructionKey).some(
          (key) => !item.slots[key]?.trim(),
        )
      ) {
        throw new GuidanceValidationError(
          `incomplete public instruction for ${kind.key}`,
        );
      }
    }
    if (
      kind.injured.primaryContact &&
      !seen.has("contact.primary") &&
      !items.some((item) => isContactOptionInstruction(item.instructionKey))
    ) {
      throw new GuidanceValidationError(
        `missing primary contact for ${kind.key}`,
      );
    }
  }
};

const parseFallbackFile = (value: unknown): GuidanceDocument => {
  if (!isRecord(value)) {
    throw new GuidanceValidationError("invalid bundled fallback");
  }
  if (value.schemaVersion !== GUIDANCE_SCHEMA_VERSION) {
    throw new GuidanceValidationError("bundled schema mismatch");
  }
  if (
    value.locale !== GUIDANCE_LOCALE ||
    value.jurisdiction !== GUIDANCE_JURISDICTION ||
    value.flowKey !== GUIDANCE_FLOW_KEY
  ) {
    throw new GuidanceValidationError("bundled scope mismatch");
  }
  const contentHash = requiredString(value.contentHash, "contentHash");
  if (!HASH_PATTERN.test(contentHash)) {
    throw new GuidanceValidationError("bundled hash mismatch");
  }
  const document = parseGuidanceDocument({
    copy: value.copy,
    cells: value.cells,
  });
  return document;
};

export const bundledGuidanceDocument = (): GuidanceDocument =>
  parseFallbackFile(fallbackJson);

export const bundledContentHash = (): string => {
  if (!isRecord(fallbackJson)) {
    throw new GuidanceValidationError("invalid bundled fallback");
  }
  return requiredString(fallbackJson.contentHash, "contentHash");
};

export const bundledPublicGuidance = (): PublicGuidance =>
  resolvePublicGuidance(bundledGuidanceDocument(), {
    revisionId: BUNDLED_REVISION_ID,
    contentHash: bundledContentHash(),
    source: "bundled",
  });

function readProfiles(
  value: unknown,
): Pick<GuidanceDocument, "reportProfiles"> {
  if (value === undefined) return {};
  try {
    const reportProfiles = parseReportProfiles(value);
    return reportProfiles.length ? { reportProfiles } : {};
  } catch {
    throw new GuidanceValidationError("invalid report profiles");
  }
}
