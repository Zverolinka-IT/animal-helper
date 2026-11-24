<script setup lang="ts">
import ReportFacts from "../components/ReportFacts.vue";
import { ref } from "vue";
import { RouterLink, useRoute } from "vue-router";

import { findAnimalKind } from "@animal-helper/guidance";
import { t } from "@animal-helper/i18n";

import { useCaseWorkspace } from "../case-workspace.js";

const route = useRoute();
const {
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
} = useCaseWorkspace(() => String(route.params.streamId ?? ""));
const actionKind = ref("call");
const actionResult = ref("");
const volunteerName = ref("");
const volunteerTask = ref("");
const volunteerResult = ref("");
const recipient = ref("");
const replyFileName = ref("");
const inspectionBy = ref("");
const inspectionOutcome = ref("founded");
const inspectionFindings = ref("");

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
</script>

<template>
  <section v-if="item" class="page case-screen">
    <p>
      <RouterLink :to="{ name: 'queue' }">{{
        t("backoffice.case.back")
      }}</RouterLink>
    </p>
    <h1>
      {{ item.caseNumber }} · {{ situation(item.situationType) }} ·
      {{ species(item.facts.speciesKey) }}
    </h1>
    <p>
      {{ item.facts.address || t("backoffice.case.none") }}
      · {{ new Date(item.createdAt).toLocaleString("sk-SK") }} ·
      {{ t(`backoffice.queue.mode.${item.mode}`) }} ·
      {{ t(`backoffice.queue.urgency.${item.urgency}`) }}
    </p>
    <p v-if="error" class="error">
      {{ error }}
      <button type="button" :disabled="pending" @click="load">
        {{ t("backoffice.case.reload") }}
      </button>
    </p>
    <p class="actions">
      <button
        v-if="item.mode === 'passive' || item.mode === 'review'"
        class="button-primary"
        type="button"
        :disabled="pending"
        @click="run({ type: 'take_over' })"
      >
        {{ t("backoffice.case.takeOver") }}
      </button>
      <button
        v-if="item.mode === 'review'"
        type="button"
        :disabled="pending"
        @click="run({ type: 'leave_passive' })"
      >
        {{ t("backoffice.case.leave") }}
      </button>
      <button
        v-if="item.mode === 'active'"
        type="button"
        :disabled="pending"
        @click="run({ type: 'close' })"
      >
        {{ t("backoffice.case.close") }}
      </button>
    </p>

    <h2>{{ t("backoffice.case.app") }}</h2>
    <dl class="case-facts">
      <dt>{{ t("backoffice.queue.animal") }}</dt>
      <dd>{{ species(item.facts.speciesKey) }}</dd>
      <dt>{{ t("backoffice.queue.place") }}</dt>
      <dd>
        {{ item.facts.address || t("backoffice.case.none") }}
        <template
          v-if="
            item.facts.latitude !== undefined &&
            item.facts.longitude !== undefined
          "
        >
          ({{ item.facts.latitude }}, {{ item.facts.longitude }})
        </template>
      </dd>
      <dt>{{ t("backoffice.case.media") }}</dt>
      <dd>{{ item.facts.mediaCount }}</dd>
      <dt>{{ t("backoffice.queue.type") }}</dt>
      <dd>{{ item.facts.symptoms.join(", ") || t("backoffice.case.none") }}</dd>
      <template v-if="item.facts.condition?.behaviour?.length">
        <dt>{{ t("report.behaviourLabel") }}</dt>
        <dd>
          {{
            item.facts.condition.behaviour
              .map((value) => t(`report.behaviour.${value}`))
              .join(", ")
          }}
        </dd>
      </template>
      <template
        v-for="field in ['conscious', 'isJuvenile', 'collar'] as const"
        :key="field"
      >
        <template v-if="item.facts.condition?.[field]">
          <dt>{{ t(`report.${field}`) }}</dt>
          <dd>{{ t(`report.answer.${item.facts.condition[field]}`) }}</dd>
        </template>
      </template>
      <dt>Opis</dt>
      <dd>{{ item.facts.description || t("backoffice.case.none") }}</dd>
      <dt>{{ t("report.outcomeLabel") }}</dt>
      <dd>
        {{
          item.facts.outcome
            ? t(`report.outcome.${item.facts.outcome.status}`)
            : t("backoffice.case.none")
        }}
      </dd>
      <template v-if="item.facts.outcome?.reasons.length">
        <dt>{{ t("report.reasonsLabel") }}</dt>
        <dd>
          <ul>
            <li v-for="reason in item.facts.outcome.reasons" :key="reason">
              {{ t(`report.reasons.${reason}`) }}
            </li>
          </ul>
        </dd>
      </template>
      <template v-if="item.facts.outcome?.otherText">
        <dt>{{ t("report.outcomeDescription") }}</dt>
        <dd>{{ item.facts.outcome.otherText }}</dd>
      </template>
      <ReportFacts v-if="item.facts.report" :report="item.facts.report" />
      <dt>Oznamovateľ</dt>
      <dd>
        <template
          v-if="
            item.facts.reporterName ||
            item.facts.reporterPhone ||
            item.facts.reporterEmail
          "
        >
          {{ item.facts.reporterName }} {{ item.facts.reporterPhone }}
          {{ item.facts.reporterEmail }}
        </template>
        <template v-else>{{ t("backoffice.case.anonymous") }}</template>
      </dd>
      <dt>{{ t("backoffice.case.share") }}</dt>
      <dd>
        {{
          item.facts.shareWithAuthorities
            ? t("backoffice.case.yes")
            : t("backoffice.case.no")
        }}
      </dd>
    </dl>

    <h2>{{ t("backoffice.case.flow") }}</h2>
    <p>
      {{
        t(
          `backoffice.queue.${item.workflowState === "in_review" ? "inReview" : item.workflowState}`,
        )
      }}
    </p>
    <p class="muted">{{ t("backoffice.case.callRule") }}</p>

    <template v-if="item.mode === 'active'">
      <h2>{{ t("backoffice.case.work") }}</h2>
      <p>
        {{ t("backoffice.case.owner") }}:
        {{ item.work.ownerEmail || t("backoffice.case.none") }}
      </p>
      <form
        @submit.prevent="
          run({ type: 'set_work', urgency, nextStep, deadline, note })
        "
      >
        <label>
          {{ t("backoffice.case.urgency") }}
          <select v-model="urgency">
            <option value="acute">
              {{ t("backoffice.queue.urgency.acute") }}
            </option>
            <option value="high">
              {{ t("backoffice.queue.urgency.high") }}
            </option>
            <option value="normal">
              {{ t("backoffice.queue.urgency.normal") }}
            </option>
          </select>
        </label>
        <label>
          {{ t("backoffice.case.next") }}
          <input v-model="nextStep" type="text" />
        </label>
        <label>
          {{ t("backoffice.case.deadline") }}
          <input v-model="deadline" type="datetime-local" />
        </label>
        <label>
          {{ t("backoffice.case.note") }}
          <textarea v-model="note"></textarea>
        </label>
        <button type="submit" :disabled="pending">
          {{ t("backoffice.case.save") }}
        </button>
      </form>

      <h3>{{ t("backoffice.case.add") }}</h3>
      <form
        @submit.prevent="
          run({
            type: 'add_action',
            kind: actionKind,
            result: actionResult,
          }).then((saved) => {
            if (saved) actionResult = '';
          })
        "
      >
        <label>
          {{ t("backoffice.case.actionKind") }}
          <select v-model="actionKind">
            <option value="call">Telefonát</option>
            <option value="email">E-mail</option>
            <option value="visit">Návšteva</option>
            <option value="referral">Postúpenie</option>
            <option value="consult">Interná konzultácia</option>
          </select>
        </label>
        <label>
          {{ t("backoffice.case.actionResult") }}
          <input v-model="actionResult" type="text" required />
        </label>
        <button type="submit" :disabled="pending">
          {{ t("backoffice.case.add") }}
        </button>
      </form>
      <ul>
        <li v-for="action in item.work.actions" :key="action.id">
          {{ new Date(action.at).toLocaleString("sk-SK") }} · {{ action.by }} ·
          {{ action.kind }} · {{ action.result }}
        </li>
      </ul>

      <form
        @submit.prevent="
          run({ type: 'add_step', text: nextStep, due: deadline })
        "
      >
        <button type="submit" :disabled="pending">
          {{ t("backoffice.case.next") }}
        </button>
      </form>
      <ul>
        <li v-for="step in item.work.steps" :key="step.id">
          {{ step.text }} {{ step.due }}
          <button
            type="button"
            @click="run({ type: 'remove_step', id: step.id })"
          >
            {{ t("backoffice.case.remove") }}
          </button>
        </li>
      </ul>

      <h3>{{ t("backoffice.case.volunteer") }}</h3>
      <form
        @submit.prevent="
          run({
            type: 'add_volunteer',
            name: volunteerName,
            task: volunteerTask,
            result: volunteerResult,
          })
        "
      >
        <input
          v-model="volunteerName"
          type="text"
          :placeholder="t('backoffice.case.volunteer')"
          required
        />
        <input
          v-model="volunteerTask"
          type="text"
          :placeholder="t('backoffice.case.volunteerTask')"
        />
        <input
          v-model="volunteerResult"
          type="text"
          :placeholder="t('backoffice.case.actionResult')"
        />
        <button type="submit" :disabled="pending">
          {{ t("backoffice.case.add") }}
        </button>
      </form>
      <p v-if="item.work.volunteer">
        {{ item.work.volunteer.name }} · {{ item.work.volunteer.task }} ·
        {{ item.work.volunteer.result }}
      </p>

      <h2>{{ t("backoffice.case.authority") }}</h2>
      <form
        @submit.prevent="
          run({ type: 'add_referral', recipient, replyFileName }).then(
            (saved) => {
              if (saved) {
                recipient = '';
                replyFileName = '';
              }
            },
          )
        "
      >
        <input
          v-model="recipient"
          type="text"
          :placeholder="t('backoffice.case.recipient')"
          required
        />
        <input
          v-model="replyFileName"
          type="text"
          :placeholder="t('backoffice.case.fileName')"
        />
        <button type="submit" :disabled="pending">
          {{ t("backoffice.case.add") }}
        </button>
      </form>
      <article v-for="referral in item.work.referrals" :key="referral.id">
        <h3>{{ referral.recipient }} · {{ referral.sentOn }}</h3>
        <p>{{ referral.replyFileName || t("backoffice.case.none") }}</p>
        <ul>
          <li v-for="inspection in referral.inspections" :key="inspection.id">
            {{ inspection.on }} · {{ inspection.by }} ·
            {{ inspection.outcome }} · {{ inspection.findings }}
          </li>
        </ul>
      </article>
      <form
        v-if="item.work.referrals.length > 0"
        @submit.prevent="
          run({
            type: 'add_inspection',
            referralId: inspectionReferral,
            by: inspectionBy,
            outcome: inspectionOutcome,
            findings: inspectionFindings,
          })
        "
      >
        <label>
          {{ t("backoffice.case.recipient") }}
          <select v-model="inspectionReferral">
            <option
              v-for="referral in item.work.referrals"
              :key="referral.id"
              :value="referral.id"
            >
              {{ referral.recipient }}
            </option>
          </select>
        </label>
        <input
          v-model="inspectionBy"
          type="text"
          :placeholder="t('backoffice.case.inspection')"
          required
        />
        <select v-model="inspectionOutcome">
          <option value="founded">Opodstatnený</option>
          <option value="partial">Čiastočne opodstatnený</option>
          <option value="unfounded">Neopodstatnený</option>
          <option value="unknown">Nemožno vyhodnotiť</option>
        </select>
        <textarea
          v-model="inspectionFindings"
          :placeholder="t('backoffice.case.findings')"
          required
        ></textarea>
        <button type="submit" :disabled="pending">
          {{ t("backoffice.case.inspection") }}
        </button>
      </form>
    </template>
  </section>
  <p v-else-if="error" class="error">{{ error }}</p>
</template>
