import type { ContactDirectoryEntry } from "./contact-directory.js";

// Synthetic data only; never seed the production directory from these fixtures.
export const syntheticContactDirectoryEntry = (
  overrides: Partial<ContactDirectoryEntry> = {},
): ContactDirectoryEntry => ({
  id: "018f1a50-7c3b-7000-8000-000000000201",
  name: "Synthetic veterinary contact",
  serviceKeys: ["vet_clinic"],
  enabled: true,
  phone: "+421 000 000 001",
  website: "https://example.invalid/help",
  address: "Synthetic address",
  coordinates: { latitude: 48.433, longitude: 17.43 },
  coverage: {
    kind: "radius",
    center: { latitude: 48.433, longitude: 17.43 },
    radiusKm: 20,
  },
  hours: { kind: "unknown" },
  note: "Synthetic public note",
  sourceUrl: "https://example.invalid/contacts",
  verifiedOn: "2026-01-01",
  reviewDueOn: "2099-01-01",
  ...overrides,
});
