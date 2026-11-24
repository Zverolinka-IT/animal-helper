<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { t } from "@animal-helper/i18n";
import type { GuidancePreview } from "../guidance-preview.js";
import {
  contactPresentation,
  type GuidanceItem,
} from "@animal-helper/guidance";
import { contactServiceKeys } from "@animal-helper/contracts";
const props = defineProps<{ walk: GuidancePreview }>();
const history = ref<string[]>([]);
watch(
  () => props.walk,
  (walk) => {
    history.value = [walk.start];
  },
  { immediate: true },
);
const current = computed(() =>
  props.walk.screens.find((screen) => screen.id === history.value.at(-1)),
);
const visited = computed(() => new Set(history.value));
function go(target: string) {
  history.value.push(target);
}
function contactInfo(item: GuidanceItem) {
  const service = contactServiceKeys.find(
    (key) => key === item.action?.targetKey,
  );
  return service ? contactPresentation(service, item.clinicVariant) : undefined;
}
</script>
<template>
  <section class="guidance-walk-preview" aria-label="Náhľad prechodov">
    <h3>{{ t("backoffice.guidance.customerWalkTitle") }}</h3>
    <p class="muted">
      Vyberte vetvu pomocou tlačidiel v náhľade. Ide o náhľad obrazoviek a
      prechodov; nič sa neodosiela a telefonáty sa nespúšťajú.
    </p>
    <ol class="walk preview-map">
      <li
        v-for="screen in walk.screens"
        :key="screen.id"
        :class="{
          current: screen.id === current?.id,
          visited: visited.has(screen.id),
        }"
      >
        <strong>{{ screen.title }}</strong>
        <code v-if="screen.path">{{ screen.path }}</code>
        <ul v-if="screen.transitions.length > 1">
          <li v-for="transition in screen.transitions" :key="transition.target">
            {{ transition.label }} →
            {{
              walk.screens.find((entry) => entry.id === transition.target)
                ?.title
            }}
          </li>
        </ul>
      </li>
    </ol>
    <h3>{{ t("backoffice.guidance.previewTitle") }}</h3>
    <article v-if="current" class="preview-copy" aria-live="polite">
      <p>
        <strong>{{ current.title }}</strong>
      </p>
      <p v-if="current.path">
        <code>{{ current.path }}</code>
      </p>
      <p v-if="current.description">{{ current.description }}</p>
      <article v-for="item in current.items" :key="item.instructionKey">
        <p v-for="(text, key) in item.slots" :key="key" class="profile-copy">
          {{ text }}
        </p>
        <p v-if="item.action">
          {{ t(`backoffice.directory.service.${item.action.targetKey}`) }}
        </p>
        <p v-if="item.clinicVariant">
          {{
            t(
              item.clinicVariant === "protected"
                ? "backoffice.guidance.contacts.clinicProtected"
                : "backoffice.guidance.contacts.clinicStandard",
            )
          }}
        </p>
        <p v-if="contactInfo(item)?.description">
          {{ contactInfo(item)?.description }}
        </p>
        <aside v-if="contactInfo(item)?.notice" class="contact-preview-notice">
          <strong>{{ contactInfo(item)?.notice?.title }}</strong>
          <p>{{ contactInfo(item)?.notice?.description }}</p>
          <p v-if="contactInfo(item)?.notice?.strong">
            <strong>{{ contactInfo(item)?.notice?.strong }}</strong>
          </p>
        </aside>
      </article>
      <p class="preview-actions">
        <button
          v-for="transition in current.transitions"
          :key="transition.target"
          type="button"
          @click="go(transition.target)"
        >
          {{ transition.label }}
        </button>
      </p>
    </article>
    <p class="preview-actions">
      <button
        type="button"
        :disabled="history.length < 2"
        @click="history.pop()"
      >
        {{ t("backoffice.guidance.previewBack") }}
      </button>
      <button type="button" @click="history = [walk.start]">
        {{ t("backoffice.guidance.previewRestart") }}
      </button>
    </p>
  </section>
</template>
<style scoped>
.preview-map {
  max-height: 360px;
  overflow: auto;
}
.profile-copy {
  white-space: pre-line;
}
.contact-preview-notice {
  padding: 12px;
  border: 1px solid var(--primary);
  border-radius: 12px;
}
.current {
  outline: 2px solid var(--primary);
  outline-offset: -2px;
}
.preview-copy {
  padding: 16px;
}
</style>
