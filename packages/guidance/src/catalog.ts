import animalKindsJson from "./generated/animal-kinds.json" with { type: "json" };
import injuredPickerKindsJson from "./generated/injured-picker-kinds.json" with { type: "json" };

import {
  isAuthorityKey,
  isCatalogKey,
  isCategoryKey,
  isContactKey,
  isCrueltyFlowKey,
  isGroupKey,
  isInjuredFlowKey,
  isSelfHelpMode,
  isSubcategoryKey,
  isWarningFrame,
  type AnimalKind,
} from "./keys.js";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const requiredString = (value: unknown, path: string): string => {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`invalid ${path}`);
  }
  return value;
};

const optionalString = (value: unknown, path: string): string | undefined => {
  if (value === undefined) {
    return undefined;
  }
  return requiredString(value, path);
};

const requiredBoolean = (value: unknown, path: string): boolean => {
  if (typeof value !== "boolean") {
    throw new Error(`invalid ${path}`);
  }
  return value;
};

const parseMatrix = (value: unknown, path: string): AnimalKind["matrix"] => {
  if (!isRecord(value)) {
    throw new Error(`invalid ${path}`);
  }
  const crueltyId = optionalString(value.crueltyId, `${path}.crueltyId`);
  const injuredId = optionalString(value.injuredId, `${path}.injuredId`);
  const strayId = optionalString(value.strayId, `${path}.strayId`);
  return {
    ...(crueltyId === undefined ? {} : { crueltyId }),
    ...(injuredId === undefined ? {} : { injuredId }),
    ...(strayId === undefined ? {} : { strayId }),
  };
};

const parseInjured = (value: unknown, path: string): AnimalKind["injured"] => {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new Error(`invalid ${path}`);
  }
  if (value.content !== "ready") {
    throw new Error(`invalid ${path}.content`);
  }
  const flowKey = requiredString(value.flowKey, `${path}.flowKey`);
  if (!isInjuredFlowKey(flowKey)) {
    throw new Error(`invalid ${path}.flowKey`);
  }
  const warningFrame =
    value.warningFrame === undefined
      ? undefined
      : requiredString(value.warningFrame, `${path}.warningFrame`);
  if (warningFrame !== undefined && !isWarningFrame(warningFrame)) {
    throw new Error(`invalid ${path}.warningFrame`);
  }
  const primaryContact =
    value.primaryContact === undefined
      ? undefined
      : requiredString(value.primaryContact, `${path}.primaryContact`);
  if (primaryContact !== undefined && !isContactKey(primaryContact)) {
    throw new Error(`invalid ${path}.primaryContact`);
  }
  const secondaryContact =
    value.secondaryContact === undefined
      ? undefined
      : requiredString(value.secondaryContact, `${path}.secondaryContact`);
  if (secondaryContact !== undefined && !isContactKey(secondaryContact)) {
    throw new Error(`invalid ${path}.secondaryContact`);
  }
  const selfHelp =
    value.selfHelp === undefined
      ? undefined
      : requiredString(value.selfHelp, `${path}.selfHelp`);
  if (selfHelp !== undefined && !isSelfHelpMode(selfHelp)) {
    throw new Error(`invalid ${path}.selfHelp`);
  }

  return {
    content: "ready",
    flowKey,
    askConscious: requiredBoolean(value.askConscious, `${path}.askConscious`),
    ...(value.askJuvenile === undefined
      ? {}
      : {
          askJuvenile: requiredBoolean(
            value.askJuvenile,
            `${path}.askJuvenile`,
          ),
        }),
    ...(warningFrame === undefined ? {} : { warningFrame }),
    ...(primaryContact === undefined ? {} : { primaryContact }),
    ...(secondaryContact === undefined ? {} : { secondaryContact }),
    ...(value.showVolunteers === undefined
      ? {}
      : {
          showVolunteers: requiredBoolean(
            value.showVolunteers,
            `${path}.showVolunteers`,
          ),
        }),
    ...(selfHelp === undefined ? {} : { selfHelp }),
  };
};

const parseCruelty = (value: unknown, path: string): AnimalKind["cruelty"] => {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new Error(`invalid ${path}`);
  }
  const flowKey = requiredString(value.flowKey, `${path}.flowKey`);
  const authorityKey = requiredString(
    value.authorityKey,
    `${path}.authorityKey`,
  );
  if (!isCrueltyFlowKey(flowKey) || !isAuthorityKey(authorityKey)) {
    throw new Error(`invalid ${path}`);
  }
  return { flowKey, authorityKey };
};

const parseStray = (value: unknown, path: string): AnimalKind["stray"] => {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value) || value.content !== "stub") {
    throw new Error(`invalid ${path}`);
  }
  return { content: "stub" };
};

const parseKind = (value: unknown, index: number): AnimalKind => {
  if (!isRecord(value)) {
    throw new Error(`invalid animal kind at ${index}`);
  }
  const key = requiredString(value.key, `kinds[${index}].key`);
  if (!isCatalogKey(key)) {
    throw new Error(`invalid animal kind key ${key}`);
  }
  const groupKey = requiredString(value.groupKey, `kinds[${index}].groupKey`);
  const categoryKey = requiredString(
    value.categoryKey,
    `kinds[${index}].categoryKey`,
  );
  if (!isGroupKey(groupKey) || !isCategoryKey(categoryKey)) {
    throw new Error(`invalid animal kind ${key} taxonomy`);
  }
  const subcategoryKey = optionalString(
    value.subcategoryKey,
    `kinds[${index}].subcategoryKey`,
  );
  if (subcategoryKey !== undefined && !isSubcategoryKey(subcategoryKey)) {
    throw new Error(`invalid animal kind ${key} subcategory`);
  }

  const kind: AnimalKind = {
    key,
    groupKey,
    categoryKey,
    labelSk: requiredString(value.labelSk, `kinds[${index}].labelSk`),
    matrix: parseMatrix(value.matrix, `kinds[${index}].matrix`),
    ...(subcategoryKey === undefined ? {} : { subcategoryKey }),
  };
  const cruelty = parseCruelty(value.cruelty, `kinds[${index}].cruelty`);
  const injured = parseInjured(value.injured, `kinds[${index}].injured`);
  const stray = parseStray(value.stray, `kinds[${index}].stray`);
  if (cruelty !== undefined) {
    kind.cruelty = cruelty;
  }
  if (injured !== undefined) {
    kind.injured = injured;
  }
  if (stray !== undefined) {
    kind.stray = stray;
  }
  return kind;
};

const parseCatalog = (value: unknown): readonly AnimalKind[] => {
  if (!Array.isArray(value)) {
    throw new Error("animal kind catalog must be an array");
  }
  const kinds = value.map((entry, index) => parseKind(entry, index));
  const keys = new Set(kinds.map((kind) => kind.key));
  if (keys.size !== kinds.length) {
    throw new Error("animal kind keys must be unique");
  }
  return kinds;
};

// The second file is the injured picker species that are not in the original
// matrices. They identify the animal on a report. Species-specific guidance
// is still the original catalogue until those flows are replaced.
export const animalKinds = parseCatalog([
  ...animalKindsJson,
  ...injuredPickerKindsJson,
]);

const kindsByKey = new Map(animalKinds.map((kind) => [kind.key, kind]));

export const findAnimalKind = (key: string): AnimalKind | undefined =>
  kindsByKey.get(key);

export const animalKindByKey = (key: string): AnimalKind => {
  const kind = findAnimalKind(key);
  if (kind === undefined) {
    throw new Error(`unknown animal kind: ${key}`);
  }
  return kind;
};

export const animalKindCount = animalKinds.length;
