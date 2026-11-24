export type AdminMode = "passive" | "review" | "active" | "closed";
export type AdminUrgency = "acute" | "high" | "normal";

export type AdminAction = Readonly<{
  id: string;
  kind: string;
  at: string;
  by: string;
  result: string;
}>;

export type AdminStep = Readonly<{
  id: string;
  text: string;
  due: string;
  done: boolean;
}>;

export type AdminVolunteer = Readonly<{
  name: string;
  task: string;
  result: string;
}>;

export type AdminInspection = Readonly<{
  id: string;
  on: string;
  by: string;
  outcome: string;
  findings: string;
}>;

export type AdminReferral = Readonly<{
  id: string;
  recipient: string;
  sentOn: string;
  replyFileName: string;
  inspections: readonly AdminInspection[];
}>;

export type AdminCaseDocument = Readonly<{
  mode: AdminMode;
  urgency: AdminUrgency;
  ownerEmail: string;
  nextStep: string;
  deadline: string;
  note: string;
  seenBy: Readonly<Record<string, string>>;
  volunteer?: AdminVolunteer;
  actions: readonly AdminAction[];
  referrals: readonly AdminReferral[];
  steps: readonly AdminStep[];
}>;

export type AdminCommand =
  | Readonly<{ type: "seen"; at: string; email: string }>
  | Readonly<{ type: "take_over"; at: string; email: string }>
  | Readonly<{ type: "leave_passive" }>
  | Readonly<{ type: "close" }>
  | Readonly<{
      type: "set_work";
      urgency: AdminUrgency;
      nextStep: string;
      deadline: string;
      note: string;
    }>
  | Readonly<{
      type: "add_action";
      id: string;
      at: string;
      email: string;
      kind: string;
      result: string;
    }>
  | Readonly<{ type: "add_step"; id: string; text: string; due: string }>
  | Readonly<{ type: "remove_step"; id: string }>
  | Readonly<{
      type: "add_volunteer";
      name: string;
      task: string;
      result: string;
    }>
  | Readonly<{
      type: "add_referral";
      id: string;
      recipient: string;
      sentOn: string;
      replyFileName: string;
    }>
  | Readonly<{
      type: "add_inspection";
      id: string;
      referralId: string;
      on: string;
      by: string;
      outcome: string;
      findings: string;
    }>;

export const initialAdminDocument = (
  situationType: string,
): AdminCaseDocument => ({
  mode:
    situationType === "cruelty" || situationType === "dead"
      ? "active"
      : "passive",
  urgency:
    situationType === "cruelty" || situationType === "dead" ? "high" : "normal",
  ownerEmail: "",
  nextStep: "",
  deadline: "",
  note: "",
  seenBy: {},
  actions: [],
  referrals: [],
  steps: [],
});

const activeOnly = (
  document: AdminCaseDocument,
): { ok: false; code: "not_allowed" } | undefined =>
  document.mode === "active" ? undefined : { ok: false, code: "not_allowed" };

export const applyAdminCommand = (
  document: AdminCaseDocument,
  command: AdminCommand,
):
  | Readonly<{ ok: true; document: AdminCaseDocument }>
  | Readonly<{ ok: false; code: "not_allowed" | "invalid" }> => {
  switch (command.type) {
    case "seen":
      return {
        ok: true,
        document: {
          ...document,
          seenBy: { ...document.seenBy, [command.email]: command.at },
        },
      };
    case "take_over":
      if (document.mode !== "passive" && document.mode !== "review") {
        return { ok: false, code: "not_allowed" };
      }
      return {
        ok: true,
        document: {
          ...document,
          mode: "active",
          ownerEmail: document.ownerEmail || command.email,
        },
      };
    case "leave_passive":
      if (document.mode !== "review") {
        return { ok: false, code: "not_allowed" };
      }
      return { ok: true, document: { ...document, mode: "passive" } };
    case "close":
      if (document.mode !== "active") {
        return { ok: false, code: "not_allowed" };
      }
      return { ok: true, document: { ...document, mode: "closed" } };
    case "set_work": {
      const blocked = activeOnly(document);
      if (blocked) {
        return blocked;
      }
      return {
        ok: true,
        document: {
          ...document,
          urgency: command.urgency,
          nextStep: command.nextStep.slice(0, 500),
          deadline: command.deadline,
          note: command.note.slice(0, 4000),
          ownerEmail: document.ownerEmail,
        },
      };
    }
    case "add_action": {
      const blocked = activeOnly(document);
      if (
        blocked ||
        command.kind.trim() === "" ||
        command.result.trim() === ""
      ) {
        return blocked ?? { ok: false, code: "invalid" };
      }
      return {
        ok: true,
        document: {
          ...document,
          ownerEmail: document.ownerEmail || command.email,
          actions: [
            ...document.actions,
            {
              id: command.id,
              kind: command.kind.trim().slice(0, 80),
              at: command.at,
              by: command.email,
              result: command.result.trim().slice(0, 2000),
            },
          ],
        },
      };
    }
    case "add_step": {
      const blocked = activeOnly(document);
      if (blocked || command.text.trim() === "") {
        return blocked ?? { ok: false, code: "invalid" };
      }
      return {
        ok: true,
        document: {
          ...document,
          steps: [
            ...document.steps,
            {
              id: command.id,
              text: command.text.trim().slice(0, 500),
              due: command.due,
              done: false,
            },
          ],
        },
      };
    }
    case "remove_step": {
      const blocked = activeOnly(document);
      if (blocked) {
        return blocked;
      }
      return {
        ok: true,
        document: {
          ...document,
          steps: document.steps.filter((step) => step.id !== command.id),
        },
      };
    }
    case "add_volunteer": {
      const blocked = activeOnly(document);
      if (blocked || command.name.trim() === "") {
        return blocked ?? { ok: false, code: "invalid" };
      }
      return {
        ok: true,
        document: {
          ...document,
          volunteer: {
            name: command.name.trim().slice(0, 200),
            task: command.task.trim().slice(0, 200),
            result: command.result.trim().slice(0, 2000),
          },
        },
      };
    }
    case "add_referral": {
      const blocked = activeOnly(document);
      if (blocked || command.recipient.trim() === "") {
        return blocked ?? { ok: false, code: "invalid" };
      }
      return {
        ok: true,
        document: {
          ...document,
          referrals: [
            ...document.referrals,
            {
              id: command.id,
              recipient: command.recipient.trim().slice(0, 200),
              sentOn: command.sentOn,
              replyFileName: command.replyFileName.trim().slice(0, 300),
              inspections: [],
            },
          ],
        },
      };
    }
    case "add_inspection": {
      const blocked = activeOnly(document);
      const referral = document.referrals.find(
        (item) => item.id === command.referralId,
      );
      if (blocked || referral === undefined || command.findings.trim() === "") {
        return blocked ?? { ok: false, code: "invalid" };
      }
      return {
        ok: true,
        document: {
          ...document,
          referrals: document.referrals.map((item) =>
            item.id === referral.id
              ? {
                  ...item,
                  inspections: [
                    ...item.inspections,
                    {
                      id: command.id,
                      on: command.on,
                      by: command.by.trim().slice(0, 200),
                      outcome: command.outcome.trim().slice(0, 80),
                      findings: command.findings.trim().slice(0, 2000),
                    },
                  ],
                }
              : item,
          ),
        },
      };
    }
  }
};
