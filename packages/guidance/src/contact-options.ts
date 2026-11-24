import type { GuidanceContactOption } from "@animal-helper/contracts";
import type { GuidanceCell, GuidanceDocument } from "./content.js";
import { isContactOptionInstruction, isContactInstruction } from "./slots.js";

export const contactOptionsForKind = (
  document: GuidanceDocument,
  kindKey: string,
): GuidanceContactOption[] => {
  const cells = document.cells
    .filter(
      (cell) =>
        cell.kindKey === kindKey && isContactInstruction(cell.instructionKey),
    )
    .slice()
    .sort(
      (a, b) =>
        a.sortOrder - b.sortOrder ||
        a.instructionKey.localeCompare(b.instructionKey),
    );
  const configured = cells.filter((cell) =>
    isContactOptionInstruction(cell.instructionKey),
  );
  if (configured.length)
    return configured.map((cell) => ({
      id: cell.instructionKey.slice("contact.option.".length),
      serviceKey: cell.actionTargetKey as GuidanceContactOption["serviceKey"],
      title: cell.copy["contact.title"] ?? "",
      body: cell.copy["contact.body"] ?? "",
      enabled: cell.applicability === "on",
      ...(cell.clinicVariant ? { clinicVariant: cell.clinicVariant } : {}),
    }));
  return cells.flatMap((cell): GuidanceContactOption[] => {
    const volunteers = cell.instructionKey === "volunteers";
    const prefix =
      cell.instructionKey === "contact.primary"
        ? "contact.primary"
        : "contact.secondary";
    const service = volunteers ? "volunteers" : cell.actionTargetKey;
    if (!service || (volunteers && !cell.copy["volunteers.body"])) return [];
    return [
      {
        id: volunteers
          ? "volunteers"
          : cell.instructionKey.slice("contact.".length),
        serviceKey: service as GuidanceContactOption["serviceKey"],
        title: volunteers
          ? "Obráťte sa na dobrovoľníkov"
          : (cell.copy[`${prefix}.title`] ?? ""),
        body: volunteers
          ? (cell.copy["volunteers.body"] ?? "")
          : (cell.copy[`${prefix}.body`] ?? ""),
        enabled: cell.applicability === "on",
      },
    ];
  });
};

export const contactOptionCells = (
  kindKey: string,
  options: readonly GuidanceContactOption[],
): GuidanceCell[] =>
  options.map((option, index) => ({
    kindKey,
    instructionKey: `contact.option.${option.id}`,
    applicability: option.enabled ? "on" : "off",
    sortOrder: 30 + index,
    copy: { "contact.title": option.title, "contact.body": option.body },
    actionTargetKey: option.serviceKey,
    ...(option.clinicVariant ? { clinicVariant: option.clinicVariant } : {}),
  }));
