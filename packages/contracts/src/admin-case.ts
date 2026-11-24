import { z } from "zod";

const text = (max: number) => z.string().trim().max(max);
const requiredText = (max: number) => text(max).min(1);
const date = z.union([z.literal(""), z.iso.date()]);
const deadline = z.union([z.literal(""), z.iso.datetime({ local: true })]);

export const adminCaseCommandSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("take_over") }),
  z.strictObject({ type: z.literal("leave_passive") }),
  z.strictObject({ type: z.literal("close") }),
  z.strictObject({
    type: z.literal("set_work"),
    urgency: z.enum(["acute", "high", "normal"]),
    nextStep: text(500),
    deadline,
    note: text(4000),
  }),
  z.strictObject({
    type: z.literal("add_action"),
    kind: z.enum(["call", "email", "visit", "referral", "consult"]),
    result: requiredText(2000),
  }),
  z.strictObject({
    type: z.literal("add_step"),
    text: requiredText(500),
    due: deadline,
  }),
  z.strictObject({ type: z.literal("remove_step"), id: z.uuid() }),
  z.strictObject({
    type: z.literal("add_volunteer"),
    name: requiredText(200),
    task: text(200),
    result: text(2000),
  }),
  z.strictObject({
    type: z.literal("add_referral"),
    recipient: requiredText(200),
    sentOn: date.optional(),
    replyFileName: text(300),
  }),
  z.strictObject({
    type: z.literal("add_inspection"),
    referralId: z.uuid(),
    on: date.optional(),
    by: requiredText(200),
    outcome: z.enum(["founded", "partial", "unfounded", "unknown"]),
    findings: requiredText(2000),
  }),
]);

export const adminCaseRequestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  commandId: z.uuid(),
  expectedRevision: z.int().nonnegative(),
  command: adminCaseCommandSchema,
});

export type AdminCaseCommand = z.infer<typeof adminCaseCommandSchema>;
export type AdminCaseRequest = z.infer<typeof adminCaseRequestSchema>;

export const adminCaseSearchSchema = z.strictObject({
  schemaVersion: z.literal(1),
  page: z.int().min(0).max(999_999).default(0),
  query: text(500).default(""),
  reporterEmail: text(320).default(""),
  ownerEmail: text(320).default(""),
});

export type AdminCaseSearch = z.infer<typeof adminCaseSearchSchema>;
