import { read, utils, type CellObject } from "xlsx";
import {
  MAX_IMPORT_BYTES,
  MAX_IMPORT_ROWS,
  type ImportWorkbook,
} from "./contact-import.js";

// Run only in the import worker. The sheet and cell limits also bound the data
// returned to Vue; the caller terminates work that exceeds the time limit.
export const parseContactSpreadsheet = (
  buffer: ArrayBuffer,
  filename: string,
  encoding = "utf-8",
): ImportWorkbook => {
  if (
    !/\.(csv|xls[xm]?)$/iu.test(filename) ||
    buffer.byteLength > MAX_IMPORT_BYTES
  )
    throw new Error("file");
  const csv = /\.csv$/iu.test(filename);
  if (!csv) {
    const bytes = new Uint8Array(buffer);
    const zip =
      bytes[0] === 0x50 &&
      bytes[1] === 0x4b &&
      bytes[2] === 3 &&
      bytes[3] === 4;
    const ole = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].every(
      (value, index) => bytes[index] === value,
    );
    const biff =
      bytes[0] === 9 && [0, 2, 4, 8].some((value) => value === bytes[1]);
    if (/\.xls[xm]$/iu.test(filename) ? !zip : !ole && !biff)
      throw new Error("file");
  }
  const input = csv
    ? new TextDecoder(encoding, { fatal: true }).decode(buffer)
    : buffer;
  const book = read(input, {
    type: csv ? "string" : "array",
    raw: true,
    cellDates: true,
    cellHTML: false,
    cellFormula: true,
    cellStyles: false,
    bookVBA: false,
    sheetRows: MAX_IMPORT_ROWS + 51,
  });
  if (!book.SheetNames.length || book.SheetNames.length > 20)
    throw new Error("file");
  return {
    sheets: book.SheetNames.map((name) => {
      const sheet = book.Sheets[name];
      if (!sheet?.["!ref"])
        return { name, rows: [], invalidRows: [], error: "empty" };
      const fullRange: unknown = sheet["!fullref"];
      const range = utils.decode_range(
        typeof fullRange === "string" ? fullRange : sheet["!ref"],
      );
      if (range.e.r >= MAX_IMPORT_ROWS + 50 || range.e.c >= 50)
        return { name, rows: [], invalidRows: [], error: "limit" };
      const rows: string[][] = [],
        invalidRows: number[] = [];
      for (let row = 0; row <= range.e.r; row++) {
        const values: string[] = [];
        for (let col = 0; col <= range.e.c; col++) {
          const cell = sheet[utils.encode_cell({ r: row, c: col })] as
            CellObject | undefined;
          if (
            cell?.f ||
            cell?.t === "e" ||
            (typeof cell?.v === "string" && cell.v.startsWith("="))
          )
            invalidRows.push(row + 1);
          const value =
            cell?.v instanceof Date
              ? cell.v.toISOString().slice(0, 10)
              : String(cell?.w ?? cell?.v ?? "");
          if (value.length > 10_000) throw new Error("file");
          values.push(value);
        }
        rows.push(values);
      }
      return { name, rows, invalidRows: [...new Set(invalidRows)] };
    }),
  };
};
