<script setup lang="ts">
import GuidanceWalkPreview from "../components/GuidanceWalkPreview.vue";
import { guidancePreview } from "../guidance-preview.js";
import GuidanceAnimalList from "../components/GuidanceAnimalList.vue";
import { animalKinds } from "@animal-helper/guidance";
import ReportGuidanceEditor from "../components/ReportGuidanceEditor.vue";
import { computed, onScopeDispose, ref, watch } from "vue";
import { contactServiceKeys } from "@animal-helper/contracts";

import {
  kindsForSituation,
  situationKeys,
  type AnimalKind,
  type SituationKey,
  isContactInstruction,
  isInstructionKey,
  contactOptionCells,
  resolveKindItems,
} from "@animal-helper/guidance";
import { t } from "@animal-helper/i18n";

import {
  fetchGuidanceKind,
  publishGuidance,
  saveGuidanceCell,
  saveGuidanceContacts,
  type AdminError,
  type GuidanceKindResponse,
} from "../api.js";

const situation = ref<SituationKey>("injured");
const reportEditor = ref<InstanceType<typeof ReportGuidanceEditor>>();
function changeSituation(key: SituationKey, event: Event) {
  if (key === situation.value) return;
  if (reportEditor.value?.canLeave() === false) {
    const input = event.target as HTMLInputElement;
    for (const radio of input
      .closest("fieldset")!
      .querySelectorAll<HTMLInputElement>("input[type=radio]")) {
      radio.checked = radio.value === situation.value;
    }
    return;
  }
  situation.value = key;
}
const selectedKey = ref<string | undefined>(undefined);
const editor = ref<GuidanceKindResponse | undefined>(undefined);
const editorError = ref<string | undefined>(undefined);
const editorPending = ref(false);
const publishDescription = ref("");
const publishConfirmed = ref(false);
const optionLabel = (key: string) => t(`backoffice.guidance.contacts.${key}`);
const serviceLabel = (key: string) => t(`backoffice.directory.service.${key}`);
const editableCells = computed(
  () =>
    editor.value?.cells.filter(
      (cell) => !isContactInstruction(cell.instructionKey),
    ) ?? [],
);
const moveContact = (index: number, direction: -1 | 1) => {
  const options = editor.value?.contactOptions;
  const option = options?.[index];
  const next = index + direction;
  if (!options || !option || next < 0 || next >= options.length) return;
  options.splice(index, 1);
  options.splice(next, 0, option);
};
const addContact = () => {
  editor.value?.contactOptions.push({
    id: crypto.randomUUID(),
    serviceKey: "vet_clinic",
    title: "",
    body: "",
    enabled: true,
  });
};
const removeContact = (index: number) => {
  if (editor.value && editor.value.contactOptions.length > 1)
    editor.value.contactOptions.splice(index, 1);
};
let editorGeneration = 0;
onScopeDispose(() => {
  editorGeneration++;
});

const kinds = computed(() =>
  situation.value === "cruelty"
    ? animalKinds
    : kindsForSituation(situation.value),
);

const selectedKind = computed(
  () =>
    kinds.value.find((kind) => kind.key === selectedKey.value) ??
    kinds.value[0],
);

watch(situation, () => {
  selectedKey.value = kindsForSituation(situation.value)[0]?.key;
});

watch(
  kinds,
  (list) => {
    if (list.some((kind) => kind.key === selectedKey.value)) {
      return;
    }
    selectedKey.value = list[0]?.key;
  },
  { immediate: true },
);

const previewItems = computed(() => {
  const current = editor.value;
  if (!current) return [];
  const cells = current.cells.flatMap((cell) =>
    isInstructionKey(cell.instructionKey) &&
    !isContactInstruction(cell.instructionKey)
      ? [
          {
            ...cell,
            instructionKey: cell.instructionKey,
            kindKey: current.kindKey,
          },
        ]
      : [],
  );
  return resolveKindItems(current.kindKey, {
    copy: {},
    cells: [
      ...cells,
      ...contactOptionCells(current.kindKey, current.contactOptions),
    ],
  });
});
const preview = computed(() =>
  guidancePreview({
    situation: situation.value,
    ...(selectedKind.value ? { kindKey: selectedKind.value.key } : {}),
    items: previewItems.value,
  }),
);

const selectKind = (key: string): void => {
  selectedKey.value = key;
};

const dash = (): string => t("backoffice.guidance.none");

const contentLabel = (kind: AnimalKind): string => {
  if (situation.value === "injured") {
    return kind.injured === undefined
      ? t("backoffice.guidance.content.missing")
      : t("backoffice.guidance.content.ready");
  }
  if (situation.value === "stray") {
    return t("backoffice.guidance.content.stub");
  }
  return kind.cruelty === undefined
    ? t("backoffice.guidance.content.missing")
    : t("backoffice.guidance.content.ready");
};

const flowLabel = (kind: AnimalKind): string => {
  if (situation.value === "injured") {
    return kind.injured?.flowKey ?? dash();
  }
  if (situation.value === "cruelty") {
    return kind.cruelty?.flowKey ?? dash();
  }
  return t("backoffice.guidance.content.stub");
};

const warningLabel = (kind: AnimalKind): string =>
  kind.injured?.warningFrame ?? dash();

const booleanLabel = (value: boolean | undefined): string => {
  if (value === undefined) {
    return dash();
  }
  return value
    ? t("backoffice.guidance.volunteers.yes")
    : t("backoffice.guidance.volunteers.no");
};

const editorErrorMessage = (error: unknown): string => {
  const code = (error as AdminError).code;
  if (code === "conflict") {
    return t("backoffice.error.guidanceConflict");
  }
  if (code === "invalid_content") {
    return t("backoffice.error.guidanceInvalid");
  }
  return t("backoffice.error.guidance");
};

const loadEditor = async (): Promise<void> => {
  const request = ++editorGeneration;
  const kindKey = selectedKind.value?.key;
  editor.value = undefined;
  editorError.value = undefined;
  if (situation.value !== "injured" || kindKey === undefined) {
    editorPending.value = false;
    return;
  }
  editorPending.value = true;
  editorError.value = undefined;
  try {
    const result = await fetchGuidanceKind(kindKey);
    if (request === editorGeneration) editor.value = result;
  } catch (error) {
    if (request !== editorGeneration) return;
    editor.value = undefined;
    editorError.value = editorErrorMessage(error);
  } finally {
    if (request === editorGeneration) editorPending.value = false;
  }
};

watch(
  [situation, selectedKind],
  () => {
    publishDescription.value = "";
    publishConfirmed.value = false;
    void loadEditor();
  },
  { immediate: true },
);

const saveEditor = async (): Promise<void> => {
  const kindKey = selectedKind.value?.key;
  if (
    editor.value === undefined ||
    kindKey === undefined ||
    editorPending.value
  ) {
    return;
  }
  editorPending.value = true;
  const request = editorGeneration;
  editorError.value = undefined;
  try {
    let current = editor.value;
    const options = current.contactOptions.map((option) => ({ ...option }));
    for (const cell of current.cells.filter(
      (cell) => !isContactInstruction(cell.instructionKey),
    )) {
      current = await saveGuidanceCell({
        expectedHash: current.contentHash,
        kindKey,
        instructionKey: cell.instructionKey,
        applicability: cell.applicability,
        copy: cell.copy,
        ...(cell.actionTargetKey === undefined
          ? {}
          : { actionTargetKey: cell.actionTargetKey }),
      });
      if (request === editorGeneration && editor.value) {
        editor.value.contentHash = current.contentHash;
        editor.value.source = current.source;
        editor.value.revisionId = current.revisionId;
      }
    }
    current = await saveGuidanceContacts({
      expectedHash: current.contentHash,
      kindKey,
      options,
    });
    if (request === editorGeneration) editor.value = current;
  } catch (error) {
    if (request !== editorGeneration) return;
    editorError.value = editorErrorMessage(error);
  } finally {
    if (request === editorGeneration) editorPending.value = false;
  }
};

const publishEditor = async (): Promise<void> => {
  if (
    editor.value === undefined ||
    editor.value.source === "bundled" ||
    editorPending.value ||
    !publishConfirmed.value
  ) {
    return;
  }
  editorPending.value = true;
  const request = editorGeneration;
  editorError.value = undefined;
  try {
    await publishGuidance({
      expectedHash: editor.value.contentHash,
      description: publishDescription.value,
    });
    if (request === editorGeneration) {
      await loadEditor();
      publishConfirmed.value = false;
    }
  } catch (error) {
    if (request === editorGeneration)
      editorError.value = editorErrorMessage(error);
  } finally {
    if (request === editorGeneration) editorPending.value = false;
  }
};
</script>

<template>
  <section class="page guidance-screen">
    <h1>{{ t("backoffice.guidance.title") }}</h1>
    <p class="muted">{{ t("backoffice.guidance.help") }}</p>
    <p class="muted">
      {{ t("backoffice.directory.guidanceHelp") }}
      <RouterLink :to="{ name: 'contacts' }">{{
        t("backoffice.nav.contacts")
      }}</RouterLink>
      ·
      <RouterLink :to="{ name: 'clinics' }">{{
        t("backoffice.nav.clinics")
      }}</RouterLink>
    </p>

    <fieldset class="situation-filter" :aria-label="t('backoffice.queue.type')">
      <label v-for="key in situationKeys" :key="key">
        <input
          :checked="situation === key"
          type="radio"
          name="guidance-situation"
          :value="key"
          @change="changeSituation(key, $event)"
        />
        {{ t(`backoffice.guidance.situation.${key}`) }}
      </label>
    </fieldset>

    <section v-if="situation === 'cruelty'">
      <GuidanceAnimalList
        :kinds="animalKinds"
        :selected-key="selectedKind?.key"
        :status="() => 'Spoločný postup — polícia a dokumentácia'"
        @select="selectKind"
      />
      <section class="panel detail">
        <h2>{{ selectedKind?.labelSk }}</h2>
        <h2>Týranie zvieraťa</h2>
        <p>
          Prebiehajúci útok → polícia 158 → výsledok nahlásenia a prípadné
          dôvody neúspechu → miesto → identifikácia → okolnosti týrania →
          odoslanie.
        </p>
        <p>
          Neakútny prípad preskočí telefonát. Po zdokumentovaní sa nezobrazuje
          ďalší strom pomoci. Hlásenia a výsledok kontaktovania polície nájdete
          v správe prípadov.
        </p>
        <GuidanceWalkPreview :walk="preview" />
      </section>
    </section>
    <ReportGuidanceEditor
      v-else-if="situation !== 'injured'"
      ref="reportEditor"
      :situation="situation"
    />
    <template v-else>
      <GuidanceAnimalList
        :kinds="kinds"
        :selected-key="selectedKind?.key"
        @select="selectKind"
      >
        <template #head>
          <th>{{ t("backoffice.guidance.column.flow") }}</th>
          <th>{{ t("backoffice.guidance.column.warning") }}</th>
          <th>{{ optionLabel("column") }}</th>
          <th>{{ t("backoffice.guidance.column.content") }}</th>
        </template>
        <template #cells="{ kind }">
          <td>
            <code>{{ flowLabel(kind) }}</code>
          </td>
          <td>
            <code>{{ warningLabel(kind) }}</code>
          </td>
          <td>
            <span v-if="kind.key === selectedKind?.key && editor">{{
              editor.contactOptions
                .map((option) => serviceLabel(option.serviceKey))
                .join(" → ")
            }}</span>
            <button
              v-else
              type="button"
              class="table-link"
              @click="selectKind(kind.key)"
            >
              {{ optionLabel("show") }}
            </button>
          </td>
          <td>{{ contentLabel(kind) }}</td>
        </template>
      </GuidanceAnimalList>

      <section v-if="selectedKind" class="detail">
        <h2>{{ selectedKind.labelSk }}</h2>
        <p>
          <code>{{ selectedKind.key }}</code>
          · {{ t(`catalog.group.${selectedKind.groupKey}`) }}
        </p>
        <p class="muted">
          {{ t("backoffice.guidance.matrixIds") }}:
          <code>{{ selectedKind.matrix.injuredId ?? dash() }}</code>
          /
          <code>{{ selectedKind.matrix.strayId ?? dash() }}</code>
          /
          <code>{{ selectedKind.matrix.crueltyId ?? dash() }}</code>
        </p>
        <p v-if="selectedKind.injured">
          {{ t("backoffice.guidance.askConscious") }}:
          {{ booleanLabel(selectedKind.injured.askConscious) }}
          · {{ t("backoffice.guidance.askJuvenile") }}:
          {{ booleanLabel(selectedKind.injured.askJuvenile) }}
        </p>
        <GuidanceWalkPreview :walk="preview" />

        <section
          v-if="situation === 'injured' && selectedKind?.injured"
          class="editor"
        >
          <h3>{{ t("backoffice.guidance.editorTitle") }}</h3>
          <p class="muted">
            {{ t("backoffice.guidance.editorHelp") }}
            · {{ t("backoffice.guidance.source") }}:
            {{
              t(
                `backoffice.guidance.sourceLabel.${editor?.source ?? "bundled"}`,
              )
            }}
          </p>
          <p v-if="editorError" class="error">
            {{ editorError }}
            <button type="button" :disabled="editorPending" @click="loadEditor">
              {{ t("backoffice.case.reload") }}
            </button>
          </p>
          <fieldset
            v-for="cell in editableCells"
            :key="cell.instructionKey"
            class="cell"
            :disabled="editorPending"
          >
            <legend>
              {{ t(`backoffice.guidance.instruction.${cell.instructionKey}`) }}
              <template v-if="cell.screenKey">
                · <code>{{ cell.screenKey }}</code>
              </template>
              <template v-else>
                · {{ t("backoffice.guidance.notInFlow") }}
              </template>
            </legend>
            <label>
              <input
                v-model="cell.applicability"
                type="checkbox"
                true-value="on"
                false-value="off"
              />
              {{ t("backoffice.guidance.applies") }}
            </label>
            <p v-if="cell.actionTargetKey" class="muted">
              {{ t("backoffice.guidance.contactKey") }}:
              <code>{{ cell.actionTargetKey }}</code>
            </p>
            <label v-for="slot in cell.slotKeys" :key="slot">
              {{ t(`backoffice.guidance.slot.${slot}`) }}
              <textarea v-model="cell.copy[slot]" rows="4"></textarea>
            </label>
          </fieldset>
          <section v-if="editor" class="contact-options">
            <h3>{{ optionLabel("title") }}</h3>
            <p class="muted">{{ optionLabel("help") }}</p>
            <fieldset
              v-for="(option, index) in editor.contactOptions"
              :key="option.id"
              class="cell"
              :disabled="editorPending"
            >
              <legend>{{ optionLabel("option") }} {{ index + 1 }}</legend>
              <label
                v-if="['vet_clinic', 'vet_exotic'].includes(option.serviceKey)"
              >
                {{ optionLabel("clinicVariant") }}
                <select
                  :value="option.clinicVariant ?? 'standard'"
                  @change="
                    option.clinicVariant = ($event.target as HTMLSelectElement)
                      .value as 'standard' | 'protected'
                  "
                >
                  <option value="standard">
                    {{ optionLabel("clinicStandard") }}
                  </option>
                  <option value="protected">
                    {{ optionLabel("clinicProtected") }}
                  </option>
                </select>
              </label>
              <label
                ><input v-model="option.enabled" type="checkbox" />{{
                  t("backoffice.guidance.applies")
                }}</label
              >
              <label
                >{{ optionLabel("service")
                }}<select
                  v-model="option.serviceKey"
                  :aria-label="optionLabel('service')"
                  @change="delete option.clinicVariant"
                >
                  <option
                    v-for="serviceKey in contactServiceKeys"
                    :key="serviceKey"
                    :value="serviceKey"
                  >
                    {{ serviceLabel(serviceKey) }}
                  </option>
                </select></label
              >
              <label
                >{{ optionLabel("heading")
                }}<input v-model="option.title" type="text" maxlength="200"
              /></label>
              <label
                >{{ optionLabel("instructions")
                }}<textarea
                  v-model="option.body"
                  rows="4"
                  maxlength="4000"
                ></textarea>
              </label>
              <p class="preview-actions">
                <button
                  type="button"
                  :disabled="index === 0"
                  @click="moveContact(index, -1)"
                >
                  {{ optionLabel("up") }}
                </button>
                <button
                  type="button"
                  :disabled="index === editor.contactOptions.length - 1"
                  @click="moveContact(index, 1)"
                >
                  {{ optionLabel("down") }}
                </button>
                <button
                  type="button"
                  :disabled="editor.contactOptions.length === 1"
                  @click="removeContact(index)"
                >
                  {{ optionLabel("remove") }}
                </button>
              </p>
            </fieldset>
            <button type="button" :disabled="editorPending" @click="addContact">
              {{ optionLabel("add") }}
            </button>
          </section>
          <p class="preview-actions">
            <button
              type="button"
              :disabled="editorPending || editor === undefined"
              @click="saveEditor"
            >
              {{ t("backoffice.guidance.save") }}
            </button>
          </p>
          <label>
            {{ t("backoffice.guidance.publishDescription") }}
            <input v-model="publishDescription" type="text" maxlength="500" />
          </label>
          <label>
            <input v-model="publishConfirmed" type="checkbox" />
            {{ t("backoffice.guidance.publishConfirm") }}
          </label>
          <button
            type="button"
            :disabled="
              editorPending ||
              editor === undefined ||
              editor.source === 'bundled' ||
              !publishConfirmed ||
              publishDescription.trim() === ''
            "
            @click="publishEditor"
          >
            {{ t("backoffice.guidance.publish") }}
          </button>
        </section>
      </section>
    </template>
  </section>
</template>
