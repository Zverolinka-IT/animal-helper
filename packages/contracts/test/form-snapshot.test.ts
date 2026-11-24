import { describe, expect, it } from "vitest";

import {
  parseCaseCommand,
  parseFormSnapshot,
  syntheticAttachFormSnapshotCommand,
  syntheticFormSnapshot,
  toDomainCaseCommand,
} from "../src/index.js";

describe("injured/stray form snapshot v1", () => {
  it("validates stray-specific answers and rejects stale or contradictory choices", () => {
    const snapshot = {
      ...syntheticFormSnapshot,
      situationType: "stray",
      condition: {
        symptoms: [],
        behaviour: ["aggressive", "other"],
        collar: "yes",
        otherText: "Synthetic detail",
      },
    };
    expect(parseFormSnapshot(snapshot).success).toBe(true);
    expect(
      parseFormSnapshot({ ...snapshot, situationType: "injured" }).success,
    ).toBe(false);
    for (const behaviour of [
      ["unknown", "aggressive"],
      ["aggressive", "aggressive"],
      ["invalid"],
    ]) {
      expect(
        parseFormSnapshot({
          ...snapshot,
          condition: { symptoms: [], behaviour },
        }).success,
      ).toBe(false);
    }
  });

  it("validates reported outcomes without requiring optional reasons or Other text", () => {
    for (const outcome of [
      { status: "resolved", reasons: [] },
      { status: "unresolved", reasons: [] },
      { status: "unresolved", reasons: ["other"] },
      {
        status: "unresolved",
        reasons: ["clinic-closed", "other"],
        otherText: "Synthetic reason",
      },
    ])
      expect(
        parseFormSnapshot({ ...syntheticFormSnapshot, outcome }).success,
      ).toBe(true);
    for (const outcome of [
      { status: "resolved", reasons: ["clinic-closed"] },
      { status: "unresolved", reasons: ["escaped", "escaped"] },
      { status: "unresolved", reasons: [], otherText: "Unchecked Other" },
      { status: "unresolved", reasons: ["invented"] },
    ])
      expect(
        parseFormSnapshot({ ...syntheticFormSnapshot, outcome }).success,
      ).toBe(false);
  });
  it("stores who helped only on a resolved injured report", () => {
    expect(
      parseFormSnapshot({
        ...syntheticFormSnapshot,
        outcome: { status: "resolved", reasons: [] },
        whoHelped: { choice: "Veterinár / klinika" },
      }).success,
    ).toBe(true);
    expect(
      parseFormSnapshot({
        ...syntheticFormSnapshot,
        outcome: { status: "resolved", reasons: [] },
        whoHelped: { choice: "Iné", detail: "Sused" },
      }).success,
    ).toBe(true);
    expect(
      parseFormSnapshot({
        ...syntheticFormSnapshot,
        outcome: { status: "unresolved", reasons: [] },
        whoHelped: { choice: "Veterinár / klinika" },
      }).success,
    ).toBe(false);
    expect(
      parseFormSnapshot({
        ...syntheticFormSnapshot,
        outcome: { status: "resolved", reasons: [] },
        whoHelped: { choice: "Obec", detail: "Sused" },
      }).success,
    ).toBe(false);
  });
  it("accepts the synthetic happy-path snapshot and strips it from the domain command", () => {
    const parsed = parseCaseCommand(syntheticAttachFormSnapshotCommand);
    expect(parsed.success).toBe(true);
    if (!parsed.success) {
      throw new Error("expected form snapshot fixture to parse");
    }

    if (parsed.data.type !== "attach_private_data") {
      throw new Error("expected attach command");
    }

    expect(parsed.data.kind).toBe("form_snapshot");
    expect(toDomainCaseCommand(parsed.data)).toEqual({
      type: "attach_private_data",
      privateRecordId: syntheticAttachFormSnapshotCommand.privateRecordId,
      kind: "form_snapshot",
    });
    expect(JSON.stringify(toDomainCaseCommand(parsed.data))).not.toContain(
      "domestic_cat",
    );
  });

  it("rejects deferred situation types and unidentified species without a kind", () => {
    expect(
      parseFormSnapshot({
        ...syntheticFormSnapshot,
        situationType: "cruelty",
      }).success,
    ).toBe(false);
    expect(
      parseFormSnapshot({
        ...syntheticFormSnapshot,
        species: { source: "manual" },
      }).success,
    ).toBe(false);
  });

  it("rejects conflicting unknown answers and accepts an optional Other description", () => {
    expect(
      parseFormSnapshot({
        ...syntheticFormSnapshot,
        condition: {
          symptoms: ["unknown", "bleeding"],
          conscious: "yes",
          isJuvenile: "no",
        },
      }).success,
    ).toBe(false);
    expect(
      parseFormSnapshot({
        ...syntheticFormSnapshot,
        condition: {
          symptoms: ["other"],
          conscious: "yes",
          isJuvenile: "no",
        },
      }).success,
    ).toBe(true);
    expect(
      parseFormSnapshot({
        ...syntheticFormSnapshot,
        condition: {
          symptoms: ["other"],
          otherText: "synthetic-other-injury",
          conscious: "unknown",
          isJuvenile: "unknown",
        },
      }).success,
    ).toBe(true);
  });

  it("rejects extra fields and a skipped-photo snapshot is still valid", () => {
    expect(
      parseFormSnapshot({
        ...syntheticFormSnapshot,
        email: "someone@example.com",
      }).success,
    ).toBe(false);
    expect(
      parseFormSnapshot({
        schemaVersion: 1,
        situationType: "stray",
        species: { source: "skipped" },
        condition: { symptoms: [] },
        mediaRecordIds: [],
      }).success,
    ).toBe(true);
  });
});

it("validates each new flow and rejects incompatible or conflicting answers", () => {
  const base = { ...syntheticFormSnapshot, condition: { symptoms: [] } };
  const reports = [
    {
      ...base,
      situationType: "dead",
      dead: { suspiciousSigns: ["bait"], animalCount: "multiple" },
    },
    {
      ...base,
      situationType: "cruelty",
      cruelty: {
        acute: true,
        signs: ["burned"],
        police: { outcome: "not-reported", reasons: ["refused"] },
      },
    },
    {
      ...base,
      situationType: "other",
      other: { branch: "human", situation: "trapped" },
    },
    {
      ...base,
      situationType: "other",
      other: {
        branch: "road",
        situation: "railway",
        serviceReport: { reasons: ["unanswered"] },
      },
    },
    {
      ...base,
      situationType: "other",
      other: { branch: "other", description: "Synthetic situation" },
    },
  ];
  for (const report of reports)
    expect(parseFormSnapshot(report).success).toBe(true);
  for (const report of [
    { ...reports[0], dead: { suspiciousSigns: ["unknown", "bait"] } },
    { ...reports[1], cruelty: { acute: false, signs: ["burned"] } },
    {
      ...reports[1],
      cruelty: {
        acute: true,
        signs: [],
        police: { outcome: "reported", reasons: ["refused"] },
      },
    },
    { ...reports[2], other: { branch: "human", situation: "railway" } },
    {
      ...reports[3],
      other: {
        branch: "road",
        situation: "railway",
        description: "unchecked other",
      },
    },
    { ...reports[0], situationType: "injured" },
  ])
    expect(parseFormSnapshot(report).success).toBe(false);
});
