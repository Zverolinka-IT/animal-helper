import { effectScope, ref, type EffectScope } from "vue";
import { afterEach, expect, it, vi } from "vitest";

import { fetchCase, updateCase, type AdminCaseDetail } from "../src/api.js";
import { useCaseWorkspace } from "../src/case-workspace.js";

vi.mock("../src/api.js", () => ({ fetchCase: vi.fn(), updateCase: vi.fn() }));

const detail = (streamId: string): AdminCaseDetail => ({
  streamId,
  revision: 7,
  caseNumber: streamId,
  createdAt: "2026-10-21T12:00:00Z",
  updatedAt: "2026-10-21T12:00:00Z",
  workflowState: "in_review",
  situationType: "injured",
  speciesKey: "domestic_cat",
  address: "Synthetic place",
  reporterEmail: "",
  mode: "active",
  urgency: "normal",
  ownerEmail: "admin@example.invalid",
  nextStep: "",
  deadline: "",
  unread: false,
  waitingOnAuthority: false,
  facts: {
    situationType: "injured",
    speciesKey: "domestic_cat",
    address: "Synthetic place",
    symptoms: [],
    description: "",
    reporterName: "",
    reporterPhone: "",
    reporterEmail: "",
    shareWithAuthorities: false,
    mediaCount: 0,
  },
  work: {
    mode: "active",
    urgency: "normal",
    ownerEmail: "admin@example.invalid",
    nextStep: "",
    deadline: "",
    note: `${streamId} note`,
    actions: [],
    referrals: [],
    steps: [],
  },
});
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const scopes: EffectScope[] = [];
const harness = () => {
  const route = ref("case-A");
  const scope = effectScope();
  scopes.push(scope);
  const workspace = scope.run(() => useCaseWorkspace(() => route.value));
  if (!workspace) throw new Error("workspace not created");
  return { route, workspace };
};
afterEach(() => {
  scopes.splice(0).forEach((scope) => scope.stop());
  vi.resetAllMocks();
});

it("ignores an older case fetch and binds edits to the displayed case", async () => {
  const a = deferred<AdminCaseDetail>();
  const b = deferred<AdminCaseDetail>();
  vi.mocked(fetchCase).mockImplementation((id) =>
    id === "case-A" ? a.promise : b.promise,
  );
  const { route, workspace } = harness();
  route.value = "case-B";
  expect(await workspace.run({ type: "close" })).toBe(false);
  b.resolve(detail("case-B"));
  await b.promise;
  a.resolve(detail("case-A"));
  await a.promise;
  expect(workspace.item.value?.streamId).toBe("case-B");
  expect(workspace.note.value).toBe("case-B note");
  vi.mocked(updateCase).mockResolvedValue(detail("case-B"));
  await workspace.run({ type: "set_work", note: workspace.note.value });
  expect(updateCase).toHaveBeenCalledWith("case-B", 7, {
    type: "set_work",
    note: "case-B note",
  });
});

it("ignores a mutation response after navigation and synchronizes fields with current server state", async () => {
  vi.mocked(fetchCase).mockImplementation((id) => Promise.resolve(detail(id)));
  const pending = deferred<AdminCaseDetail>();
  vi.mocked(updateCase).mockReturnValueOnce(pending.promise);
  const { route, workspace } = harness();
  await Promise.resolve();
  const mutation = workspace.run({ type: "close" });
  route.value = "case-B";
  await Promise.resolve();
  pending.resolve(detail("case-A"));
  expect(await mutation).toBe(false);
  expect(workspace.item.value?.streamId).toBe("case-B");
  const updated = detail("case-B");
  vi.mocked(updateCase).mockResolvedValue({
    ...updated,
    revision: 9,
    work: { ...updated.work, note: "Current server note" },
  });
  expect(await workspace.run({ type: "take_over" })).toBe(true);
  expect(workspace.note.value).toBe("Current server note");
  expect(workspace.item.value?.revision).toBe(9);
});
