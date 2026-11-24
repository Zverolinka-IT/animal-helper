import { randomUUID } from "node:crypto";

import type { AdminCommand, CaseCommand } from "@animal-helper/domain";
import { applyAdminCommand } from "@animal-helper/domain";
import type { Sql } from "postgres";

import { loadAdminCases, type StoredAdminCase } from "./admin-case.js";
import { applyCommandInTransaction } from "./apply-command.js";
import { hashCommandContent, hashesEqual } from "./hash.js";
import { recordOperatorAudit } from "./operators.js";

type Failure = Readonly<{
  ok: false;
  code: "not_found" | "not_allowed" | "invalid" | "conflict";
}>;
type Outcome = Readonly<{ ok: true; case: StoredAdminCase }> | Failure;
type Mutation = Readonly<{
  commandId: string;
  expectedRevision: number;
  contentHash: Buffer;
}>;

// Lock the parent stream even when there is no workspace row yet. Lifecycle,
// erasable working data, receipt and audit all commit in this transaction.
export const executeAdminCaseCommand = async (
  sql: Sql,
  input: Readonly<{
    streamId: string;
    email: string;
    command: AdminCommand;
    now: Date;
    mutation?: Mutation;
  }>,
): Promise<Outcome> =>
  sql.begin(async (transaction) => {
    const tx = transaction as unknown as Sql;
    const { streamId, email, command, mutation } = input;
    const locked =
      await tx`select stream_id from ah.streams where stream_id = ${streamId}::uuid for update`;
    if (locked.length === 0) return { ok: false, code: "not_found" } as const;
    const current = (await loadAdminCases(tx, { streamId, limit: 1 }))[0];
    if (current === undefined) return { ok: false, code: "not_found" } as const;

    const reject = async (code: Failure["code"]): Promise<Failure> => {
      await recordOperatorAudit(tx, {
        operatorEmail: email,
        streamId,
        action: `case_${command.type}`,
        outcome: "rejected",
        errorCode: code,
      });
      return { ok: false, code };
    };

    if (mutation !== undefined) {
      const [receipt] = await tx<
        { actor_reference: string; content_hash: Buffer; stream_id: string }[]
      >`
      select actor_reference, content_hash, stream_id from ah.admin_case_commands
      where command_id = ${mutation.commandId}::uuid
    `;
      if (receipt !== undefined) {
        if (
          receipt.stream_id !== streamId ||
          receipt.actor_reference !== email ||
          !hashesEqual(receipt.content_hash, mutation.contentHash)
        )
          return reject("conflict");
        return { ok: true, case: current } as const;
      }
      if (mutation.expectedRevision !== current.revision)
        return reject("conflict");
    } else if (command.type !== "seen") {
      return reject("invalid");
    }

    const applied = applyAdminCommand(current.document, command);
    if (!applied.ok) return reject(applied.code);
    // An earlier request can wait for a newer write's lock; keep update times
    // monotonic so unread markers cannot hide that write.
    const now = new Date(
      Math.max(
        input.now.getTime(),
        current.updatedAt.getTime() + (command.type === "seen" ? 0 : 1),
      ),
    );
    const transition = async (domainCommand: CaseCommand) => {
      const [stream] = await tx<
        { current_version: number }[]
      >`select current_version from ah.streams where stream_id = ${streamId}::uuid`;
      if (stream === undefined) throw new Error("locked case disappeared");
      const result = await applyCommandInTransaction(tx, {
        commandId: randomUUID(),
        streamId,
        expectedVersion: stream.current_version,
        occurredAt: now.toISOString(),
        correlationId: mutation?.commandId ?? randomUUID(),
        actorKind: "administrator",
        actorReference: email,
        domainCommand,
        contentHash: hashCommandContent(domainCommand),
        now,
      });
      if (!result.ok)
        throw new Error(
          `admin lifecycle transition failed: ${result.error.code}`,
        );
    };
    if (
      command.type !== "seen" &&
      (applied.document.mode === "active" || command.type === "close") &&
      current.workflowState === "submitted"
    ) {
      await transition({ type: "start_review" });
    }
    if (command.type === "close") await transition({ type: "complete_case" });

    const revision = current.revision + (command.type === "seen" ? 0 : 1);
    const document =
      command.type === "seen"
        ? {
            ...applied.document,
            seenBy: { ...applied.document.seenBy, [email]: now.toISOString() },
          }
        : applied.document;
    await tx`
    insert into ah.admin_case_work (stream_id, document, revision, updated_at)
    values (${streamId}::uuid, ${tx.json(document)}, ${revision}, ${command.type === "seen" ? current.updatedAt : now})
    on conflict (stream_id) do update set
      document = excluded.document, revision = excluded.revision, updated_at = excluded.updated_at
  `;
    if (mutation !== undefined)
      await tx`
    insert into ah.admin_case_commands (command_id, stream_id, actor_reference, content_hash, committed_revision)
    values (${mutation.commandId}::uuid, ${streamId}::uuid, ${email}, ${mutation.contentHash}, ${revision})
  `;
    await recordOperatorAudit(tx, {
      operatorEmail: email,
      streamId,
      action:
        command.type === "seen" ? "case_detail_read" : `case_${command.type}`,
      outcome: "accepted",
    });
    const saved = (await loadAdminCases(tx, { streamId, limit: 1 }))[0];
    if (saved === undefined) throw new Error("updated case disappeared");
    return { ok: true, case: saved } as const;
  });
