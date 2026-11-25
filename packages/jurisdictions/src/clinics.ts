import {
  splitContactPhones,
  type ContactCoordinates,
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
  coordinates?: ContactCoordinates;
  distanceKm?: number;
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
  latitude?: number;
  longitude?: number;
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

const radians = (degrees: number) => (degrees * Math.PI) / 180;
const distanceKm = (a: ContactCoordinates, b: ContactCoordinates) => {
  const latitude = radians(b.latitude - a.latitude);
  const longitude = radians(b.longitude - a.longitude);
  const h =
    Math.sin(latitude / 2) ** 2 +
    Math.cos(radians(a.latitude)) *
      Math.cos(radians(b.latitude)) *
      Math.sin(longitude / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
};

const present = (
  clinic: StoredClinic,
  now: Date,
  location: ContactCoordinates | undefined,
): VeterinaryClinic => {
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
  const coordinates =
    clinic.latitude !== undefined && clinic.longitude !== undefined
      ? { latitude: clinic.latitude, longitude: clinic.longitude }
      : undefined;
  const distance =
    coordinates && location ? distanceKm(location, coordinates) : undefined;
  return {
    id: clinic.id,
    name: clinic.name,
    address: clinic.address,
    phone: numbers.valid[0] ?? "",
    note,
    district: clinic.district,
    groups: clinic.groups,
    ...(coordinates ? { coordinates } : {}),
    ...(distance === undefined ? {} : { distanceKm: distance }),
  };
};

const stored = clinics as StoredClinic[];

export const veterinaryClinicsFor = (
  district: string | undefined,
  groups: readonly string[],
  now: Date,
  location?: ContactCoordinates,
): readonly VeterinaryClinic[] => {
  if (!district || !groups.length) return [];
  const wanted = new Set(groups);
  return stored
    .filter(
      (clinic) =>
        clinic.district === district &&
        clinic.groups.some((group) => wanted.has(group)),
    )
    .map((clinic) => present(clinic, now, location))
    .sort(
      (a, b) =>
        (a.distanceKm ?? Number.POSITIVE_INFINITY) -
          (b.distanceKm ?? Number.POSITIVE_INFINITY) ||
        a.name.localeCompare(b.name, "sk"),
    );
};
