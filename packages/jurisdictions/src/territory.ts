import {
  slovakDistricts,
  splitContactPhones,
  type SlovakDistrict,
} from "@animal-helper/contracts";
import authorityContacts from "./generated/authority-contacts.json" with { type: "json" };
import municipalityDistricts from "./generated/municipalities.json" with { type: "json" };

export type AuthorityService = "sop_rescue" | "hunting_manager_or_opk";
export type AuthorityContact = {
  name: string;
  address: string;
  phone: string;
  note: string;
  districts: readonly SlovakDistrict[];
};

type RawAuthorityContact = {
  name: string;
  address: string;
  phone: string;
  duty: string;
  districts: string[];
};

const fold = (value: string) =>
  value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[–—-]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();

const isDistrict = (value: string): value is SlovakDistrict =>
  (slovakDistricts as readonly string[]).includes(value);

const places = Object.entries(
  municipalityDistricts as Record<string, string | string[]>,
)
  .map(([name, district]) => ({
    name,
    districts: (Array.isArray(district) ? district : [district]).filter(
      isDistrict,
    ),
  }))
  .filter((place) => place.districts.length)
  .sort((a, b) => b.name.length - a.name.length);

const containsPhrase = (haystack: string, needle: string) => {
  let from = 0;
  while (from <= haystack.length) {
    const index = haystack.indexOf(needle, from);
    if (index < 0) return false;
    const before = index === 0 || !/\p{L}/u.test(haystack[index - 1] ?? "");
    const afterIndex = index + needle.length;
    const after =
      afterIndex === haystack.length ||
      !/\p{L}/u.test(haystack[afterIndex] ?? "");
    if (before && after) return true;
    from = index + 1;
  }
  return false;
};

// Municipality names come from the territorial register. A repeated name, such
// as Píla, stays unresolved unless the label also names one of its districts.
export const districtForPlace = (label: string): SlovakDistrict | undefined => {
  const folded = fold(label);
  if (!folded) return undefined;
  const hits = places.filter((place) => containsPhrase(folded, place.name));
  const longest = hits[0]?.name.length ?? 0;
  const matched = hits.filter((place) => place.name.length === longest);
  const districts = [...new Set(matched.flatMap((place) => place.districts))];
  if (districts.length === 1) return districts[0];
  const named = districts.filter((district) =>
    containsPhrase(folded, fold(district)),
  );
  return named.length === 1 ? named[0] : undefined;
};

const isCallable = (value: string) =>
  splitContactPhones(value).valid.includes(value);

const presentAuthority = (
  contact: RawAuthorityContact,
  groups: { label: string; values: string[] }[],
): AuthorityContact | undefined => {
  const districts = contact.districts.filter(isDistrict);
  const populated = groups.filter((group) => group.values.length);
  const phone =
    populated
      .flatMap((group) => group.values)
      .find((value) => isCallable(value)) ?? "";
  const note =
    populated.length === 1 &&
    populated[0]?.values.length === 1 &&
    populated[0].values[0] === phone
      ? ""
      : populated
          .map((group) => `${group.label}: ${group.values.join(", ")}`)
          .join("\n");
  if (!districts.length || (!phone && !note)) return undefined;
  return {
    name: contact.name,
    address: contact.address,
    phone,
    note,
    districts,
  };
};

const numbers = (value: string) => {
  const split = splitContactPhones(value);
  return [...split.valid, ...split.invalid];
};

const records = authorityContacts;

const authorities: Record<AuthorityService, AuthorityContact[]> = {
  sop_rescue: records.sop_rescue.flatMap((contact) => {
    const presented = presentAuthority(contact, [
      { label: "Pohotovosť", values: numbers(contact.duty) },
      { label: "Telefón", values: numbers(contact.phone) },
    ]);
    return presented ? [presented] : [];
  }),
  hunting_manager_or_opk: records.hunting_manager_or_opk.flatMap((contact) => {
    const presented = presentAuthority(contact, [
      { label: "Všeobecný kontakt", values: numbers(contact.phone) },
    ]);
    return presented ? [presented] : [];
  }),
};

export const authorityContactsFor = (
  service: AuthorityService,
  district: string | undefined,
): readonly AuthorityContact[] =>
  district
    ? authorities[service].filter((contact) =>
        contact.districts.some((item) => item === district),
      )
    : [];
