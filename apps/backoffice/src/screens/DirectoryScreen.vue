<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { onBeforeRouteLeave } from "vue-router";
import {
  contactDirectoryEntrySchema,
  contactDirectoryIssues,
  contactServiceKeys,
  parseSlovakDistricts,
  type AdminContactDirectory,
  type ContactDirectoryEntry,
  type ContactDirectoryRequest,
  type ContactServiceKey,
} from "@animal-helper/contracts";
import { t } from "@animal-helper/i18n";
import { createSearchMatcher } from "@animal-helper/search";
import {
  contactAvailability,
  parseContactBoundary,
  slovakDate,
} from "@animal-helper/jurisdictions";
import {
  fetchContactDirectory,
  updateContactDirectory,
  type AdminError,
} from "../api.js";
import ContactImport from "../components/ContactImport.vue";
import {
  directoryServices,
  matchesDirectoryView,
  type DirectoryView,
} from "../directory-view.js";

const props = withDefaults(defineProps<{ view?: DirectoryView }>(), {
  view: "contacts",
});
const services = computed(() => directoryServices(props.view));
const inView = (item: ContactDirectoryEntry) =>
  matchesDirectoryView(item, props.view);

const directory = ref<AdminContactDirectory>();
const entry = ref<ContactDirectoryEntry>();
const query = ref("");
const service = ref<ContactServiceKey | "">("");
const pending = ref(false);
const error = ref("");
const message = ref("");
const conflict = ref(false);
const removeConfirmation = ref(false);
const showImport = ref(false),
  importStaged = ref(false);
const baseline = ref("");
const latitude = ref("");
const longitude = ref("");
const coverage = ref<ContactDirectoryEntry["coverage"]["kind"]>("national");
const boundary = ref("");
const districtsText = ref("");
const centerLatitude = ref("");
const centerLongitude = ref("");
const radius = ref("");
const hoursKind = ref<ContactDirectoryEntry["hours"]["kind"]>("unknown");
const shifts = ref<{ day: number; opens: string; closes: string }[]>([]);
const weekdays = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];
const label = (key: string) => t(`backoffice.directory.${key}`);
const viewLabel = (key: string) =>
  t(`backoffice.${props.view === "clinics" ? "clinics" : "directory"}.${key}`);
const serviceLabel = (key: string) => label(`service.${key}`);
const number = (value: string | number) =>
  String(value).trim() === "" ? NaN : Number(value);
const geometry = computed(() => {
  try {
    return parseContactBoundary(JSON.parse(boundary.value));
  } catch {
    return undefined;
  }
});
const candidate = computed(() =>
  entry.value
    ? {
        ...entry.value,
        ...(latitude.value || longitude.value
          ? {
              coordinates: {
                latitude: number(latitude.value),
                longitude: number(longitude.value),
              },
            }
          : { coordinates: undefined }),
        coverage: (() => {
          if (coverage.value === "national")
            return { kind: "national" as const };
          if (coverage.value === "boundary")
            return { kind: "boundary" as const, geometry: geometry.value };
          if (coverage.value === "districts") {
            const parsed = parseSlovakDistricts(districtsText.value);
            return {
              kind: "districts" as const,
              districts: parsed.ok ? parsed.districts : [],
            };
          }
          return {
            kind: "radius" as const,
            center: {
              latitude: number(centerLatitude.value),
              longitude: number(centerLongitude.value),
            },
            radiusKm: number(radius.value),
          };
        })(),
        hours:
          hoursKind.value === "weekly"
            ? { kind: "weekly" as const, intervals: shifts.value }
            : { kind: hoursKind.value },
      }
    : undefined,
);
const fingerprint = computed(() => JSON.stringify(candidate.value));
const dirty = computed(() =>
  Boolean(entry.value && fingerprint.value !== baseline.value),
);
const visible = computed(() => {
  const matches = createSearchMatcher(query.value);
  return (directory.value?.document.entries ?? [])
    .filter(
      (item) =>
        inView(item) &&
        (!service.value || item.serviceKeys.includes(service.value)) &&
        matches([item.name, item.address, item.phone, item.website, item.note]),
    )
    .sort((a, b) => a.name.localeCompare(b.name, "sk"));
});
const issues = computed(() =>
  directory.value
    ? contactDirectoryIssues(
        directory.value.document,
        slovakDate(new Date()),
      ).flatMap((issue) => {
        const item = directory.value?.document.entries.find(
          (item) => item.id === issue.id,
        );
        return item ? [{ ...issue, entry: item }] : [];
      })
    : [],
);
const previewHours = computed(() => {
  const parsed = contactDirectoryEntrySchema.safeParse(candidate.value);
  return parsed.success
    ? contactAvailability(parsed.data.hours, new Date()).label
    : "";
});
const saved = computed(() =>
  directory.value?.document.entries.some((item) => item.id === entry.value?.id),
);

const mayDiscard = () => !dirty.value || window.confirm(label("discard"));
onBeforeRouteLeave(
  () =>
    mayDiscard() &&
    (!importStaged.value || window.confirm(label("import.discard"))),
);
const closeImport = () => {
  if (
    pending.value ||
    (importStaged.value && !window.confirm(label("import.discard")))
  )
    return;
  showImport.value = false;
  importStaged.value = false;
};

const select = (item: ContactDirectoryEntry, force = false) => {
  if (!force && !mayDiscard()) return;
  entry.value = JSON.parse(JSON.stringify(item)) as ContactDirectoryEntry;
  latitude.value = item.coordinates?.latitude.toString() ?? "";
  longitude.value = item.coordinates?.longitude.toString() ?? "";
  coverage.value = item.coverage.kind;
  districtsText.value =
    item.coverage.kind === "districts" ? item.coverage.districts.join("\n") : "";
  boundary.value =
    item.coverage.kind === "boundary"
      ? JSON.stringify(item.coverage.geometry, null, 2)
      : "";
  centerLatitude.value =
    item.coverage.kind === "radius"
      ? item.coverage.center.latitude.toString()
      : "";
  centerLongitude.value =
    item.coverage.kind === "radius"
      ? item.coverage.center.longitude.toString()
      : "";
  radius.value =
    item.coverage.kind === "radius" ? item.coverage.radiusKm.toString() : "";
  hoursKind.value = item.hours.kind;
  shifts.value =
    item.hours.kind === "weekly"
      ? item.hours.intervals.map((shift) => ({ ...shift }))
      : [];
  baseline.value = fingerprint.value;
  removeConfirmation.value = false;
};

const add = () =>
  select({
    id: crypto.randomUUID(),
    name: "",
    serviceKeys: ["vet_clinic"],
    enabled: true,
    phone: "",
    website: "",
    address: "",
    coverage: { kind: "national" },
    hours: { kind: "unknown" },
    note: "",
    sourceUrl: "",
    verifiedOn: "",
    reviewDueOn: "",
  });

const fail = (caught: unknown) => {
  conflict.value = (caught as AdminError).status === 409;
  error.value = label(
    conflict.value
      ? "error.conflict"
      : (caught as AdminError).status === 401
        ? "error.session"
        : "error.failed",
  );
};

const load = async () => {
  if (pending.value || !mayDiscard()) return;
  pending.value = true;
  error.value = "";
  message.value = "";
  try {
    directory.value = await fetchContactDirectory();
    entry.value = undefined;
    conflict.value = false;
  } catch (caught) {
    fail(caught);
  } finally {
    pending.value = false;
  }
};
onMounted(() => {
  void load();
});

const run = async (command: ContactDirectoryRequest["command"]) => {
  if (pending.value || !directory.value) return;
  pending.value = true;
  error.value = "";
  message.value = "";
  try {
    directory.value = await updateContactDirectory(
      directory.value.revision,
      command,
    );
    conflict.value = false;
    if (command.type === "save_entry") select(command.entry, true);
    if (command.type === "remove_entry") entry.value = undefined;
    if (command.type === "import_entries") {
      entry.value = undefined;
      showImport.value = false;
      importStaged.value = false;
    }
    message.value = label(
      command.type === "publish"
        ? "publishedMessage"
        : command.type === "import_entries"
          ? "import.saved"
          : "savedMessage",
    );
  } catch (caught) {
    fail(caught);
  } finally {
    pending.value = false;
  }
};

const save = async () => {
  const parsed = contactDirectoryEntrySchema.safeParse(candidate.value);
  if (!parsed.success) {
    error.value = label("error.fields");
    return;
  }
  if (!inView(parsed.data)) {
    error.value = t("backoffice.clinics.serviceRequired");
    return;
  }
  await run({ type: "save_entry", entry: parsed.data });
};
const importEntries = (entries: ContactDirectoryEntry[]) => {
  if (!entries.every(inView)) {
    error.value = t("backoffice.clinics.serviceRequired");
    return;
  }
  return run({
    type: "import_entries",
    entries: entries.map((item) => ({ ...item, enabled: false as const })),
  });
};

const remove = async () => {
  if (entry.value) await run({ type: "remove_entry", id: entry.value.id });
};

const importBoundary = async (event: Event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  try {
    if (file.size > 100_000) throw new Error("boundary too large");
    boundary.value = JSON.stringify(
      parseContactBoundary(JSON.parse(await file.text())),
      null,
      2,
    );
  } catch {
    error.value = label("error.boundary");
  }
};
</script>

<template>
  <section class="page directory-screen">
    <div class="directory-heading">
      <div>
        <h1>{{ viewLabel("title") }}</h1>
        <p class="muted">{{ viewLabel("help") }}</p>
      </div>
      <div class="actions">
        <button
          type="button"
          :disabled="!directory || pending || dirty || conflict || showImport"
          @click="showImport = true"
        >
          {{ label("import.title") }}
        </button>
        <button type="button" :disabled="pending || showImport" @click="add">
          {{ viewLabel("add") }}
        </button>
      </div>
    </div>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p v-if="message" class="directory-message" role="status">{{ message }}</p>
    <ContactImport
      v-if="showImport && directory"
      :existing="directory.document.entries"
      :disabled="pending || conflict || dirty"
      :view="props.view"
      @staged="importStaged = $event"
      @cancel="closeImport"
      @import="importEntries"
    />
    <div v-if="directory" class="directory-publication">
      <div>
        <h2>{{ label("publication") }}</h2>
        <p v-if="directory.published" class="muted">
          {{ label("publishedAt") }}
          {{
            new Date(directory.published.publishedAt).toLocaleString("sk-SK")
          }}
          · {{ directory.published.entries.length }}
          {{ label("contactsCount") }}
        </p>
        <p v-else class="muted">{{ label("neverPublished") }}</p>
        <p>
          {{
            label(directory.hasUnpublishedChanges ? "unpublished" : "upToDate")
          }}
        </p>
      </div>
      <div class="actions">
        <button
          type="button"
          class="button-quiet"
          :disabled="pending"
          @click="load"
        >
          {{ label("reload") }}
        </button>
        <button
          type="button"
          :disabled="
            pending ||
            showImport ||
            dirty ||
            conflict ||
            !directory.hasUnpublishedChanges ||
            issues.length > 0
          "
          @click="run({ type: 'publish' })"
        >
          {{ viewLabel("publish") }}
        </button>
      </div>
      <p class="muted">{{ viewLabel("publishHelp") }}</p>
      <p v-if="dirty" class="muted">{{ label("saveFirst") }}</p>
      <div v-if="issues.length" class="directory-issues">
        <p>{{ label("incomplete") }}</p>
        <ul>
          <li v-for="issue in issues" :key="issue.id">
            <button
              v-if="inView(issue.entry)"
              type="button"
              class="button-quiet"
              :disabled="pending"
              @click="select(issue.entry)"
            >
              {{ issue.entry.name }}
            </button>
            <RouterLink v-else :to="{ name: 'contacts' }"
              >{{ issue.entry.name }} ({{
                t("backoffice.nav.contacts")
              }})</RouterLink
            >
            {{
              issue.fields.map((field) => label(`required.${field}`)).join(", ")
            }}
          </li>
        </ul>
      </div>
    </div>

    <div v-if="directory" class="directory-layout">
      <aside class="directory-list" :aria-label="viewLabel('list')">
        <label
          >{{ label("search") }}<input v-model="query" type="search"
        /></label>
        <p class="muted">{{ t("backoffice.searchHelp") }}</p>
        <label
          >{{ label("serviceFilter") }}
          <select v-model="service">
            <option value="">{{ viewLabel("allServices") }}</option>
            <option v-for="key in services" :key="key" :value="key">
              {{ serviceLabel(key) }}
            </option>
          </select>
        </label>
        <p v-if="!visible.length" class="muted">{{ viewLabel("empty") }}</p>
        <button
          v-for="item in visible"
          :key="item.id"
          type="button"
          class="directory-item"
          :class="{ selected: entry?.id === item.id }"
          :disabled="pending"
          :aria-pressed="entry?.id === item.id"
          @click="select(item)"
        >
          <strong>{{ item.name }}</strong>
          <span>{{ item.serviceKeys.map(serviceLabel).join(" · ") }}</span>
          <span class="muted">{{
            label(item.enabled ? "active" : "inactive")
          }}</span>
        </button>
      </aside>

      <form v-if="entry" class="directory-editor" @submit.prevent="save">
        <h2>{{ viewLabel(saved ? "edit" : "new") }}</h2>
        <p v-if="dirty" class="muted">{{ label("unsaved") }}</p>
        <fieldset :disabled="pending || showImport">
          <label
            >{{ viewLabel("name")
            }}<input v-model="entry.name" required maxlength="160"
          /></label>
          <label class="directory-check"
            ><input v-model="entry.enabled" type="checkbox" />{{
              viewLabel("enabled")
            }}</label
          >
          <fieldset class="directory-services">
            <legend>{{ viewLabel("services") }}</legend>
            <p v-if="props.view === 'clinics'" class="muted">
              {{ t("backoffice.clinics.servicesHelp") }}
            </p>
            <label
              v-for="key in contactServiceKeys"
              :key="key"
              class="directory-check"
              ><input
                v-model="entry.serviceKeys"
                type="checkbox"
                :value="key"
              />{{ serviceLabel(key) }}</label
            >
          </fieldset>
          <div class="directory-fields">
            <label
              >{{ label("phone")
              }}<input v-model="entry.phone" type="tel" maxlength="32"
            /></label>
            <label
              >{{ label("website")
              }}<input
                v-model="entry.website"
                type="url"
                maxlength="1000"
                placeholder="https://"
            /></label>
          </div>
          <label
            >{{ label("address")
            }}<input v-model="entry.address" maxlength="300"
          /></label>
          <p class="muted">{{ label("coordinatesHelp") }}</p>
          <div class="directory-fields">
            <label
              >{{ label("latitude")
              }}<input
                v-model="latitude"
                type="number"
                step="any"
                min="-90"
                max="90"
            /></label>
            <label
              >{{ label("longitude")
              }}<input
                v-model="longitude"
                type="number"
                step="any"
                min="-180"
                max="180"
            /></label>
          </div>
          <label
            >{{ label("coverage")
            }}<select v-model="coverage">
              <option value="national">{{ label("national") }}</option>
              <option value="radius">{{ label("radius") }}</option>
              <option value="boundary">{{ label("boundary") }}</option>
              <option value="districts">{{ label("districts") }}</option>
            </select></label
          >
          <p class="muted">{{ label("coverageHelp") }}</p>
          <div v-if="coverage === 'radius'" class="directory-fields">
            <label
              >{{ label("centerLatitude")
              }}<input
                v-model="centerLatitude"
                type="number"
                required
                step="any"
                min="-90"
                max="90"
            /></label>
            <label
              >{{ label("centerLongitude")
              }}<input
                v-model="centerLongitude"
                type="number"
                required
                step="any"
                min="-180"
                max="180"
            /></label>
            <label
              >{{ label("radiusKm")
              }}<input
                v-model="radius"
                type="number"
                required
                step="any"
                min="0.01"
                max="600"
            /></label>
          </div>
          <div v-if="coverage === 'districts'">
            <label
              >{{ label("districtList")
              }}<textarea
                v-model="districtsText"
                rows="5"
                required
                maxlength="4000"
              />
            </label>
            <p class="muted">{{ label("districtsHelp") }}</p>
          </div>
          <div v-if="coverage === 'boundary'" class="directory-boundary">
            <label
              >{{ label("boundaryFile")
              }}<input
                type="file"
                accept=".geojson,.json,application/geo+json,application/json"
                @change="importBoundary"
            /></label>
            <label
              >{{ label("boundaryData")
              }}<textarea
                v-model="boundary"
                rows="5"
                required
                maxlength="100000"
                spellcheck="false"
              />
            </label>
            <p class="muted">
              {{ label(geometry ? "boundaryValid" : "boundaryHelp") }}
            </p>
          </div>
          <label
            >{{ label("hours")
            }}<select v-model="hoursKind">
              <option value="unknown">{{ label("hoursUnknown") }}</option>
              <option value="always">{{ label("hoursAlways") }}</option>
              <option value="weekly">{{ label("hoursWeekly") }}</option>
            </select></label
          >
          <p class="muted">{{ label("hoursHelp") }}</p>
          <div v-if="hoursKind === 'weekly'" class="directory-shifts">
            <div
              v-for="(shift, index) in shifts"
              :key="index"
              class="directory-shift"
            >
              <label
                >{{ label("day")
                }}<select v-model.number="shift.day">
                  <option
                    v-for="(day, dayIndex) in weekdays"
                    :key="day"
                    :value="dayIndex"
                  >
                    {{ label(`dayName.${day}`) }}
                  </option>
                </select></label
              >
              <label
                >{{ label("opens")
                }}<input v-model="shift.opens" type="time" required
              /></label>
              <label
                >{{ label("closes")
                }}<input v-model="shift.closes" type="time" required
              /></label>
              <button
                type="button"
                class="button-quiet"
                @click="shifts.splice(index, 1)"
              >
                {{ label("removeShift") }}
              </button>
            </div>
            <button
              type="button"
              class="button-quiet"
              :disabled="shifts.length >= 28"
              @click="shifts.push({ day: 0, opens: '08:00', closes: '16:00' })"
            >
              {{ label("addShift") }}
            </button>
          </div>
          <p v-if="previewHours" class="muted">
            {{ label("hoursPreview") }} {{ previewHours }}
          </p>
          <label
            >{{ label("note")
            }}<textarea v-model="entry.note" rows="3" maxlength="1000" />
          </label>
          <h3>{{ label("verification") }}</h3>
          <p class="muted">{{ label("verificationHelp") }}</p>
          <label
            >{{ label("sourceUrl")
            }}<input
              v-model="entry.sourceUrl"
              type="url"
              maxlength="1000"
              placeholder="https://"
          /></label>
          <div class="directory-fields">
            <label
              >{{ label("verifiedOn")
              }}<input v-model="entry.verifiedOn" type="date"
            /></label>
            <label
              >{{ label("reviewDueOn")
              }}<input v-model="entry.reviewDueOn" type="date"
            /></label>
          </div>
          <div class="actions">
            <button type="submit" :disabled="!dirty || conflict">
              {{ label("save") }}
            </button>
            <button
              v-if="saved"
              type="button"
              class="button-quiet"
              @click="removeConfirmation = !removeConfirmation"
            >
              {{ label("remove") }}
            </button>
          </div>
          <div v-if="removeConfirmation" class="directory-issues">
            <p>{{ label("removeHelp") }}</p>
            <button type="button" :disabled="conflict" @click="remove">
              {{ label("confirmRemove") }}
            </button>
          </div>
        </fieldset>
      </form>
      <p v-else class="muted directory-select">{{ viewLabel("select") }}</p>
    </div>
  </section>
</template>

<style scoped>
.directory-heading,
.directory-publication,
.directory-fields,
.directory-shift {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  align-items: center;
}
.directory-heading {
  justify-content: space-between;
}
.directory-heading > div {
  display: grid;
  gap: 8px;
}
.directory-publication {
  padding: 20px;
  border-radius: 16px;
  background: var(--canvas);
}
.directory-publication > div:first-child {
  flex: 1 1 300px;
}
.directory-publication > p,
.directory-issues {
  flex-basis: 100%;
}
.directory-layout {
  display: grid;
  grid-template-columns: minmax(220px, 300px) minmax(0, 1fr);
  gap: 28px;
  align-items: start;
}
.directory-list {
  display: grid;
  gap: 12px;
}
.directory-item {
  display: grid;
  gap: 4px;
  width: 100%;
  text-align: left;
  border: 1px solid var(--line);
  background: var(--surface);
  color: var(--ink);
  overflow-wrap: anywhere;
}
.directory-item span {
  font-size: 12px;
}
.directory-item.selected {
  border-color: var(--primary);
  background: var(--canvas);
}
.directory-editor > fieldset {
  display: grid;
  gap: 20px;
  min-width: 0;
  padding: 0;
  border: 0;
}
.directory-services {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 16px;
}
.directory-services > .muted {
  grid-column: 1 / -1;
}
.directory-check {
  display: flex;
  align-items: start;
  gap: 8px;
}
.directory-check input {
  flex-shrink: 0;
}
.directory-fields > label,
.directory-shift > label {
  flex: 1 1 160px;
  min-width: 0;
}
.directory-shift {
  align-items: end;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--line);
}
.directory-issues {
  padding: 16px;
  border: 1px solid #e0bd68;
  border-radius: 12px;
  background: #fffbeb;
}
.directory-issues ul {
  margin: 8px 0 0;
  padding-left: 20px;
}
.directory-issues .button-quiet {
  padding: 4px 0;
  margin-right: 8px;
  text-decoration: underline;
}
.directory-message {
  color: #236b47;
}
.directory-select {
  padding: 24px;
}
@media (max-width: 800px) {
  .directory-layout {
    grid-template-columns: 1fr;
  }
  .directory-list {
    max-height: 340px;
    overflow-y: auto;
  }
  .directory-services {
    grid-template-columns: 1fr;
  }
}
</style>
