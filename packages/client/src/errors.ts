export type ClientError =
  | Readonly<{ code: "INVALID_CAPABILITY"; retryable: false }>
  | Readonly<{ code: "INVALID_COMMAND"; retryable: false }>
  | Readonly<{ code: "NO_OPEN_CASE"; retryable: false }>
  | Readonly<{ code: "CASE_ALREADY_OPEN"; retryable: false }>
  | Readonly<{ code: "CASE_READ_ONLY"; retryable: false }>
  | Readonly<{ code: "NETWORK_FAILURE"; retryable: true }>
  | Readonly<{ code: "STORAGE_UNAVAILABLE"; retryable: false }>
  | Readonly<{ code: "UNSUPPORTED_SITUATION"; retryable: false }>
  | Readonly<{ code: "INVALID_RESPONSE"; retryable: false }>
  | Readonly<{ code: "VERSION_CONFLICT"; retryable: false }>
  | Readonly<{ code: "API"; retryable: false; apiCode: string }>;

export const invalidCapability: ClientError = {
  code: "INVALID_CAPABILITY",
  retryable: false,
};

export const invalidCommand: ClientError = {
  code: "INVALID_COMMAND",
  retryable: false,
};

export const noOpenCase: ClientError = {
  code: "NO_OPEN_CASE",
  retryable: false,
};

export const caseAlreadyOpen: ClientError = {
  code: "CASE_ALREADY_OPEN",
  retryable: false,
};

export const caseReadOnly: ClientError = {
  code: "CASE_READ_ONLY",
  retryable: false,
};

export const networkFailure: ClientError = {
  code: "NETWORK_FAILURE",
  retryable: true,
};

export const storageUnavailable: ClientError = {
  code: "STORAGE_UNAVAILABLE",
  retryable: false,
};

export const invalidResponse: ClientError = {
  code: "INVALID_RESPONSE",
  retryable: false,
};

export const versionConflict: ClientError = {
  code: "VERSION_CONFLICT",
  retryable: false,
};

export const apiError = (apiCode: string): ClientError => ({
  code: "API",
  retryable: false,
  apiCode,
});
