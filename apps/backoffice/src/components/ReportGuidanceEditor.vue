<script setup lang="ts">
import { computed, onScopeDispose, ref, watch } from "vue";
import {
  contactServiceKeys,
  type ReportGuidanceContext,
  type ReportGuidanceProfile,
} from "@animal-helper/contracts";
import {
  animalKinds,
  profileItems,
  resolveReportGuidanceProfile,
} from "@animal-helper/guidance";
import GuidanceWalkPreview from "./GuidanceWalkPreview.vue";
import { guidancePreview } from "../guidance-preview.js";
import GuidanceAnimalList from "./GuidanceAnimalList.vue";
import { t } from "@animal-helper/i18n";
import {
  fetchReportGuidance,
  saveReportGuidance,
  publishGuidance,
  type ReportGuidanceResponse,
  type AdminError,
} from "../api.js";
const props = defineProps<{ situation: string }>();
const contexts = computed(
  (): { key: ReportGuidanceContext; label: string }[] =>
    props.situation === "stray"
      ? [{ key: "stray", label: "Zatúlané zviera" }]
      : props.situation === "dead"
        ? [
            { key: "dead", label: "Bez uvedených podozrivých znakov" },
            { key: "dead-suspicious", label: "Podozrivé znaky nálezu" },
          ]
        : [
            {
              key: "human",
              label: "Uviaznutie / ľudská činnosť — všeobecný postup",
            },
            ...(
              [
                "field",
                "trees",
                "building",
                "fire",
                "trapped",
                "inside",
                "other",
              ] as const
            ).map((key) => ({
              key: `human-${key}` as ReportGuidanceContext,
              label: `Ľudská činnosť: ${t(`report.details.situation.${key}`)}`,
            })),
            ...(
              [
                "near-road",
                "near-highway",
                "hit-road",
                "hit-highway",
                "railway",
                "other",
              ] as const
            ).map((key) => ({
              key: `road-${key}` as ReportGuidanceContext,
              label: t(`report.details.situation.${key}`),
            })),
          ],
);
const context = ref<ReportGuidanceContext>("stray");
const kindKey = ref("");
const data = ref<ReportGuidanceResponse>();
const profile = ref<ReportGuidanceProfile>();
const saved = ref("");
const dirty = computed(() => JSON.stringify(profile.value) !== saved.value);
const pending = ref(false);
const error = ref("");
const notice = ref("");
const description = ref("");
const confirmed = ref(false);
const shared = computed(() => context.value.startsWith("road-"));
const exactProfile = computed(() =>
  data.value?.profiles.find(
    (entry) =>
      entry.context === context.value &&
      (entry.kindKey ?? "") === kindKey.value,
  ),
);
const inheritedProfile = computed(() =>
  resolveReportGuidanceProfile(
    data.value?.profiles ?? [],
    context.value,
    kindKey.value || undefined,
  ),
);
const items = computed(() =>
  !dirty.value && !exactProfile.value && inheritedProfile.value
    ? profileItems(inheritedProfile.value)
    : profile.value
      ? profileItems(profile.value)
      : [],
);
const selectedAnimal = computed(() =>
  animals.find((animal) => animal.key === kindKey.value),
);
function profileStatus(key: string): string {
  if (!data.value) return "Načítavam…";
  const effectiveKey = shared.value ? undefined : key || undefined;
  const own = data.value.profiles.find(
    (entry) =>
      entry.context === context.value && entry.kindKey === effectiveKey,
  );
  const effective = resolveReportGuidanceProfile(
    data.value.profiles,
    context.value,
    effectiveKey,
  );
  if (shared.value)
    return effective ? "Spoločný postup" : "Spoločný postup — nenastavený";
  if (own)
    return profileItems(own).length
      ? key
        ? "Vlastný postup"
        : "Všeobecný postup"
      : key
        ? "Všeobecný postup potlačený"
        : "Prázdny postup";
  return effective ? "Zdedený postup" : "Nenastavené";
}
function canLeaveProfile() {
  return (
    !dirty.value ||
    window.confirm("Máte neuložené zmeny. Zahodiť ich a zmeniť výber?")
  );
}
defineExpose({ canLeave: () => !pending.value && canLeaveProfile() });
function selectAnimal(key: string) {
  if (
    !pending.value &&
    !shared.value &&
    key !== kindKey.value &&
    canLeaveProfile()
  )
    kindKey.value = key;
}
function selectContext(event: Event) {
  const select = event.target as HTMLSelectElement;
  if (canLeaveProfile()) context.value = select.value as ReportGuidanceContext;
  else select.value = context.value;
}
const preview = computed(() =>
  guidancePreview({
    situation:
      props.situation === "stray"
        ? "stray"
        : props.situation === "dead"
          ? "dead"
          : "other",
    context: context.value,
    ...(kindKey.value ? { kindKey: kindKey.value } : {}),
    items: items.value,
  }),
);
const animals = [...animalKinds].sort((a, b) =>
  a.labelSk.localeCompare(b.labelSk, "sk"),
);
let generation = 0;
onScopeDispose(() => {
  generation++;
});
function chooseProfile() {
  const found = data.value?.profiles.find(
    (entry) =>
      entry.context === context.value &&
      (entry.kindKey ?? "") === kindKey.value,
  );
  profile.value = found
    ? (JSON.parse(JSON.stringify(found)) as ReportGuidanceProfile)
    : {
        context: context.value,
        ...(kindKey.value ? { kindKey: kindKey.value } : {}),
        warning: "",
        instructions: "",
        contacts: [],
      };
  saved.value = JSON.stringify(profile.value);
  confirmed.value = false;
  notice.value = "";
}
function message(value: unknown) {
  const code = (value as AdminError).code;
  return t(
    code === "conflict"
      ? "backoffice.error.guidanceConflict"
      : code === "invalid_content"
        ? "backoffice.error.guidanceInvalid"
        : "backoffice.error.guidance",
  );
}
async function load() {
  const request = ++generation;
  pending.value = true;
  error.value = "";
  try {
    const result = await fetchReportGuidance();
    if (request !== generation) return;
    data.value = result;
    chooseProfile();
  } catch (value) {
    if (request === generation) error.value = message(value);
  } finally {
    if (request === generation) pending.value = false;
  }
}
watch(
  () => props.situation,
  () => {
    context.value = contexts.value[0]!.key;
    kindKey.value = "";
    void load();
  },
  { immediate: true },
);
watch(context, (value) => {
  if (value.startsWith("road-")) kindKey.value = "";
});
watch([context, kindKey], chooseProfile);
function addContact() {
  profile.value?.contacts.push({
    id: crypto.randomUUID(),
    serviceKey: "vet_clinic",
    title: "",
    body: "",
    enabled: true,
  });
}
function move(index: number, offset: number) {
  const contacts = profile.value?.contacts;
  if (!contacts || index + offset < 0 || index + offset >= contacts.length)
    return;
  const item = contacts.splice(index, 1)[0]!;
  contacts.splice(index + offset, 0, item);
}
async function save() {
  if (!data.value || !profile.value || pending.value) return;
  const request = generation;
  pending.value = true;
  error.value = "";
  notice.value = "";
  try {
    const result = await saveReportGuidance({
      expectedHash: data.value.contentHash,
      profile: JSON.parse(
        JSON.stringify(profile.value),
      ) as ReportGuidanceProfile,
    });
    if (request !== generation) return;
    data.value = result;
    chooseProfile();
    notice.value =
      "Koncept bol uložený. Zverejnite ho, aby sa zmeny zobrazili v aplikácii.";
  } catch (value) {
    if (request === generation) error.value = message(value);
  } finally {
    if (request === generation) pending.value = false;
  }
}
async function publish() {
  if (
    !data.value ||
    dirty.value ||
    pending.value ||
    !confirmed.value ||
    !description.value.trim()
  )
    return;
  const request = generation;
  pending.value = true;
  error.value = "";
  try {
    await publishGuidance({
      expectedHash: data.value.contentHash,
      description: description.value,
    });
    if (request !== generation) return;
    confirmed.value = false;
    notice.value =
      "Sprievodca bol zverejnený. Nové hlásenia použijú túto verziu.";
  } catch (value) {
    if (request === generation) error.value = message(value);
  } finally {
    if (request === generation) pending.value = false;
  }
}
</script>
<template>
  <section class="panel editor">
    <h2>Sprievodca situáciou</h2>
    <p>
      Postup: miesto → údaje o zvierati → zverejnené upozornenia a kontakty →
      odoslanie hlásenia. Pri ceste sa kontakt zobrazí pred identifikáciou; po
      neúspechu nasleduje dokumentácia a ponuka ďalšej pomoci.
    </p>
    <p v-if="situation === 'other'" class="muted">
      Všeobecná „iná situácia“ obsahuje miesto, identifikáciu a opis, potom
      odoslanie bez ďalšieho sprievodcu.
    </p>
    <p class="muted">
      Zadajte overený postup. Bez nastavenia aplikácia umožní hlásenie odoslať a
      oznámi, že overený postup zatiaľ chýba. Konkrétny druh má prednosť pred
      všeobecným profilom. Prázdny uložený profil pre konkrétny druh potlačí
      všeobecný postup.
    </p>
    <p v-if="error" role="alert" class="error">
      {{ error }}
      <button type="button" :disabled="pending" @click="load">
        Načítať znova
      </button>
    </p>
    <p v-if="notice" role="status">{{ notice }}</p>
    <fieldset :disabled="pending">
      <label
        >Situácia<select :value="context" @change="selectContext">
          <option v-for="entry in contexts" :key="entry.key" :value="entry.key">
            {{ entry.label }}
          </option>
        </select></label
      >
      <p v-if="context.startsWith('road-')" class="muted">
        Pri ceste sa služba vyberá pred identifikáciou zvieraťa. Postup platí
        pre všetky druhy.
      </p>
    </fieldset>
    <GuidanceAnimalList
      :kinds="animals"
      :selected-key="kindKey"
      include-general
      :shared="shared"
      :pending="pending"
      :status="profileStatus"
      @select="selectAnimal"
    />
    <section v-if="profile" class="detail">
      <h2>
        {{
          shared
            ? "Všetky druhy — spoločný postup"
            : (selectedAnimal?.labelSk ?? "Všetky druhy / neznámy druh")
        }}
      </h2>
      <p class="muted">{{ profileStatus(kindKey) }}</p>
      <p v-if="!exactProfile && inheritedProfile" class="muted">
        Náhľad zobrazuje zdedený postup. Uložením formulára vytvoríte vlastný
        postup pre tento výber. Uloženie prázdneho postupu potlačí zdedené
        pokyny.
      </p>
    </section>
    <form v-if="profile && data" @submit.prevent="save">
      <fieldset :disabled="pending">
        <label
          >Čo nerobiť<textarea
            v-model="profile.warning"
            rows="4"
            maxlength="4000"
          ></textarea>
        </label>
        <label
          >Čo urobiť pred kontaktovaním pomoci<textarea
            v-model="profile.instructions"
            rows="4"
            maxlength="4000"
          ></textarea>
        </label>
        <h3>Kontakty v poradí</h3>
        <fieldset
          v-for="(contact, index) in profile.contacts"
          :key="contact.id"
          class="cell"
        >
          <legend>Možnosť {{ index + 1 }}</legend>
          <label
            v-if="['vet_clinic', 'vet_exotic'].includes(contact.serviceKey)"
          >
            {{ t("backoffice.guidance.contacts.clinicVariant") }}
            <select
              :value="contact.clinicVariant ?? 'standard'"
              @change="
                contact.clinicVariant = ($event.target as HTMLSelectElement)
                  .value as 'standard' | 'protected'
              "
            >
              <option value="standard">
                {{ t("backoffice.guidance.contacts.clinicStandard") }}
              </option>
              <option value="protected" :disabled="!kindKey">
                {{ t("backoffice.guidance.contacts.clinicProtected") }}
              </option>
            </select>
          </label>
          <label
            ><input v-model="contact.enabled" type="checkbox" />Zapnuté</label
          >
          <label
            >Služba<select
              v-model="contact.serviceKey"
              @change="delete contact.clinicVariant"
            >
              <option
                v-for="service in contactServiceKeys"
                :key="service"
                :value="service"
              >
                {{ t(`backoffice.directory.service.${service}`) }}
              </option>
            </select></label
          >
          <label
            >Nadpis<input
              v-model="contact.title"
              :required="contact.enabled"
              maxlength="200"
          /></label>
          <label
            >Pokyny<textarea
              v-model="contact.body"
              :required="contact.enabled"
              rows="3"
              maxlength="4000"
            ></textarea>
          </label>
          <p class="preview-actions">
            <button
              type="button"
              :disabled="index === 0"
              @click="move(index, -1)"
            >
              Vyššie</button
            ><button
              type="button"
              :disabled="index === profile.contacts.length - 1"
              @click="move(index, 1)"
            >
              Nižšie</button
            ><button type="button" @click="profile.contacts.splice(index, 1)">
              Odstrániť
            </button>
          </p>
        </fieldset>
        <button
          type="button"
          :disabled="profile.contacts.length >= 24"
          @click="addContact"
        >
          Pridať kontakt
        </button>
        <p v-if="dirty" class="muted">
          Neuložené zmeny. Pred zmenou situácie alebo druhu ich uložte.
        </p>
        <button type="submit">Uložiť koncept</button>
      </fieldset>
    </form>
    <GuidanceWalkPreview v-if="profile" :walk="preview" />
    <fieldset
      :disabled="pending || dirty || !data || data.source === 'bundled'"
    >
      <label>Popis zmeny<input v-model="description" maxlength="500" /></label>
      <label
        ><input v-model="confirmed" type="checkbox" />Skontroloval/a som celý
        koncept sprievodcu. Zverejnenie zahŕňa všetky uložené zmeny.</label
      >
      <button
        type="button"
        :disabled="!confirmed || !description.trim()"
        @click="publish"
      >
        Zverejniť
      </button>
    </fieldset>
  </section>
</template>
