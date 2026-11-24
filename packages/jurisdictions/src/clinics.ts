import {
  splitContactPhones,
  type SlovakDistrict,
} from "@animal-helper/contracts";
import clinics from "./generated/clinics.json" with { type: "json" };

export type VeterinaryClinic = {
  id: string;
  name: string;
  address: string;
  phone: string;
  note: string;
  district: SlovakDistrict;
  groups: readonly string[];
};

type StoredClinic = {
  id: string;
  name: string;
  address: string;
  phone: string;
  district: SlovakDistrict;
  groups: string[];
  emergency: boolean;
  visit: boolean;
  hours: string[];
};

const weekday = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Bratislava",
  weekday: "short",
});

const mondayIndex = (now: Date) =>
  ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(
    weekday.format(now),
  );

const phonesFor = (value: string) =>
  splitContactPhones(value.replace(/(\d)\s*\/\s*(?=\d)/gu, "$1 "));

const present = (clinic: StoredClinic, now: Date): VeterinaryClinic => {
  const numbers = phonesFor(clinic.phone);
  const today = clinic.hours[mondayIndex(now)] ?? "";
  const note = [
    today ? `Dnes: ${today}` : "",
    numbers.valid.slice(1).join(", "),
    clinic.emergency ? "Pohotovosť: Áno" : "",
    clinic.visit ? "Výjazd: Áno" : "",
  ]
    .filter(Boolean)
    .join("\n");
  return {
    id: clinic.id,
    name: clinic.name,
    address: clinic.address,
    phone: numbers.valid[0] ?? "",
    note,
    district: clinic.district,
    groups: clinic.groups,
  };
};

const stored = clinics as StoredClinic[];

export const veterinaryClinicsFor = (
  district: string | undefined,
  groups: readonly string[],
  now: Date,
): readonly VeterinaryClinic[] => {
  if (!district || !groups.length) return [];
  const wanted = new Set(groups);
  return stored
    .filter(
      (clinic) =>
        clinic.district === district &&
        clinic.groups.some((group) => wanted.has(group)),
    )
    .map((clinic) => present(clinic, now))
    .sort((a, b) => a.name.localeCompare(b.name, "sk"));
};
