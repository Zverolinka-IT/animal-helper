import { createRouter, createWebHistory } from "vue-router";

import CaseScreen from "./screens/CaseScreen.vue";
import GuidanceScreen from "./screens/GuidanceScreen.vue";
import LoginScreen from "./screens/LoginScreen.vue";
import QueueScreen from "./screens/QueueScreen.vue";
import OperatorsScreen from "./screens/OperatorsScreen.vue";
import DirectoryScreen from "./screens/DirectoryScreen.vue";
import { currentOperator } from "./runtime.js";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", name: "login", component: LoginScreen },
    { path: "/queue", name: "queue", component: QueueScreen },
    { path: "/queue/:streamId", name: "case", component: CaseScreen },
    { path: "/guide", name: "guidance", component: GuidanceScreen },
    { path: "/contacts", name: "contacts", component: DirectoryScreen },
    {
      path: "/clinics",
      name: "clinics",
      component: DirectoryScreen,
      props: { view: "clinics" },
    },
    { path: "/operators", name: "operators", component: OperatorsScreen },
    { path: "/:pathMatch(.*)*", redirect: "/" },
  ],
});

router.beforeEach((to) => {
  if (
    to.name === "operators" &&
    currentOperator.value !== undefined &&
    !currentOperator.value.canManageOperators
  )
    return { name: "queue" };
  if (to.name === "login") {
    return currentOperator.value === undefined ? true : { name: "queue" };
  }
  return currentOperator.value === undefined ? { name: "login" } : true;
});
