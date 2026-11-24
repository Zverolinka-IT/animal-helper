import { effectScope, type EffectScope } from "vue";
import { afterEach, expect, it, vi } from "vitest";
import {
  fetchCases,
  type AdminCasePage,
  type AdminCaseSummary,
} from "../src/api.js";
import { useCaseQueue } from "../src/case-queue.js";

vi.mock("../src/api.js", () => ({ fetchCases: vi.fn() }));
const summary = (streamId: string): AdminCaseSummary => ({
  streamId,
  revision: 0,
  caseNumber: streamId,
  createdAt: "2026-10-22T12:00:00Z",
  updatedAt: "2026-10-22T12:00:00Z",
  workflowState: "submitted",
  situationType: "injured",
  speciesKey: "domestic_cat",
  address: "Synthetic place",
  reporterEmail: "reporter@example.invalid",
  mode: "passive",
  urgency: "normal",
  ownerEmail: "",
  nextStep: "",
  deadline: "",
  unread: true,
  waitingOnAuthority: false,
});
const scopes: EffectScope[] = [];
const harness = () => {
  const scope = effectScope();
  scopes.push(scope);
  const queue = scope.run(useCaseQueue);
  if (!queue) throw new Error("queue not initialized");
  return queue;
};
const deferred = () => {
  let resolve!: (value: AdminCasePage) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<AdminCasePage>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
};
afterEach(() => {
  scopes.splice(0).forEach((scope) => scope.stop());
  vi.resetAllMocks();
});

it("applies all filters across pages, ignores unapplied text, and clears all filters", async () => {
  vi.mocked(fetchCases).mockResolvedValueOnce({
    cases: [summary("unfiltered")],
    nextPage: 1,
  });
  const queue = harness();
  await Promise.resolve();
  queue.filters.query = "  Zilnia  ";
  queue.filters.ownerEmail = " admin@ ";
  queue.filters.reporterEmail = "  Reporter@example.invalid  ";
  vi.mocked(fetchCases).mockResolvedValueOnce({
    cases: [summary("match-1")],
    nextPage: 1,
  });
  await queue.applyFilters();
  expect(fetchCases).toHaveBeenLastCalledWith(0, {
    query: "Zilnia",
    reporterEmail: "Reporter@example.invalid",
    ownerEmail: "admin@",
  });
  expect(queue.cases.value.map((item) => item.streamId)).toEqual(["match-1"]);
  queue.filters.reporterEmail = "not-yet-applied@example.invalid";
  queue.filters.ownerEmail = "other@";
  queue.filters.query = "other place";
  expect(queue.filtersChanged.value).toBe(true);
  vi.mocked(fetchCases).mockResolvedValueOnce({
    cases: [summary("match-2")],
    nextPage: null,
  });
  await queue.refresh(1);
  expect(fetchCases).toHaveBeenLastCalledWith(1, {
    query: "Zilnia",
    reporterEmail: "Reporter@example.invalid",
    ownerEmail: "admin@",
  });
  expect(queue.cases.value.map((item) => item.streamId)).toEqual([
    "match-1",
    "match-2",
  ]);
  vi.mocked(fetchCases).mockResolvedValueOnce({
    cases: [summary("unfiltered")],
    nextPage: 1,
  });
  await queue.clearFilters();
  expect(fetchCases).toHaveBeenLastCalledWith(0, {
    query: "",
    reporterEmail: "",
    ownerEmail: "",
  });
  expect(queue.activeFilters.value.reporterEmail).toBe("");
  expect(queue.filters.reporterEmail).toBe("");
  expect(queue.nextPage.value).toBe(1);
  expect(queue.filters).toEqual({
    query: "",
    reporterEmail: "",
    ownerEmail: "",
  });
  expect(queue.hasFilters.value).toBe(false);
  expect(queue.filtersChanged.value).toBe(false);
});

it("ignores obsolete results and errors when filters change during requests", async () => {
  const initial = deferred();
  const first = deferred();
  const latest = deferred();
  vi.mocked(fetchCases)
    .mockReturnValueOnce(initial.promise)
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(latest.promise);
  const queue = harness();
  queue.filters.reporterEmail = "first";
  const a = queue.applyFilters();
  queue.filters.reporterEmail = "latest";
  const b = queue.applyFilters();
  first.resolve({ cases: [summary("wrong")], nextPage: 9 });
  await a;
  expect(queue.pending.value).toBe(true);
  expect(queue.cases.value).toEqual([]);
  latest.resolve({ cases: [summary("correct")], nextPage: null });
  await b;
  initial.reject(new Error("obsolete failure"));
  await Promise.resolve();
  expect(queue.cases.value.map((item) => item.streamId)).toEqual(["correct"]);
  expect(queue.error.value).toBeUndefined();
  expect(queue.nextPage.value).toBeNull();
  expect(queue.pending.value).toBe(false);
});
