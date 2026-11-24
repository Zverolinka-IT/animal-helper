import { parseContactSpreadsheet } from "./contact-spreadsheet.js";

type WorkerScope = {
  onmessage:
    | ((
        event: MessageEvent<{
          buffer: ArrayBuffer;
          filename: string;
          encoding: string;
        }>,
      ) => void)
    | null;
  postMessage: (message: unknown) => void;
};
const scope = globalThis as unknown as WorkerScope;
scope.onmessage = ({ data }) => {
  try {
    scope.postMessage({
      ok: true,
      workbook: parseContactSpreadsheet(
        data.buffer,
        data.filename,
        data.encoding,
      ),
    });
  } catch {
    scope.postMessage({ ok: false });
  }
};
