import {
  reportGuidanceProfilesSchema,
  type ReportGuidanceProfile,
  type FormSnapshotV1,
} from "@animal-helper/contracts";
import { findAnimalKind } from "./catalog.js";
import { copyLooksSafe } from "./copy.js";
import type { GuidanceItem, PublicGuidance } from "./content.js";
import { contactOptionPath, isContactOptionInstruction } from "./slots.js";

export function reportGuidancePaths(items: readonly GuidanceItem[]): string[] {
  return [
    ...(!items.length || items.some((item) => item.screenKey === "w14")
      ? ["/w14"]
      : []),
    ...items.flatMap((item) =>
      isContactOptionInstruction(item.instructionKey)
        ? [contactOptionPath(item.instructionKey)]
        : [],
    ),
  ];
}

export function parseReportProfiles(value: unknown): ReportGuidanceProfile[] {
  const profiles = reportGuidanceProfilesSchema.parse(value);
  for (const profile of profiles) {
    if (profile.kindKey && !findAnimalKind(profile.kindKey))
      throw new Error("unknown profile animal kind");
    if (
      ![
        profile.warning,
        profile.instructions,
        ...profile.contacts.flatMap((contact) => [contact.title, contact.body]),
      ].every(copyLooksSafe)
    )
      throw new Error("unsafe profile copy");
  }
  return profiles;
}

export function reportGuidanceContext(
  snapshot: FormSnapshotV1,
): ReportGuidanceProfile["context"] | undefined {
  if (snapshot.situationType === "stray") return "stray";
  if (snapshot.situationType === "dead")
    return snapshot.dead?.suspiciousSigns.some((sign) => sign !== "unknown")
      ? "dead-suspicious"
      : "dead";
  if (snapshot.other?.branch === "human")
    return snapshot.other.situation
      ? `human-${snapshot.other.situation}`
      : "human";
  if (snapshot.other?.branch === "road" && !snapshot.other.animalHelpRequested)
    return `road-${snapshot.other.situation}`;
  return undefined;
}

export function reportGuidanceItems(
  guidance: PublicGuidance,
  context: ReportGuidanceProfile["context"],
  kindKey?: string,
): GuidanceItem[] {
  const profile = resolveReportGuidanceProfile(
    guidance.reportProfiles ?? [],
    context,
    kindKey,
  );
  return profile ? profileItems(profile) : [];
}

export function resolveReportGuidanceProfile(
  profiles: readonly ReportGuidanceProfile[],
  context: ReportGuidanceProfile["context"],
  kindKey?: string,
): ReportGuidanceProfile | undefined {
  const match = (key: ReportGuidanceProfile["context"]) =>
    profiles.find(
      (entry) =>
        entry.context === key && !!kindKey && entry.kindKey === kindKey,
    ) ??
    profiles.find(
      (entry) => entry.context === key && entry.kindKey === undefined,
    );
  return (
    match(context) ??
    (context.startsWith("human-") ? match("human") : undefined)
  );
}

export function profileItems(profile: ReportGuidanceProfile): GuidanceItem[] {
  const items: GuidanceItem[] = [];
  if (profile.warning)
    items.push({
      screenKey: "w14",
      instructionKey: "warning.do_not",
      polarity: "do_not",
      slots: { "warning.do_not": profile.warning },
    });
  if (profile.instructions)
    items.push({
      screenKey: "w14",
      instructionKey: "warning.do_before",
      polarity: "do",
      slots: { "warning.do_before": profile.instructions },
    });
  for (const contact of profile.contacts.filter((contact) => contact.enabled)) {
    items.push({
      screenKey: "w15",
      instructionKey: `contact.option.${contact.id}`,
      polarity: "info",
      slots: { "contact.title": contact.title, "contact.body": contact.body },
      action: { kind: "call-contact", targetKey: contact.serviceKey },
      ...(contact.clinicVariant
        ? { clinicVariant: contact.clinicVariant }
        : {}),
    });
  }
  return items;
}
