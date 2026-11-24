import {
  contactDirectoryEntrySchema,
  contactImportKey,
  contactServiceKeys,
  parseSlovakDistricts,
  splitContactPhones,
  type ContactDirectoryEntry,
  type ContactServiceKey,
} from "@animal-helper/contracts";
import { t } from "@animal-helper/i18n";
import { matchesDirectoryView, type DirectoryView } from "./directory-view.js";

export const MAX_IMPORT_ROWS = 1000;
export const MAX_IMPORT_BYTES = 5_000_000;
export const importFields = [
  "name",
  "lastName",
  "services",
  "phone",
  "website",
  "address",
  "city",
  "note",
  "latitude",
  "longitude",
  "radiusKm",
  "districts",
  "sourceUrl",
  "verifiedOn",
  "reviewDueOn",
] as const;
export type ImportField = (typeof importFields)[number];
export type ColumnMapping = Record<ImportField, number>;
export type ImportSheet = {
  name: string;
  rows: string[][];
  invalidRows: number[];
  error?: string;
};
export type ImportWorkbook = { sheets: ImportSheet[] };
export type ImportRow = {
  row: number;
  status: "new" | "duplicate" | "invalid";
  name: string;
  errors: string[];
  entry?: ContactDirectoryEntry;
};

const normalized = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/gu, "");
const headers: Record<ImportField, readonly string[]> = {
  name: [
    "name",
    "nazov",
    "meno",
    "kontakt",
    "nazovkontaktu",
    "nazovorganizacie",
    "organizacia",
    "organization",
    "fullname",
    "menoapriezvisko",
    "firstname",
    "nazovambulancie",
    "clinic",
    "clinicname",
    "veterinaryclinic",
    "veterinaryclinicname",
    "nazovkliniky",
    "nazovveterinarnejkliniky",
    "nazovveterinarnejambulancie",
  ],
  lastName: ["lastname", "surname", "priezvisko"],
  services: [
    "services",
    "servicekeys",
    "service",
    "sluzba",
    "sluzby",
    "typ",
    "type",
    "kategoria",
  ],
  phone: ["phone", "telefon", "tel", "mobil", "mobile", "telefonnecislo"],
  website: ["website", "web", "url", "webovastranka"],
  address: ["address", "adresa", "sidlo", "miesto"],
  city: ["city", "mesto", "obec"],
  note: ["note", "notes", "poznamka", "poznamky"],
  latitude: ["latitude", "lat", "zemepisnasirka"],
  longitude: ["longitude", "lon", "lng", "zemepisnadlzka"],
  radiusKm: ["radiuskm", "radius", "polomer", "polomerkm"],
  districts: ["districts", "district", "okres", "okresy", "uzemnaposobnost"],
  sourceUrl: ["sourceurl", "source", "zdroj", "odkaznazdrojoverenia"],
  verifiedOn: ["verifiedon", "verified", "overene", "datumoverenia"],
  reviewDueOn: [
    "reviewdueon",
    "review",
    "overitdo",
    "dalsieoverenie",
    "overitznovunajneskor",
  ],
};
export const guessContactColumns = (
  columns: readonly string[],
): ColumnMapping =>
  Object.fromEntries(
    importFields.map((field) => [
      field,
      columns.findIndex((column) =>
        headers[field].includes(normalized(column)),
      ),
    ]),
  ) as ColumnMapping;

const aliases: Partial<Record<ContactServiceKey, readonly string[]>> = {
  vet_clinic: [
    "vet",
    "veterinar",
    "veterinari",
    "veterinary",
    "veterinarian",
    "veterinary clinic",
    "veterinary practice",
    "veterinárna ambulancia",
    "veterinárna ordinácia",
  ],
  vet_exotic: ["exoticvet", "exotic animal vet", "exotic animal veterinarian"],
  volunteers: ["dobrovolnik", "dobrovolnici", "volunteer"],
  municipality_capture: ["obec", "mesto", "municipality"],
  police: ["policia"],
};
const parseServices = (
  value: string,
  fallback: ContactServiceKey,
): ContactServiceKey[] | undefined => {
  if (!value.trim()) return [fallback];
  const result: ContactServiceKey[] = [];
  for (const part of value.split(/[;,|]/u)) {
    const needle = normalized(part);
    if (!needle) continue;
    const key = contactServiceKeys.find(
      (key) =>
        normalized(key) === needle ||
        normalized(t(`backoffice.directory.service.${key}`)) === needle ||
        aliases[key]?.some((alias) => normalized(alias) === needle),
    );
    if (!key) return undefined;
    result.push(key);
  }
  return result.length ? [...new Set(result)] : undefined;
};
const date = (value: string) => {
  const match = /^(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})$/u.exec(value);
  return match
    ? `${match[3]}-${match[2]?.padStart(2, "0")}-${match[1]?.padStart(2, "0")}`
    : value;
};
const coordinate = (value: string) =>
  /^[-+]?\d+(?:[.,]\d+)?$/u.test(value) ? Number(value.replace(",", ".")) : NaN;
const url = (value: string) =>
  /^www\./iu.test(value) ? `https://${value}` : value;

export const previewContactImport = (
  sheet: ImportSheet,
  headerRow: number,
  mapping: ColumnMapping,
  defaultService: ContactServiceKey,
  existing: readonly ContactDirectoryEntry[],
  createId: () => string = () => crypto.randomUUID(),
  view: DirectoryView = "contacts",
): ImportRow[] => {
  const known = new Set(existing.map(contactImportKey));
  return sheet.rows.slice(headerRow + 1).flatMap((row, index): ImportRow[] => {
    if (!row.some((cell) => cell.trim())) return [];
    const rowNumber = headerRow + index + 2;
    const get = (field: ImportField) =>
      (mapping[field] < 0 ? "" : (row[mapping[field]] ?? "")).trim();
    const name = [get("name"), get("lastName")].filter(Boolean).join(" "),
      latitude = get("latitude"),
      longitude = get("longitude"),
      radius = get("radiusKm");
    const phones = splitContactPhones(
      get("phone")
        .replace(/^tel:/iu, "")
        .replace(/[.\u200b]/gu, "")
        .replace(/[\u2010-\u2015]/gu, "-"),
    );
    const territory = parseSlovakDistricts(get("districts"));
    const errors: string[] = [];
    if (sheet.invalidRows.includes(rowNumber)) errors.push("formula");
    if (get("districts") && !territory.ok) errors.push("districts");
    if (get("phone").trim() && !phones.valid.length) errors.push("phone");
    const serviceKeys = parseServices(get("services"), defaultService);
    if (!serviceKeys) errors.push("services");
    else if (!matchesDirectoryView({ serviceKeys }, view))
      errors.push("clinicService");
    if (radius && (!latitude || !longitude)) errors.push("coverage");
    const parsed = contactDirectoryEntrySchema.safeParse({
      id: createId(),
      name,
      serviceKeys: serviceKeys ?? [defaultService],
      enabled: false,
      phone: phones.valid[0] ?? "",
      website: url(get("website")),
      address: [get("address"), get("city")].filter(Boolean).join(", "),
      note: [
        get("note"),
        [...phones.valid.slice(1), ...phones.invalid].join(", "),
      ]
        .filter(Boolean)
        .join("\n"),
      ...(latitude || longitude
        ? {
            coordinates: {
              latitude: coordinate(latitude),
              longitude: coordinate(longitude),
            },
          }
        : {}),
      coverage:
        territory.ok && territory.districts.length
          ? { kind: "districts", districts: territory.districts }
          : radius
            ? {
                kind: "radius",
                center: {
                  latitude: coordinate(latitude),
                  longitude: coordinate(longitude),
                },
                radiusKm: coordinate(radius),
              }
            : { kind: "national" },
      hours: { kind: "unknown" },
      sourceUrl: url(get("sourceUrl")),
      verifiedOn: date(get("verifiedOn")),
      reviewDueOn: date(get("reviewDueOn")),
    });
    if (!parsed.success)
      errors.push(...parsed.error.issues.map((issue) => String(issue.path[0])));
    if (!parsed.success || errors.length)
      return [
        {
          row: rowNumber,
          name,
          status: "invalid",
          errors: [...new Set(errors)],
        },
      ];
    const key = contactImportKey(parsed.data);
    const duplicate = known.has(key);
    known.add(key);
    return [
      {
        row: rowNumber,
        name,
        status: duplicate ? "duplicate" : "new",
        errors: [],
        entry: parsed.data,
      },
    ];
  });
};
