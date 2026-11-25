import {
  syntheticContactDirectoryEntry,
  type PublicContactDirectory,
} from "@animal-helper/contracts";
import { describe, expect, it } from "vitest";
import {
  authorityContactsFor,
  municipalityOfficeFor,
  contactAvailability,
  distanceKm,
  districtForPlace,
  navigationHref,
  parseContactBoundary,
  phoneHref,
  selectContacts,
  slovakDate,
  veterinaryClinicsFor,
} from "../src/index.js";

const now = new Date("2026-10-20T10:00:00Z");
const location = { latitude: 48.433, longitude: 17.43 };
const directory = (
  entries: PublicContactDirectory["entries"],
): PublicContactDirectory => ({
  schemaVersion: 1,
  jurisdiction: "SK",
  revisionId: "018f1a50-7c3b-7000-8000-000000000101",
  publishedAt: now.toISOString(),
  entries,
});

describe("published public contact selection", () => {
  it("filters service, territory, disabled and expired entries before sorting by distance", () => {
    const near = syntheticContactDirectoryEntry();
    const far = syntheticContactDirectoryEntry({
      id: "018f1a50-7c3b-7000-8000-000000000202",
      coordinates: { latitude: 48.45, longitude: 17.43 },
    });
    const excluded = [
      { ...near, enabled: false },
      { ...near, serviceKeys: ["volunteers" as const] },
      { ...near, reviewDueOn: "2026-10-19" },
      { ...near, verifiedOn: "2026-10-21" },
      { ...near, phone: "", website: "" },
      {
        ...near,
        coverage: {
          kind: "radius" as const,
          center: { latitude: 49, longitude: 20 },
          radiusKm: 1,
        },
      },
    ];
    expect(
      selectContacts(
        directory([far, ...excluded, near]),
        "vet_clinic",
        location,
        now,
      ).map((item) => item.entry.id),
    ).toEqual([near.id, far.id]);
    expect(distanceKm(location, location)).toBe(0);
    expect(distanceKm(location, far.coordinates ?? location)).toBeGreaterThan(
      1,
    );
  });

  it("offers a district contact only in the districts named on the entry", () => {
    const regional = syntheticContactDirectoryEntry({
      serviceKeys: ["sop_rescue"],
      coverage: { kind: "districts", districts: ["Trnava"] },
      coordinates: undefined,
    });
    expect(
      selectContacts(
        directory([regional]),
        "sop_rescue",
        undefined,
        now,
        "Trnava",
      ).map((item) => item.entry.id),
    ).toEqual([regional.id]);
    expect(
      selectContacts(
        directory([regional]),
        "sop_rescue",
        location,
        now,
        "Pezinok",
      ),
    ).toEqual([]);
    expect(
      selectContacts(directory([regional]), "sop_rescue", location, now),
    ).toEqual([]);
  });

  it("keeps national hotlines usable without GPS and never substitutes an out-of-area service", () => {
    const regional = syntheticContactDirectoryEntry();
    const national = syntheticContactDirectoryEntry({
      coverage: { kind: "national" },
      coordinates: undefined,
    });
    expect(
      selectContacts(directory([regional]), "vet_clinic", undefined, now),
    ).toEqual([]);
    expect(
      selectContacts(directory([national]), "vet_clinic", undefined, now),
    ).toHaveLength(1);
    expect(selectContacts(undefined, "vet_clinic", location, now)).toEqual([]);
    expect(navigationHref(national)).toContain("Synthetic%20address");
    expect(navigationHref({ ...national, address: "" })).toBeUndefined();
    expect(phoneHref("+421 (000) 000-001")).toBe("tel:+421000000001");
    expect(phoneHref("112?body=anything")).toBeUndefined();
  });

  it("uses exact municipality boundaries including holes and multiple areas", () => {
    const geometry = parseContactBoundary({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [17, 48],
                [18, 48],
                [18, 49],
                [17, 49],
                [17, 48],
              ],
              [
                [17.1, 48.1],
                [17.2, 48.1],
                [17.2, 48.2],
                [17.1, 48.2],
                [17.1, 48.1],
              ],
            ],
          },
        },
      ],
    });
    const entry = syntheticContactDirectoryEntry({
      coverage: { kind: "boundary", geometry },
    });
    const contacts = directory([entry]);
    expect(selectContacts(contacts, "vet_clinic", location, now)).toHaveLength(
      1,
    );
    expect(
      selectContacts(
        contacts,
        "vet_clinic",
        { latitude: 48.15, longitude: 17.15 },
        now,
      ),
    ).toEqual([]);
    expect(
      selectContacts(
        contacts,
        "vet_clinic",
        { latitude: 49.01, longitude: 17.15 },
        now,
      ),
    ).toEqual([]);
    expect(selectContacts(contacts, "vet_clinic", undefined, now)).toEqual([]);
    expect(() =>
      parseContactBoundary({
        type: "Polygon",
        coordinates: [
          [
            [17, 48],
            [18, 49],
            [17, 49],
          ],
        ],
      }),
    ).toThrow();
  });
});

describe("Slovak opening hours", () => {
  it("calculates local time, inclusive opening, exclusive closing and closing soon", () => {
    const hours = {
      kind: "weekly" as const,
      intervals: [{ day: 1, opens: "08:00", closes: "16:00" }],
    };
    expect(
      contactAvailability(hours, new Date("2026-10-20T06:00:00Z")).tone,
    ).toBe("open");
    expect(
      contactAvailability(hours, new Date("2026-10-20T13:00:00Z")).tone,
    ).toBe("closing");
    expect(
      contactAvailability(hours, new Date("2026-10-20T14:00:00Z")).tone,
    ).toBe("closed");
    expect(contactAvailability({ kind: "always" }, now).label).toBe("Nonstop");
    expect(contactAvailability({ kind: "unknown" }, now).tone).toBe("unknown");
  });

  it("handles Sunday overnight, winter/summer time, and adjacent shifts", () => {
    const overnight = {
      kind: "weekly" as const,
      intervals: [{ day: 6, opens: "22:00", closes: "02:00" }],
    };
    expect(
      contactAvailability(overnight, new Date("2026-10-19T23:00:00+02:00"))
        .tone,
    ).toBe("closed");
    expect(
      contactAvailability(overnight, new Date("2026-10-19T01:00:00+02:00"))
        .tone,
    ).toBe("closing");
    const shifts = {
      kind: "weekly" as const,
      intervals: [
        { day: 1, opens: "08:00", closes: "12:00" },
        { day: 1, opens: "12:00", closes: "16:00" },
      ],
    };
    expect(contactAvailability(shifts, now)).toEqual({
      tone: "open",
      label: "Otvorené · do 16:00",
    });
    const winter = {
      kind: "weekly" as const,
      intervals: [{ day: 0, opens: "08:00", closes: "16:00" }],
    };
    expect(
      contactAvailability(winter, new Date("2026-12-21T07:00:00Z")).tone,
    ).toBe("open");
    expect(slovakDate(new Date("2026-10-19T23:00:00Z"))).toBe("2026-10-20");
  });
});

describe("municipality offices", () => {
  it("returns the phones and police flag for a uniquely named municipality", () => {
    expect(municipalityOfficeFor("Dolné Orešany")).toMatchObject({
      name: "Dolné Orešany",
      district: "Trnava",
      phone: "033 558 21 01",
      note: "0910 571 826",
      police: false,
    });
    expect(municipalityOfficeFor("Banská Bystrica")).toMatchObject({
      police: true,
      phone: "048 4330 321",
    });
    expect(municipalityOfficeFor("Breznička")).toBeUndefined();
    expect(municipalityOfficeFor(undefined)).toBeUndefined();
  });
});

describe("veterinary clinics", () => {
  const saturday = new Date("2026-11-21T10:00:00+01:00");

  it("shows today's written hours for clinics in the district that treat the animal group", () => {
    const clinics = veterinaryClinicsFor("Trnava", ["Domáce"], saturday);
    const fg = clinics.find((clinic) => clinic.name.startsWith("FG Vet"));
    expect(fg).toMatchObject({
      phone: "033 550 16 09",
      note: "Dnes: 09:00–14:00\n0905 781 394\nPohotovosť: Áno",
      district: "Trnava",
    });
    expect(clinics.some((clinic) => clinic.district !== "Trnava")).toBe(false);
    const nearest = veterinaryClinicsFor("Trnava", ["Domáce"], saturday, {
      latitude: 48.433,
      longitude: 17.43,
    });
    expect(nearest[0]?.name).toContain("Zvončín");
    expect(nearest[0]?.distanceKm).toBeLessThan(
      nearest.at(-1)?.distanceKm ?? 0,
    );
    expect(
      nearest.every(
        (clinic, index) =>
          index === 0 ||
          (nearest[index - 1]?.distanceKm ?? Number.POSITIVE_INFINITY) <=
            (clinic.distanceKm ?? Number.POSITIVE_INFINITY),
      ),
    ).toBe(true);
    const birds = veterinaryClinicsFor("Trnava", ["Vtáky"], saturday);
    expect(birds.some((clinic) => clinic.name.startsWith("FG Vet"))).toBe(
      false,
    );
    expect(birds.map((clinic) => clinic.name)).toContain(
      "MVDr. Juraj Horváth – veterinárna ambulancia",
    );
    expect(veterinaryClinicsFor(undefined, ["Domáce"], saturday)).toEqual([]);
    expect(
      veterinaryClinicsFor("Košice - okolie", ["Domáce"], saturday).length,
    ).toBeGreaterThan(0);
  });
});

describe("ŠOP and hunting-chamber territory", () => {
  it("resolves a municipality to its district and leaves a repeated name unresolved", () => {
    expect(districtForPlace("Dolné Orešany")).toBe("Trnava");
    expect(districtForPlace("Hlavná 1, Dolné Orešany")).toBe("Trnava");
    expect(districtForPlace("Jablonové")).toBeUndefined();
    expect(districtForPlace("Moja poloha")).toBeUndefined();
  });

  it("lists the office that covers the district, including every number from the sheet", () => {
    expect(authorityContactsFor("sop_rescue", "Trnava")).toEqual([
      expect.objectContaining({
        name: "Správa CHKO Malé Karpaty",
        phone: "0911 011 384",
        note: "Pohotovosť: 0911 011 384, 0911 390 170\nTelefón: 033 647 40 02",
      }),
    ]);
    expect(authorityContactsFor("hunting_manager_or_opk", "Trnava")).toEqual([
      expect.objectContaining({
        name: "OPK Trnava",
        phone: "0910 668 948",
        note: "Všeobecný kontakt: 0910 668 948, 033 551 10 82",
      }),
    ]);
    const roznava = authorityContactsFor(
      "hunting_manager_or_opk",
      "Rožňava",
    )[0];
    expect(roznava?.phone).toBe("0917 803 019");
    expect(roznava?.note).toContain("é58 381 01 64");
    expect(authorityContactsFor("sop_rescue", undefined)).toEqual([]);
    expect(authorityContactsFor("sop_rescue", "Trnava")).toHaveLength(1);
    expect(
      authorityContactsFor("sop_rescue", "Pezinok").length,
    ).toBeGreaterThan(0);
  });
});
