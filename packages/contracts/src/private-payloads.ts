import { z } from "zod";

export const PRIVATE_PAYLOAD_MAX_BYTES = 16_384;
export const PRIVATE_RECORD_SCHEMA_VERSION = 1;
export const FORM_SNAPSHOT_SCHEMA_VERSION = PRIVATE_RECORD_SCHEMA_VERSION;
export const MAX_MEDIA_ATTACHMENTS = 6;

const withinBudget = <Schema extends z.ZodType>(schema: Schema) =>
  schema.refine(
    (value) => JSON.stringify(value).length <= PRIVATE_PAYLOAD_MAX_BYTES,
    { message: "private payload exceeds 16 KiB" },
  );

const catalogKeySchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/);

const ternarySchema = z.enum(["yes", "no", "unknown"]);

export const situationTypeSchema = z.enum([
  "injured",
  "stray",
  "dead",
  "cruelty",
  "other",
]);

export const speciesSourceSchema = z.enum([
  "ai",
  "manual",
  "failed",
  "skipped",
]);

export const conditionSymptomSchema = z.enum([
  "bleeding",
  "hit",
  "poison_suspected",
  "vomiting",
  "foam",
  "limping",
  "unknown",
  "other",
]);

export const strayBehaviourSchema = z.enum([
  "escaping",
  "aggressive",
  "confused",
  "unknown",
  "other",
]);

export const reportOutcomeSchema = z
  .strictObject({
    status: z.enum(["resolved", "unresolved"]),
    reasons: z
      .array(
        z.enum([
          "municipality-unanswered",
          "municipality-refused",
          "municipality-referred",
          "clinic-closed",
          "clinic-refused",
          "police-refused",
          "police-absent",
          "police-referred",
          "aggressive",
          "escaped",
          "equipment",
          "unable",
          "volunteers",
          "died",
          "time",
          "resolved-otherwise",
          "other",
        ]),
      )
      .max(17),
    otherText: z.string().trim().min(1).max(2000).optional(),
  })
  .superRefine((outcome, context) => {
    if (new Set(outcome.reasons).size !== outcome.reasons.length)
      context.addIssue({
        code: "custom",
        path: ["reasons"],
        message: "reasons must be unique",
      });
    if (outcome.status === "resolved" && outcome.reasons.length > 0)
      context.addIssue({
        code: "custom",
        path: ["reasons"],
        message: "resolved reports cannot have failure reasons",
      });
    if (outcome.otherText !== undefined && !outcome.reasons.includes("other"))
      context.addIssue({
        code: "custom",
        path: ["otherText"],
        message: "otherText is only allowed with the other reason",
      });
  });
export type ReportOutcome = z.infer<typeof reportOutcomeSchema>;

const optionalDescription = z.string().trim().min(1).max(2000).optional();
const selections = <T extends z.ZodType<string>>(item: T, max: number) =>
  z
    .array(item)
    .max(max)
    .refine(
      (values) =>
        new Set(values).size === values.length &&
        (!values.some((value) => value === "unknown") || values.length === 1),
      "selections must be unique and unknown exclusive",
    );

export const roadSituationSchema = z.enum([
  "near-road",
  "near-highway",
  "hit-road",
  "hit-highway",
  "railway",
  "other",
]);
export const deadReportSchema = z
  .strictObject({
    suspiciousSigns: selections(
      z.enum(["bound", "foam", "bait", "gunshot", "unknown"]),
      5,
    ),
    animalCount: z.enum(["one", "multiple"]).optional(),
    description: optionalDescription,
  })
  .refine(
    (value) => !value.description || value.suspiciousSigns.includes("unknown"),
    "site description requires none/unknown",
  );
export const policeReportSchema = z
  .strictObject({
    outcome: z.enum(["reported", "not-reported"]),
    reasons: selections(
      z.enum(["refused", "not-arrived", "redirected", "no-time", "other"]),
      5,
    ),
    description: optionalDescription,
  })
  .refine(
    (value) =>
      (!value.description || value.reasons.includes("other")) &&
      (value.outcome !== "reported" || value.reasons.length === 0),
    "invalid police outcome reasons",
  );
export const crueltyReportSchema = z
  .strictObject({
    acute: z.boolean(),
    signs: selections(
      z.enum([
        "chained",
        "conditions",
        "underfed",
        "beaten",
        "no-water",
        "burned",
        "poisoned",
        "unknown",
      ]),
      8,
    ),
    description: optionalDescription,
    police: policeReportSchema.optional(),
  })
  .superRefine((value, context) => {
    const allowed = value.acute
      ? ["burned", "beaten", "poisoned", "unknown"]
      : ["chained", "conditions", "underfed", "beaten", "no-water", "unknown"];
    if (
      value.signs.some((sign) => !allowed.includes(sign)) ||
      (!value.acute && value.police)
    )
      context.addIssue({
        code: "custom",
        message: "incompatible cruelty answers",
      });
  });
export const otherReportSchema = z.discriminatedUnion("branch", [
  z
    .strictObject({
      branch: z.literal("road"),
      situation: roadSituationSchema,
      description: optionalDescription,
      serviceReport: z
        .strictObject({
          reasons: selections(
            z.enum(["unanswered", "refused", "no-time", "other"]),
            4,
          ),
          description: optionalDescription,
        })
        .refine(
          (value) => !value.description || value.reasons.includes("other"),
          "description requires other",
        )
        .optional(),
      animalHelpRequested: z.boolean().optional(),
    })
    .refine(
      (value) => !value.description || value.situation === "other",
      "description requires other",
    ),
  z
    .strictObject({
      branch: z.literal("human"),
      situation: z
        .enum([
          "field",
          "trees",
          "building",
          "fire",
          "trapped",
          "inside",
          "other",
        ])
        .optional(),
      description: optionalDescription,
    })
    .refine(
      (value) => !value.description || value.situation === "other",
      "description requires other",
    ),
  z.strictObject({
    branch: z.literal("other"),
    description: optionalDescription,
  }),
]);
export const draftClosureSchema = z
  .strictObject({
    status: z.enum(["resolved", "unresolved", "resolved-otherwise", "other"]),
    description: optionalDescription,
  })
  .refine(
    (value) => !value.description || value.status === "other",
    "description requires other",
  );

export const formSnapshotV1Schema = withinBudget(
  z
    .strictObject({
      schemaVersion: z.literal(PRIVATE_RECORD_SCHEMA_VERSION),
      situationType: situationTypeSchema,
      species: z.strictObject({
        source: speciesSourceSchema,
        groupKey: catalogKeySchema.optional(),
        categoryKey: catalogKeySchema.optional(),
        kindKey: catalogKeySchema.optional(),
        description: optionalDescription,
      }),
      condition: z.strictObject({
        symptoms: z.array(conditionSymptomSchema).max(8),
        otherText: z.string().trim().min(1).max(2000).optional(),
        conscious: ternarySchema.optional(),
        isJuvenile: ternarySchema.optional(),
        behaviour: z.array(strayBehaviourSchema).max(5).optional(),
        collar: ternarySchema.optional(),
      }),
      outcome: reportOutcomeSchema.optional(),
      whoHelped: z
        .strictObject({
          choice: z
            .string()
            .trim()
            .min(1)
            .max(200)
            .refine((value) => !/[<>]/u.test(value)),
          detail: z.string().trim().min(1).max(2000).optional(),
        })
        .refine(
          (value) => value.detail === undefined || value.choice === "Iné",
          "detail requires Iné",
        )
        .optional(),
      dead: deadReportSchema.optional(),
      cruelty: crueltyReportSchema.optional(),
      other: otherReportSchema.optional(),
      closure: draftClosureSchema.optional(),
      mediaRecordIds: z.array(z.uuid()).max(MAX_MEDIA_ATTACHMENTS),
    })
    .superRefine((snapshot, context) => {
      for (const field of ["dead", "cruelty", "other"] as const) {
        if (snapshot[field] !== undefined && snapshot.situationType !== field)
          context.addIssue({
            code: "custom",
            path: [field],
            message: "answers belong to another situation",
          });
        if (
          snapshot.situationType === field &&
          snapshot[field] === undefined &&
          !snapshot.closure
        )
          context.addIssue({
            code: "custom",
            path: [field],
            message: "situation details required",
          });
      }
      if (
        snapshot.whoHelped &&
        (snapshot.situationType !== "injured" ||
          snapshot.outcome?.status !== "resolved")
      ) {
        context.addIssue({
          code: "custom",
          path: ["whoHelped"],
          message: "who helped is recorded only for a resolved injured report",
        });
      }
      const identified =
        snapshot.species.source === "ai" ||
        snapshot.species.source === "manual";
      if (identified && snapshot.species.kindKey === undefined) {
        context.addIssue({
          code: "custom",
          path: ["species", "kindKey"],
          message: "kindKey is required when the species was identified",
        });
      }

      const uniqueSymptoms = new Set(snapshot.condition.symptoms);
      if (uniqueSymptoms.size !== snapshot.condition.symptoms.length) {
        context.addIssue({
          code: "custom",
          path: ["condition", "symptoms"],
          message: "symptoms must be unique",
        });
      }

      if (
        snapshot.condition.symptoms.includes("unknown") &&
        snapshot.condition.symptoms.length > 1
      ) {
        context.addIssue({
          code: "custom",
          path: ["condition", "symptoms"],
          message: "unknown cannot be combined with other symptoms",
        });
      }

      const behaviour = snapshot.condition.behaviour ?? [];
      if (
        new Set(behaviour).size !== behaviour.length ||
        (behaviour.includes("unknown") && behaviour.length > 1)
      )
        context.addIssue({
          code: "custom",
          path: ["condition", "behaviour"],
          message: "behaviour must be unique and unknown exclusive",
        });
      if (
        snapshot.situationType !== "stray" &&
        (snapshot.condition.behaviour !== undefined ||
          snapshot.condition.collar !== undefined)
      )
        context.addIssue({
          code: "custom",
          path: ["condition"],
          message: "behaviour and collar are only allowed for stray reports",
        });
      const hasOther =
        snapshot.condition.symptoms.includes("other") ||
        behaviour.includes("other");

      if (!hasOther && snapshot.condition.otherText !== undefined) {
        context.addIssue({
          code: "custom",
          path: ["condition", "otherText"],
          message: "otherText is only allowed with the other symptom",
        });
      }

      if (
        new Set(snapshot.mediaRecordIds).size !== snapshot.mediaRecordIds.length
      ) {
        context.addIssue({
          code: "custom",
          path: ["mediaRecordIds"],
          message: "mediaRecordIds must be unique",
        });
      }
    }),
);

export const locationPayloadV1Schema = withinBudget(
  z.strictObject({
    schemaVersion: z.literal(PRIVATE_RECORD_SCHEMA_VERSION),
    address: z.string().trim().min(1).max(500),
    coordinates: z
      .strictObject({
        latitude: z.number().gte(-90).lte(90),
        longitude: z.number().gte(-180).lte(180),
      })
      .optional(),
  }),
);

export const contactPayloadV1Schema = withinBudget(
  z.strictObject({
    schemaVersion: z.literal(PRIVATE_RECORD_SCHEMA_VERSION),
    name: z.string().trim().min(1).max(200).optional(),
    phone: z
      .string()
      .trim()
      .regex(/^\+?[0-9][0-9\s-]{6,30}$/)
      .max(32)
      .optional(),
    email: z.email().max(320).optional(),
    shareWithAuthorities: z.boolean(),
    newsletter: z.boolean(),
  }),
);

export const mediaRefPayloadV1Schema = withinBudget(
  z.strictObject({
    schemaVersion: z.literal(PRIVATE_RECORD_SCHEMA_VERSION),
    contentType: z.enum([
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/heic",
      "video/mp4",
      "video/quicktime",
    ]),
    byteSize: z.int().positive().max(52_428_800),
    checksumSha256: z.string().regex(/^[a-f0-9]{64}$/),
  }),
);

export const textPayloadSchema = withinBudget(
  z.record(z.string().max(64), z.string().max(4000)),
);

export type FormSnapshotV1 = z.infer<typeof formSnapshotV1Schema>;
export type LocationPayloadV1 = z.infer<typeof locationPayloadV1Schema>;
export type ContactPayloadV1 = z.infer<typeof contactPayloadV1Schema>;
export type MediaRefPayloadV1 = z.infer<typeof mediaRefPayloadV1Schema>;
export type TextPayload = z.infer<typeof textPayloadSchema>;

export type PrivateRecordPayload =
  | FormSnapshotV1
  | LocationPayloadV1
  | ContactPayloadV1
  | MediaRefPayloadV1
  | TextPayload;

export const parseFormSnapshot = (
  value: unknown,
): z.ZodSafeParseResult<FormSnapshotV1> =>
  formSnapshotV1Schema.safeParse(value);
