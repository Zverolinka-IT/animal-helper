import { expect, it } from "vitest";
import {
  reportGuidanceProfileSchema,
  syntheticFormSnapshot,
} from "@animal-helper/contracts";
import {
  bundledPublicGuidance,
  reportGuidanceContext,
  reportGuidanceItems,
  parsePublicGuidance,
} from "../src/index.js";

it("uses exact human circumstances before general guidance, with explicit empty overrides", () => {
  const guidance = {
    ...bundledPublicGuidance(),
    reportProfiles: [
      {
        context: "human" as const,
        warning: "General",
        instructions: "",
        contacts: [],
      },
      {
        context: "human-fire" as const,
        warning: "Fire",
        instructions: "",
        contacts: [],
      },
      {
        context: "human-fire" as const,
        kindKey: "domestic_cat",
        warning: "",
        instructions: "",
        contacts: [],
      },
    ],
  };
  expect(
    reportGuidanceContext({
      ...syntheticFormSnapshot,
      situationType: "other",
      other: { branch: "human", situation: "fire" },
    }),
  ).toBe("human-fire");
  const parsed = parsePublicGuidance(guidance);
  expect(
    reportGuidanceItems(parsed, "human-fire", "domestic_dog")[0]?.slots[
      "warning.do_not"
    ],
  ).toBe("Fire");
  expect(
    reportGuidanceItems(parsed, "human-trees")[0]?.slots["warning.do_not"],
  ).toBe("General");
  expect(reportGuidanceItems(parsed, "human-fire", "domestic_cat")).toEqual([]);
});

it("rejects unreachable species-specific road routing and keeps road choices distinct", () => {
  const profile = {
    context: "road-railway",
    warning: "",
    instructions: "",
    contacts: [],
  };
  expect(reportGuidanceProfileSchema.safeParse(profile).success).toBe(true);
  expect(
    reportGuidanceProfileSchema.safeParse({
      ...profile,
      kindKey: "domestic_cat",
    }).success,
  ).toBe(false);
  expect(
    reportGuidanceContext({
      ...syntheticFormSnapshot,
      situationType: "other",
      other: { branch: "road", situation: "railway" },
    }),
  ).toBe("road-railway");
  expect(
    reportGuidanceContext({
      ...syntheticFormSnapshot,
      situationType: "other",
      other: {
        branch: "road",
        situation: "railway",
        animalHelpRequested: true,
      },
    }),
  ).toBeUndefined();
});
