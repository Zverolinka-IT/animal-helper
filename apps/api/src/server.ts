import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";

import { apiError } from "./errors.js";
import type { ApiHandlerOptions, ApiResponse } from "./handler.js";
import { createApiHandler } from "./handler.js";

import { bodyLimit } from "./body-limit.js";

const headerValue = (
  value: string | string[] | undefined,
): string | undefined => {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
};

const readBody = async (
  request: IncomingMessage,
): Promise<{ ok: true; value: unknown } | { ok: false }> => {
  request.setEncoding("utf8");
  const limit = bodyLimit(
    request.method ?? "GET",
    new URL(request.url ?? "/", "http://localhost").pathname,
  );
  let body = "";

  for await (const chunk of request) {
    if (typeof chunk !== "string") {
      return { ok: false };
    }

    body += chunk;
    if (Buffer.byteLength(body, "utf8") > limit) {
      return { ok: false };
    }
  }

  if (body.length === 0) {
    return { ok: true, value: undefined };
  }

  try {
    return { ok: true, value: JSON.parse(body) as unknown };
  } catch {
    return { ok: false };
  }
};

export const createHttpServer = (options: ApiHandlerOptions) => {
  const handle = createApiHandler(options);

  return createServer((request: IncomingMessage, response: ServerResponse) => {
    void (async () => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const body = await readBody(request);
      const origin = headerValue(request.headers.origin);
      const cookie = headerValue(request.headers.cookie);
      const host = headerValue(request.headers.host);
      const secFetchSite = headerValue(request.headers["sec-fetch-site"]);
      const ifNoneMatch = headerValue(request.headers["if-none-match"]);
      const result = body.ok
        ? await handle({
            method: request.method ?? "GET",
            pathname: url.pathname,
            search: url.search,
            authorization: headerValue(request.headers.authorization),
            body: body.value,
            origin,
            ...(cookie === undefined ? {} : { cookie }),
            ...(host === undefined ? {} : { host }),
            ...(secFetchSite === undefined ? {} : { secFetchSite }),
            ...(ifNoneMatch === undefined ? {} : { ifNoneMatch }),
          })
        : await handle({
            method: request.method ?? "GET",
            pathname: url.pathname,
            search: url.search,
            authorization: headerValue(request.headers.authorization),
            body: undefined,
            origin,
            ...(cookie === undefined ? {} : { cookie }),
            ...(host === undefined ? {} : { host }),
            ...(secFetchSite === undefined ? {} : { secFetchSite }),
            ...(ifNoneMatch === undefined ? {} : { ifNoneMatch }),
          }).then((parsed): ApiResponse => ({
            status: 400,
            headers: parsed.headers,
            body: apiError("INVALID_REQUEST"),
          }));

      const headers: Record<string, string | string[]> = { ...result.headers };
      if (result.cookies !== undefined && result.cookies.length > 0) {
        headers["set-cookie"] = [...result.cookies];
      }
      response.writeHead(result.status, headers);
      response.end(
        result.body === null ? undefined : JSON.stringify(result.body),
      );
    })().catch(() => {
      if (!response.headersSent) {
        response.writeHead(500, { "cache-control": "no-store" });
      }

      response.end();
    });
  });
};
