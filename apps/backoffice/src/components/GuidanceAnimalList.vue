<script setup lang="ts">
import { computed, ref } from "vue";
import {
  groupKeys,
  type AnimalKind,
  type GroupKey,
} from "@animal-helper/guidance";
import { t } from "@animal-helper/i18n";
import { createSearchMatcher } from "@animal-helper/search";

const props = defineProps<{
  kinds: readonly AnimalKind[];
  selectedKey?: string | undefined;
  includeGeneral?: boolean;
  shared?: boolean;
  pending?: boolean;
  status?: (key: string) => string;
}>();
const emit = defineEmits<{ select: [key: string] }>();
function select(key: string) {
  if (!props.pending && !props.shared) emit("select", key);
}
const query = ref("");
const group = ref<GroupKey | "all">("all");
const visibleKinds = computed(() => {
  const matches = createSearchMatcher(query.value);
  return props.kinds.filter(
    (kind) =>
      (group.value === "all" || kind.groupKey === group.value) &&
      matches([
        kind.key,
        kind.labelSk,
        kind.matrix.injuredId,
        kind.matrix.strayId,
        kind.matrix.crueltyId,
        kind.injured?.flowKey,
        kind.cruelty?.flowKey,
      ]),
  );
});
</script>

<template>
  <section class="guidance-animals" aria-label="Druhy zvierat">
    <label>
      {{ t("backoffice.guidance.search") }}
      <input v-model="query" type="search" />
    </label>
    <p class="muted">{{ t("backoffice.searchHelp") }}</p>
    <label>
      {{ t("backoffice.guidance.group.all") }}
      <select v-model="group">
        <option value="all">{{ t("backoffice.guidance.group.all") }}</option>
        <option v-for="key in groupKeys" :key="key" :value="key">
          {{ t(`catalog.group.${key}`) }}
        </option>
      </select>
    </label>
    <p class="muted">
      {{ t("backoffice.guidance.count") }}: {{ visibleKinds.length }}
    </p>
    <p v-if="!visibleKinds.length" class="muted">
      {{ t("backoffice.guidance.empty") }}
    </p>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>{{ t("backoffice.guidance.column.label") }}</th>
            <th>{{ t("backoffice.guidance.column.kind") }}</th>
            <slot name="head"><th>Postup</th></slot>
          </tr>
        </thead>
        <tbody>
          <tr
            v-if="includeGeneral"
            :class="{ selected: selectedKey === '' || shared }"
            @click="select('')"
          >
            <td>
              <button
                class="table-link"
                type="button"
                :disabled="pending || shared"
                :aria-pressed="selectedKey === '' || shared"
                @click.stop="select('')"
              >
                Všetky druhy / neznámy druh
              </button>
            </td>
            <td>—</td>
            <td>{{ status?.("") }}</td>
          </tr>
          <tr
            v-for="kind in visibleKinds"
            :key="kind.key"
            :class="{ selected: !shared && kind.key === selectedKey }"
            @click="select(kind.key)"
          >
            <td>
              <button
                class="table-link"
                type="button"
                :disabled="pending || shared"
                :aria-pressed="!shared && kind.key === selectedKey"
                @click.stop="select(kind.key)"
              >
                {{ kind.labelSk }}
              </button>
            </td>
            <td>
              <code>{{ kind.key }}</code>
            </td>
            <slot name="cells" :kind="kind"
              ><td>{{ status?.(kind.key) }}</td></slot
            >
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
label {
  max-width: 440px;
}
table {
  min-width: 640px;
}
</style>
