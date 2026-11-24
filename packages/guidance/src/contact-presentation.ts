import type {
  ContactServiceKey,
  GuidanceContactOption,
} from "@animal-helper/contracts";

type ContactPresentation = {
  title: string;
  description?: string;
  notice?: {
    emphasis: "critical" | "important";
    title: string;
    description: string;
    strong?: string;
  };
};

// Visual design frames 2129:19129, 2122:14396 and 2129:19017.
// A protected variant is an explicit reviewed admin choice, never inferred from a label.
export function contactPresentation(
  service: ContactServiceKey,
  variant?: GuidanceContactOption["clinicVariant"],
): ContactPresentation | undefined {
  if (service === "municipality_capture")
    return {
      title: "Kontaktujte mesto alebo obec",
      description:
        "Obec má zo zákona povinnosť zabezpečiť odchyt túlavých zvierat a ich umiestnenie do útulku, a to aj v prípade, ak sú zranené.\nObci oznámte, kde sa zviera nachádza a v akom je stave.",
      notice: {
        emphasis: "critical" as const,
        title: "Dôležité!",
        description:
          "Útulky a dobrovoľníci sú na hranici svojich možností a nemôžu nahrádzať povinnosti obcí.",
        strong:
          "Iné možnosti pomoci využite, až keď ste sa opakovane pokúsili získať pomoc od obce, no neuspeli ste.",
      },
    };
  if (service === "vet_clinic" || service === "vet_exotic")
    return variant === "protected"
      ? {
          title: "Kontaktujte veterinárnu kliniku",
          description: "Chránených živočíchov prevezmú bezplatne.",
        }
      : {
          title: "Môžete kontaktovať veterinárnu kliniku",
          description:
            "Vybrali sme najbližšie veterinárne kliniky vo vašom okolí, ktoré majú momentálne otvorené.",
          notice: {
            emphasis: "important" as const,
            title: "Pozor, nebude to bezplatné",
            description:
              "Ak si objednáte ošetrenie veterinára, náklady budete musieť uhradiť vy, pokiaľ sa vopred nedohodnete inak. Niektoré veterinárne pracoviská poskytujú aj pohotovosť a výjazdy. Vopred si telefonicky overte ich dostupnosť a prípadné príplatky. Spoluprácu s klinikami ešte pripravujeme. Zatiaľ vám zobrazujeme najbližšie veterinárne pracoviská.",
          },
        };
  return undefined;
}
