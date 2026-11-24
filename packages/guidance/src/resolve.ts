import { animalKinds, findAnimalKind } from "./catalog.js";
import { flowFor } from "./flows.js";
import type { GuidanceItem } from "./content.js";
import { contactOptionPath, isContactOptionInstruction } from "./slots.js";
import {
  groupKeys,
  type AnimalKind,
  type FlowKey,
  type ScreenKey,
  type SituationKey,
} from "./keys.js";
import {
  customerImplementedWalk,
  customerWalkOrder,
  customerWalkPath,
  screens,
  type ScreenStatus,
} from "./screens.js";

export type ResolvedWalkReason =
  "ready" | "stub" | "missing_kind" | "missing_content";

export type ResolvedWalkStep = {
  screenKey: ScreenKey;
  role: string;
  status: ScreenStatus;
  customerPath: string;
};

export type ResolvedGuidanceWalk = {
  situation: SituationKey;
  reason: ResolvedWalkReason;
  kind?: AnimalKind;
  flowKey?: FlowKey;
  steps: readonly ResolvedWalkStep[];
};

export type CustomerWalkableStatus = Exclude<ScreenStatus, "skipped">;

export type CustomerWalkableStep = {
  path: string;
  screenKeys: readonly ScreenKey[];
  status: CustomerWalkableStatus;
};

const thanksStep = (): CustomerWalkableStep => ({
  path: customerImplementedWalk.thanks.path,
  screenKeys: customerImplementedWalk.thanks.matrixScreens,
  status: "implemented",
});

const implementedSkeleton = (): CustomerWalkableStep[] =>
  customerWalkOrder.map((route) => ({
    path: route.path,
    screenKeys: route.matrixScreens,
    status: "implemented",
  }));

const prefixUntilDetails = (): CustomerWalkableStep[] => {
  const detailsPath = customerWalkPath("details");
  const skeleton = implementedSkeleton();
  const index = skeleton.findIndex((step) => step.path === detailsPath);
  return index === -1 ? skeleton : skeleton.slice(0, index + 1);
};

const withPhotoStep = (
  steps: readonly CustomerWalkableStep[],
): CustomerWalkableStep[] => {
  const locationPath = customerWalkPath("location");
  const photo = {
    path: customerImplementedWalk.photo.path,
    screenKeys: customerImplementedWalk.photo.matrixScreens,
    status: "implemented" as const,
  };
  if (steps.some((step) => step.path === photo.path)) {
    return [...steps];
  }

  const walkable: CustomerWalkableStep[] = [];
  for (const step of steps) {
    walkable.push(step);
    if (step.path === locationPath) {
      walkable.push(photo);
    }
  }
  return walkable;
};

const stepsForFlow = (flowKey: FlowKey): readonly ResolvedWalkStep[] =>
  flowFor(flowKey).screens.map((screenKey) => {
    const screen = screens[screenKey];
    return {
      screenKey,
      role: screen.role,
      status: screen.status,
      customerPath: screen.customerPath,
    };
  });

export const kindsForSituation = (
  situation: SituationKey,
): readonly AnimalKind[] => {
  const matching = animalKinds.filter((kind) => {
    if (situation === "injured") {
      return kind.injured !== undefined;
    }
    if (situation === "cruelty") {
      return kind.cruelty !== undefined;
    }
    return kind.stray !== undefined;
  });

  return [...matching].sort((left, right) => {
    if (left.groupKey !== right.groupKey) {
      return (
        groupKeys.indexOf(left.groupKey) - groupKeys.indexOf(right.groupKey)
      );
    }
    return left.labelSk.localeCompare(right.labelSk, "sk");
  });
};

export const resolveGuidanceWalk = (
  situation: SituationKey,
  kindKey: string | undefined,
): ResolvedGuidanceWalk => {
  if (kindKey === undefined || kindKey === "") {
    return { situation, reason: "missing_kind", steps: [] };
  }

  const kind = findAnimalKind(kindKey);
  if (kind === undefined) {
    return { situation, reason: "missing_kind", steps: [] };
  }

  if (situation === "injured") {
    if (kind.injured === undefined) {
      return { situation, reason: "missing_content", kind, steps: [] };
    }
    return {
      situation,
      reason: "ready",
      kind,
      flowKey: kind.injured.flowKey,
      steps: stepsForFlow(kind.injured.flowKey),
    };
  }

  if (situation === "cruelty") {
    if (kind.cruelty === undefined) {
      return { situation, reason: "missing_content", kind, steps: [] };
    }
    return {
      situation,
      reason: "ready",
      kind,
      flowKey: kind.cruelty.flowKey,
      steps: stepsForFlow(kind.cruelty.flowKey),
    };
  }

  if (kind.stray === undefined) {
    return { situation, reason: "missing_content", kind, steps: [] };
  }

  return { situation, reason: "stub", kind, steps: [] };
};

const collapseWalkableSteps = (
  steps: readonly ResolvedWalkStep[],
): CustomerWalkableStep[] => {
  const walkable: CustomerWalkableStep[] = [];

  for (const step of steps) {
    if (step.status === "skipped") {
      continue;
    }

    const path = step.customerPath;
    const last = walkable.at(-1);
    if (last !== undefined && last.path === path) {
      walkable[walkable.length - 1] = {
        ...last,
        screenKeys: [...last.screenKeys, step.screenKey],
      };
      continue;
    }

    walkable.push({
      path,
      screenKeys: [step.screenKey],
      status: step.status,
    });
  }

  return walkable;
};

const withThanks = (
  steps: readonly CustomerWalkableStep[],
): CustomerWalkableStep[] => {
  const contactPath = customerWalkPath("contact");
  const contactIndex = steps.findIndex((step) => step.path === contactPath);
  const untilContact =
    contactIndex === -1 ? [...steps] : steps.slice(0, contactIndex + 1);
  const thanks = thanksStep();
  if (untilContact.some((step) => step.path === thanks.path)) {
    return untilContact;
  }
  return [...untilContact, thanks];
};

export const customerWalkableSteps = (
  situation: SituationKey,
  kindKey: string | undefined,
  items: readonly GuidanceItem[] = [],
): readonly CustomerWalkableStep[] => {
  if (situation === "stray") {
    return implementedSkeleton();
  }

  if (situation !== "injured") {
    return prefixUntilDetails().slice(0, 1);
  }

  const resolved = resolveGuidanceWalk(situation, kindKey);
  if (resolved.reason !== "ready") {
    return prefixUntilDetails();
  }

  const steps = withThanks(
    withPhotoStep(collapseWalkableSteps(resolved.steps)),
  );
  const contacts = items.filter((item) =>
    isContactOptionInstruction(item.instructionKey),
  );
  if (!contacts.length) return steps;
  const contactPaths = new Set(["/w15", "/w18", "/w19", "/w20", "/w21"]);
  const first = steps.findIndex((step) => contactPaths.has(step.path));
  const dynamic = contacts.map((item): CustomerWalkableStep => ({
    path: contactOptionPath(item.instructionKey as `contact.option.${string}`),
    screenKeys: ["w15"],
    status: "implemented",
  }));
  const before = first < 0 ? steps.length - 2 : first;
  return [
    ...steps.slice(0, before),
    ...dynamic,
    ...steps.slice(before).filter((step) => !contactPaths.has(step.path)),
  ];
};

export const matrixWalkableSteps = (
  situation: SituationKey,
  kindKey: string | undefined,
): readonly ResolvedWalkStep[] =>
  resolveGuidanceWalk(situation, kindKey).steps.filter(
    (step) => step.status !== "skipped",
  );

export const nextCustomerPath = (
  currentPath: string,
  situation: SituationKey,
  kindKey: string | undefined,
  items: readonly GuidanceItem[] = [],
): string | undefined => {
  const steps = customerWalkableSteps(situation, kindKey, items);
  const index = steps.findIndex((step) => step.path === currentPath);
  if (index === -1 || index >= steps.length - 1) {
    return undefined;
  }
  return steps[index + 1]?.path;
};

export const isCustomerWalkablePath = (
  path: string,
  situation: SituationKey,
  kindKey: string | undefined,
): boolean =>
  customerWalkableSteps(situation, kindKey).some((step) => step.path === path);
