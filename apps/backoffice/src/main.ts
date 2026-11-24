import { t } from "@animal-helper/i18n";
import { createApp } from "vue";

import App from "./App.vue";
import { captureBootstrapToken, pendingBootstrapToken } from "./bootstrap.js";
import { router } from "./router.js";
import { rememberOperator } from "./runtime.js";
import { restoreOperatorSession } from "./session.js";
import "@fontsource-variable/roboto/wght.css";
import "./style.css";

document.title = t("backoffice.appName");

captureBootstrapToken();

const start = async () => {
  const setup = pendingBootstrapToken() !== undefined;
  let restored: Awaited<ReturnType<typeof restoreOperatorSession>>;
  if (setup) {
    restored = undefined;
  } else {
    try {
      restored = await restoreOperatorSession();
    } catch {
      restored = undefined;
    }
  }
  if (restored !== undefined) {
    rememberOperator(restored.operator, restored.environment);
  }
  const path = window.location.pathname;
  await router.replace(
    restored === undefined
      ? { name: "login" }
      : path === "/"
        ? { name: "queue" }
        : path,
  );
  createApp(App).use(router).mount("#app");
};

void start();
