import {
  parseWalkView,
  type WalkFieldError,
  type WalkGuideItem,
  type WalkKindOption,
  type WalkView,
} from "@animal-helper/contracts";

import { findAnimalKind } from "./catalog.js";
import { itemsForScreens, type PublicGuidance } from "./content.js";
import { isScreenKey, type SituationKey } from "./keys.js";
import {
  customerWalkableSteps,
  kindsForSituation,
  nextCustomerPath,
} from "./resolve.js";
import { customerImplementedWalk, customerWalkPath } from "./screens.js";
import { contactOptionPath, isContactOptionInstruction } from "./slots.js";

export type WalkFacts = {
  situationType: SituationKey;
  kindKey?: string;
  hasDraft: boolean;
  hasLocation: boolean;
  photoDone: boolean;
  hasFormSnapshot: boolean;
  hasContact: boolean;
  submitted: boolean;
  publicState?: "draft" | "received" | "closed";
  fieldErrors?: readonly WalkFieldError[];
};

const emptyProps = {};

const fieldErrorsOf = (facts: WalkFacts): WalkFieldError[] => [
  ...(facts.fieldErrors ?? []),
];

const parseResolved = (value: unknown): WalkView => {
  const parsed = parseWalkView(value);
  if (!parsed.success) {
    throw new Error("walk view resolver produced an invalid document");
  }
  return parsed.data;
};

const detailsKinds = (situationType: SituationKey): WalkKindOption[] => {
  if (situationType !== "injured") {
    return [];
  }

  return kindsForSituation("injured").map((kind) => ({
    key: kind.key,
    groupKey: kind.groupKey,
    categoryKey: kind.categoryKey,
    labelSk: kind.labelSk,
    askConscious: kind.injured?.askConscious !== false,
    askJuvenile: kind.injured?.askJuvenile !== false,
  }));
};

const guideItems = (
  facts: WalkFacts,
  screenKeys: readonly string[],
  guidance: PublicGuidance,
  path?: string,
): WalkGuideItem[] => {
  if (facts.kindKey === undefined) {
    return [];
  }

  const kindItems = guidance.kinds[facts.kindKey]?.items ?? [];
  const keys = screenKeys.filter(isScreenKey);
  return itemsForScreens(kindItems, keys)
    .filter(
      (item) =>
        !isContactOptionInstruction(item.instructionKey) ||
        contactOptionPath(item.instructionKey) === path,
    )
    .map((item) => {
      const slots: Record<string, string> = {};
      for (const [slotKey, slotValue] of Object.entries(item.slots)) {
        if (typeof slotValue === "string") {
          slots[slotKey] = slotValue;
        }
      }

      return {
        screenKey: item.screenKey,
        instructionKey: item.instructionKey,
        polarity: item.polarity,
        slots,
        ...(item.action === undefined
          ? {}
          : {
              action: {
                kind: item.action.kind,
                targetKey: item.action.targetKey,
              },
            }),
      };
    });
};

const situationView = (facts: WalkFacts): WalkView =>
  parseResolved({
    schemaVersion: 1,
    screen: "situation",
    path: customerWalkPath("situation"),
    screenKeys: [...customerImplementedWalk.situation.matrixScreens],
    allowedCommands: ["create_draft"],
    fieldErrors: fieldErrorsOf(facts),
    props: { situations: ["injured", "stray", "cruelty", "other"] },
  });

const locationView = (facts: WalkFacts): WalkView =>
  parseResolved({
    schemaVersion: 1,
    screen: "location",
    path: customerWalkPath("location"),
    screenKeys: [...customerImplementedWalk.location.matrixScreens],
    allowedCommands: ["attach_location"],
    fieldErrors: fieldErrorsOf(facts),
    props: emptyProps,
  });

const photoView = (facts: WalkFacts): WalkView =>
  parseResolved({
    schemaVersion: 1,
    screen: "photo",
    path: customerWalkPath("photo"),
    screenKeys: [...customerImplementedWalk.photo.matrixScreens],
    allowedCommands: ["continue"],
    fieldErrors: fieldErrorsOf(facts),
    props: emptyProps,
  });

const detailsView = (facts: WalkFacts): WalkView =>
  parseResolved({
    schemaVersion: 1,
    screen: "details",
    path: customerWalkPath("details"),
    screenKeys: [...customerImplementedWalk.details.matrixScreens],
    allowedCommands: ["attach_form_snapshot"],
    fieldErrors: fieldErrorsOf(facts),
    props: {
      situationType: facts.situationType,
      kinds: detailsKinds(facts.situationType),
    },
  });

const contactView = (facts: WalkFacts): WalkView =>
  parseResolved({
    schemaVersion: 1,
    screen: "contact",
    path: customerWalkPath("contact"),
    screenKeys: [...customerImplementedWalk.contact.matrixScreens],
    allowedCommands: ["attach_contact", "submit_draft"],
    fieldErrors: fieldErrorsOf(facts),
    props: emptyProps,
  });

const thanksView = (facts: WalkFacts): WalkView =>
  parseResolved({
    schemaVersion: 1,
    screen: "thanks",
    path: customerWalkPath("thanks"),
    screenKeys: [...customerImplementedWalk.thanks.matrixScreens],
    allowedCommands: [],
    fieldErrors: fieldErrorsOf(facts),
    props:
      facts.publicState === undefined ? {} : { publicState: facts.publicState },
  });

const guideView = (
  path: string,
  screenKeys: readonly string[],
  facts: WalkFacts,
  guidance: PublicGuidance,
): WalkView => {
  const kindKey = facts.kindKey;
  if (kindKey === undefined || findAnimalKind(kindKey) === undefined) {
    return detailsView(facts);
  }

  return parseResolved({
    schemaVersion: 1,
    screen: "guide",
    path,
    screenKeys: [...screenKeys],
    allowedCommands: ["continue"],
    fieldErrors: fieldErrorsOf(facts),
    props: {
      kindKey,
      revisionId: guidance.revisionId,
      items: guideItems(facts, screenKeys, guidance, path),
    },
  });
};

const walkSituation = (situationType: SituationKey): SituationKey =>
  situationType;

export const walkViewForPath = (
  path: string,
  facts: WalkFacts,
  guidance: PublicGuidance,
): WalkView | undefined => {
  if (path === customerWalkPath("situation")) {
    return situationView(facts);
  }
  if (path === customerWalkPath("location")) {
    return locationView(facts);
  }
  if (path === customerWalkPath("photo")) {
    return photoView(facts);
  }
  if (path === customerWalkPath("details")) {
    return detailsView(facts);
  }
  if (path === customerWalkPath("contact")) {
    return contactView(facts);
  }
  if (path === customerWalkPath("thanks")) {
    return thanksView(facts);
  }

  const step = customerWalkableSteps(
    walkSituation(facts.situationType),
    facts.kindKey,
    facts.kindKey ? guidance.kinds[facts.kindKey]?.items : undefined,
  ).find((entry) => entry.path === path);
  if (step === undefined) {
    return undefined;
  }

  return guideView(path, step.screenKeys, facts, guidance);
};

export const resumeWalkView = (
  facts: WalkFacts,
  guidance: PublicGuidance,
): WalkView => {
  if (facts.submitted) {
    return thanksView(facts);
  }
  if (!facts.hasDraft) {
    return situationView(facts);
  }
  if (!facts.hasLocation) {
    return locationView(facts);
  }
  if (!facts.photoDone) {
    return photoView(facts);
  }
  if (!facts.hasFormSnapshot) {
    return detailsView(facts);
  }
  if (!facts.hasContact) {
    const afterDetails = nextCustomerPath(
      customerWalkPath("details"),
      walkSituation(facts.situationType),
      facts.kindKey,
      facts.kindKey ? guidance.kinds[facts.kindKey]?.items : undefined,
    );
    if (afterDetails === undefined) {
      return contactView(facts);
    }
    return walkViewForPath(afterDetails, facts, guidance) ?? contactView(facts);
  }

  return contactView(facts);
};

export const walkViewAfterPath = (
  completedPath: string,
  facts: WalkFacts,
  guidance: PublicGuidance,
): WalkView | undefined => {
  const nextPath = nextCustomerPath(
    completedPath,
    walkSituation(facts.situationType),
    facts.kindKey,
    facts.kindKey ? guidance.kinds[facts.kindKey]?.items : undefined,
  );
  if (nextPath === undefined) {
    return undefined;
  }
  return walkViewForPath(nextPath, facts, guidance);
};
