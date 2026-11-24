import { describe, expect, it } from "vitest";
import {
  contactDirectoryDocumentSchema,
  contactDirectoryEntrySchema,
  contactDirectoryIssues,
  parseSlovakDistricts,
  splitContactPhones,
  syntheticContactDirectoryEntry,
  contactDirectoryRequestSchema,
  planContactImport,
} from "../src/index.js";

describe("contact-directory boundary", () => {
  it("imports hidden contacts additively, skips exact identities, and rejects ID collisions", () => {
    const original = syntheticContactDirectoryEntry();
    const duplicate = {
      ...original,
      id: crypto.randomUUID(),
      name: original.name.toUpperCase(),
      phone: original.phone.replace(/ /gu, ""),
      enabled: false,
    };
    const added = {
      ...original,
      id: crypto.randomUUID(),
      address: "Another branch",
      enabled: false,
    };
    const secondDuplicate = { ...added, id: crypto.randomUUID() };
    expect(
      planContactImport([original], [duplicate, added, secondDuplicate]),
    ).toEqual({
      added: [added],
      duplicates: [duplicate, secondDuplicate],
    });
    expect(original.enabled).toBe(true);
    expect(() =>
      planContactImport(
        [original],
        [{ ...original, name: "Different contact" }],
      ),
    ).toThrow("import_id_conflict");
    const request = {
      schemaVersion: 1,
      commandId: crypto.randomUUID(),
      expectedRevision: 0,
      command: { type: "import_entries", entries: [added] },
    };
    expect(contactDirectoryRequestSchema.safeParse(request).success).toBe(true);
    expect(
      contactDirectoryRequestSchema.safeParse({
        ...request,
        command: { type: "import_entries", entries: [original] },
      }).success,
    ).toBe(false);
    expect(
      contactDirectoryRequestSchema.safeParse({
        ...request,
        command: { type: "import_entries", entries: [added, added] },
      }).success,
    ).toBe(false);
  });
  it("allows incomplete drafts and identifies why an active entry cannot be published", () => {
    const entry = syntheticContactDirectoryEntry({
      phone: "",
      website: "",
      sourceUrl: "",
      verifiedOn: "",
      reviewDueOn: "",
    });
    expect(contactDirectoryEntrySchema.safeParse(entry).success).toBe(true);
    expect(
      contactDirectoryIssues(
        { schemaVersion: 1, jurisdiction: "SK", entries: [entry] },
        "2026-10-20",
      ),
    ).toEqual([
      {
        id: entry.id,
        fields: ["contact", "sourceUrl", "verifiedOn", "reviewDueOn"],
      },
    ]);
    expect(
      contactDirectoryIssues(
        {
          schemaVersion: 1,
          jurisdiction: "SK",
          entries: [{ ...entry, enabled: false }],
        },
        "2026-10-20",
      ),
    ).toEqual([]);
  });

  it("rejects executable links, embedded credentials, invalid coordinates, times and duplicate IDs", () => {
    for (const patch of [
      { website: "javascript:alert(1)" },
      { sourceUrl: "https://user:secret@example.invalid" },
      { phone: "112?body=secret" },
      { phone: "1 ()" },
      { name: "<script>" },
      { coordinates: { latitude: 91, longitude: 17 } },
      {
        hours: {
          kind: "weekly",
          intervals: [{ day: 0, opens: "24:00", closes: "09:00" }],
        },
      },
      {
        hours: {
          kind: "weekly",
          intervals: [{ day: 0, opens: "09:00", closes: "09:00" }],
        },
      },
      { hours: { kind: "weekly", intervals: [] } },
    ])
      expect(
        contactDirectoryEntrySchema.safeParse({
          ...syntheticContactDirectoryEntry(),
          ...patch,
        }).success,
      ).toBe(false);
    const entry = syntheticContactDirectoryEntry();
    expect(
      contactDirectoryDocumentSchema.safeParse({
        schemaVersion: 1,
        jurisdiction: "SK",
        entries: [entry, entry],
      }).success,
    ).toBe(false);
  });

  it("splits several phone numbers and keeps a value that is not a phone number", () => {
    expect(splitContactPhones("033 647 40 02")).toEqual({
      valid: ["033 647 40 02"],
      invalid: [],
    });
    expect(splitContactPhones("0911 011 384\n0911 390 170").valid).toEqual([
      "0911 011 384",
      "0911 390 170",
    ]);
    expect(splitContactPhones("0917 803 019\né58 381 01 64")).toEqual({
      valid: ["0917 803 019"],
      invalid: ["é58 381 01 64"],
    });
    expect(parseSlovakDistricts("Pezinok; Košice-okolie")).toEqual({
      ok: true,
      districts: ["Pezinok", "Košice - okolie"],
    });
    expect(parseSlovakDistricts("Atlantída").ok).toBe(false);
  });

  it("requires district coverage before an authority contact can be published", () => {
    const entry = syntheticContactDirectoryEntry({
      serviceKeys: ["sop_rescue"],
      coverage: { kind: "districts", districts: ["Trnava"] },
    });
    expect(contactDirectoryEntrySchema.safeParse(entry).success).toBe(true);
    expect(
      contactDirectoryIssues(
        {
          schemaVersion: 1,
          jurisdiction: "SK",
          entries: [
            syntheticContactDirectoryEntry({ serviceKeys: ["sop_rescue"] }),
          ],
        },
        "2026-10-20",
      )[0]?.fields,
    ).toEqual(["districts"]);
  });

  it("requires real review dates and region-limited municipal contacts", () => {
    const entry = syntheticContactDirectoryEntry({
      serviceKeys: ["municipality_capture"],
      coverage: { kind: "national" },
      verifiedOn: "2026-10-21",
      reviewDueOn: "2026-10-19",
    });
    expect(
      contactDirectoryIssues(
        { schemaVersion: 1, jurisdiction: "SK", entries: [entry] },
        "2026-10-20",
      )[0]?.fields,
    ).toEqual(["verifiedOn", "reviewDueOn", "coverage"]);
  });
});
