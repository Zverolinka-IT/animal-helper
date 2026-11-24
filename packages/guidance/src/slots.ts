import { flowFor } from "./flows.js";
import { type ContactKey, type FlowKey, type ScreenKey } from "./keys.js";

export const GUIDANCE_SCHEMA_VERSION = 1;
export const GUIDANCE_LOCALE = "sk-SK";
export const GUIDANCE_JURISDICTION = "SK";
export const GUIDANCE_FLOW_KEY = "injured";
export const COPY_MAX_LENGTH = 4000;
export const BUNDLED_REVISION_ID = "bundled";

export const guidanceScope = {
  schemaVersion: GUIDANCE_SCHEMA_VERSION,
  locale: GUIDANCE_LOCALE,
  jurisdiction: GUIDANCE_JURISDICTION,
  flowKey: GUIDANCE_FLOW_KEY,
} as const;

export const instructionKeys = [
  "warning.do_not",
  "warning.do_before",
  "contact.primary",
  "contact.secondary",
  "volunteers",
  "self_help",
] as const;

export type FixedInstructionKey = (typeof instructionKeys)[number];
export type ContactOptionInstructionKey = `contact.option.${string}`;
export type InstructionKey = FixedInstructionKey | ContactOptionInstructionKey;
export const isContactOptionInstruction = (
  value: string,
): value is ContactOptionInstructionKey =>
  /^contact\.option\.[a-z0-9][a-z0-9-]{0,47}$/u.test(value);
export const isContactInstruction = (value: string): boolean =>
  isContactOptionInstruction(value) ||
  ["contact.primary", "contact.secondary", "volunteers"].includes(value);
export const contactOptionPath = (
  instructionKey: ContactOptionInstructionKey,
): string => `/contacts/${instructionKey.slice("contact.option.".length)}`;

export const copySlotKeys = [
  "warning.do_not",
  "warning.do_before",
  "contact.primary.title",
  "contact.primary.body",
  "contact.secondary.title",
  "contact.secondary.body",
  "volunteers.body",
  "self_help.intro",
  "contact.title",
  "contact.body",
] as const;

export type CopySlotKey = (typeof copySlotKeys)[number];

export const instructionSlotKeys: Readonly<
  Record<FixedInstructionKey, readonly CopySlotKey[]>
> = {
  "warning.do_not": ["warning.do_not"],
  "warning.do_before": ["warning.do_before"],
  "contact.primary": ["contact.primary.title", "contact.primary.body"],
  "contact.secondary": ["contact.secondary.title", "contact.secondary.body"],
  volunteers: ["volunteers.body"],
  self_help: ["self_help.intro"],
};

export const slotsForInstruction = (
  key: InstructionKey,
): readonly CopySlotKey[] =>
  isContactOptionInstruction(key)
    ? ["contact.title", "contact.body"]
    : instructionSlotKeys[key];

export type InstructionPolarity = "do" | "do_not" | "info";

export const polarityFor: Readonly<
  Record<FixedInstructionKey, InstructionPolarity>
> = {
  "warning.do_not": "do_not",
  "warning.do_before": "do",
  "contact.primary": "info",
  "contact.secondary": "info",
  volunteers: "info",
  self_help: "do",
};
export const polarityForInstruction = (
  key: InstructionKey,
): InstructionPolarity =>
  isContactOptionInstruction(key) ? "info" : polarityFor[key];

export const instructionSortOrder: Readonly<
  Record<FixedInstructionKey, number>
> = {
  "warning.do_not": 10,
  "warning.do_before": 20,
  "contact.primary": 30,
  "contact.secondary": 40,
  volunteers: 50,
  self_help: 60,
};
export const sortOrderForInstruction = (key: InstructionKey): number =>
  isContactOptionInstruction(key) ? 30 : instructionSortOrder[key];

const includesKey = <Key extends string>(
  keys: readonly Key[],
  value: string,
): value is Key => (keys as readonly string[]).includes(value);

export const isInstructionKey = (value: string): value is InstructionKey =>
  includesKey(instructionKeys, value) || isContactOptionInstruction(value);

export const isCopySlotKey = (value: string): value is CopySlotKey =>
  includesKey(copySlotKeys, value);

export const isInstructionPolarity = (
  value: string,
): value is InstructionPolarity =>
  value === "do" || value === "do_not" || value === "info";

export const screenForInstruction = (
  instructionKey: InstructionKey,
  flowKey: FlowKey,
): ScreenKey | undefined => {
  if (isContactOptionInstruction(instructionKey)) return "w15";
  const screens: readonly ScreenKey[] = flowFor(flowKey).screens;
  const has = (key: ScreenKey): boolean => screens.includes(key);

  switch (instructionKey) {
    case "warning.do_not":
      if (has("w13")) {
        return "w13";
      }
      return has("w14") ? "w14" : undefined;
    case "warning.do_before":
      return has("w14") ? "w14" : undefined;
    case "contact.primary":
      if (has("w20")) {
        return "w20";
      }
      return has("w15") ? "w15" : undefined;
    case "contact.secondary":
      if (has("w19")) {
        return "w19";
      }
      return has("w18") ? "w18" : undefined;
    case "volunteers":
      return has("w21") ? "w21" : undefined;
    case "self_help":
      return has("w22") ? "w22" : undefined;
  }
};

export const actionTargetForInstruction = (
  instructionKey: InstructionKey,
  primaryContact: ContactKey | undefined,
  secondaryContact: ContactKey | undefined,
): ContactKey | undefined => {
  if (instructionKey === "contact.primary") {
    return primaryContact;
  }
  if (instructionKey === "contact.secondary") {
    return secondaryContact;
  }
  return undefined;
};
