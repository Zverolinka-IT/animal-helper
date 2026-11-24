import { describe, expect, it } from "vitest";

import {
  applyAdminCommand,
  appFactsFromRecords,
  caseNumber,
  initialAdminDocument,
  isUnread,
} from "../src/admin-case.js";

describe("admin case workspace", () => {
  it("clears superseded species, free text and coordinates when the reporter corrects them", () => {
    const facts = appFactsFromRecords([
      {
        kind: "form_snapshot",
        payload: {
          species: { kindKey: "domestic_cat" },
          condition: {
            symptoms: ["other"],
            otherText: "Synthetic earlier text",
          },
        },
      },
      {
        kind: "location",
        payload: {
          address: "Synthetic old address",
          coordinates: { latitude: 48, longitude: 17 },
        },
      },
      {
        kind: "form_snapshot",
        payload: {
          species: { source: "failed" },
          condition: { symptoms: ["unknown"] },
        },
      },
      { kind: "location", payload: { address: "Synthetic corrected address" } },
    ]);
    expect(facts).toMatchObject({
      speciesKey: "",
      description: "",
      address: "Synthetic corrected address",
      symptoms: ["unknown"],
    });
    expect(facts.latitude).toBeUndefined();
    expect(facts.longitude).toBeUndefined();
  });
  it("reads the reporter payload and hides the newsletter flag", () => {
    const facts = appFactsFromRecords([
      {
        kind: "form_snapshot",
        payload: {
          situationType: "injured",
          species: { source: "manual", kindKey: "domestic_cat" },
          condition: { symptoms: ["bleeding"], otherText: "Poranená labka" },
        },
      },
      {
        kind: "location",
        payload: {
          address: "Dolné Orešany",
          coordinates: { latitude: 48.43, longitude: 17.43 },
        },
      },
      {
        kind: "contact",
        payload: {
          name: "Test",
          email: "test@example.org",
          shareWithAuthorities: true,
          newsletter: true,
        },
      },
      { kind: "media_ref", payload: { contentType: "image/jpeg" } },
    ]);

    expect(facts).toMatchObject({
      situationType: "injured",
      speciesKey: "domestic_cat",
      address: "Dolné Orešany",
      description: "Poranená labka",
      reporterName: "Test",
      shareWithAuthorities: true,
      mediaCount: 1,
    });
    expect(facts).not.toHaveProperty("newsletter");
  });

  it("starts cruelty as active work and injured as a passive record", () => {
    expect(initialAdminDocument("cruelty").mode).toBe("active");
    expect(initialAdminDocument("injured").mode).toBe("passive");
  });

  it("lets an admin take over a passive case and then record work", () => {
    const passive = initialAdminDocument("injured");
    const taken = applyAdminCommand(passive, {
      type: "take_over",
      at: "2026-09-28T12:00:00.000Z",
      email: "admin@example.org",
    });
    expect(taken.ok && taken.document.mode).toBe("active");
    if (!taken.ok) {
      return;
    }
    const noted = applyAdminCommand(taken.document, {
      type: "add_action",
      id: "action-1",
      at: "2026-09-28T12:05:00.000Z",
      email: "admin@example.org",
      kind: "call",
      result: "Volané RVPS",
    });
    expect(noted.ok && noted.document.actions).toHaveLength(1);
    expect(applyAdminCommand(passive, { type: "close" }).ok).toBe(false);
  });

  it("marks a case unread until this admin opens it", () => {
    const document = initialAdminDocument("stray");
    const updated = "2026-09-28T12:00:00.000Z";
    expect(isUnread(document, "admin@example.org", updated)).toBe(true);
    const seen = applyAdminCommand(document, {
      type: "seen",
      at: updated,
      email: "admin@example.org",
    });
    expect(
      seen.ok && isUnread(seen.document, "admin@example.org", updated),
    ).toBe(false);
  });

  it("builds a stable case number from the stream id", () => {
    expect(
      caseNumber(
        "6f1b0c2e-1a4d-4f2a-9c3b-8e7d6a5b4c3d",
        new Date("2026-09-28T12:00:00.000Z"),
      ),
    ).toBe("ZV-2026-6F1B0C2E");
  });
});

it("does not retain a superseded outcome when a newer snapshot has no outcome", async () => {
  const { syntheticFormSnapshot } = await import("@animal-helper/contracts");
  const previous = {
    kind: "form_snapshot",
    payload: {
      ...syntheticFormSnapshot,
      outcome: {
        status: "unresolved",
        reasons: ["other"],
        otherText: "Old reason",
      },
    },
  };
  expect(appFactsFromRecords([previous]).outcome?.otherText).toBe("Old reason");
  expect(
    appFactsFromRecords([
      previous,
      { kind: "form_snapshot", payload: syntheticFormSnapshot },
    ]).outcome,
  ).toBeUndefined();
});
