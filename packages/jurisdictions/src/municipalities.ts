import {
  slovakDistricts,
  splitContactPhones,
  type SlovakDistrict,
} from "@animal-helper/contracts";
import officesFile from "./generated/municipality-offices.json" with { type: "json" };

export type MunicipalityOffice = {
  name: string;
  district: SlovakDistrict;
  phone: string;
  note: string;
  police: boolean;
};

type StoredOffice = {
  name: string;
  district: string;
  phones: string[];
  police: boolean;
};

const stored = officesFile as {
  offices: StoredOffice[];
  aliases: Record<string, number | number[]>;
};

const fold = (value: string) =>
  value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[–—-]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();

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

const isDistrict = (value: string): value is SlovakDistrict =>
  (slovakDistricts as readonly string[]).includes(value);

const aliases = Object.entries(stored.aliases)
  .map(([key, value]) => ({
    key,
    indexes: (Array.isArray(value) ? value : [value]).filter(
      (index) => stored.offices[index] !== undefined,
    ),
  }))
  .filter((alias) => alias.indexes.length)
  .sort((a, b) => b.key.length - a.key.length);

const callable = (phone: string) =>
  splitContactPhones(phone.replace(/(\d)\s*\/\s*(?=\d)/gu, "$1 ")).valid;

// The phone sheet names municipalities, not their districts. A repeated name is
// kept unresolved unless the place label also names the district. Cadastral
// area names point at the municipality that contains them.
export const municipalityOfficeFor = (
  label: string | undefined,
): MunicipalityOffice | undefined => {
  const folded = fold(label ?? "");
  if (!folded) return undefined;
  const hits = aliases.filter((alias) => containsPhrase(folded, alias.key));
  const longest = hits[0]?.key.length ?? 0;
  const indexes = [
    ...new Set(
      hits
        .filter((alias) => alias.key.length === longest)
        .flatMap((alias) => alias.indexes),
    ),
  ];
  let offices = indexes.flatMap((index) => {
    const office = stored.offices[index];
    return office ? [office] : [];
  });
  if (offices.length > 1) {
    const named = offices.filter((office) =>
      containsPhrase(folded, fold(office.district)),
    );
    if (named.length !== 1) return undefined;
    offices = named;
  }
  const office = offices[0];
  if (!office || !isDistrict(office.district)) return undefined;
  const phones = office.phones.flatMap(callable);
  return {
    name: office.name,
    district: office.district,
    phone: phones[0] ?? "",
    note: phones.slice(1).join("\n"),
    police: office.police,
  };
};
