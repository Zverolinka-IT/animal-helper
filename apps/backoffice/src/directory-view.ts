import {
  contactServiceKeys,
  type ContactDirectoryEntry,
  type ContactServiceKey,
} from "@animal-helper/contracts";

export type DirectoryView = "contacts" | "clinics";

const clinicServices: readonly ContactServiceKey[] = [
  "vet_clinic",
  "vet_exotic",
];

export const directoryServices = (
  view: DirectoryView,
): readonly ContactServiceKey[] =>
  view === "clinics" ? clinicServices : contactServiceKeys;

export const matchesDirectoryView = (
  entry: Pick<ContactDirectoryEntry, "serviceKeys">,
  view: DirectoryView,
): boolean =>
  entry.serviceKeys.some((key) => directoryServices(view).includes(key));
