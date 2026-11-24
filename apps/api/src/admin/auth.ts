import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import type { Sql } from "postgres";

import {
  finishOperatorAuthentication,
  finishOperatorRegistration,
  hashOpaqueToken,
  hashesEqual,
  insertOperatorChallenge,
  listEnabledOperatorPasskeys,
  listOperatorPasskeys,
  lookupActiveBootstrap,
  lookupOperatorSession,
  newOpaqueToken,
  OperatorAuthError,
  recordOperatorAudit,
  revokeOperatorSession,
  takeOperatorChallenge,
  type OperatorRecord,
} from "@animal-helper/event-store";

import type { AdminConfig } from "./config.js";

export type AdminAuthResult = Readonly<{
  operator: { id: string; email: string; canManageOperators: boolean };
  expiresAt: string;
  sessionToken: string;
}>;

export type CeremonyResult = Readonly<{
  options: unknown;
  ceremonyToken: string;
}>;

const asTransports = (
  values: readonly string[],
): AuthenticatorTransportFuture[] =>
  values.filter(
    (value): value is AuthenticatorTransportFuture =>
      value === "ble" ||
      value === "cable" ||
      value === "hybrid" ||
      value === "internal" ||
      value === "nfc" ||
      value === "smart-card" ||
      value === "usb",
  );

export const createRegistrationOptions = async (
  sql: Sql,
  config: AdminConfig,
  bootstrapToken: string,
  now: Date,
): Promise<CeremonyResult> => {
  const operator = await lookupActiveBootstrap(
    sql,
    hashOpaqueToken(bootstrapToken),
    now,
  );
  if (operator === undefined || !operator.enabled) {
    throw new OperatorAuthError("bootstrap_invalid");
  }

  const existing = await listOperatorPasskeys(sql, operator.operatorId);
  const options = await generateRegistrationOptions({
    rpName: config.rpName,
    rpID: config.rpId,
    userName: operator.email,
    userID: new Uint8Array(Buffer.from(operator.operatorId, "utf8")),
    attestationType: "none",
    authenticatorSelection: {
      residentKey: "required",
      userVerification: "required",
    },
    excludeCredentials: existing.map((key) => ({
      id: key.credentialId,
      transports: asTransports(key.transports),
    })),
  });

  const ceremonyToken = newOpaqueToken();
  await insertOperatorChallenge(sql, {
    tokenHash: hashOpaqueToken(ceremonyToken),
    kind: "registration",
    challenge: options.challenge,
    operatorId: operator.operatorId,
    bootstrapHash: hashOpaqueToken(bootstrapToken),
    expiresAt: new Date(now.getTime() + config.challengeSeconds * 1000),
  });

  return { options, ceremonyToken };
};

export const createAuthenticationOptions = async (
  sql: Sql,
  config: AdminConfig,
  now: Date,
  sessionToken?: string,
): Promise<CeremonyResult> => {
  const session =
    sessionToken === undefined
      ? undefined
      : await lookupOperatorSession(sql, hashOpaqueToken(sessionToken), now);
  if (sessionToken !== undefined && session === undefined)
    throw new OperatorAuthError("passkey_failed");
  const existing =
    session === undefined
      ? await listEnabledOperatorPasskeys(sql)
      : await listOperatorPasskeys(sql, session.operatorId);
  if (existing.length === 0) {
    throw new OperatorAuthError("passkey_unregistered");
  }
  const options = await generateAuthenticationOptions({
    rpID: config.rpId,
    userVerification: "required",
    allowCredentials: existing.map((key) => ({
      id: key.credentialId,
      transports: asTransports(key.transports),
    })),
  });
  const ceremonyToken = newOpaqueToken();
  await insertOperatorChallenge(sql, {
    tokenHash: hashOpaqueToken(ceremonyToken),
    kind: "authentication",
    challenge: options.challenge,
    operatorId: null,
    bootstrapHash: null,
    ...(sessionToken === undefined
      ? {}
      : { sessionTokenHash: hashOpaqueToken(sessionToken) }),
    expiresAt: new Date(now.getTime() + config.challengeSeconds * 1000),
  });
  return { options, ceremonyToken };
};

export const completeRegistration = async (
  sql: Sql,
  config: AdminConfig,
  ceremonyToken: string,
  response: unknown,
  now: Date,
): Promise<AdminAuthResult> => {
  const challenge = await takeOperatorChallenge(
    sql,
    hashOpaqueToken(ceremonyToken),
    "registration",
    now,
  );
  if (
    challenge === undefined ||
    challenge.operatorId === null ||
    challenge.bootstrapHash === null
  ) {
    throw new OperatorAuthError("passkey_failed");
  }

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: response as RegistrationResponseJSON,
      expectedChallenge: challenge.challenge,
      expectedOrigin: config.origin,
      expectedRPID: config.rpId,
      requireUserVerification: true,
    });
  } catch {
    throw new OperatorAuthError("passkey_failed");
  }
  if (!verification.verified || !verification.registrationInfo.userVerified) {
    throw new OperatorAuthError("passkey_failed");
  }
  const info = verification.registrationInfo;

  const sessionToken = newOpaqueToken();
  const operator = await finishOperatorRegistration(sql, {
    operatorId: challenge.operatorId,
    bootstrapHash: challenge.bootstrapHash,
    credentialId: info.credential.id,
    publicKey: Buffer.from(info.credential.publicKey),
    counter: info.credential.counter,
    transports: info.credential.transports ?? [],
    sessionTokenHash: hashOpaqueToken(sessionToken),
    now,
    sessionExpiresAt: new Date(now.getTime() + config.sessionSeconds * 1000),
  });
  await recordOperatorAudit(sql, {
    operatorEmail: operator.email,
    action: "operator_passkey_registered",
    outcome: "accepted",
  });
  return toAuthResult(operator, sessionToken, config, now);
};

export const completeAuthentication = async (
  sql: Sql,
  config: AdminConfig,
  ceremonyToken: string,
  response: unknown,
  now: Date,
  reauthSessionToken?: string,
): Promise<AdminAuthResult> => {
  const challenge = await takeOperatorChallenge(
    sql,
    hashOpaqueToken(ceremonyToken),
    "authentication",
    now,
  );
  if (challenge === undefined) {
    throw new OperatorAuthError("passkey_failed");
  }

  const previousHash =
    reauthSessionToken === undefined
      ? undefined
      : hashOpaqueToken(reauthSessionToken);
  if (
    challenge.sessionTokenHash === null
      ? previousHash !== undefined
      : previousHash === undefined ||
        !hashesEqual(challenge.sessionTokenHash, previousHash)
  ) {
    throw new OperatorAuthError("passkey_failed");
  }
  const previousSession =
    previousHash === undefined
      ? undefined
      : await lookupOperatorSession(sql, previousHash, now);
  if (previousHash !== undefined && previousSession === undefined)
    throw new OperatorAuthError("passkey_failed");

  const assertion = response as AuthenticationResponseJSON;
  const userHandle = readUserHandle(assertion.response.userHandle);
  if (
    previousSession !== undefined &&
    userHandle !== undefined &&
    userHandle !== previousSession.operatorId
  )
    throw new OperatorAuthError("passkey_failed");
  const expectedOperatorId = previousSession?.operatorId ?? userHandle;

  const sessionToken = newOpaqueToken();
  try {
    const operator = await finishOperatorAuthentication(sql, {
      credentialId: assertion.id,
      expectedOperatorId,
      verify: async (passkey) => {
        const verification = await verifyAuthenticationResponse({
          response: assertion,
          expectedChallenge: challenge.challenge,
          expectedOrigin: config.origin,
          expectedRPID: config.rpId,
          requireUserVerification: true,
          credential: {
            id: passkey.credentialId,
            publicKey: new Uint8Array(passkey.publicKey),
            counter: passkey.counter,
            transports: asTransports(passkey.transports),
          },
        });
        if (!verification.verified) {
          throw new OperatorAuthError("passkey_failed");
        }
        return {
          newCounter: verification.authenticationInfo.newCounter,
          userVerified: verification.authenticationInfo.userVerified,
        };
      },
      sessionTokenHash: hashOpaqueToken(sessionToken),
      now,
      sessionExpiresAt: new Date(now.getTime() + config.sessionSeconds * 1000),
      ...(previousHash === undefined
        ? {}
        : { previousSessionTokenHash: previousHash }),
    });
    await recordOperatorAudit(sql, {
      operatorEmail: operator.email,
      action:
        previousSession === undefined
          ? "operator_signed_in"
          : "operator_reauthenticated",
      outcome: "accepted",
    });
    return toAuthResult(operator, sessionToken, config, now);
  } catch (error) {
    if (error instanceof OperatorAuthError) {
      throw error;
    }
    throw new OperatorAuthError("passkey_failed");
  }
};

export const readOperatorSession = async (
  sql: Sql,
  sessionToken: string | undefined,
  now: Date,
) => {
  if (sessionToken === undefined) {
    return undefined;
  }
  return lookupOperatorSession(sql, hashOpaqueToken(sessionToken), now);
};

export const signOutOperator = async (
  sql: Sql,
  sessionToken: string | undefined,
  now: Date,
): Promise<void> => {
  if (sessionToken === undefined) {
    return;
  }
  const session = await lookupOperatorSession(
    sql,
    hashOpaqueToken(sessionToken),
    now,
  );
  await revokeOperatorSession(sql, hashOpaqueToken(sessionToken), now);
  if (session !== undefined) {
    await recordOperatorAudit(sql, {
      operatorEmail: session.email,
      action: "operator_signed_out",
      outcome: "accepted",
    });
  }
};

const toAuthResult = (
  operator: OperatorRecord,
  sessionToken: string,
  config: AdminConfig,
  now: Date,
): AdminAuthResult => ({
  operator: {
    id: operator.operatorId,
    email: operator.email,
    canManageOperators: operator.canManageOperators,
  },
  expiresAt: new Date(
    now.getTime() + config.sessionSeconds * 1000,
  ).toISOString(),
  sessionToken,
});

const readUserHandle = (userHandle: string | undefined): string | undefined => {
  if (userHandle === undefined || userHandle.length === 0) {
    return undefined;
  }
  return Buffer.from(userHandle, "base64url").toString("utf8");
};
