import { z } from "zod";
import { slovakDistricts } from "./slovak-districts.js";

export const guidanceContactKeys = [
  "municipality_capture",
  "vet_clinic",
  "vet_exotic",
  "sop_rescue",
  "hunting_manager_or_opk",
  "emergency_112",
  "conditional_sop_if_wild_pigeon",
  "dynamic_sop_or_municipality",
] as const;

export const contactServiceKeys = [
  ...guidanceContactKeys,
  "volunteers",
  "police",
  "highway_patrol",
] as const;
export type ContactServiceKey = (typeof contactServiceKeys)[number];

const safeText = (value: string): boolean => {
  if (/[<>]/u.test(value)) return false;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 32 && ![9, 10, 13].includes(code)) return false;
  }
  return true;
};
const text = (max: number) => z.string().trim().max(max).refine(safeText);
const date = z.iso.date();
const optionalDate = z.union([z.literal(""), date]);
const httpsUrl = z.union([
  z.literal(""),
  z
    .url({ protocol: /^https$/u })
    .max(1000)
    .refine((value) => /^https:\/\/[^/?#@\\\s]+(?:[/?#]|$)/iu.test(value)),
]);

export const contactCoordinatesSchema = z.strictObject({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});
export type ContactCoordinates = z.infer<typeof contactCoordinatesSchema>;

const position = z.tuple([
  z.number().min(-180).max(180),
  z.number().min(-90).max(90),
]);
const ring = z
  .array(position)
  .min(4)
  .max(1000)
  .refine((points) => {
    const first = points[0];
    const last = points.at(-1);
    return first?.[0] === last?.[0] && first?.[1] === last?.[1];
  });
const polygon = z.array(ring).min(1).max(20);
export const contactBoundarySchema = z
  .discriminatedUnion("type", [
    z.strictObject({ type: z.literal("Polygon"), coordinates: polygon }),
    z.strictObject({
      type: z.literal("MultiPolygon"),
      coordinates: z.array(polygon).min(1).max(20),
    }),
  ])
  .refine((geometry) => {
    const polygons =
      geometry.type === "Polygon"
        ? [geometry.coordinates]
        : geometry.coordinates;
    return (
      polygons.flatMap((area) => area.flat()).length <= 2000 &&
      JSON.stringify(geometry).length <= 45000
    );
  });
export type ContactBoundary = z.infer<typeof contactBoundarySchema>;

export const contactCoverageSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("national") }),
  z.strictObject({
    kind: z.literal("radius"),
    center: contactCoordinatesSchema,
    radiusKm: z.number().positive().max(600),
  }),
  z.strictObject({
    kind: z.literal("boundary"),
    geometry: contactBoundarySchema,
  }),
  z.strictObject({
    kind: z.literal("districts"),
    districts: z
      .array(z.enum(slovakDistricts))
      .min(1)
      .max(slovakDistricts.length)
      .refine((items) => new Set(items).size === items.length),
  }),
]);

const phonePattern = (value: string) =>
  /^\+?[0-9][0-9 ()-]+$/u.test(value) &&
  /^\+?\d{2,15}$/u.test(value.replace(/[ ()-]/gu, ""));

// A cell may contain several numbers, sometimes separated only by a space
// once the first number already has ten digits.
export const splitContactPhones = (
  value: string,
): { valid: string[]; invalid: string[] } => {
  const valid: string[] = [];
  const invalid: string[] = [];
  const flush = (words: string[]) => {
    const text = words.join(" ").trim();
    if (!text) return;
    if (phonePattern(text)) valid.push(text);
    else invalid.push(text);
  };
  for (const chunk of value
    .split(/[\n|;]+/u)
    .map((part) => part.trim())
    .filter(Boolean)) {
    if (phonePattern(chunk)) {
      valid.push(chunk);
      continue;
    }
    const current: string[] = [];
    let digits = 0;
    for (const word of chunk.split(/\s+/u).filter(Boolean)) {
      const wordDigits = word.replace(/\D/gu, "");
      if (!wordDigits || (digits > 0 && digits + wordDigits.length > 10)) {
        flush(current);
        current.length = 0;
        digits = 0;
      }
      if (!wordDigits) {
        invalid.push(word);
        continue;
      }
      current.push(word);
      digits += wordDigits.length;
      if (digits === 10) {
        flush(current);
        current.length = 0;
        digits = 0;
      }
    }
    flush(current);
  }
  return { valid, invalid };
};

const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u);
export const contactHoursSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("unknown") }),
  z.strictObject({ kind: z.literal("always") }),
  z.strictObject({
    kind: z.literal("weekly"),
    intervals: z
      .array(
        z
          .strictObject({
            day: z.number().int().min(0).max(6),
            opens: time,
            closes: time,
          })
          .refine((interval) => interval.opens !== interval.closes),
      )
      .min(1)
      .max(28),
  }),
]);

// Incomplete entries can be saved as drafts. Publishing checks the required
// public contact and verification fields together, under the draft lock.
export const contactDirectoryEntrySchema = z.strictObject({
  id: z.uuid(),
  name: text(160).min(1),
  serviceKeys: z
    .array(z.enum(contactServiceKeys))
    .min(1)
    .max(contactServiceKeys.length)
    .refine((keys) => new Set(keys).size === keys.length),
  enabled: z.boolean(),
  phone: text(32).refine((value) => value === "" || phonePattern(value)),
  website: httpsUrl,
  address: text(300),
  coordinates: contactCoordinatesSchema.optional(),
  coverage: contactCoverageSchema,
  hours: contactHoursSchema,
  note: text(1000),
  sourceUrl: httpsUrl,
  verifiedOn: optionalDate,
  reviewDueOn: optionalDate,
});
export type ContactDirectoryEntry = z.infer<typeof contactDirectoryEntrySchema>;

// Import is additive. Match only exact identities, never fuzzy names, so nearby
// organisations and branches are not silently combined or overwritten.
export const contactImportKey = (entry: ContactDirectoryEntry): string => {
  const text = (value: string) =>
    value.trim().replace(/\s+/gu, " ").toLowerCase();
  return JSON.stringify([
    text(entry.name),
    text(entry.address),
    entry.phone.replace(/[ ()-]/gu, ""),
    entry.website,
    [...entry.serviceKeys].sort(),
  ]);
};

export const planContactImport = (
  existing: readonly ContactDirectoryEntry[],
  incoming: readonly ContactDirectoryEntry[],
): { added: ContactDirectoryEntry[]; duplicates: ContactDirectoryEntry[] } => {
  const known = new Set(existing.map(contactImportKey));
  const ids = new Set(existing.map((entry) => entry.id));
  const added: ContactDirectoryEntry[] = [],
    duplicates: ContactDirectoryEntry[] = [];
  for (const entry of incoming) {
    const key = contactImportKey(entry);
    if (known.has(key)) duplicates.push(entry);
    else {
      if (ids.has(entry.id)) throw new Error("import_id_conflict");
      added.push(entry);
      known.add(key);
      ids.add(entry.id);
    }
  }
  return { added, duplicates };
};

export const contactDirectoryDocumentSchema = z.strictObject({
  schemaVersion: z.literal(1),
  jurisdiction: z.literal("SK"),
  entries: z
    .array(contactDirectoryEntrySchema)
    .max(1000)
    .refine(
      (entries) =>
        new Set(entries.map((entry) => entry.id)).size === entries.length &&
        JSON.stringify(entries).length <= 1_000_000,
    ),
});
export type ContactDirectoryDocument = z.infer<
  typeof contactDirectoryDocumentSchema
>;

export const publicContactDirectorySchema =
  contactDirectoryDocumentSchema.extend({
    revisionId: z.uuid(),
    publishedAt: z.iso.datetime(),
  });
export type PublicContactDirectory = z.infer<
  typeof publicContactDirectorySchema
>;

export type ContactDirectoryIssue = Readonly<{ id: string; fields: string[] }>;
export const contactDirectoryIssues = (
  document: ContactDirectoryDocument,
  today: string,
): ContactDirectoryIssue[] =>
  document.entries
    .filter((entry) => entry.enabled)
    .flatMap((entry) => {
      const fields: string[] = [];
      if (!entry.phone && !entry.website) fields.push("contact");
      if (!entry.sourceUrl) fields.push("sourceUrl");
      if (!entry.verifiedOn || entry.verifiedOn > today)
        fields.push("verifiedOn");
      if (
        !entry.reviewDueOn ||
        entry.reviewDueOn < today ||
        entry.reviewDueOn < entry.verifiedOn
      )
        fields.push("reviewDueOn");
      if (
        entry.serviceKeys.includes("municipality_capture") &&
        entry.coverage.kind !== "boundary"
      )
        fields.push("coverage");
      if (
        (entry.serviceKeys.includes("sop_rescue") ||
          entry.serviceKeys.includes("hunting_manager_or_opk")) &&
        entry.coverage.kind !== "districts"
      )
        fields.push("districts");
      return fields.length ? [{ id: entry.id, fields }] : [];
    });

export const contactDirectoryRequestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  commandId: z.uuid(),
  expectedRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  command: z.discriminatedUnion("type", [
    z.strictObject({
      type: z.literal("save_entry"),
      entry: contactDirectoryEntrySchema,
    }),
    z.strictObject({ type: z.literal("remove_entry"), id: z.uuid() }),
    z.strictObject({
      type: z.literal("import_entries"),
      entries: z
        .array(
          contactDirectoryEntrySchema.extend({ enabled: z.literal(false) }),
        )
        .min(1)
        .max(1000)
        .refine(
          (entries) =>
            new Set(entries.map((entry) => entry.id)).size === entries.length,
        ),
    }),
    z.strictObject({ type: z.literal("publish") }),
  ]),
});
export type ContactDirectoryRequest = z.infer<
  typeof contactDirectoryRequestSchema
>;

export type AdminContactDirectory = Readonly<{
  revision: number;
  document: ContactDirectoryDocument;
  published: PublicContactDirectory | null;
  hasUnpublishedChanges: boolean;
}>;
