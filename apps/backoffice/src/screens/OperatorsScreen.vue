<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import type {
  OperatorAccount,
  OperatorInvitation,
} from "@animal-helper/contracts";
import { t } from "@animal-helper/i18n";

import {
  createOperatorInvitation,
  fetchOperatorInvitations,
  fetchOperatorAccounts,
  changeOperatorManagement,
  revokeOperatorInvitation,
  type AdminError,
} from "../api.js";
import { rememberOperator, currentOperator } from "../runtime.js";
import { reauthenticateOperator } from "../session.js";

const email = ref("");
const invitations = ref<readonly OperatorInvitation[]>([]);
const accounts = ref<readonly OperatorAccount[]>([]);
const pending = ref(false);
const loading = ref(true);
const error = ref("");
const message = ref("");
const generated = ref<{ invitation: OperatorInvitation; setupUrl: string }>();
let expiryTimer: ReturnType<typeof setTimeout> | undefined;

const date = (value: string) => new Date(value).toLocaleString("sk-SK");
const clearLink = () => {
  generated.value = undefined;
  clearTimeout(expiryTimer);
};
onUnmounted(clearLink);

const errorMessage = (caught: unknown): string => {
  const code = (caught as AdminError).code;
  switch (code) {
    case "operator_exists":
      return t("backoffice.operators.error.exists");
    case "forbidden":
      return t("backoffice.operators.error.forbidden");
    case "reauth_required":
    case "unauthenticated":
      return t("backoffice.operators.error.session");
    case "rate_limited":
      return t("backoffice.operators.error.rateLimit");
    case "not_found":
      return t("backoffice.operators.error.expired");
    case "invalid_request":
      return t("backoffice.operators.error.email");
    case "conflict":
      return t("backoffice.operators.error.conflict");
    case "self_management":
      return t("backoffice.operators.error.selfManagement");
    default:
      return t("backoffice.operators.error.failed");
  }
};

const refresh = async () => {
  loading.value = true;
  try {
    const [links, enrolled] = await Promise.all([
      fetchOperatorInvitations(),
      fetchOperatorAccounts(),
    ]);
    invitations.value = links.invitations;
    accounts.value = enrolled.operators;
  } catch (caught) {
    error.value = errorMessage(caught);
  } finally {
    loading.value = false;
  }
};
onMounted(() => {
  void refresh();
});

const confirmPasskey = async () => {
  try {
    const result = await reauthenticateOperator();
    rememberOperator(result.operator, result.environment);
  } catch {
    throw Object.assign(new Error("confirmation_failed"), {
      code: "confirmation_failed",
    });
  }
};

const generate = async (address = email.value) => {
  if (pending.value) return;
  pending.value = true;
  error.value = "";
  message.value = "";
  clearLink();
  try {
    await confirmPasskey();
    const result = await createOperatorInvitation(address.trim());
    generated.value = result;
    expiryTimer = setTimeout(
      clearLink,
      Math.max(0, Date.parse(result.invitation.expiresAt) - Date.now()),
    );
    email.value = "";
    await refresh();
  } catch (caught) {
    error.value =
      (caught as AdminError).code === "confirmation_failed"
        ? t("backoffice.operators.error.confirmation")
        : errorMessage(caught);
  } finally {
    pending.value = false;
  }
};

const revoke = async (invitation: OperatorInvitation) => {
  if (pending.value) return;
  pending.value = true;
  error.value = "";
  message.value = "";
  try {
    await confirmPasskey();
    await revokeOperatorInvitation(invitation.id);
    if (generated.value?.invitation.id === invitation.id) clearLink();
    message.value = t("backoffice.operators.revoked");
    await refresh();
  } catch (caught) {
    error.value =
      (caught as AdminError).code === "confirmation_failed"
        ? t("backoffice.operators.error.confirmation")
        : errorMessage(caught);
    if ((caught as AdminError).code === "not_found") await refresh();
  } finally {
    pending.value = false;
  }
};

const copy = async () => {
  if (!generated.value) return;
  try {
    await navigator.clipboard.writeText(generated.value.setupUrl);
    message.value = t("backoffice.operators.copied");
  } catch {
    message.value = t("backoffice.operators.copyManually");
  }
};

const changeManagement = async (account: OperatorAccount) => {
  if (pending.value || account.id === currentOperator.value?.id) return;
  pending.value = true;
  error.value = "";
  message.value = "";
  try {
    await confirmPasskey();
    await changeOperatorManagement(account);
    message.value = t("backoffice.operators.managementUpdated");
    await refresh();
  } catch (caught) {
    error.value =
      (caught as AdminError).code === "confirmation_failed"
        ? t("backoffice.operators.error.confirmation")
        : errorMessage(caught);
    if ((caught as AdminError).code === "conflict") await refresh();
  } finally {
    pending.value = false;
  }
};
</script>

<template>
  <section class="page operators-screen">
    <h1>{{ t("backoffice.operators.title") }}</h1>
    <p class="muted">{{ t("backoffice.operators.help") }}</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p v-if="message" class="muted" role="status">{{ message }}</p>

    <form class="invite-form" @submit.prevent="generate()">
      <label>
        {{ t("backoffice.operators.email") }}
        <input
          v-model="email"
          type="email"
          autocomplete="off"
          maxlength="254"
          required
          :disabled="pending"
        />
      </label>
      <button type="submit" :disabled="pending || email.trim() === ''">
        {{
          t(
            pending
              ? "backoffice.operators.confirming"
              : "backoffice.operators.generate",
          )
        }}
      </button>
    </form>
    <p class="muted">{{ t("backoffice.operators.confirmHelp") }}</p>

    <section v-if="generated" class="setup-link-panel">
      <h2>
        {{ t("backoffice.operators.linkTitle") }} ·
        {{ generated.invitation.email }}
      </h2>
      <p>{{ t("backoffice.operators.linkHelp") }}</p>
      <label>
        {{ t("backoffice.operators.setupLink") }}
        <input
          :value="generated.setupUrl"
          type="text"
          readonly
          autocomplete="off"
          spellcheck="false"
        />
      </label>
      <p class="muted">
        {{ t("backoffice.operators.expires") }}:
        {{ date(generated.invitation.expiresAt) }}
      </p>
      <div class="actions">
        <button type="button" @click="copy">
          {{ t("backoffice.operators.copy") }}
        </button>
        <button type="button" @click="clearLink">
          {{ t("backoffice.operators.hide") }}
        </button>
      </div>
    </section>

    <h2>{{ t("backoffice.operators.accounts") }}</h2>
    <p class="muted">{{ t("backoffice.operators.managementHelp") }}</p>
    <ul class="invitation-list">
      <li v-for="account in accounts" :key="account.id">
        <div>
          <strong>{{ account.email }}</strong>
          <p class="muted">
            {{
              t(
                account.canManageOperators
                  ? "backoffice.operators.manager"
                  : "backoffice.operators.operator",
              )
            }}
          </p>
        </div>
        <button
          v-if="account.id !== currentOperator?.id"
          type="button"
          :disabled="pending || loading"
          @click="changeManagement(account)"
        >
          {{
            t(
              account.canManageOperators
                ? "backoffice.operators.revokeManagement"
                : "backoffice.operators.grantManagement",
            )
          }}
        </button>
        <span v-else class="muted">{{
          t("backoffice.operators.yourAccount")
        }}</span>
      </li>
    </ul>
    <h2>{{ t("backoffice.operators.pending") }}</h2>
    <p v-if="loading" class="muted" role="status">
      {{ t("backoffice.operators.loading") }}
    </p>
    <p v-else-if="invitations.length === 0" class="empty-state muted">
      {{ t("backoffice.operators.empty") }}
    </p>
    <ul v-else class="invitation-list">
      <li v-for="invitation in invitations" :key="invitation.id">
        <div>
          <strong>{{ invitation.email }}</strong>
          <p class="muted">
            {{ t("backoffice.operators.expires") }}:
            {{ date(invitation.expiresAt) }}
          </p>
        </div>
        <div class="actions">
          <button
            type="button"
            :disabled="pending"
            @click="generate(invitation.email)"
          >
            {{ t("backoffice.operators.regenerate") }}
          </button>
          <button type="button" :disabled="pending" @click="revoke(invitation)">
            {{ t("backoffice.operators.revoke") }}
          </button>
        </div>
      </li>
    </ul>
    <button type="button" :disabled="pending || loading" @click="refresh">
      {{ t("backoffice.operators.refresh") }}
    </button>
  </section>
</template>

<style scoped>
.invite-form {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  gap: 16px;
  margin-top: 8px;
}
.invite-form label {
  flex: 1 1 260px;
  max-width: 440px;
}
.setup-link-panel {
  padding: 24px;
  background: var(--canvas);
  border: 1px solid var(--primary-light);
  border-radius: 16px;
}
.invitation-list {
  display: grid;
  gap: 12px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.invitation-list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 16px;
  padding: 20px;
  border: 1px solid var(--line);
  border-radius: 16px;
}
.invitation-list strong,
.setup-link-panel h2 {
  overflow-wrap: anywhere;
}
@media (max-width: 600px) {
  .setup-link-panel,
  .invitation-list li {
    padding: 16px;
  }
}
</style>
