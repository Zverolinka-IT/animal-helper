import { afterEach, expect, it, vi } from "vitest";
import { fetchCases, type AdminCaseFilters } from "../src/api.js";

afterEach(() => {
  vi.unstubAllGlobals();
});
it.each<AdminCaseFilters>([
  { query: "Zilnia", reporterEmail: "", ownerEmail: "" },
  { query: "", reporterEmail: "private@example.invalid", ownerEmail: "" },
  { query: "", reporterEmail: "", ownerEmail: "assigned@example.invalid" },
  {
    query: "Zilnia",
    reporterEmail: "private@example.invalid",
    ownerEmail: "assigned@",
  },
])(
  "sends each search and combined searches through the same private POST: %j",
  async (filters) => {
    const fetch = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ cases: [], nextPage: null }), {
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetch);
    await fetchCases(2, filters);
    expect(fetch).toHaveBeenLastCalledWith(
      "/admin/cases/search",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify({ schemaVersion: 1, page: 2, ...filters }),
      }),
    );
    await fetchCases(1, { query: " ", reporterEmail: " ", ownerEmail: " " });
    expect(fetch).toHaveBeenLastCalledWith(
      "/admin/cases/page/1",
      expect.objectContaining({ method: "GET" }),
    );
  },
);
