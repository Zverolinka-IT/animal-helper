<script setup lang="ts">
import { useRouter } from "vue-router";

import { t } from "@animal-helper/i18n";

import {
  clearOperator,
  currentEnvironment,
  currentOperator,
} from "./runtime.js";
import { signOutOperator } from "./session.js";
import logo from "./assets/logo-orange.svg";

const router = useRouter();
const operator = currentOperator;
const environment = currentEnvironment;

const signOut = async () => {
  try {
    await signOutOperator();
  } finally {
    clearOperator();
    await router.push({ name: "login" });
  }
};
</script>

<template>
  <div class="shell">
    <header class="app-header">
      <RouterLink class="brand" :to="{ name: operator ? 'queue' : 'login' }">
        <img :src="logo" alt="" width="62" height="40" />
        <span>{{ t("backoffice.appName") }}</span>
      </RouterLink>
      <nav v-if="operator" class="nav" :aria-label="t('backoffice.nav.label')">
        <RouterLink :to="{ name: 'queue' }">
          {{ t("backoffice.nav.queue") }}
        </RouterLink>
        <RouterLink :to="{ name: 'guidance' }">
          {{ t("backoffice.nav.guidance") }}
        </RouterLink>
        <RouterLink :to="{ name: 'contacts' }">
          {{ t("backoffice.nav.contacts") }}
        </RouterLink>
        <RouterLink :to="{ name: 'clinics' }">
          {{ t("backoffice.nav.clinics") }}
        </RouterLink>
        <RouterLink
          v-if="operator.canManageOperators"
          :to="{ name: 'operators' }"
        >
          {{ t("backoffice.nav.operators") }}
        </RouterLink>
      </nav>
      <p v-if="operator" class="operator">
        <span class="environment">{{ environment }}</span>
        <span class="operator-email">{{ operator.email }}</span>
        <button class="button-quiet" type="button" @click="signOut">
          {{ t("backoffice.signOut") }}
        </button>
      </p>
    </header>
    <main :class="{ 'login-layout': !operator }">
      <RouterView :key="$route.path" />
    </main>
  </div>
</template>
