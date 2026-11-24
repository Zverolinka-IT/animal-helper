import { z } from "zod";
import { guidanceContactOptionSchema } from "./guidance-contacts.js";

// Code owns flow boundaries; reviewed admin content owns variable service routing.
export const reportGuidanceContexts = [
  "stray",
  "dead",
  "dead-suspicious",
  "human",
  "human-field",
  "human-trees",
  "human-building",
  "human-fire",
  "human-trapped",
  "human-inside",
  "human-other",
  "road-near-road",
  "road-near-highway",
  "road-hit-road",
  "road-hit-highway",
  "road-railway",
  "road-other",
] as const;
export const reportGuidanceProfileSchema = z
  .strictObject({
    context: z.enum(reportGuidanceContexts),
    kindKey: z
      .string()
      .regex(/^[a-z][a-z0-9_]{0,63}$/u)
      .optional(),
    warning: z.string().trim().max(4000),
    instructions: z.string().trim().max(4000),
    contacts: z
      .array(guidanceContactOptionSchema)
      .max(24)
      .refine(
        (values) =>
          new Set(values.map((value) => value.id)).size === values.length,
        "Contact IDs must be unique",
      ),
  })
  .refine(
    (profile) =>
      !profile.context.startsWith("road-") || profile.kindKey === undefined,
    "Road routing precedes species identification",
  )
  .refine(
    (profile) =>
      !!profile.kindKey ||
      !profile.contacts.some(
        (contact) => contact.clinicVariant === "protected",
      ),
    "Protected veterinary guidance requires a reviewed animal-specific profile",
  );
export const reportGuidanceProfilesSchema = z
  .array(reportGuidanceProfileSchema)
  .max(2000)
  .refine(
    (values) =>
      new Set(values.map((value) => `${value.context}:${value.kindKey ?? "*"}`))
        .size === values.length,
    "Profiles must be unique per context and animal kind",
  );
export const adminReportGuidanceSchema = z.strictObject({
  expectedHash: z.string().regex(/^[0-9a-f]{64}$/u),
  profile: reportGuidanceProfileSchema,
});
export type ReportGuidanceProfile = z.infer<typeof reportGuidanceProfileSchema>;
export type ReportGuidanceContext = ReportGuidanceProfile["context"];
