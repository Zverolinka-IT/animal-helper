import { contactDirectoryRequestSchema } from "@animal-helper/contracts";
import {
  ContactDirectoryError,
  executeContactDirectoryCommand,
  loadAdminContactDirectory,
} from "@animal-helper/event-store";
import {
  bundledContentHash,
  bundledGuidanceDocument,
  guidanceScope,
} from "@animal-helper/guidance";
import { slovakDate } from "@animal-helper/jurisdictions";
import type { Sql } from "postgres";
import { GUIDANCE_SOURCE_REFERENCES } from "../guidance.js";
import type { ApiRequest, ApiResponse } from "../handler.js";
import { readOperatorSession } from "./auth.js";

const json = (status: number, body: unknown): ApiResponse => ({
  status,
  headers: {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
  },
  body,
});

export const handleAdminContactDirectory = async (
  request: ApiRequest,
  sql: Sql,
  sessionToken: string | undefined,
  now: Date,
): Promise<ApiResponse> => {
  const session = await readOperatorSession(sql, sessionToken, now);
  if (!session)
    return json(401, { ok: false, error: { code: "unauthenticated" } });
  const importing = request.pathname === "/admin/contact-directory/import";
  if (importing && request.method !== "POST")
    return json(405, { error: { code: "method_not_allowed" } });
  if (request.method === "GET")
    return json(200, await loadAdminContactDirectory(sql, guidanceScope));
  const parsed = contactDirectoryRequestSchema.safeParse(request.body);
  if (
    !parsed.success ||
    (parsed.data.command.type === "import_entries") !== importing
  )
    return json(400, { ok: false, error: { code: "invalid_request" } });
  try {
    await executeContactDirectoryCommand(sql, {
      request: parsed.data,
      actorEmail: session.email,
      now,
      today: slovakDate(now),
      scope: guidanceScope,
      fallback: {
        document: bundledGuidanceDocument(),
        contentHash: bundledContentHash(),
        sourceReferences: GUIDANCE_SOURCE_REFERENCES,
      },
    });
    return json(200, await loadAdminContactDirectory(sql, guidanceScope));
  } catch (error) {
    if (!(error instanceof ContactDirectoryError)) throw error;
    return json(
      error.code === "conflict" ? 409 : error.code === "not_found" ? 404 : 400,
      {
        ok: false,
        error: { code: error.code, issues: error.issues },
      },
    );
  }
};
