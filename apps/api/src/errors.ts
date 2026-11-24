export type ApiErrorCode =
  | "NOT_FOUND"
  | "INVALID_REQUEST"
  | "UNSUPPORTED_COMMAND"
  | "VERSION_CONFLICT"
  | "INVALID_TRANSITION"
  | "INCOMPLETE_REPORT"
  | "CASE_ALREADY_EXISTS"
  | "CASE_NOT_FOUND"
  | "PRIVATE_RECORD_ALREADY_ATTACHED"
  | "COMMAND_CONTENT_MISMATCH"
  | "NOTHING_TO_PURGE";

export type ApiErrorBody = Readonly<{
  ok: false;
  error: Readonly<{ code: ApiErrorCode }>;
}>;

export type ApiSuccessBody<T> = Readonly<{
  ok: true;
  value: T;
}>;

export const apiError = (code: ApiErrorCode): ApiErrorBody => ({
  ok: false,
  error: { code },
});

export const apiSuccess = <T>(value: T): ApiSuccessBody<T> => ({
  ok: true,
  value,
});

export const statusForError = (code: ApiErrorCode): number => {
  switch (code) {
    case "NOT_FOUND":
    case "CASE_NOT_FOUND":
      return 404;
    case "UNSUPPORTED_COMMAND":
      return 403;
    case "VERSION_CONFLICT":
      return 409;
    default:
      return 400;
  }
};
