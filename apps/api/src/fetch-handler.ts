import { Headers, type Request, Response } from "undici";

import { apiError } from "./errors.js";
import type { ApiRequest, ApiResponse } from "./handler.js";

export const MAX_BODY_BYTES = 65_536;

const textHeader = (request: Request, name: string): string | undefined => {
  const value = request.headers.get(name);
  if (value === null || value.length === 0) {
    return undefined;
  }

  return value;
};

const publicHost = (request: Request): string | undefined => {
  const forwarded = textHeader(request, "x-forwarded-host")
    ?.split(",")[0]
    ?.trim();
  if (forwarded !== undefined && forwarded.length > 0) {
    return forwarded;
  }

  return textHeader(request, "host");
};

export const readFetchBody = async (
  request: Request,
): Promise<{ ok: true; value: unknown } | { ok: false }> => {
  if (
    request.method === "GET" ||
    request.method === "HEAD" ||
    request.method === "OPTIONS"
  ) {
    return { ok: true, value: undefined };
  }

  const declared = textHeader(request, "content-length");
  if (declared !== undefined) {
    const length = Number(declared);
    if (!Number.isInteger(length) || length < 0 || length > MAX_BODY_BYTES) {
      return { ok: false };
    }
  }

  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > MAX_BODY_BYTES) {
    return { ok: false };
  }

  if (bytes.byteLength === 0) {
    return { ok: true, value: undefined };
  }

  try {
    return {
      ok: true,
      value: JSON.parse(new TextDecoder().decode(bytes)) as unknown,
    };
  } catch {
    return { ok: false };
  }
};

export const apiRequestFromFetch = (
  request: Request,
  body: unknown,
): ApiRequest => {
  const url = new URL(request.url, "https://animal-helper.local");
  // Vercel appends an unused /admin/:path* capture as ?path=. Admin rejects
  // every query string, so drop that injected parameter before routing.
  if (url.pathname === "/admin" || url.pathname.startsWith("/admin/")) {
    url.searchParams.delete("path");
  }
  const origin = textHeader(request, "origin");
  const cookie = textHeader(request, "cookie");
  const host = publicHost(request);
  const secFetchSite = textHeader(request, "sec-fetch-site");
  const ifNoneMatch = textHeader(request, "if-none-match");

  return {
    method: request.method,
    pathname: url.pathname,
    search: url.search,
    authorization: textHeader(request, "authorization"),
    body,
    origin,
    ...(cookie === undefined ? {} : { cookie }),
    ...(host === undefined ? {} : { host }),
    ...(secFetchSite === undefined ? {} : { secFetchSite }),
    ...(ifNoneMatch === undefined ? {} : { ifNoneMatch }),
  };
};

export const fetchResponseFromApi = (result: ApiResponse): Response => {
  const headers = new Headers();
  for (const [key, value] of Object.entries(result.headers)) {
    headers.set(key, value);
  }

  for (const cookie of result.cookies ?? []) {
    headers.append("set-cookie", cookie);
  }

  return new Response(
    result.body === null ? null : JSON.stringify(result.body),
    {
      status: result.status,
      headers,
    },
  );
};

export const serveFetch = async (
  handle: (request: ApiRequest) => Promise<ApiResponse>,
  request: Request,
): Promise<Response> => {
  const body = await readFetchBody(request);
  if (!body.ok) {
    const probe = await handle(apiRequestFromFetch(request, undefined));
    return fetchResponseFromApi({
      status: 400,
      headers: probe.headers,
      body: apiError("INVALID_REQUEST"),
    });
  }

  return fetchResponseFromApi(
    await handle(apiRequestFromFetch(request, body.value)),
  );
};
