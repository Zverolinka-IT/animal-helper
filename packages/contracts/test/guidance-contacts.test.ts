import { expect, it } from "vitest";
import { adminGuidanceContactsSchema } from "../src/index.js";

const option = {
  id: "first",
  serviceKey: "vet_clinic",
  title: "Veterinár",
  body: "Pokyny",
  enabled: true,
};
const request = {
  expectedHash: "a".repeat(64),
  kindKey: "domestic_cat",
  options: [option],
};
it("accepts ordered contact options including vets, volunteers and emergency services", () => {
  const parsed = adminGuidanceContactsSchema.parse({
    ...request,
    options: [option, { ...option, id: "second", serviceKey: "volunteers" }],
  });
  expect(parsed.options.map((item) => item.id)).toEqual(["first", "second"]);
});
it("rejects empty or fully disabled lists, duplicate IDs, unknown services and extra fields", () => {
  for (const options of [
    [],
    [{ ...option, enabled: false }],
    [option, option],
    [{ ...option, id: "../invalid" }],
    [{ ...option, serviceKey: "invented" }],
    [{ ...option, telephone: "123" }],
  ]) {
    expect(
      adminGuidanceContactsSchema.safeParse({ ...request, options }).success,
    ).toBe(false);
  }
});
