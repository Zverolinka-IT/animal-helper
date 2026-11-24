import { describe, expect, it } from "vitest";

import {
  animalKindByKey,
  animalKindCount,
  animalKinds,
  customerImplementedWalk,
  customerWalkOrder,
  flowFor,
  flowKeys,
  screens,
} from "../src/index.js";
import { readMatrixRows } from "./read-matrices.js";

describe("animal-kind catalog", () => {
  it("keeps unique catalog keys and the existing domestic_cat identity", () => {
    expect(animalKindCount).toBe(200);
    expect(new Set(animalKinds.map((kind) => kind.key)).size).toBe(200);
    expect(animalKindByKey("domestic_cat")).toMatchObject({
      key: "domestic_cat",
      groupKey: "domestic",
      categoryKey: "companion",
      labelSk: "Mačka",
      matrix: {
        crueltyId: "TYR-002",
        injuredId: "ZRZAT-003",
        strayId: "ZRZAT-004",
      },
    });
    expect(animalKindByKey("domestic_dog").injured).toMatchObject({
      flowKey: "injured_companion",
      askJuvenile: false,
    });
    expect(animalKindByKey("exotic_tiger").injured).toMatchObject({
      flowKey: "injured_exotic_dangerous",
      primaryContact: "emergency_112",
      showVolunteers: false,
    });
  });

  it("covers every cruelty and injured/stray matrix id", () => {
    const crueltyIds = readMatrixRows("animal-cruelty.csv").map(
      (row) => row.ID ?? "",
    );
    const injuredRows = readMatrixRows("injured-and-stray.csv");
    const catalogCruelty = animalKinds.flatMap((kind) =>
      kind.matrix.crueltyId === undefined ? [] : [kind.matrix.crueltyId],
    );
    expect(catalogCruelty.sort()).toEqual([...crueltyIds].sort());

    const catalogInjured = new Set(
      animalKinds.flatMap((kind) =>
        kind.matrix.injuredId === undefined ? [] : [kind.matrix.injuredId],
      ),
    );
    const catalogStray = new Set(
      animalKinds.flatMap((kind) =>
        kind.matrix.strayId === undefined ? [] : [kind.matrix.strayId],
      ),
    );
    const sourceInjured = injuredRows
      .filter((row) => row["Typ situácie"] === "Zranené")
      .map((row) => row.ID ?? "");
    const sourceStray = injuredRows
      .filter((row) => row["Typ situácie"] === "Zatúlané")
      .map((row) => row.ID ?? "");

    expect([...catalogInjured].sort()).toEqual([...sourceInjured].sort());
    expect([...catalogStray].sort()).toEqual([...sourceStray].sort());
    expect(
      animalKinds.filter((kind) => kind.stray?.content === "stub"),
    ).toHaveLength(sourceStray.length);
    expect(
      animalKinds.filter((kind) => kind.injured?.content === "ready"),
    ).toHaveLength(sourceInjured.length);
  });

  it("leaves companion rat without an injured row and stray as stubs", () => {
    expect(animalKinds.filter((kind) => kind.stray !== undefined)).toHaveLength(
      animalKinds.filter((kind) => kind.matrix.strayId !== undefined).length,
    );
    expect(animalKindByKey("domestic_rat").injured).toBeUndefined();
    expect(animalKindByKey("wild_mouse").matrix.injuredId).toBeUndefined();
  });
});

describe("flow and screen map", () => {
  it("registers every flow screen and the current customer skeleton", () => {
    for (const key of flowKeys) {
      expect(flowFor(key).screens[0]).toBe("w01");
    }
    expect(flowFor("cruelty_standard").screens).toEqual([
      "w01",
      "w02",
      "w03a",
      "w03b",
      "w04",
      "w06a",
      "w06b",
      "w11",
      "w24",
    ]);
    expect(customerWalkOrder.map((step) => step.path)).toEqual([
      "/w01",
      "/w03",
      "/w04",
      "/w09",
      "/w24",
      "/thank-you",
    ]);
    expect(customerImplementedWalk.details.matrixScreens).toEqual([
      "w04",
      "w09",
      "w09b",
      "w11",
    ]);
    expect(screens.w24.customerPath).toBe("/w24");
    expect(screens.w14.customerPath).toBe("/w14");
    expect(screens.w02.status).toBe("planned");
  });
});
