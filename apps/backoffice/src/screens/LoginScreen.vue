<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";

import { t } from "@animal-helper/i18n";

import {
  clearPendingBootstrapToken,
  pendingBootstrapToken,
} from "../bootstrap.js";
import { rememberOperator } from "../runtime.js";
import { registerOperatorPasskey, signInOperator } from "../session.js";

const router = useRouter();
const bootstrapToken = ref<string | undefined>(pendingBootstrapToken());
const pending = ref(false);
const error = ref<string | undefined>(undefined);

const messageFor = (errorValue: unknown): string => {
  const code =
    typeof errorValue === "object" &&
    errorValue !== null &&
    "code" in errorValue &&
    typeof errorValue.code === "string"
      ? errorValue.code
      : undefined;
  if (code === "bootstrap_invalid") {
    return t("backoffice.error.bootstrap");
  }
  if (code === "passkey_unregistered") {
    return t("backoffice.error.passkeyUnregistered");
  }
  if (code === "unreachable") {
    return t("backoffice.error.unreachable");
  }
  const name = errorValue instanceof Error ? errorValue.name : undefined;
  if (name === "SecurityError" || name === "NotSupportedError") {
    return t("backoffice.error.passkeyOrigin");
  }
  return t("backoffice.error.passkey");
};

const continueWithPasskey = async () => {
  pending.value = true;
  error.value = undefined;
  try {
    const token = bootstrapToken.value;
    const result =
      token === undefined
        ? await signInOperator()
        : await registerOperatorPasskey(token);
    rememberOperator(result.operator, result.environment);
    clearPendingBootstrapToken();
    bootstrapToken.value = undefined;
    await router.push({ name: "queue" });
  } catch (caught) {
    error.value = messageFor(caught);
  } finally {
    pending.value = false;
  }
};
</script>

<template>
  <section class="login-card">
    <h1>
      {{
        bootstrapToken === undefined
          ? t("backoffice.login.title")
          : t("backoffice.login.setupTitle")
      }}
    </h1>
    <p class="muted">{{ t("backoffice.login.help") }}</p>
    <p v-if="bootstrapToken" class="muted">
      {{ t("backoffice.login.setupHelp") }}
    </p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <button
      class="button-primary"
      type="button"
      :disabled="pending"
      @click="continueWithPasskey"
    >
      {{
        pending
          ? t("backoffice.login.waiting")
          : bootstrapToken === undefined
            ? t("backoffice.login.submit")
            : t("backoffice.login.setupSubmit")
      }}
    </button>
  </section>
</template>
