import {
  adminCaseCommandSchema,
  adminCaseSearchSchema,
  contactDirectoryRequestSchema,
  type AdminContactDirectory,
  type ContactDirectoryRequest,
  type AdminCaseRequest,
  type AdminCaseSearch,
  type GuidanceContactOption,
  type FormSnapshotV1,
  type ReportOutcome,
  type ReportGuidanceProfile,
} from "@animal-helper/contracts";
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/browser";
import type { GuidanceItem } from "@animal-helper/guidance";

export type Operator = Readonly<{
  id: string;
  email: string;
  canManageOperators: boolean;
}>;

export type QueueCase = Readonly<{
  streamId: string;
  workflowState: string;
  hasPrivateData: boolean;
  privateDataPurged: boolean;
  createdAt: string;
  updatedAt: string;
}>;

export type AdminCaseSummary = Readonly<{
  revision: number;
  streamId: string;
  caseNumber: string;
  createdAt: string;
  updatedAt: string;
  workflowState: string;
  situationType: string;
  speciesKey: string;
  address: string;
  reporterEmail: string;
  mode: "passive" | "review" | "active" | "closed";
  urgency: "acute" | "high" | "normal";
  ownerEmail: string;
  nextStep: string;
  deadline: string;
  unread: boolean;
  waitingOnAuthority: boolean;
}>;

export type AdminCaseDetail = AdminCaseSummary &
  Readonly<{
    facts: {
      situationType: string;
      speciesKey: string;
      address: string;
      latitude?: number;
      longitude?: number;
      symptoms: readonly string[];
      description: string;
      condition?: FormSnapshotV1["condition"];
      report?: Pick<
        FormSnapshotV1,
        "dead" | "cruelty" | "other" | "closure" | "species"
      >;
      outcome?: ReportOutcome;
      reporterName: string;
      reporterPhone: string;
      reporterEmail: string;
      shareWithAuthorities: boolean;
      mediaCount: number;
    };
    work: {
      mode: AdminCaseSummary["mode"];
      urgency: AdminCaseSummary["urgency"];
      ownerEmail: string;
      nextStep: string;
      deadline: string;
      note: string;
      volunteer?: { name: string; task: string; result: string };
      actions: readonly {
        id: string;
        kind: string;
        at: string;
        by: string;
        result: string;
      }[];
      referrals: readonly {
        id: string;
        recipient: string;
        sentOn: string;
        replyFileName: string;
        inspections: readonly {
          id: string;
          on: string;
          by: string;
          outcome: string;
          findings: string;
        }[];
      }[];
      steps: readonly {
        id: string;
        text: string;
        due: string;
        done: boolean;
      }[];
    };
  }>;

export type AdminError = Error & { status?: number; code?: string };

const adminFetch = async (path: string, body?: unknown): Promise<unknown> => {
  let response: Response;
  try {
    response = await fetch(
      path,
      body === undefined
        ? {
            method: "GET",
            credentials: "same-origin",
            cache: "no-store",
            signal: AbortSignal.timeout(12_000),
          }
        : {
            method: "POST",
            credentials: "same-origin",
            cache: "no-store",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(12_000),
          },
    );
  } catch {
    throw Object.assign(new Error("unreachable"), {
      code: "unreachable",
    });
  }

  if (response.status === 204) {
    return null;
  }

  const value: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = Object.assign(new Error("request_failed"), {
      status: response.status,
      code: readErrorCode(value),
    }) as AdminError;
    throw error;
  }

  return value;
};

export const fetchRegistrationOptions = (bootstrapToken: string) =>
  adminFetch("/admin/auth/register/options", { bootstrapToken }) as Promise<{
    options: PublicKeyCredentialCreationOptionsJSON;
  }>;

export const verifyRegistration = (response: RegistrationResponseJSON) =>
  adminFetch("/admin/auth/register/verify", { response }) as Promise<{
    operator: Operator;
    environment: string;
    expiresAt: string;
  }>;

export const fetchLoginOptions = () =>
  adminFetch("/admin/auth/login/options", {}) as Promise<{
    options: PublicKeyCredentialRequestOptionsJSON;
  }>;

export const verifyLogin = (response: AuthenticationResponseJSON) =>
  adminFetch("/admin/auth/login/verify", { response }) as Promise<{
    operator: Operator;
    environment: string;
    expiresAt: string;
  }>;

export const fetchReauthenticationOptions = () =>
  adminFetch("/admin/auth/reauth/options", {}) as ReturnType<
    typeof fetchLoginOptions
  >;

export const verifyReauthentication = (response: AuthenticationResponseJSON) =>
  adminFetch("/admin/auth/reauth/verify", { response }) as ReturnType<
    typeof verifyLogin
  >;

export const fetchOperatorInvitations = () =>
  adminFetch("/admin/operators/invitations") as Promise<{
    invitations: import("@animal-helper/contracts").OperatorInvitation[];
  }>;

export const fetchOperatorAccounts = () =>
  adminFetch("/admin/operators/accounts") as Promise<{
    operators: import("@animal-helper/contracts").OperatorAccount[];
  }>;

export const changeOperatorManagement = (
  operator: import("@animal-helper/contracts").OperatorAccount,
) =>
  adminFetch(`/admin/operators/accounts/${operator.id}/management`, {
    canManageOperators: !operator.canManageOperators,
    expectedCanManageOperators: operator.canManageOperators,
  });

export const createOperatorInvitation = (email: string) =>
  adminFetch("/admin/operators/invitations", { email }) as Promise<{
    invitation: import("@animal-helper/contracts").OperatorInvitation;
    setupUrl: string;
  }>;

export const revokeOperatorInvitation = (id: string) =>
  adminFetch(`/admin/operators/invitations/${id}/revoke`, {});

export const fetchSession = () =>
  adminFetch("/admin/session") as Promise<{
    operator: Operator;
    environment: string;
    expiresAt: string;
  }>;

export const fetchQueue = () =>
  adminFetch("/admin/queue") as Promise<{ cases: QueueCase[] }>;

export type AdminCasePage = {
  cases: AdminCaseSummary[];
  nextPage: number | null;
};

export type AdminCaseFilters = Pick<
  AdminCaseSearch,
  "query" | "reporterEmail" | "ownerEmail"
>;

export const fetchCases = (
  page = 0,
  filters: AdminCaseFilters = { query: "", reporterEmail: "", ownerEmail: "" },
): Promise<AdminCasePage> =>
  (Object.values(filters).some((value) => value.trim() !== "")
    ? adminFetch(
        "/admin/cases/search",
        adminCaseSearchSchema.parse({
          schemaVersion: 1,
          page,
          ...filters,
        }),
      )
    : adminFetch(
        page === 0 ? "/admin/cases" : `/admin/cases/page/${page}`,
      )) as Promise<AdminCasePage>;

export const fetchCase = (streamId: string) =>
  adminFetch(`/admin/cases/${streamId}`) as Promise<AdminCaseDetail>;

export const fetchContactDirectory = () =>
  adminFetch("/admin/contact-directory") as Promise<AdminContactDirectory>;

let pendingDirectoryCommand:
  { fingerprint: string; request: ContactDirectoryRequest } | undefined;
export const updateContactDirectory = async (
  expectedRevision: number,
  command: ContactDirectoryRequest["command"],
): Promise<AdminContactDirectory> => {
  const fingerprint = JSON.stringify({ expectedRevision, command });
  const request =
    pendingDirectoryCommand?.fingerprint === fingerprint
      ? pendingDirectoryCommand.request
      : contactDirectoryRequestSchema.parse({
          schemaVersion: 1,
          commandId: crypto.randomUUID(),
          expectedRevision,
          command,
        });
  pendingDirectoryCommand = { fingerprint, request };
  try {
    const directory = (await adminFetch(
      command.type === "import_entries"
        ? "/admin/contact-directory/import"
        : "/admin/contact-directory",
      request,
    )) as AdminContactDirectory;
    pendingDirectoryCommand = undefined;
    return directory;
  } catch (error) {
    const status = (error as AdminError).status;
    if (status !== undefined && status < 500)
      pendingDirectoryCommand = undefined;
    throw error;
  }
};

const pendingCaseCommands = new Map<
  string,
  { fingerprint: string; request: AdminCaseRequest }
>();

export const updateCase = async (
  streamId: string,
  expectedRevision: number,
  body: unknown,
): Promise<AdminCaseDetail> => {
  const command = adminCaseCommandSchema.parse(body);
  const fingerprint = JSON.stringify({ expectedRevision, command });
  const pending = pendingCaseCommands.get(streamId);
  const request =
    pending?.fingerprint === fingerprint
      ? pending.request
      : {
          schemaVersion: 1 as const,
          commandId: crypto.randomUUID(),
          expectedRevision,
          command,
        };
  pendingCaseCommands.set(streamId, { fingerprint, request });
  try {
    const detail = (await adminFetch(
      `/admin/cases/${streamId}`,
      request,
    )) as AdminCaseDetail;
    pendingCaseCommands.delete(streamId);
    return detail;
  } catch (error) {
    const status = (error as AdminError).status;
    if (status !== undefined && status < 500)
      pendingCaseCommands.delete(streamId);
    throw error;
  }
};

export const logoutSession = async () => {
  try {
    return await adminFetch("/admin/auth/logout", {});
  } finally {
    pendingCaseCommands.clear();
    pendingDirectoryCommand = undefined;
  }
};

export type GuidanceEditorCell = {
  instructionKey: string;
  applicability: "on" | "off";
  sortOrder: number;
  copy: Record<string, string>;
  slotKeys: readonly string[];
  screenKey?: string;
  actionTargetKey?: string;
};

export type GuidanceKindResponse = {
  contactOptions: GuidanceContactOption[];
  source: "draft" | "published" | "bundled";
  revisionId: string;
  contentHash: string;
  kindKey: string;
  cells: GuidanceEditorCell[];
  items: GuidanceItem[];
};

export const fetchGuidanceKind = (kindKey: string) =>
  adminFetch(
    `/admin/guidance/kind/injured/${kindKey}`,
  ) as Promise<GuidanceKindResponse>;

export const saveGuidanceCell = (body: {
  expectedHash: string;
  kindKey: string;
  instructionKey: string;
  applicability: "on" | "off";
  copy: Record<string, string>;
  actionTargetKey?: string;
}) =>
  adminFetch("/admin/guidance/cells", body) as Promise<GuidanceKindResponse>;

export const saveGuidanceContacts = (body: {
  expectedHash: string;
  kindKey: string;
  options: readonly GuidanceContactOption[];
}) =>
  adminFetch("/admin/guidance/contacts", body) as Promise<GuidanceKindResponse>;

export const publishGuidance = (body: {
  expectedHash: string;
  description: string;
}) =>
  adminFetch("/admin/guidance/publish", body) as Promise<{
    source: "published";
    revisionId: string;
    contentHash: string;
  }>;

const readErrorCode = (value: unknown): string | undefined => {
  if (typeof value !== "object" || value === null || !("error" in value)) {
    return undefined;
  }
  const error = value.error;
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  const code = error.code;
  return typeof code === "string" ? code : undefined;
};

export type ReportGuidanceResponse = {
  source: "bundled" | "draft" | "published";
  contentHash: string;
  profiles: ReportGuidanceProfile[];
};
export const fetchReportGuidance = () =>
  adminFetch("/admin/guidance/report-flows") as Promise<ReportGuidanceResponse>;
export const saveReportGuidance = (body: {
  expectedHash: string;
  profile: ReportGuidanceProfile;
}) =>
  adminFetch(
    "/admin/guidance/report-flows",
    body,
  ) as Promise<ReportGuidanceResponse>;
