export const CATALOG_KEY_PATTERN = /^[a-z][a-z0-9_]*$/;
export const CATALOG_KEY_MAX_LENGTH = 64;

export const situationKeys = [
  "injured",
  "stray",
  "dead",
  "cruelty",
  "other",
] as const;
export type SituationKey = (typeof situationKeys)[number];

export const groupKeys = ["domestic", "farm", "wildlife", "exotic"] as const;
export type GroupKey = (typeof groupKeys)[number];

export const categoryKeys = [
  "companion",
  "farm",
  "bird",
  "aquatic",
  "reptile",
  "amphibian",
  "exotic",
  "wild_mammal",
] as const;
export type CategoryKey = (typeof categoryKeys)[number];

export const subcategoryKeys = [
  "forest_game",
  "songbirds",
  "small_wild_mammals",
  "waterfowl",
  "raptors",
  "corvids",
  "owls",
  "storks_waders",
  "large_carnivores",
  "pigeons",
] as const;
export type SubcategoryKey = (typeof subcategoryKeys)[number];

export const injuredFlowKeys = [
  "injured_companion",
  "injured_farm",
  "injured_protected_standard",
  "injured_game",
  "injured_exotic",
  "injured_exotic_dangerous",
  "injured_small_wild",
  "injured_pigeon_identify",
  "injured_turtle_identify",
] as const;
export type InjuredFlowKey = (typeof injuredFlowKeys)[number];

export const crueltyFlowKeys = ["cruelty_standard"] as const;
export type CrueltyFlowKey = (typeof crueltyFlowKeys)[number];

export const flowKeys = [...injuredFlowKeys, ...crueltyFlowKeys] as const;
export type FlowKey = (typeof flowKeys)[number];

export const authorityKeys = [
  "rvps",
  "rvps_sizp",
  "rvps_sizp_manual",
  "rvps_district_land_forest",
] as const;
export type AuthorityKey = (typeof authorityKeys)[number];

export { guidanceContactKeys as contactKeys } from "@animal-helper/contracts";
import { guidanceContactKeys as contactKeys } from "@animal-helper/contracts";
export type ContactKey = (typeof contactKeys)[number];

export const warningFrames = ["w13", "w14", "dynamic"] as const;
export type WarningFrame = (typeof warningFrames)[number];

export const selfHelpModes = [
  "none",
  "after_contacts",
  "after_all_contacts",
  "after_contacts_if_safe",
] as const;
export type SelfHelpMode = (typeof selfHelpModes)[number];

export const screenKeys = [
  "w01",
  "w02",
  "w03a",
  "w03b",
  "w04",
  "w06a",
  "w06b",
  "w09",
  "w09b",
  "w11",
  "w13",
  "w14",
  "w15",
  "w16",
  "w17",
  "w18",
  "w19",
  "w20",
  "w21",
  "w22",
  "w23",
  "w24",
  "w25a",
  "w25b",
  "w26",
  "thanks",
] as const;
export type ScreenKey = (typeof screenKeys)[number];

export const customerWalkSteps = [
  "situation",
  "location",
  "photo",
  "details",
  "contact",
  "thanks",
] as const;
export type CustomerWalkStep = (typeof customerWalkSteps)[number];

export type InjuredKindContent = {
  content: "ready";
  flowKey: InjuredFlowKey;
  askConscious: boolean;
  askJuvenile?: boolean;
  warningFrame?: WarningFrame;
  primaryContact?: ContactKey;
  secondaryContact?: ContactKey;
  showVolunteers?: boolean;
  selfHelp?: SelfHelpMode;
};

export type CrueltyKindContent = {
  flowKey: CrueltyFlowKey;
  authorityKey: AuthorityKey;
};

export type StrayKindContent = {
  content: "stub";
};

export type AnimalKind = {
  key: string;
  groupKey: GroupKey;
  categoryKey: CategoryKey;
  subcategoryKey?: SubcategoryKey;
  labelSk: string;
  matrix: {
    crueltyId?: string;
    injuredId?: string;
    strayId?: string;
  };
  cruelty?: CrueltyKindContent;
  injured?: InjuredKindContent;
  stray?: StrayKindContent;
};

export const isCatalogKey = (value: string): boolean =>
  CATALOG_KEY_PATTERN.test(value) && value.length <= CATALOG_KEY_MAX_LENGTH;

const includesKey = <Key extends string>(
  keys: readonly Key[],
  value: string,
): value is Key => (keys as readonly string[]).includes(value);

export const isGroupKey = (value: string): value is GroupKey =>
  includesKey(groupKeys, value);
export const isCategoryKey = (value: string): value is CategoryKey =>
  includesKey(categoryKeys, value);
export const isSubcategoryKey = (value: string): value is SubcategoryKey =>
  includesKey(subcategoryKeys, value);
export const isInjuredFlowKey = (value: string): value is InjuredFlowKey =>
  includesKey(injuredFlowKeys, value);
export const isCrueltyFlowKey = (value: string): value is CrueltyFlowKey =>
  includesKey(crueltyFlowKeys, value);
export const isAuthorityKey = (value: string): value is AuthorityKey =>
  includesKey(authorityKeys, value);
export const isContactKey = (value: string): value is ContactKey =>
  includesKey(contactKeys, value);
export const isWarningFrame = (value: string): value is WarningFrame =>
  includesKey(warningFrames, value);
export const isSelfHelpMode = (value: string): value is SelfHelpMode =>
  includesKey(selfHelpModes, value);
export const isScreenKey = (value: string): value is ScreenKey =>
  includesKey(screenKeys, value);
