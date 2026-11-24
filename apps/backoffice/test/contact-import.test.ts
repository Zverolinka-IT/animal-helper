import { expect, it } from "vitest";
import { utils, write } from "xlsx";
import {
  guessContactColumns,
  previewContactImport,
  MAX_IMPORT_BYTES,
} from "../src/contact-import.js";
import { parseContactSpreadsheet } from "../src/contact-spreadsheet.js";

const csv = (text: string) =>
  parseContactSpreadsheet(new TextEncoder().encode(text).buffer, "contacts.csv")
    .sheets[0];
const id = () => crypto.randomUUID();
it("reads UTF-8 BOM, semicolon CSV, quoted separators/newlines, Slovak headers and leading-zero phone numbers", () => {
  const sheet = csv(
    '\ufeffNázov;Telefón;Adresa;Poznámka\r\n"Klinika; sever";0903123456;"Ulica 1";"riadok 1\nriadok 2"\r\n',
  );
  if (!sheet) throw new Error("sheet missing");
  const rows = previewContactImport(
    sheet,
    0,
    guessContactColumns(sheet.rows[0] ?? []),
    "vet_clinic",
    [],
  );
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    row: 2,
    status: "new",
    entry: {
      name: "Klinika; sever",
      phone: "0903123456",
      note: "riadok 1\nriadok 2",
      enabled: false,
    },
  });
});

it.each(["biff8", "xlsx"] as const)(
  "reads real %s workbooks, sheet selection, formatted phones and Excel dates",
  (bookType) => {
    const book = utils.book_new();
    utils.book_append_sheet(
      book,
      utils.aoa_to_sheet([["Information"], ["Choose the contacts sheet"]]),
      "Readme",
    );
    const sheet = utils.aoa_to_sheet([
      ["Name", "Phone", "VerifiedOn"],
      ["Synthetic vet", 903123456, new Date("2026-10-22T00:00:00Z")],
    ]);
    sheet.B2 = { t: "n", v: 903123456, z: "0000000000" };
    utils.book_append_sheet(book, sheet, "Contacts");
    const buffer = write(book, { type: "array", bookType }) as ArrayBuffer;
    const workbook = parseContactSpreadsheet(
      buffer,
      bookType === "xlsx" ? "contacts.xlsx" : "contacts.xls",
    );
    expect(workbook.sheets.map((sheet) => sheet.name)).toEqual([
      "Readme",
      "Contacts",
    ]);
    const contacts = workbook.sheets[1];
    if (!contacts) throw new Error("sheet missing");
    const result = previewContactImport(
      contacts,
      0,
      guessContactColumns(contacts.rows[0] ?? []),
      "vet_clinic",
      [],
    );
    expect(result[0]).toMatchObject({
      status: "new",
      entry: { phone: "0903123456", verifiedOn: "2026-10-22" },
    });
  },
);

it("maps split names/addresses, multiple services, dates and decimal-comma coordinates without inventing verification", () => {
  const sheet = csv(
    'Meno;Priezvisko;Mesto;Služba;Latitude;Longitude;RadiusKm;VerifiedOn\nJan;Novák;Žilina;"dobrovoľníci|veterinár";"49,2";"18,7";25;22.10.2026',
  );
  if (!sheet) throw new Error("sheet missing");
  const result = previewContactImport(
    sheet,
    0,
    guessContactColumns(sheet.rows[0] ?? []),
    "vet_clinic",
    [],
  );
  expect(result[0]).toMatchObject({
    status: "new",
    entry: {
      name: "Jan Novák",
      address: "Žilina",
      serviceKeys: ["volunteers", "vet_clinic"],
      coverage: {
        kind: "radius",
        center: { latitude: 49.2, longitude: 18.7 },
        radiusKm: 25,
      },
      verifiedOn: "2026-10-22",
      sourceUrl: "",
      reviewDueOn: "",
      hours: { kind: "unknown" },
      enabled: false,
    },
  });
});

it("marks invalid rows, preserves source row numbers and skips exact duplicates within the file and directory", () => {
  const sheet = csv(
    "Name,Phone,Services\nSynthetic vet,+421900000000,vet_clinic\nSynthetic vet,+421900000000,vet_clinic\nInvalid phone,call me,vet_clinic\nUnknown service,0903123456,invented\n,0903123456,volunteers",
  );
  if (!sheet) throw new Error("sheet missing");
  const mapping = guessContactColumns(sheet.rows[0] ?? []);
  const first = previewContactImport(sheet, 0, mapping, "vet_clinic", []);
  expect(first.map((row) => row.status)).toEqual([
    "new",
    "duplicate",
    "invalid",
    "invalid",
    "invalid",
  ]);
  expect(first.map((row) => row.row)).toEqual([2, 3, 4, 5, 6]);
  const original = first[0]?.entry;
  if (!original) throw new Error("valid entry missing");
  const again = previewContactImport(
    sheet,
    0,
    mapping,
    "volunteers",
    [original],
    id,
  );
  expect(again[0]?.status).toBe("duplicate");
  expect(again[1]?.status).toBe("duplicate");
});

it.each(["csv", "biff8", "xlsx"] as const)(
  "imports clinic lists from %s with clinic headers and a veterinary default",
  (format) => {
    const contents = [
      ["Názov veterinárnej ambulancie", "Telefón", "Mesto"],
      ["Synthetic clinic", "0903123456", "Žilina"],
    ];
    const book = utils.book_new();
    utils.book_append_sheet(book, utils.aoa_to_sheet(contents), "Clinics");
    const buffer =
      format === "csv"
        ? new TextEncoder().encode(
            contents.map((row) => row.join(";")).join("\n"),
          ).buffer
        : (write(book, { type: "array", bookType: format }) as ArrayBuffer);
    const sheet = parseContactSpreadsheet(
      buffer,
      `clinics.${format === "biff8" ? "xls" : format}`,
    ).sheets[0];
    if (!sheet) throw new Error("clinic sheet missing");
    const result = previewContactImport(
      sheet,
      0,
      guessContactColumns(sheet.rows[0] ?? []),
      "vet_exotic",
      [],
      id,
      "clinics",
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      status: "new",
      entry: {
        name: "Synthetic clinic",
        serviceKeys: ["vet_exotic"],
        enabled: false,
        phone: "0903123456",
        address: "Žilina",
        verifiedOn: "",
        reviewDueOn: "",
      },
    });
  },
);

it("requires a veterinary service in clinic imports, preserves shared services, and keeps general contact imports unchanged", () => {
  const sheet = csv(
    'Clinic name,Phone,Service\nSynthetic vet,0903123456,Veterinary clinic\nSynthetic exotic,0903123457,Exotic animal vet\nSynthetic volunteer,0903123458,volunteers\nSynthetic shared,0903123459,"vet_clinic|volunteers"',
  );
  if (!sheet) throw new Error("clinic sheet missing");
  const mapping = guessContactColumns(sheet.rows[0] ?? []);
  const clinics = previewContactImport(
    sheet,
    0,
    mapping,
    "vet_clinic",
    [],
    id,
    "clinics",
  );
  expect(clinics.map((row) => row.status)).toEqual([
    "new",
    "new",
    "invalid",
    "new",
  ]);
  expect(clinics[2]?.errors).toEqual(["clinicService"]);
  expect(clinics[3]?.entry?.serviceKeys).toEqual(["vet_clinic", "volunteers"]);
  const contacts = previewContactImport(sheet, 0, mapping, "vet_clinic", []);
  expect(contacts.every((row) => row.status === "new")).toBe(true);
  const shared = clinics[3]?.entry;
  if (!shared) throw new Error("shared clinic missing");
  expect(
    previewContactImport(
      sheet,
      0,
      mapping,
      "vet_clinic",
      [shared],
      id,
      "clinics",
    )[3]?.status,
  ).toBe("duplicate");
});

it("rejects formulas, unsafe links, bad file signatures, excessive files and worksheets", () => {
  const book = utils.book_new();
  const sheet = utils.aoa_to_sheet([
    ["Name", "Phone"],
    ["Formula", "0903123456"],
  ]);
  sheet.A2 = { t: "s", f: '"Formula"', v: "Formula" };
  utils.book_append_sheet(book, sheet, "Contacts");
  const bytes = write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  const parsed = parseContactSpreadsheet(bytes, "contacts.xlsx").sheets[0];
  if (!parsed) throw new Error("sheet missing");
  expect(
    previewContactImport(
      parsed,
      0,
      guessContactColumns(parsed.rows[0] ?? []),
      "vet_clinic",
      [],
    )[0]?.errors,
  ).toContain("formula");
  const unsafe = csv("Name,Website\nUnsafe,javascript:alert(1)");
  if (!unsafe) throw new Error("sheet missing");
  expect(
    previewContactImport(
      unsafe,
      0,
      guessContactColumns(unsafe.rows[0] ?? []),
      "vet_clinic",
      [],
    )[0]?.status,
  ).toBe("invalid");
  expect(() =>
    parseContactSpreadsheet(
      new TextEncoder().encode("not excel").buffer,
      "contacts.xlsx",
    ),
  ).toThrow();
  expect(() =>
    parseContactSpreadsheet(
      new ArrayBuffer(MAX_IMPORT_BYTES + 1),
      "contacts.csv",
    ),
  ).toThrow();
  const tooMany = csv("name\n" + "vet\n".repeat(1051));
  expect(tooMany?.error).toBe("limit");
});

it("imports district coverage and extra phone numbers, including an xlsm workbook", () => {
  const sheet = csv(
    'Názov;Telefón;Územná pôsobnosť\n"Správa CHKO";"033 647 40 02\n0911 011 384";"Pezinok; Košice-okolie"\n"Neznámy okres";0903123456;Atlantída\n',
  );
  if (!sheet) throw new Error("sheet missing");
  const rows = previewContactImport(
    sheet,
    0,
    guessContactColumns(sheet.rows[0] ?? []),
    "sop_rescue",
    [],
  );
  expect(rows[0]).toMatchObject({
    status: "new",
    entry: {
      phone: "033 647 40 02",
      note: "0911 011 384",
      serviceKeys: ["sop_rescue"],
      enabled: false,
      coverage: {
        kind: "districts",
        districts: ["Pezinok", "Košice - okolie"],
      },
    },
  });
  expect(rows[1]).toMatchObject({ status: "invalid", errors: ["districts"] });
  const book = utils.book_new();
  utils.book_append_sheet(
    book,
    utils.aoa_to_sheet([
      ["Názov", "Telefón"],
      ["OPK Trnava", "0910668948"],
    ]),
    "Komory",
  );
  const buffer = write(book, {
    type: "array",
    bookType: "xlsx",
  }) as ArrayBuffer;
  expect(parseContactSpreadsheet(buffer, "komory.xlsm").sheets[0]?.name).toBe(
    "Komory",
  );
});
