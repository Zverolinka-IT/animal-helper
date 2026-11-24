import { z } from "zod";

export const WALK_VIEW_SCHEMA_VERSION = 1;

export const walkCommandKindSchema = z.enum([
  "create_draft",
  "attach_location",
  "attach_form_snapshot",
  "attach_contact",
  "submit_draft",
  "continue",
]);

export type WalkCommandKind = z.infer<typeof walkCommandKindSchema>;

export const walkFieldErrorSchema = z.strictObject({
  path: z.string().min(1).max(128),
  code: z.string().min(1).max(64),
});

export type WalkFieldError = z.infer<typeof walkFieldErrorSchema>;

export const walkSituationTypeSchema = z.enum([
  "injured",
  "stray",
  "dead",
  "cruelty",
  "other",
]);

export const walkKindOptionSchema = z.strictObject({
  key: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z][a-z0-9_]*$/),
  groupKey: z.string().min(1).max(64),
  categoryKey: z.string().min(1).max(64),
  labelSk: z.string().min(1).max(200),
  askConscious: z.boolean(),
  askJuvenile: z.boolean(),
});

export type WalkKindOption = z.infer<typeof walkKindOptionSchema>;

export const walkGuideActionSchema = z.strictObject({
  kind: z.literal("call-contact"),
  targetKey: z.string().min(1).max(64),
});

export const walkGuideItemSchema = z.strictObject({
  screenKey: z.string().min(1).max(32),
  instructionKey: z.string().min(1).max(64),
  polarity: z.enum(["do", "do_not", "info"]),
  slots: z.record(z.string().min(1).max(64), z.string().max(4000)),
  action: walkGuideActionSchema.optional(),
});

export type WalkGuideItem = z.infer<typeof walkGuideItemSchema>;

const walkViewBase = {
  schemaVersion: z.literal(WALK_VIEW_SCHEMA_VERSION),
  path: z.string().min(1).max(64),
  screenKeys: z.array(z.string().min(1).max(32)).min(1).max(16),
  allowedCommands: z.array(walkCommandKindSchema).max(8),
  fieldErrors: z.array(walkFieldErrorSchema).max(32),
} as const;

export const situationWalkViewSchema = z.strictObject({
  ...walkViewBase,
  screen: z.literal("situation"),
  path: z.literal("/w01"),
  props: z.strictObject({
    situations: z.array(walkSituationTypeSchema).min(1).max(5),
  }),
});

export const locationWalkViewSchema = z.strictObject({
  ...walkViewBase,
  screen: z.literal("location"),
  path: z.literal("/w03"),
  props: z.strictObject({}),
});

export const photoWalkViewSchema = z.strictObject({
  ...walkViewBase,
  screen: z.literal("photo"),
  path: z.literal("/w04"),
  props: z.strictObject({}),
});

export const detailsWalkViewSchema = z.strictObject({
  ...walkViewBase,
  screen: z.literal("details"),
  path: z.literal("/w09"),
  props: z.strictObject({
    situationType: walkSituationTypeSchema,
    kinds: z.array(walkKindOptionSchema).max(200),
  }),
});

export const guideWalkViewSchema = z.strictObject({
  ...walkViewBase,
  screen: z.literal("guide"),
  props: z.strictObject({
    kindKey: z.string().min(1).max(64),
    revisionId: z.string().min(1).max(128),
    items: z.array(walkGuideItemSchema).max(32),
  }),
});

export const contactWalkViewSchema = z.strictObject({
  ...walkViewBase,
  screen: z.literal("contact"),
  path: z.literal("/w24"),
  props: z.strictObject({}),
});

export const thanksWalkViewSchema = z.strictObject({
  ...walkViewBase,
  screen: z.literal("thanks"),
  path: z.literal("/thank-you"),
  props: z.strictObject({
    publicState: z.enum(["draft", "received", "closed"]).optional(),
  }),
});

export const walkViewSchema = z.discriminatedUnion("screen", [
  situationWalkViewSchema,
  locationWalkViewSchema,
  photoWalkViewSchema,
  detailsWalkViewSchema,
  guideWalkViewSchema,
  contactWalkViewSchema,
  thanksWalkViewSchema,
]);

export type WalkView = z.infer<typeof walkViewSchema>;
export type SituationWalkView = z.infer<typeof situationWalkViewSchema>;
export type LocationWalkView = z.infer<typeof locationWalkViewSchema>;
export type PhotoWalkView = z.infer<typeof photoWalkViewSchema>;
export type DetailsWalkView = z.infer<typeof detailsWalkViewSchema>;
export type GuideWalkView = z.infer<typeof guideWalkViewSchema>;
export type ContactWalkView = z.infer<typeof contactWalkViewSchema>;
export type ThanksWalkView = z.infer<typeof thanksWalkViewSchema>;

export const parseWalkView = (value: unknown): z.ZodSafeParseResult<WalkView> =>
  walkViewSchema.safeParse(value);
