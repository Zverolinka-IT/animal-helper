import type { ReportGuidanceContext } from "@animal-helper/contracts";
import {
  customerWalkableSteps,
  contactOptionPath,
  isContactOptionInstruction,
  reportGuidancePaths,
  type GuidanceItem,
  type SituationKey,
} from "@animal-helper/guidance";

export type PreviewTransition = { label: string; target: string };
export type PreviewScreen = {
  id: string;
  path: string;
  title: string;
  description: string;
  items: readonly GuidanceItem[];
  transitions: PreviewTransition[];
};
export type GuidancePreview = { start: string; screens: PreviewScreen[] };

type Input = {
  situation: SituationKey;
  context?: ReportGuidanceContext;
  kindKey?: string;
  items: readonly GuidanceItem[];
};

/** Read-only presentation of the routes and choices implemented by the walk adapter. */
export function guidancePreview(input: Input): GuidancePreview {
  const screens: PreviewScreen[] = [];
  const add = (
    id: string,
    path: string,
    title: string,
    description = "",
    items: readonly GuidanceItem[] = [],
  ) => {
    const screen: PreviewScreen = {
      id,
      path,
      title,
      description,
      items,
      transitions: [],
    };
    screens.push(screen);
    return screen;
  };
  const get = (id: string): PreviewScreen => {
    const screen = screens.find((entry) => entry.id === id);
    if (!screen) throw new Error(`Missing preview screen: ${id}`);
    return screen;
  };
  const edge = (from: string, target: string, label = "Pokračovať") => {
    const screen = screens.find((entry) => entry.id === from);
    if (!screen) throw new Error(`Missing preview screen: ${from}`);
    screen.transitions.push({ label, target });
  };
  const form = (id: string, title: string) => {
    add(
      id,
      `/${id}`,
      title,
      "Voliteľný kontakt a súhlasy. Hlásenie sa odošle až potvrdením formulára.",
    );
    edge(id, "received", "Odoslať a ukončiť");
  };
  const identify = (prefix: string, next: string) => {
    add(
      `${prefix}photo`,
      "/w04",
      "Fotografia alebo video",
      "Súbory zostávajú lokálne; rozpoznávanie druhu ešte nie je zapojené.",
    );
    add(
      `${prefix}species`,
      "/w06",
      "Určenie druhu zvieraťa",
      "Výber druhu, skupiny alebo neznámeho zvieraťa.",
    );
    add(
      `${prefix}processing`,
      "/w04",
      "Spracovanie fotografie",
      "Aktuálna implementácia vyžaduje manuálne určenie druhu.",
    );
    edge(`${prefix}photo`, `${prefix}species`, "Nemám fotografiu");
    edge(`${prefix}photo`, `${prefix}processing`, "Potvrdiť fotografiu");
    edge(`${prefix}processing`, next, "Pokračovať bez rozpoznaného druhu");
    edge(`${prefix}species`, next, "Potvrdiť voľbu");
    return `${prefix}photo`;
  };
  add("home", "/", "Výber situácie");
  add(
    "received",
    "/",
    "Hlásenie bolo odoslané",
    "Aplikácia sa vráti na úvod. V náhľade sa nič neodosiela.",
  );
  form("w24", "Pomoc sa podarila / dokončenie hlásenia");
  form("w25", "Pomoc sa nepodarila — dôvody a kontakt");
  form("w39", "Dokončenie dokumentácie prípadu");
  add("location", "/w03", "Miesto nálezu");
  add("details", "/w09", "Údaje o zvierati a okolnostiach");

  if (input.situation === "cruelty") {
    add("acute", "/w27", "Prebieha útok práve teraz?");
    add("police", "/w28", "Výsledok kontaktovania polície");
    add("police-reported", "/w29", "Prípad bol nahlásený");
    add(
      "police-failed",
      "/w30",
      "Prípad sa nepodarilo nahlásiť",
      "Dôvody neúspechu a voliteľný opis zostanú súčasťou hlásenia.",
    );
    edge("home", "acute", "Týranie / zanedbávanie");
    edge("acute", "police", "Volať políciu — 158");
    edge("acute", "location", "Nejde o akútny prípad");
    edge("police", "police-reported", "Podarilo sa nahlásiť");
    edge("police", "police-failed", "Nepodarilo sa nahlásiť");
    edge("police-reported", "location", "Zdokumentovať prípad");
    edge("police-failed", "location", "Zdokumentovať prípad");
    edge("location", identify("", "details"), "Potvrdiť polohu");
    edge("details", "w39", "Potvrdiť okolnosti týrania");
  } else {
    const road = input.context?.startsWith("road-") === true;
    if (input.situation === "other") {
      add("branch", "/w32", "V akej situácii je zviera?");
      edge("home", "branch", "Iná situácia");
      edge(
        "branch",
        "location",
        road
          ? "Na / pri ceste alebo koľajniciach"
          : "Uviaznutie / ľudská činnosť",
      );
      add("other-location", "/w03", "Miesto nálezu — iná situácia");
      add("other-details", "/w09", "Druh zvieraťa a vlastný opis situácie");
      edge("branch", "other-location", "Iná situácia — vlastný opis");
      edge(
        "other-location",
        identify("other-", "other-details"),
        "Potvrdiť polohu",
      );
      edge("other-details", "w39", "Potvrdiť");
    } else
      edge(
        "home",
        "location",
        input.situation === "injured"
          ? "Zranené zviera"
          : input.situation === "stray"
            ? "Zatúlané zviera"
            : "Nález mŕtveho zvieraťa",
      );

    const guideIds: string[] = [];
    if (input.situation === "injured") {
      const steps = customerWalkableSteps(
        "injured",
        input.kindKey,
        input.items,
      );
      for (const step of steps) {
        if (
          ["/w01", "/w03", "/w04", "/w09", "/w24", "/thank-you"].includes(
            step.path,
          )
        )
          continue;
        const items = input.items.filter((item) =>
          isContactOptionInstruction(item.instructionKey)
            ? contactOptionPath(item.instructionKey) === step.path
            : step.screenKeys.includes(item.screenKey),
        );
        // The customer skips empty guidance screens.
        if (!items.length) continue;
        const id = `guide-${guideIds.length}`;
        add(
          id,
          step.path,
          items[0]?.slots["contact.title"] ??
            (step.path === "/w22" ? "Svojpomoc" : "Pokyny a možnosti pomoci"),
          "",
          items,
        );
        guideIds.push(id);
      }
    } else {
      for (const path of reportGuidancePaths(input.items)) {
        const warning = path === "/w14";
        const items = input.items.filter((item) =>
          warning
            ? item.screenKey === "w14"
            : isContactOptionInstruction(item.instructionKey) &&
              contactOptionPath(item.instructionKey) === path,
        );
        const id = warning ? "warning" : `guide-${guideIds.length}`;
        add(
          id,
          path,
          warning
            ? input.items.length
              ? "Upozornenia a pokyny"
              : "Overený postup nie je nastavený"
            : (items[0]?.slots["contact.title"] ?? "Kontakt"),
          warning
            ? input.items.length
              ? ""
              : "Používateľ môže pokračovať v dokumentovaní a odoslaní hlásenia."
            : "Kontaktné údaje sa vyberajú zo zverejneného adresára.",
          items,
        );
        guideIds.push(id);
      }
    }
    for (const [index, id] of guideIds.entries()) {
      const screen = get(id);
      const contact = screen.items.some(
        (item) =>
          item.action?.kind === "call-contact" ||
          item.instructionKey === "self_help",
      );
      const next = guideIds[index + 1];
      if (contact) edge(id, "w24", "Podarilo sa pomôcť");
      edge(
        id,
        next ?? (road ? "road-failed" : contact ? "w25" : "w24"),
        contact ? "Iné možnosti / nepodarilo sa pomôcť" : "Pokračovať",
      );
    }
    if (road) {
      add(
        "road-details",
        "/w33",
        "Situácia na ceste",
        "Konkrétna voľba v náhľade zodpovedá vybranému profilu. Kontakt sa vyberá pred identifikáciou druhu.",
      );
      add("road-failed", "/w37", "Dôvody neúspechu kontaktovania služby");
      add("road-documentation", "/w09", "Určenie zvieraťa pre dokumentáciu");
      form("w38", "Dokumentácia cesty a ponuka ďalšej pomoci");
      add(
        "injured-handoff",
        "",
        "Pokračovanie v toku Zranené",
        "Použije sa postup podľa práve identifikovaného druhu v tom istom hlásení. Jeho podrobný priebeh si môžete prezrieť na karte Zranené.",
      );
      edge(
        "w38",
        "injured-handoff",
        "Vyžiadať ďalšiu pomoc zranenému zvieraťu",
      );
      edge("location", "road-details", "Potvrdiť polohu");
      edge("road-details", guideIds[0] ?? "road-failed", "Potvrdiť situáciu");
      edge(
        "road-failed",
        identify("road-", "road-documentation"),
        "Zdokumentovať prípad",
      );
      edge("road-documentation", "w38", "Potvrdiť druh");
    } else {
      edge("location", identify("", "details"), "Potvrdiť polohu");
      edge("details", guideIds[0] ?? "w24", "Potvrdiť údaje");
    }
  }
  // Show only reachable branches; no inactive outcome forms in the overview.
  const reachable = new Set<string>();
  const visit = (id: string) => {
    if (reachable.has(id)) return;
    const screen = screens.find((entry) => entry.id === id);
    if (!screen) throw new Error(`Missing preview target: ${id}`);
    reachable.add(id);
    for (const transition of screen.transitions) visit(transition.target);
  };
  visit("home");
  return {
    start: "home",
    screens: [...reachable].map((id) => get(id)),
  };
}
