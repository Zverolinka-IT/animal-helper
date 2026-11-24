import {
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";

import {
  fetchLoginOptions,
  fetchQueue,
  fetchRegistrationOptions,
  fetchReauthenticationOptions,
  fetchSession,
  logoutSession,
  verifyLogin,
  verifyRegistration,
  verifyReauthentication,
  type Operator,
  type QueueCase,
} from "./api.js";

export const restoreOperatorSession = async (): Promise<
  { operator: Operator; environment: string } | undefined
> => {
  try {
    const session = await fetchSession();
    return { operator: session.operator, environment: session.environment };
  } catch (error) {
    if (readStatus(error) === 401) {
      return undefined;
    }
    throw error;
  }
};

export const registerOperatorPasskey = async (
  bootstrapToken: string,
): Promise<{ operator: Operator; environment: string }> => {
  const { options } = await fetchRegistrationOptions(bootstrapToken);
  const response = await startRegistration({ optionsJSON: options });
  const result = await verifyRegistration(response);
  return { operator: result.operator, environment: result.environment };
};

export const signInOperator = async (): Promise<{
  operator: Operator;
  environment: string;
}> => {
  const { options } = await fetchLoginOptions();
  const response = await startAuthentication({ optionsJSON: options });
  const result = await verifyLogin(response);
  return { operator: result.operator, environment: result.environment };
};

export const reauthenticateOperator = async (): Promise<{
  operator: Operator;
  environment: string;
}> => {
  const { options } = await fetchReauthenticationOptions();
  const response = await startAuthentication({ optionsJSON: options });
  const result = await verifyReauthentication(response);
  return { operator: result.operator, environment: result.environment };
};

export const loadQueue = async (): Promise<readonly QueueCase[]> => {
  const result = await fetchQueue();
  return result.cases;
};

export const signOutOperator = async (): Promise<void> => {
  await logoutSession();
};

const readStatus = (error: unknown): number | undefined => {
  if (typeof error !== "object" || error === null || !("status" in error)) {
    return undefined;
  }
  return typeof error.status === "number" ? error.status : undefined;
};
