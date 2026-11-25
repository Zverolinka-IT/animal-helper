import {
  contactBoundarySchema,
  type ContactCoordinates,
  type ContactBoundary,
  type ContactDirectoryEntry,
  type ContactServiceKey,
  type PublicContactDirectory,
} from "@animal-helper/contracts";

const radians = (degrees: number) => (degrees * Math.PI) / 180;
export const distanceKm = (
  a: ContactCoordinates,
  b: ContactCoordinates,
): number => {
  const latitude = radians(b.latitude - a.latitude);
  const longitude = radians(b.longitude - a.longitude);
  const h =
    Math.sin(latitude / 2) ** 2 +
    Math.cos(radians(a.latitude)) *
      Math.cos(radians(b.latitude)) *
      Math.sin(longitude / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
};

const dateFormatter = new Intl.DateTimeFormat("en", {
  timeZone: "Europe/Bratislava",
  numberingSystem: "latn",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const hoursFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Bratislava",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  numberingSystem: "latn",
});

export const slovakDate = (now: Date): string => {
  const parts = dateFormatter.formatToParts(now);
  const part = (name: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === name)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
};

export type ResolvedContact = Readonly<{
  entry: ContactDirectoryEntry;
  distanceKm?: number;
}>;

export const parseContactBoundary = (input: unknown): ContactBoundary => {
  if (typeof input !== "object" || input === null)
    return contactBoundarySchema.parse(input);
  const value = input as Record<string, unknown>;
  if (value.type === "Feature")
    return contactBoundarySchema.parse(value.geometry);
  if (value.type === "FeatureCollection" && Array.isArray(value.features)) {
    const geometries = value.features.map((feature: unknown) =>
      parseContactBoundary(feature),
    );
    return contactBoundarySchema.parse({
      type: "MultiPolygon",
      coordinates: geometries.flatMap((geometry) =>
        geometry.type === "Polygon"
          ? [geometry.coordinates]
          : geometry.coordinates,
      ),
    });
  }
  return contactBoundarySchema.parse(value);
};

// GeoJSON uses longitude/latitude; a polygon's subsequent rings are holes.
const insideRing = (
  point: ContactCoordinates,
  ring: [number, number][],
): boolean => {
  const x = point.longitude,
    y = point.latitude;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i],
      b = ring[j];
    if (!a || !b) return false;
    const [ax, ay] = a,
      [bx, by] = b;
    if (
      Math.abs((x - ax) * (by - ay) - (y - ay) * (bx - ax)) < 1e-10 &&
      x >= Math.min(ax, bx) &&
      x <= Math.max(ax, bx) &&
      y >= Math.min(ay, by) &&
      y <= Math.max(ay, by)
    )
      return true;
    if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax)
      inside = !inside;
  }
  return inside;
};

const insideBoundary = (
  location: ContactCoordinates,
  geometry: ReturnType<typeof parseContactBoundary>,
): boolean => {
  const polygons =
    geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  return polygons.some(
    ([outer, ...holes]) =>
      outer !== undefined &&
      insideRing(location, outer) &&
      !holes.some((hole) => insideRing(location, hole)),
  );
};

export const selectContacts = (
  directory: PublicContactDirectory | undefined,
  service: ContactServiceKey,
  location: ContactCoordinates | undefined,
  now: Date,
  district?: string,
): ResolvedContact[] => {
  const today = slovakDate(now);
  return (directory?.entries ?? [])
    .flatMap((entry): ResolvedContact[] => {
      if (
        !entry.enabled ||
        !entry.serviceKeys.includes(service) ||
        !entry.verifiedOn ||
        entry.verifiedOn > today ||
        !entry.reviewDueOn ||
        entry.reviewDueOn < today ||
        !entry.sourceUrl ||
        (!entry.phone && !entry.website)
      )
        return [];
      if (
        entry.coverage.kind === "radius" &&
        (!location ||
          distanceKm(location, entry.coverage.center) > entry.coverage.radiusKm)
      )
        return [];
      if (
        entry.coverage.kind === "boundary" &&
        (!location || !insideBoundary(location, entry.coverage.geometry))
      )
        return [];
      if (
        entry.coverage.kind === "districts" &&
        !entry.coverage.districts.some((item) => item === district)
      )
        return [];
      return [
        {
          entry,
          ...(location && entry.coordinates
            ? { distanceKm: distanceKm(location, entry.coordinates) }
            : {}),
        },
      ];
    })
    .sort(
      (a, b) =>
        (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity) ||
        a.entry.name.localeCompare(b.entry.name, "sk"),
    );
};

export const phoneHref = (phone: string): string | undefined =>
  /^\+?[0-9][0-9 ()-]+$/u.test(phone) &&
  /^\+?\d{2,15}$/u.test(phone.replace(/[ ()-]/gu, ""))
    ? `tel:${phone.replace(/[ ()-]/gu, "")}`
    : undefined;

export const navigationHref = (
  entry: ContactDirectoryEntry,
): string | undefined => {
  const destination = entry.coordinates
    ? `${entry.coordinates.latitude},${entry.coordinates.longitude}`
    : entry.address;
  return destination
    ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`
    : undefined;
};

const minutes = (time: string) =>
  Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
export type ContactAvailability = Readonly<{
  label: string;
  tone: "open" | "closing" | "closed" | "unknown";
}>;

export const contactAvailability = (
  hours: ContactDirectoryEntry["hours"],
  now: Date,
): ContactAvailability => {
  if (hours.kind === "unknown")
    return { label: "Otváracie hodiny nie sú overené", tone: "unknown" };
  if (hours.kind === "always") return { label: "Nonstop", tone: "open" };
  const parts = hoursFormatter.formatToParts(now);
  const part = (name: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === name)?.value ?? "";
  const day = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(
    part("weekday"),
  );
  const current =
    day * 1440 + Number(part("hour")) * 60 + Number(part("minute"));
  const week = 7 * 1440;
  const intervals = hours.intervals
    .flatMap((interval) => {
      const start = interval.day * 1440 + minutes(interval.opens);
      const end =
        interval.day * 1440 +
        minutes(interval.closes) +
        (interval.closes < interval.opens ? 1440 : 0);
      return [-week, 0, week].map((offset) => ({
        start: start + offset,
        end: end + offset,
      }));
    })
    .sort((a, b) => a.start - b.start);
  // Merge adjacent/overlapping shifts before calculating the true closing time.
  const merged: { start: number; end: number }[] = [];
  for (const interval of intervals) {
    const previous = merged.at(-1);
    if (previous && interval.start <= previous.end)
      previous.end = Math.max(previous.end, interval.end);
    else merged.push({ ...interval });
  }
  const active = merged.find(
    (interval) => interval.start <= current && current < interval.end,
  );
  if (!active)
    return { label: "Zatvorené podľa otváracích hodín", tone: "closed" };
  const closing = active.end - current <= 60;
  const end = active.end % 1440;
  const until = `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`;
  return {
    label: `${closing ? "Čoskoro zatvára" : "Otvorené"} · do ${until}`,
    tone: closing ? "closing" : "open",
  };
};

export { authorityContactsFor, districtForPlace } from "./territory.js";
export type { AuthorityContact, AuthorityService } from "./territory.js";
export { veterinaryClinicsFor } from "./clinics.js";
export type { VeterinaryClinic } from "./clinics.js";
export { municipalityOfficeFor } from "./municipalities.js";
export type { MunicipalityOffice } from "./municipalities.js";
