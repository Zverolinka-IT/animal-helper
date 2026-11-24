import { describe, expect, it } from "vitest";
import { reportGuidanceContexts } from "@animal-helper/contracts";
import { profileItems, type GuidanceItem } from "@animal-helper/guidance";
import {
  guidancePreview,
  type GuidancePreview,
} from "../src/guidance-preview.js";

const contacts: GuidanceItem[] = profileItems({
  context: "stray",
  warning: "Reviewed warning",
  instructions: "",
  contacts: [
    {
      id: "first",
      serviceKey: "municipality_capture",
      title: "First contact",
      body: "Instructions",
      enabled: true,
    },
    {
      id: "second",
      serviceKey: "vet_clinic",
      title: "Second contact",
      body: "Instructions",
      enabled: true,
    },
    {
      id: "disabled",
      serviceKey: "police",
      title: "Disabled",
      body: "",
      enabled: false,
    },
  ],
});
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Missing expected preview screen");
  return value;
}
const screen = (walk: GuidancePreview, id: string) =>
  required(walk.screens.find((entry) => entry.id === id));
function trace(walk: GuidancePreview, choices: string[]) {
  let id = walk.start;
  const paths: string[] = [];
  for (const label of choices) {
    const current = screen(walk, id);
    paths.push(current.path);
    const target = current.transitions.find(
      (transition) => transition.label === label,
    )?.target;
    if (!target) throw new Error(`Choice ${label} missing from ${id}`);
    id = target;
  }
  paths.push(screen(walk, id).path);
  return { id, paths };
}

describe("guidance transition preview", () => {
  it("has reachable, valid targets for every flow and configured circumstance", () => {
    const walks = [
      guidancePreview({
        situation: "injured",
        kindKey: "domestic_cat",
        items: contacts,
      }),
      guidancePreview({ situation: "cruelty", items: [] }),
      ...reportGuidanceContexts.map((context) =>
        guidancePreview({
          situation:
            context === "stray"
              ? "stray"
              : context.startsWith("dead")
                ? "dead"
                : "other",
          context,
          items: contacts,
        }),
      ),
    ];
    for (const walk of walks) {
      const ids = new Set(walk.screens.map((entry) => entry.id));
      expect(ids.size).toBe(walk.screens.length);
      expect(ids.has(walk.start)).toBe(true);
      for (const entry of walk.screens) {
        for (const transition of entry.transitions)
          expect(ids.has(transition.target)).toBe(true);
      }
      expect(walk.screens.some((entry) => entry.path === "/w05")).toBe(false);
    }
  });

  it("shows ordered enabled contacts and the final failure form for a non-road flow", () => {
    const walk = guidancePreview({
      situation: "stray",
      context: "stray",
      items: contacts,
    });
    const first = required(
      walk.screens.find((entry) => entry.path === "/contacts/first"),
    );
    const second = required(
      walk.screens.find((entry) => entry.path === "/contacts/second"),
    );
    expect(first.transitions).toContainEqual({
      label: "Iné možnosti / nepodarilo sa pomôcť",
      target: second.id,
    });
    expect(second.transitions).toContainEqual({
      label: "Iné možnosti / nepodarilo sa pomôcť",
      target: "w25",
    });
    expect(walk.screens.some((entry) => entry.path.includes("disabled"))).toBe(
      false,
    );
    expect(screen(walk, "warning").items[0]?.slots["warning.do_not"]).toBe(
      "Reviewed warning",
    );
  });

  it("retains the full report path when reviewed guidance is empty", () => {
    const walk = guidancePreview({
      situation: "dead",
      context: "dead-suspicious",
      items: [],
    });
    expect(
      trace(walk, [
        "Nález mŕtveho zvieraťa",
        "Potvrdiť polohu",
        "Nemám fotografiu",
        "Potvrdiť voľbu",
        "Potvrdiť údaje",
        "Pokračovať",
        "Odoslať a ukončiť",
      ]).id,
    ).toBe("received");
  });

  it("previews both acute and nonacute cruelty without inserting post-documentation help", () => {
    const walk = guidancePreview({ situation: "cruelty", items: contacts });
    expect(
      trace(walk, ["Týranie / zanedbávanie", "Nejde o akútny prípad"]).id,
    ).toBe("location");
    expect(
      trace(walk, [
        "Týranie / zanedbávanie",
        "Volať políciu — 158",
        "Nepodarilo sa nahlásiť",
        "Zdokumentovať prípad",
      ]).id,
    ).toBe("location");
    expect(screen(walk, "details").transitions).toEqual([
      { label: "Potvrdiť okolnosti týrania", target: "w39" },
    ]);
    expect(
      walk.screens.some((entry) => entry.path.startsWith("/contacts/")),
    ).toBe(false);
  });

  it("routes road contacts before identification, then preserves documentation and injured-flow handoff", () => {
    const walk = guidancePreview({
      situation: "other",
      context: "road-railway",
      items: contacts,
    });
    expect(
      trace(walk, [
        "Iná situácia",
        "Na / pri ceste alebo koľajniciach",
        "Potvrdiť polohu",
        "Potvrdiť situáciu",
        "Pokračovať",
      ]).paths,
    ).toEqual(["/", "/w32", "/w03", "/w33", "/w14", "/contacts/first"]);
    const last = required(
      walk.screens.find((entry) => entry.path === "/contacts/second"),
    );
    expect(last.transitions.some((edge) => edge.target === "road-failed")).toBe(
      true,
    );
    expect(screen(walk, "road-failed").transitions[0]?.target).toBe(
      "road-photo",
    );
    expect(screen(walk, "road-documentation").transitions[0]?.target).toBe(
      "w38",
    );
    expect(screen(walk, "w38").transitions.map((edge) => edge.target)).toEqual([
      "received",
      "injured-handoff",
    ]);
  });

  it("offers the documentation-only other branch independently of configured human guidance", () => {
    const walk = guidancePreview({
      situation: "other",
      context: "human-fire",
      items: contacts,
    });
    expect(
      trace(walk, [
        "Iná situácia",
        "Iná situácia — vlastný opis",
        "Potvrdiť polohu",
        "Nemám fotografiu",
        "Potvrdiť voľbu",
        "Potvrdiť",
        "Odoslať a ukončiť",
      ]).paths,
    ).not.toContain("/contacts/first");
  });

  it("uses the injured routing resolver and retains outcome branches", () => {
    const walk = guidancePreview({
      situation: "injured",
      kindKey: "domestic_cat",
      items: contacts,
    });
    const contact = required(
      walk.screens.find((entry) => entry.path === "/contacts/first"),
    );
    expect(contact.items[0]?.slots["contact.title"]).toBe("First contact");
    expect(contact.transitions.some((edge) => edge.target === "w24")).toBe(
      true,
    );
  });
});
