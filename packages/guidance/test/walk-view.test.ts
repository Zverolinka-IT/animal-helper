import { describe, expect, it } from "vitest";

import { parseWalkView } from "@animal-helper/contracts";

import {
  bundledPublicGuidance,
  resumeWalkView,
  walkViewAfterPath,
  walkViewForPath,
  type WalkFacts,
} from "../src/index.js";

const facts = (patch: Partial<WalkFacts> = {}): WalkFacts => ({
  situationType: "injured",
  hasDraft: false,
  hasLocation: false,
  photoDone: false,
  hasFormSnapshot: false,
  hasContact: false,
  submitted: false,
  ...patch,
});

describe("customer walk view resolver", () => {
  it("resumes from durable facts without a live command response", () => {
    const guidance = bundledPublicGuidance();
    expect(resumeWalkView(facts(), guidance)).toMatchObject({
      screen: "situation",
      props: { situations: ["injured", "stray", "cruelty", "other"] },
    });
    expect(resumeWalkView(facts({ hasDraft: true }), guidance).path).toBe(
      "/w03",
    );
    expect(
      resumeWalkView(facts({ hasDraft: true, hasLocation: true }), guidance)
        .path,
    ).toBe("/w04");
    expect(
      resumeWalkView(
        facts({ hasDraft: true, hasLocation: true, photoDone: true }),
        guidance,
      ).path,
    ).toBe("/w09");
    expect(
      resumeWalkView(
        facts({
          hasDraft: true,
          hasLocation: true,
          photoDone: true,
          hasFormSnapshot: true,
          kindKey: "domestic_cat",
        }),
        guidance,
      ),
    ).toMatchObject({ screen: "guide", path: "/w14" });
    expect(
      resumeWalkView(
        facts({ submitted: true, publicState: "received" }),
        guidance,
      ).screen,
    ).toBe("thanks");
  });

  it("advances after each completed path using the same document", () => {
    const guidance = bundledPublicGuidance();
    const afterSituation = walkViewAfterPath(
      "/w01",
      facts({ hasDraft: true }),
      guidance,
    );
    const afterLocation = walkViewAfterPath(
      "/w03",
      facts({ hasDraft: true, hasLocation: true }),
      guidance,
    );
    const afterPhoto = walkViewAfterPath(
      "/w04",
      facts({ hasDraft: true, hasLocation: true, photoDone: true }),
      guidance,
    );
    const afterDetails = walkViewAfterPath(
      "/w09",
      facts({
        hasDraft: true,
        hasLocation: true,
        photoDone: true,
        hasFormSnapshot: true,
        kindKey: "domestic_cat",
      }),
      guidance,
    );
    const afterTiger = walkViewAfterPath(
      "/w09",
      facts({
        hasDraft: true,
        hasLocation: true,
        photoDone: true,
        hasFormSnapshot: true,
        kindKey: "exotic_tiger",
      }),
      guidance,
    );

    expect(afterSituation?.path).toBe("/w03");
    expect(afterLocation?.path).toBe("/w04");
    expect(afterPhoto?.path).toBe("/w09");
    expect(afterDetails).toMatchObject({
      screen: "guide",
      path: "/w14",
      allowedCommands: ["continue"],
    });
    expect(afterTiger?.path).toBe("/w20");
    expect(afterDetails && parseWalkView(afterDetails).success).toBe(true);
    expect(
      afterDetails?.screen === "guide" && afterDetails.props.items.length,
    ).toBeGreaterThan(0);
  });

  it("puts kinds and field errors on the details document", () => {
    const view = walkViewForPath(
      "/w09",
      facts({
        situationType: "injured",
        fieldErrors: [{ path: "species.kindKey", code: "REQUIRED" }],
      }),
      bundledPublicGuidance(),
    );
    expect(view?.screen).toBe("details");
    if (view?.screen !== "details") {
      throw new Error("expected details walk view");
    }
    expect(view.allowedCommands).toEqual(["attach_form_snapshot"]);
    expect(view.props.kinds.some((kind) => kind.key === "domestic_cat")).toBe(
      true,
    );
    expect(view.fieldErrors).toEqual([
      { path: "species.kindKey", code: "REQUIRED" },
    ]);
  });
});
