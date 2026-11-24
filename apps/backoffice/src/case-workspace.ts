import { onScopeDispose, ref, watch } from "vue";

import { t } from "@animal-helper/i18n";

import {
  fetchCase,
  updateCase,
  type AdminCaseDetail,
  type AdminError,
} from "./api.js";

export const useCaseWorkspace = (streamId: () => string) => {
  const error = ref<string>();
  const pending = ref(false);
  const item = ref<AdminCaseDetail>();
  const urgency = ref<AdminCaseDetail["urgency"]>("normal");
  const nextStep = ref("");
  const deadline = ref("");
  const note = ref("");
  const inspectionReferral = ref("");
  let generation = 0;
  let loadedStreamId: string | undefined;

  const show = (detail: AdminCaseDetail) => {
    item.value = detail;
    urgency.value = detail.work.urgency;
    nextStep.value = detail.work.nextStep;
    deadline.value = detail.work.deadline;
    note.value = detail.work.note;
    inspectionReferral.value = detail.work.referrals[0]?.id ?? "";
  };

  const load = async () => {
    const id = streamId();
    const request = ++generation;
    loadedStreamId = undefined;
    error.value = undefined;
    item.value = undefined;
    try {
      const detail = await fetchCase(id);
      if (request !== generation || streamId() !== id) return;
      loadedStreamId = id;
      show(detail);
    } catch {
      if (request === generation && streamId() === id)
        error.value = t("backoffice.error.queue");
    }
  };

  const run = async (body: unknown) => {
    const id = loadedStreamId;
    if (pending.value || item.value === undefined || id !== streamId())
      return false;
    const request = generation;
    const revision = item.value.revision;
    pending.value = true;
    error.value = undefined;
    try {
      const detail = await updateCase(id, revision, body);
      if (request !== generation || streamId() !== id) return false;
      show(detail);
      return true;
    } catch (caught) {
      if (request === generation && streamId() === id)
        error.value = t(
          (caught as AdminError).code === "conflict"
            ? "backoffice.error.caseConflict"
            : "backoffice.error.queue",
        );
      return false;
    } finally {
      pending.value = false;
    }
  };

  watch(
    streamId,
    () => {
      void load();
    },
    { immediate: true, flush: "sync" },
  );
  onScopeDispose(() => {
    generation++;
  });

  return {
    error,
    pending,
    item,
    urgency,
    nextStep,
    deadline,
    note,
    inspectionReferral,
    load,
    run,
  };
};
