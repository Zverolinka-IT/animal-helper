// Official district names from the 2026 territorial register supplied with the contact workbooks.
export const slovakDistricts = [
  "Bratislava I",
  "Bratislava II",
  "Bratislava III",
  "Bratislava IV",
  "Bratislava V",
  "Malacky",
  "Pezinok",
  "Senec",
  "Dunajská Streda",
  "Galanta",
  "Hlohovec",
  "Piešťany",
  "Senica",
  "Skalica",
  "Trnava",
  "Bánovce nad Bebravou",
  "Ilava",
  "Myjava",
  "Nové Mesto nad Váhom",
  "Partizánske",
  "Považská Bystrica",
  "Prievidza",
  "Púchov",
  "Trenčín",
  "Komárno",
  "Levice",
  "Nitra",
  "Nové Zámky",
  "Šaľa",
  "Topoľčany",
  "Zlaté Moravce",
  "Bytča",
  "Čadca",
  "Dolný Kubín",
  "Kysucké Nové Mesto",
  "Liptovský Mikuláš",
  "Martin",
  "Námestovo",
  "Ružomberok",
  "Turčianske Teplice",
  "Tvrdošín",
  "Žilina",
  "Banská Bystrica",
  "Banská Štiavnica",
  "Brezno",
  "Detva",
  "Krupina",
  "Lučenec",
  "Poltár",
  "Revúca",
  "Rimavská Sobota",
  "Veľký Krtíš",
  "Zvolen",
  "Žarnovica",
  "Žiar nad Hronom",
  "Bardejov",
  "Humenné",
  "Kežmarok",
  "Levoča",
  "Medzilaborce",
  "Poprad",
  "Prešov",
  "Sabinov",
  "Snina",
  "Stará Ľubovňa",
  "Stropkov",
  "Svidník",
  "Vranov nad Topľou",
  "Gelnica",
  "Košice I",
  "Košice II",
  "Košice III",
  "Košice IV",
  "Košice - okolie",
  "Michalovce",
  "Rožňava",
  "Sobrance",
  "Spišská Nová Ves",
  "Trebišov",
] as const;

export type SlovakDistrict = (typeof slovakDistricts)[number];

const foldDistrict = (value: string) =>
  value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[–—-]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();

const districtsByFold = new Map(
  slovakDistricts.map((name) => [foldDistrict(name), name]),
);

// Empty input is a valid absence of districts. An unknown name is not.
export const parseSlovakDistricts = (
  value: string,
): { ok: true; districts: SlovakDistrict[] } | { ok: false } => {
  const districts: SlovakDistrict[] = [];
  for (const token of value
    .split(/[;\n,]/u)
    .map((part) => part.trim())
    .filter(Boolean)) {
    const district = districtsByFold.get(foldDistrict(token));
    if (!district) return { ok: false };
    if (!districts.includes(district)) districts.push(district);
  }
  return { ok: true, districts };
};
