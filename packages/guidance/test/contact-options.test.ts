import { expect, it } from "vitest";
import type { GuidanceContactOption } from "@animal-helper/contracts";
import {
  assertPublishableDocument,
  bundledGuidanceDocument,
  bundledPublicGuidance,
  contactOptionCells,
  contactOptionsForKind,
  customerWalkableSteps,
  isContactInstruction,
  isContactOptionInstruction,
  parseGuidanceDocument,
  parsePublicGuidance,
  resolvePublicGuidance,
  canonicalizeGuidanceDocument,
  walkViewAfterPath,
  walkViewForPath,
  type WalkFacts,
  animalKinds,
} from "../src/index.js";

const facts: WalkFacts = {
  situationType: "injured",
  kindKey: "domestic_cat",
  hasDraft: true,
  hasLocation: true,
  photoDone: true,
  hasFormSnapshot: true,
  hasContact: false,
  submitted: false,
};
const option = (id: string, enabled = true): GuidanceContactOption => ({
  id,
  enabled,
  serviceKey: "vet_clinic",
  title: `Možnosť ${id}`,
  body: `Pokyny ${id}`,
});
const documentFor = (options: GuidanceContactOption[]) => {
  const original = bundledGuidanceDocument();
  return parseGuidanceDocument({
    copy: original.copy,
    cells: [
      ...original.cells.filter(
        (cell) =>
          cell.kindKey !== "domestic_cat" ||
          !isContactInstruction(cell.instructionKey),
      ),
      ...contactOptionCells("domestic_cat", options),
    ],
  });
};
const publicFor = (options: GuidanceContactOption[]) =>
  resolvePublicGuidance(documentFor(options), {
    revisionId: "bundled",
    source: "bundled",
    contentHash: "a".repeat(64),
  });

it("preserves the existing primary, secondary and volunteer options until an admin saves", () => {
  const document = bundledGuidanceDocument();
  const options = contactOptionsForKind(document, "domestic_cat");
  expect(
    options.filter((item) => item.enabled).map((item) => item.serviceKey),
  ).toEqual(["municipality_capture", "vet_clinic", "volunteers"]);
  expect(contactOptionsForKind(document, "domestic_cat")).toEqual(options);
  expect(
    bundledPublicGuidance().kinds.domestic_cat?.items.some((item) =>
      isContactOptionInstruction(item.instructionKey),
    ),
  ).toBe(false);
});

it.each([1, 3, 20])(
  "supports %i sequential options, each rendered once with stable forward/back paths",
  (length) => {
    const options = Array.from({ length }, (_, index) =>
      option(`step-${index}`),
    );
    const document = documentFor(options);
    expect(() => assertPublishableDocument(document)).not.toThrow();
    const guidance = parsePublicGuidance(publicFor(options));
    const steps = customerWalkableSteps(
      "injured",
      "domestic_cat",
      guidance.kinds.domestic_cat?.items,
    );
    expect(
      steps
        .filter((step) => step.path.startsWith("/contacts/"))
        .map((step) => step.path),
    ).toEqual(options.map((item) => `/contacts/${item.id}`));
    expect(
      steps.some((step) =>
        ["/w15", "/w18", "/w19", "/w20", "/w21"].includes(step.path),
      ),
    ).toBe(false);
    for (let index = 0; index < length; index++) {
      const path = `/contacts/step-${index}`;
      const view = walkViewForPath(path, facts, guidance);
      expect(view).toMatchObject({
        screen: "guide",
        props: {
          items: [
            {
              instructionKey: `contact.option.step-${index}`,
              slots: { "contact.title": `Možnosť step-${index}` },
            },
          ],
        },
      });
      if (view?.screen === "guide") expect(view.props.items).toHaveLength(1);
      expect(walkViewAfterPath(path, facts, guidance)?.path).toBe(
        index === length - 1 ? "/w22" : `/contacts/step-${index + 1}`,
      );
    }
    expect(
      walkViewForPath("/contacts/missing", facts, guidance),
    ).toBeUndefined();
  },
);

it("retains order and skips disabled options without renumbering their IDs", () => {
  const options = [
    option("third"),
    option("disabled", false),
    { ...option("first"), serviceKey: "volunteers" as const },
  ];
  const guidance = publicFor(options);
  expect(contactOptionsForKind(documentFor(options), "domestic_cat")).toEqual(
    options,
  );
  const paths = customerWalkableSteps(
    "injured",
    "domestic_cat",
    guidance.kinds.domestic_cat?.items,
  )
    .filter((step) => step.path.startsWith("/contacts/"))
    .map((step) => step.path);
  expect(paths).toEqual(["/contacts/third", "/contacts/first"]);
});

it("round trips an explicit protected veterinary variant through drafts and public guidance", () => {
  const protectedOption = {
    ...option("clinic"),
    serviceKey: "vet_clinic" as const,
    clinicVariant: "protected" as const,
  };
  const document = documentFor([protectedOption]);
  expect(canonicalizeGuidanceDocument(document)).not.toEqual(
    canonicalizeGuidanceDocument(
      documentFor([{ ...protectedOption, clinicVariant: "standard" }]),
    ),
  );
  expect(contactOptionsForKind(document, "domestic_cat")).toEqual([
    protectedOption,
  ]);
  const guidance = parsePublicGuidance(publicFor([protectedOption]));
  expect(
    guidance.kinds.domestic_cat?.items.find(
      (item) => item.instructionKey === "contact.option.clinic",
    ),
  ).toMatchObject({ clinicVariant: "protected" });
  expect(() =>
    documentFor([{ ...protectedOption, serviceKey: "police" }]),
  ).toThrow();
});

it("rejects unsafe text, missing instructions or services, and mixed legacy/dynamic contacts", () => {
  expect(() =>
    documentFor([{ ...option("one"), body: "https://example.invalid" }]),
  ).toThrow();
  expect(() =>
    assertPublishableDocument(documentFor([{ ...option("one"), title: "" }])),
  ).toThrow();
  const document = documentFor([option("one")]);
  expect(() =>
    parseGuidanceDocument({
      ...document,
      cells: [
        ...document.cells,
        ...bundledGuidanceDocument().cells.filter(
          (cell) =>
            cell.kindKey === "domestic_cat" &&
            cell.instructionKey === "contact.primary",
        ),
      ],
    }),
  ).toThrow();
  const guidance = publicFor([option("one")]);
  const item = guidance.kinds.domestic_cat?.items.find((entry) =>
    isContactOptionInstruction(entry.instructionKey),
  );
  expect(item).toBeDefined();
  if (!item) throw new Error("contact required");
  const withoutAction = { ...item };
  delete withoutAction.action;
  expect(() =>
    parsePublicGuidance({
      ...guidance,
      kinds: { ...guidance.kinds, domestic_cat: { items: [withoutAction] } },
    }),
  ).toThrow();
});

it("converts every supported animal's legacy contacts into a publishable ordered list", () => {
  const original = bundledGuidanceDocument();
  const kinds = animalKinds.filter((kind) => kind.injured);
  const cells = kinds.flatMap((kind) => {
    const options = contactOptionsForKind(original, kind.key);
    expect(options.some((option) => option.enabled)).toBe(true);
    return contactOptionCells(kind.key, options);
  });
  expect(() =>
    assertPublishableDocument({
      copy: original.copy,
      cells: [
        ...original.cells.filter(
          (cell) => !isContactInstruction(cell.instructionKey),
        ),
        ...cells,
      ],
    }),
  ).not.toThrow();
});
