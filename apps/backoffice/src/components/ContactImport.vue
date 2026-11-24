<script setup lang="ts">
import { computed, onScopeDispose, ref, watch } from "vue";
import {
  contactDirectoryDocumentSchema,
  type ContactDirectoryEntry,
  type ContactServiceKey,
} from "@animal-helper/contracts";
import { t } from "@animal-helper/i18n";
import {
  guessContactColumns,
  importFields,
  MAX_IMPORT_BYTES,
  MAX_IMPORT_ROWS,
  previewContactImport,
  type ColumnMapping,
  type ImportWorkbook,
} from "../contact-import.js";
import { directoryServices, type DirectoryView } from "../directory-view.js";

const props = withDefaults(
  defineProps<{
    existing: readonly ContactDirectoryEntry[];
    disabled: boolean;
    view?: DirectoryView;
  }>(),
  { view: "contacts" },
);
const services = computed(() => directoryServices(props.view));
const emit = defineEmits<{
  import: [entries: ContactDirectoryEntry[]];
  cancel: [];
  staged: [value: boolean];
}>();
const label = (key: string) => t(`backoffice.directory.import.${key}`);
const serviceLabel = (key: string) => t(`backoffice.directory.service.${key}`);
const fieldLabel = (field: string) =>
  label(`field.${field === "serviceKeys" ? "services" : field}`);
const workbook = ref<ImportWorkbook>();
const selectedSheet = ref(0),
  headerRow = ref(0);
const mapping = ref<ColumnMapping>(guessContactColumns([]));
const defaultService = ref<ContactServiceKey>("vet_clinic");
const encoding = ref("utf-8"),
  filename = ref("");
const parsing = ref(false),
  error = ref("");
const excluded = ref<number[]>([]);
let selectedFile: File | undefined;
let generation = 0,
  worker: Worker | undefined,
  timer: ReturnType<typeof setTimeout> | undefined;
const cleanup = () => {
  generation++;
  worker?.terminate();
  worker = undefined;
  clearTimeout(timer);
};
onScopeDispose(cleanup);
const sheet = computed(() => workbook.value?.sheets[selectedSheet.value]);
const columns = computed(() => sheet.value?.rows[headerRow.value] ?? []);
const headerChoices = computed(
  () =>
    sheet.value?.rows.slice(0, 50).map((row, index) => ({
      index,
      text: row.filter(Boolean).slice(0, 2).join(" · ").slice(0, 100),
    })) ?? [],
);
watch(sheet, (value) => {
  const guessed =
    value?.rows.slice(0, 50).findIndex((row) => {
      const fields = guessContactColumns(row);
      return (
        fields.name >= 0 &&
        Object.values(fields).filter((value) => value >= 0).length > 1
      );
    }) ?? -1;
  headerRow.value =
    guessed >= 0
      ? guessed
      : Math.max(
          0,
          value?.rows.findIndex((row) => row.some((cell) => cell.trim())) ?? 0,
        );
  excluded.value = [];
});
watch(columns, (value) => {
  mapping.value = guessContactColumns(value);
});
watch(workbook, (value) => emit("staged", Boolean(value)));
const rows = computed(() =>
  sheet.value && !sheet.value.error
    ? previewContactImport(
        sheet.value,
        headerRow.value,
        mapping.value,
        defaultService.value,
        props.existing,
        undefined,
        props.view,
      )
    : [],
);
const selected = computed(() =>
  rows.value.flatMap((row) =>
    row.status === "new" && row.entry && !excluded.value.includes(row.row)
      ? [row.entry]
      : [],
  ),
);
const capacity = computed(
  () =>
    contactDirectoryDocumentSchema.safeParse({
      schemaVersion: 1,
      jurisdiction: "SK",
      entries: [...props.existing, ...selected.value],
    }).success,
);
const tooMany = computed(() => rows.value.length > MAX_IMPORT_ROWS);
const unmapped = computed(() =>
  columns.value
    .filter(
      (column, index) =>
        column && !Object.values(mapping.value).includes(index),
    )
    .join(", "),
);
const counts = computed(() => ({
  invalid: rows.value.filter((row) => row.status === "invalid").length,
  duplicate: rows.value.filter((row) => row.status === "duplicate").length,
}));
const rowErrors = (errors: string[]) =>
  errors
    .map((field) =>
      field === "formula"
        ? label("formula")
        : field === "clinicService"
          ? t("backoffice.clinics.serviceRequired")
          : field === "coordinates"
            ? label("coordinates")
            : field === "coverage"
              ? label("coverage")
              : importFields.includes(field as keyof ColumnMapping) ||
                  field === "serviceKeys"
                ? fieldLabel(field)
                : t("backoffice.directory.error.fields"),
    )
    .join(", ");

const parse = async (file: File) => {
  cleanup();
  const request = generation;
  workbook.value = undefined;
  error.value = "";
  filename.value = file.name;
  parsing.value = true;
  try {
    if (file.size > MAX_IMPORT_BYTES || !/\.(csv|xlsx?)$/iu.test(file.name))
      throw new Error("file");
    const buffer = await file.arrayBuffer();
    if (request !== generation) return;
    const current = new Worker(
      new URL("../contact-import.worker.ts", import.meta.url),
      { type: "module" },
    );
    worker = current;
    const fail = () => {
      if (request === generation) {
        cleanup();
        parsing.value = false;
        error.value = label("fileError");
      }
    };
    timer = setTimeout(fail, 20_000);
    current.onerror = fail;
    current.onmessage = (
      event: MessageEvent<
        { ok: true; workbook: ImportWorkbook } | { ok: false }
      >,
    ) => {
      if (request !== generation) return;
      if (!event.data.ok) {
        fail();
        return;
      }
      workbook.value = event.data.workbook;
      selectedSheet.value = 0;
      cleanup();
      parsing.value = false;
    };
    current.postMessage(
      { buffer, filename: file.name, encoding: encoding.value },
      [buffer],
    );
  } catch {
    if (request === generation) {
      parsing.value = false;
      error.value = label("fileError");
    }
  }
};
const chooseFile = (event: Event) => {
  const input = event.target as HTMLInputElement;
  selectedFile = input.files?.[0];
  input.value = "";
  if (selectedFile) void parse(selectedFile);
};
watch(encoding, () => {
  if (selectedFile) void parse(selectedFile);
});
const template = () => {
  const link = document.createElement("a");
  const href = URL.createObjectURL(
    new Blob(
      [
        "\ufeff" +
          importFields
            .filter((field) => field !== "lastName" && field !== "city")
            .join(";") +
          "\r\n",
      ],
      { type: "text/csv;charset=utf-8" },
    ),
  );
  link.href = href;
  link.download =
    props.view === "clinics" ? "clinics-template.csv" : "contacts-template.csv";
  link.click();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
};
</script>

<template>
  <section class="contact-import" :aria-label="label('title')">
    <h2>{{ label("title") }}</h2>
    <p>{{ label("help") }}</p>
    <p v-if="view === 'clinics'" class="muted">
      {{ t("backoffice.clinics.importHelp") }}
    </p>
    <div class="actions">
      <label
        >{{ label("file")
        }}<input
          type="file"
          accept=".csv,.xls,.xlsx,.xlsm"
          :disabled="disabled || parsing"
          @change="chooseFile"
      /></label>
      <button type="button" class="button-quiet" @click="template">
        {{ label("template") }}
      </button>
      <button
        type="button"
        class="button-quiet"
        :disabled="disabled"
        @click="emit('cancel')"
      >
        {{ label("cancel") }}
      </button>
    </div>
    <p v-if="filename" class="muted">{{ filename }}</p>
    <label v-if="/\.csv$/i.test(filename)"
      >{{ label("encoding")
      }}<select v-model="encoding" :disabled="disabled || parsing">
        <option value="utf-8">UTF-8</option>
        <option value="windows-1250">Windows-1250</option>
      </select></label
    >
    <p v-if="parsing" role="status">{{ label("parsing") }}</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <template v-if="workbook && sheet">
      <div class="import-fields">
        <label
          >{{ label("sheet")
          }}<select
            v-model.number="selectedSheet"
            :aria-label="label('sheet')"
            :disabled="disabled"
          >
            <option
              v-for="(item, index) in workbook.sheets"
              :key="index"
              :value="index"
            >
              {{ item.name }}
            </option>
          </select></label
        >
        <label v-if="!sheet.error"
          >{{ label("header")
          }}<select
            v-model.number="headerRow"
            :aria-label="label('header')"
            :disabled="disabled"
          >
            <option
              v-for="item in headerChoices"
              :key="item.index"
              :value="item.index"
            >
              {{ item.index + 1 }}: {{ item.text }}
            </option>
          </select></label
        >
        <label
          >{{ label("defaultService")
          }}<select
            v-model="defaultService"
            :aria-label="label('defaultService')"
            :disabled="disabled"
          >
            <option v-for="key in services" :key="key" :value="key">
              {{ serviceLabel(key) }}
            </option>
          </select></label
        >
      </div>
      <p v-if="sheet.error || tooMany" class="error" role="alert">
        {{ label(sheet.error === "empty" ? "empty" : "limit") }}
      </p>
      <template v-else>
        <details open>
          <summary>{{ label("mapping") }}</summary>
          <div class="import-fields">
            <label v-for="field in importFields" :key="field"
              >{{ fieldLabel(field)
              }}<select
                v-model.number="mapping[field]"
                :aria-label="fieldLabel(field)"
                :disabled="disabled"
              >
                <option :value="-1">{{ label("unmapped") }}</option>
                <option
                  v-for="(column, index) in columns"
                  :key="index"
                  :value="index"
                >
                  {{ index + 1 }}: {{ column }}
                </option>
              </select></label
            >
          </div>
        </details>
        <p v-if="unmapped" class="muted">
          {{ label("ignoredColumns") }} {{ unmapped }}
        </p>
        <p class="muted">{{ label("defaults") }}</p>
        <p>
          {{ label("ready") }} <strong>{{ selected.length }}</strong> ·
          {{ label("invalid") }} {{ counts.invalid }} · {{ label("duplicate") }}
          {{ counts.duplicate }}
        </p>
        <p v-if="!capacity" class="error" role="alert">
          {{ label("capacity") }}
        </p>
        <div class="table-wrap import-preview">
          <table>
            <thead>
              <tr>
                <th>{{ label("include") }}</th>
                <th>{{ label("row") }}</th>
                <th>{{ fieldLabel("name") }}</th>
                <th>{{ fieldLabel("services") }}</th>
                <th>{{ fieldLabel("address") }}</th>
                <th>{{ label("contact") }}</th>
                <th>{{ label("status") }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in rows" :key="row.row">
                <td>
                  <input
                    v-if="row.status === 'new'"
                    type="checkbox"
                    :aria-label="`${label('include')} ${row.row}`"
                    :checked="!excluded.includes(row.row)"
                    :disabled="disabled"
                    @change="
                      excluded = excluded.includes(row.row)
                        ? excluded.filter((value) => value !== row.row)
                        : [...excluded, row.row]
                    "
                  />
                </td>
                <td>{{ row.row }}</td>
                <td>{{ row.name || "—" }}</td>
                <td>
                  {{
                    row.entry?.serviceKeys.map(serviceLabel).join(", ") || "—"
                  }}
                </td>
                <td>{{ row.entry?.address || "—" }}</td>
                <td>{{ row.entry?.phone || row.entry?.website || "—" }}</td>
                <td :class="{ error: row.status === 'invalid' }">
                  {{ label(`statusLabel.${row.status}`)
                  }}<span v-if="row.errors.length"
                    >: {{ rowErrors(row.errors) }}</span
                  >
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-if="rows.length === 0" class="muted">{{ label("empty") }}</p>
        <button
          type="button"
          :disabled="disabled || !selected.length || !capacity"
          @click="emit('import', selected)"
        >
          {{ label("confirm") }} ({{ selected.length }})
        </button>
      </template>
    </template>
  </section>
</template>

<style scoped>
.contact-import {
  display: grid;
  gap: 16px;
  padding: 24px;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: var(--canvas);
  min-width: 0;
}
.import-fields {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
  margin-top: 16px;
}
.import-fields label {
  display: grid;
  gap: 6px;
  min-width: 0;
}
.import-preview {
  max-height: 440px;
  overflow: auto;
}
.import-preview td {
  overflow-wrap: anywhere;
}
@media (max-width: 800px) {
  .import-fields {
    grid-template-columns: minmax(0, 1fr);
  }
  .contact-import {
    padding: 16px;
  }
}
</style>
