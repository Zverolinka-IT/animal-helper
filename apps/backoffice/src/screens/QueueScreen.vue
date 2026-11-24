<script setup lang="ts">
import { computed, ref } from "vue";
import { RouterLink } from "vue-router";

import { findAnimalKind } from "@animal-helper/guidance";
import { t } from "@animal-helper/i18n";

import type { AdminCaseSummary } from "../api.js";
import { useCaseQueue } from "../case-queue.js";

const {
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
} = useCaseQueue();
const mode = ref("all");

const species = (key: string): string =>
  key === ""
    ? t("backoffice.case.none")
    : (findAnimalKind(key)?.labelSk ?? key);

const situation = (value: string): string => {
  switch (value) {
    case "injured":
    case "stray":
    case "dead":
    case "cruelty":
    case "other":
      return t(`backoffice.queue.situation.${value}`);
    default:
      return value === "" ? t("backoffice.case.none") : value;
  }
};

const dueNow = (item: AdminCaseSummary): boolean => {
  if (item.deadline === "") {
    return false;
  }
  return new Date(item.deadline).getTime() <= Date.now();
};

const counters = computed(() => ({
  active: cases.value.filter((item) => item.mode === "active").length,
  needs: cases.value.filter((item) => item.mode === "review").length,
  unread: cases.value.filter((item) => item.unread).length,
  due: cases.value.filter(dueNow).length,
  waiting: cases.value.filter((item) => item.waitingOnAuthority).length,
}));

const visible = computed(() => {
  return cases.value.filter((item) => {
    if (mode.value === "active" && item.mode !== "active") {
      return false;
    }
    if (mode.value === "review" && item.mode !== "review") {
      return false;
    }
    if (mode.value === "unread" && !item.unread) {
      return false;
    }
    if (mode.value === "due" && !dueNow(item)) {
      return false;
    }
    if (mode.value === "waiting" && !item.waitingOnAuthority) {
      return false;
    }
    return true;
  });
});
</script>

<template>
  <section class="page queue-screen">
    <h1>{{ t("backoffice.queue.title") }}</h1>
    <p class="muted">{{ t("backoffice.queue.help") }}</p>
    <p v-if="error" class="error">
      {{ error }}
      <button type="button" :disabled="pending" @click="refresh()">
        {{ t("backoffice.case.reload") }}
      </button>
    </p>
    <div class="counters">
      <button
        type="button"
        :aria-pressed="mode === 'all'"
        @click="mode = 'all'"
      >
        <span>{{ t("backoffice.queue.all") }}</span>
        <strong>{{ cases.length }}</strong>
      </button>
      <button
        type="button"
        :aria-pressed="mode === 'active'"
        @click="mode = 'active'"
      >
        <span>{{ t("backoffice.queue.active") }}</span>
        <strong>{{ counters.active }}</strong>
      </button>
      <button
        type="button"
        :aria-pressed="mode === 'review'"
        @click="mode = 'review'"
      >
        <span>{{ t("backoffice.queue.needsAdmin") }}</span>
        <strong>{{ counters.needs }}</strong>
      </button>
      <button
        type="button"
        :aria-pressed="mode === 'unread'"
        @click="mode = 'unread'"
      >
        <span>{{ t("backoffice.queue.unread") }}</span>
        <strong>{{ counters.unread }}</strong>
      </button>
      <button
        type="button"
        :aria-pressed="mode === 'due'"
        @click="mode = 'due'"
      >
        <span>{{ t("backoffice.queue.due") }}</span>
        <strong>{{ counters.due }}</strong>
      </button>
      <button
        type="button"
        :aria-pressed="mode === 'waiting'"
        @click="mode = 'waiting'"
      >
        <span>{{ t("backoffice.queue.waiting") }}</span>
        <strong>{{ counters.waiting }}</strong>
      </button>
    </div>
    <form class="queue-filters" @submit.prevent="applyFilters">
      <label>
        {{ t("backoffice.queue.search") }}
        <input v-model="filters.query" type="search" maxlength="500" />
      </label>
      <label>
        {{ t("backoffice.queue.reporterEmail") }}
        <input
          v-model="filters.reporterEmail"
          type="search"
          inputmode="email"
          autocomplete="off"
          autocapitalize="none"
          :spellcheck="false"
          maxlength="320"
          :placeholder="t('backoffice.queue.emailPlaceholder')"
        />
      </label>
      <label>
        {{ t("backoffice.queue.ownerEmail") }}
        <input
          v-model="filters.ownerEmail"
          type="search"
          inputmode="email"
          autocomplete="off"
          autocapitalize="none"
          :spellcheck="false"
          maxlength="320"
          :placeholder="t('backoffice.queue.emailPlaceholder')"
        />
      </label>
      <button type="submit" :disabled="pending && !filtersChanged">
        {{ t("backoffice.queue.applyFilter") }}
      </button>
      <button
        v-if="hasFilters || filtersChanged"
        type="button"
        class="button-quiet"
        @click="clearFilters"
      >
        {{ t("backoffice.queue.clearFilter") }}
      </button>
    </form>
    <p class="muted">{{ t("backoffice.searchHelp") }}</p>
    <p v-if="hasFilters" class="muted">
      {{ t("backoffice.queue.filtersApplied") }}
      <span v-if="activeFilters.query"
        >{{ t("backoffice.queue.search") }}:
        <strong>{{ activeFilters.query }}</strong
        >.
      </span>
      <span v-if="activeFilters.reporterEmail"
        >{{ t("backoffice.queue.reporterEmail") }}:
        <strong>{{ activeFilters.reporterEmail }}</strong
        >.
      </span>
      <span v-if="activeFilters.ownerEmail"
        >{{ t("backoffice.queue.ownerEmail") }}:
        <strong>{{ activeFilters.ownerEmail }}</strong
        >.</span
      >
    </p>
    <p v-if="pending" role="status" class="muted">
      {{ t("backoffice.queue.loading") }}
    </p>
    <p
      v-if="visible.length === 0 && !pending && !error"
      class="empty-state muted"
    >
      {{ t("backoffice.queue.empty") }}
    </p>
    <div v-if="visible.length > 0" class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>
              <span class="sr-only">{{ t("backoffice.queue.unread") }}</span>
            </th>
            <th>{{ t("backoffice.queue.case") }}</th>
            <th>{{ t("backoffice.queue.reporterEmail") }}</th>
            <th>{{ t("backoffice.queue.received") }}</th>
            <th>{{ t("backoffice.queue.type") }}</th>
            <th>{{ t("backoffice.queue.animal") }}</th>
            <th>{{ t("backoffice.queue.place") }}</th>
            <th>{{ t("backoffice.queue.progress") }}</th>
            <th>{{ t("backoffice.queue.status") }}</th>
            <th>{{ t("backoffice.queue.owner") }}</th>
            <th>{{ t("backoffice.queue.deadline") }}</th>
            <th>{{ t("backoffice.queue.next") }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in visible" :key="item.streamId">
            <td class="unread-dot">
              <span
                v-if="item.unread"
                :aria-label="t('backoffice.queue.unread')"
                >●</span
              >
            </td>
            <td>
              <RouterLink
                :to="{ name: 'case', params: { streamId: item.streamId } }"
              >
                {{ item.caseNumber }}
              </RouterLink>
            </td>
            <td class="reporter-email">
              {{ item.reporterEmail || t("backoffice.case.none") }}
            </td>
            <td>{{ new Date(item.createdAt).toLocaleString("sk-SK") }}</td>
            <td>{{ situation(item.situationType) }}</td>
            <td>{{ species(item.speciesKey) }}</td>
            <td>{{ item.address || t("backoffice.case.none") }}</td>
            <td>
              {{
                t(
                  `backoffice.queue.${item.workflowState === "in_review" ? "inReview" : item.workflowState}`,
                )
              }}
            </td>
            <td>
              <span class="status" :class="`status-${item.mode}`">{{
                t(`backoffice.queue.mode.${item.mode}`)
              }}</span>
            </td>
            <td>{{ item.ownerEmail || t("backoffice.case.none") }}</td>
            <td :class="{ overdue: dueNow(item) }">
              {{
                item.deadline === ""
                  ? t("backoffice.case.none")
                  : new Date(item.deadline).toLocaleString("sk-SK")
              }}
            </td>
            <td>{{ item.nextStep || t("backoffice.case.none") }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <button
      v-if="nextPage !== null"
      type="button"
      :disabled="pending"
      @click="refresh(nextPage)"
    >
      {{ t("backoffice.queue.loadMore") }}
    </button>
  </section>
</template>
