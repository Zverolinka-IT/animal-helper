import { z } from "zod";
import { contactServiceKeys } from "./contact-directory.js";

export const guidanceContactOptionSchema = z
  .strictObject({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,47}$/u),
    serviceKey: z.enum(contactServiceKeys),
    title: z.string().trim().max(200),
    body: z.string().trim().max(4000),
    enabled: z.boolean(),
    clinicVariant: z.enum(["standard", "protected"]).optional(),
  })
  .refine(
    (option) =>
      option.clinicVariant === undefined ||
      ["vet_clinic", "vet_exotic"].includes(option.serviceKey),
    "Veterinary presentation is only available for veterinary services",
  );

export const guidanceContactOptionsSchema = z
  .array(guidanceContactOptionSchema)
  .min(1)
  .refine(
    (options) =>
      new Set(options.map((option) => option.id)).size === options.length,
    "Contact option IDs must be unique",
  )
  .refine(
    (options) => options.some((option) => option.enabled),
    "At least one contact option must be enabled",
  );

export const adminGuidanceContactsSchema = z.strictObject({
  expectedHash: z.string().regex(/^[0-9a-f]{64}$/u),
  kindKey: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/u),
  options: guidanceContactOptionsSchema,
});

export type GuidanceContactOption = z.infer<typeof guidanceContactOptionSchema>;
