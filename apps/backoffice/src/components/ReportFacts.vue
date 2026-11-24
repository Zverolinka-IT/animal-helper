<script setup lang="ts">
import { computed } from "vue";
import { t } from "@animal-helper/i18n";
import type { AdminCaseDetail } from "../api.js";
const props = defineProps<{
  report: NonNullable<AdminCaseDetail["facts"]["report"]>;
}>();
const rows = computed(() => {
  const result: { label: string; value: string }[] = [];
  const add = (label: string, value: string | undefined) => {
    if (value) result.push({ label: t(`report.details.${label}`), value });
  };
  const values = (group: string, choices: readonly string[]) =>
    choices.map((value) => t(`report.details.${group}.${value}`)).join(", ");
  const report = props.report;
  add("speciesDescription", report.species.description);
  if (report.dead) {
    add("deadSigns", values("signs", report.dead.suspiciousSigns));
    add(
      "countLabel",
      report.dead.animalCount
        ? t(`report.details.count.${report.dead.animalCount}`)
        : undefined,
    );
    add("description", report.dead.description);
  }
  if (report.cruelty) {
    add("acute", t(`report.answer.${report.cruelty.acute ? "yes" : "no"}`));
    add("crueltySigns", values("signs", report.cruelty.signs));
    add("description", report.cruelty.description);
    if (report.cruelty.police) {
      add(
        "policeLabel",
        t(`report.details.police.${report.cruelty.police.outcome}`),
      );
      add(
        "serviceReasons",
        values("serviceReason", report.cruelty.police.reasons),
      );
      add("description", report.cruelty.police.description);
    }
  }
  if (report.other) {
    add("branchLabel", t(`report.details.branch.${report.other.branch}`));
    if ("situation" in report.other && report.other.situation)
      add(
        "situationLabel",
        t(`report.details.situation.${report.other.situation}`),
      );
    add("description", report.other.description);
    if (report.other.branch === "road") {
      if (report.other.serviceReport) {
        add(
          "serviceReasons",
          values("serviceReason", report.other.serviceReport.reasons),
        );
        add("description", report.other.serviceReport.description);
      }
      if (report.other.animalHelpRequested)
        add("onwardHelp", t("report.answer.yes"));
    }
  }
  if (report.closure) {
    add("closureLabel", t(`report.details.closure.${report.closure.status}`));
    add("description", report.closure.description);
  }
  return result;
});
</script>
<template>
  <template v-for="(row, index) in rows" :key="index">
    <dt>{{ row.label }}</dt>
    <dd>{{ row.value }}</dd>
  </template>
</template>
