import { computed, onScopeDispose, reactive, ref } from "vue";
import { t } from "@animal-helper/i18n";
import {
  fetchCases,
  type AdminCaseSummary,
  type AdminCaseFilters,
} from "./api.js";

const emptyFilters = (): AdminCaseFilters => ({
  query: "",
  reporterEmail: "",
  ownerEmail: "",
});

export const useCaseQueue = () => {
  const error = ref<string>();
  const pending = ref(false);
  const cases = ref<readonly AdminCaseSummary[]>([]);
  const nextPage = ref<number | null>(null);
  const filters = reactive(emptyFilters());
  const activeFilters = ref(emptyFilters());
  const hasFilters = computed(() =>
    Object.values(activeFilters.value).some(Boolean),
  );
  const filtersChanged = computed(() =>
    (Object.keys(filters) as (keyof AdminCaseFilters)[]).some(
      (key) => filters[key].trim() !== activeFilters.value[key],
    ),
  );
  let generation = 0;

  const refresh = async (page = 0) => {
    if (page > 0 && pending.value) return;
    const request = ++generation;
    const applied = { ...activeFilters.value };
    pending.value = true;
    error.value = undefined;
    if (page === 0) {
      cases.value = [];
      nextPage.value = null;
    }
    try {
      const result = await fetchCases(page, applied);
      if (request !== generation) return;
      cases.value =
        page === 0
          ? result.cases
          : [
              ...new Map(
                [...cases.value, ...result.cases].map((item) => [
                  item.streamId,
                  item,
                ]),
              ).values(),
            ];
      nextPage.value = result.nextPage;
    } catch {
      if (request === generation) error.value = t("backoffice.error.queue");
    } finally {
      if (request === generation) pending.value = false;
    }
  };
  const applyFilters = () => {
    activeFilters.value = {
      query: filters.query.trim(),
      reporterEmail: filters.reporterEmail.trim(),
      ownerEmail: filters.ownerEmail.trim(),
    };
    return refresh();
  };
  const clearFilters = () => {
    Object.assign(filters, emptyFilters());
    activeFilters.value = emptyFilters();
    return refresh();
  };
  onScopeDispose(() => {
    generation++;
  });
  void refresh();
  return {
    error,
    pending,
    cases,
    nextPage,
    filters,
    activeFilters,
    filtersChanged,
    hasFilters,
    refresh,
    applyFilters,
    clearFilters,
  };
};
