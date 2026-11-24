import { describe, expect, it } from "vitest";

import { t } from "../src/index.js";

describe("sk-SK customer shell copy", () => {
  it("resolves shell keys and rejects unknown paths", () => {
    expect(t("customer.appName")).toBe("Zvierací ombudsman");
    expect(t("customer.contact.submit")).toBe("Odoslať a ukončiť");
    expect(t("customer.durability.received")).toBe("Nahlásenie bolo prijaté");
    expect(t("backoffice.appName")).toBe("Zverolinka — správa");
    expect(t("backoffice.nav.guidance")).toBe("Matica sprievodcu");
    expect(t("catalog.group.domestic")).toBe("Domáce");
    expect(t("backoffice.error.passkeyOrigin")).toContain("localhost");
    expect(t("backoffice.guidance.instruction.warning.do_not")).toBe(
      "Čo nerobiť",
    );
    expect(t("customer.guide.empty")).toContain("rada");
    expect(t("customer.situation.title")).toBe("Čo sa stalo?");
    expect(t("customer.chrome.logo")).toBe("LOGO");
    expect(() => t("customer.unknown")).toThrow(/Missing locale key/);
  });
});
