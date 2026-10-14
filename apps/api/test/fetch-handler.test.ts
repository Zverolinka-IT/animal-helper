import { parseCapabilityPepper } from "@animal-helper/event-store";
import { describe, expect, it } from "vitest";

import {
  apiRequestFromFetch,
  fetchResponseFromApi,
  MAX_BODY_BYTES,
  serveFetch,
} from "../src/fetch-handler.js";
import { createApiHandler } from "../src/handler.js";
import { createMemoryGateway } from "../src/memory-gateway.js";

const pepper = parseCapabilityPepper(
  "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff",
);

const handle = createApiHandler({
  gateway: createMemoryGateway(),
  pepper,
  now: () => new Date("2026-08-22T12:00:00.000Z"),
  corsOrigin: "https://customer.example",
});

describe("fetch adapter", () => {
  it("keeps the original path, query, and public host", () => {
    const request = apiRequestFromFetch(
      new Request("https://internal.vercel/status?x=1", {
        headers: {
          host: "internal.vercel",
          "x-forwarded-host": "admin.zverolinka.sk, edge.vercel",
          authorization: "Capability abc",
          origin: "https://customer.example",
          "sec-fetch-site": "cross-site",
          "if-none-match": '"hash"',
        },
      }),
      undefined,
    );

    expect(
      apiRequestFromFetch(
        new Request("https://admin.example/admin/session?path=session&x=1"),
        undefined,
      ),
    ).toMatchObject({
      pathname: "/admin/session",
      search: "?x=1",
    });

    expect(request).toMatchObject({
      method: "GET",
      pathname: "/status",
      search: "?x=1",
      authorization: "Capability abc",
      origin: "https://customer.example",
      host: "admin.zverolinka.sk",
      secFetchSite: "cross-site",
      ifNoneMatch: '"hash"',
    });
  });

  it("serves health on the browser path", async () => {
    const response = await serveFetch(
      handle,
      new Request("https://admin.example/health"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("rejects an oversized or unreadable body", async () => {
    const oversized = await serveFetch(
      handle,
      new Request("https://admin.example/commands", {
        method: "POST",
        body: "x".repeat(MAX_BODY_BYTES + 1),
      }),
    );
    const invalid = await serveFetch(
      handle,
      new Request("https://admin.example/commands", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      }),
    );

    expect(oversized.status).toBe(400);
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toEqual({
      ok: false,
      error: { code: "INVALID_REQUEST" },
    });
  });

  it("appends every session cookie and omits an empty body", () => {
    const response = fetchResponseFromApi({
      status: 204,
      headers: { "cache-control": "no-store" },
      body: null,
      cookies: ["ah=1; HttpOnly", "ah_ceremony=2; HttpOnly"],
    });

    expect(response.status).toBe(204);
    expect(response.body).toBeNull();
    expect(response.headers.getSetCookie()).toEqual([
      "ah=1; HttpOnly",
      "ah_ceremony=2; HttpOnly",
    ]);
  });
});
