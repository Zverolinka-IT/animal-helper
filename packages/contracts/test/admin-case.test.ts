import { describe, expect, it } from "vitest";

import { adminCaseRequestSchema, adminCaseSearchSchema } from "../src/index.js";

const request = {
  schemaVersion: 1,
  commandId: "018f1a50-7c3b-7000-8000-000000000101",
  expectedRevision: 0,
  command: {
    type: "set_work",
    urgency: "normal",
    nextStep: "",
    deadline: "2026-10-19T12:30",
    note: "Synthetic note",
  },
};

describe("admin case write boundary", () => {
  it("accepts local deadlines and rejects unknown fields, invalid enums and excessive text", () => {
    expect(adminCaseRequestSchema.safeParse(request).success).toBe(true);
    for (const command of [
      { ...request.command, ownerEmail: "someone@example.invalid" },
      { ...request.command, urgency: "arbitrary" },
      { ...request.command, note: "x".repeat(4001) },
      { ...request.command, deadline: "not-a-date" },
    ])
      expect(
        adminCaseRequestSchema.safeParse({ ...request, command }).success,
      ).toBe(false);
    expect(
      adminCaseRequestSchema.safeParse({ ...request, expectedRevision: -1 })
        .success,
    ).toBe(false);
  });
});

it("accepts bounded text and email searches and rejects invalid paging or extra fields", () => {
  expect(
    adminCaseSearchSchema.parse({
      schemaVersion: 1,
      reporterEmail: "  @Example.org  ",
    }),
  ).toEqual({
    schemaVersion: 1,
    reporterEmail: "@Example.org",
    ownerEmail: "",
    query: "",
    page: 0,
  });
  expect(
    adminCaseSearchSchema.parse({
      schemaVersion: 1,
      query: " Žilina ",
      ownerEmail: " Admin@ ",
    }),
  ).toMatchObject({ query: "Žilina", ownerEmail: "Admin@", reporterEmail: "" });
  for (const input of [
    { page: -1 },
    { page: 1.5 },
    { page: 1_000_000 },
    { reporterEmail: "x".repeat(321) },
    { reporterEmail: null },
    { ownerEmail: "x".repeat(321) },
    { ownerEmail: null },
    { query: "x".repeat(501) },
    { query: null },
    { unexpected: true },
  ])
    expect(
      adminCaseSearchSchema.safeParse({
        schemaVersion: 1,
        reporterEmail: "",
        ...input,
      }).success,
    ).toBe(false);
});
