import {
  decodeRecordedCaseEvents,
  foldCaseEvents,
  validateEventStream,
} from "@animal-helper/domain";
import type { Queryable } from "./sql.js";

import { loadRecordedEvents } from "./events.js";
import { projectCase } from "./projections.js";

export type RebuildResult =
  | Readonly<{ ok: true; eventCount: number }>
  | Readonly<{
      ok: false;
      error: { code: "STREAM_INVALID" | "EVENT_DECODE_FAILED" };
    }>;

export const rebuildCaseProjections = async (
  sql: Queryable,
  streamId: string,
): Promise<RebuildResult> =>
  sql.begin(async (transaction) => {
    const tx = transaction as unknown as Queryable;
    const locked =
      await tx`select stream_id from ah.streams where stream_id = ${streamId}::uuid for update`;
    if (locked.length === 0) return { ok: true, eventCount: 0 };
    const recordedEvents = await loadRecordedEvents(tx, streamId);
    const streamValidation = validateEventStream(recordedEvents);

    if (!streamValidation.ok) {
      return { ok: false, error: { code: "STREAM_INVALID" } };
    }

    const decoded = decodeRecordedCaseEvents(recordedEvents);

    if (!decoded.ok) {
      return { ok: false, error: { code: "EVENT_DECODE_FAILED" } };
    }

    const state = foldCaseEvents(decoded.value);
    const createdAt = new Date(
      recordedEvents.at(0)?.occurredAt ?? new Date().toISOString(),
    );
    const updatedAt = new Date(
      recordedEvents.at(-1)?.occurredAt ?? createdAt.toISOString(),
    );

    await projectCase(tx, {
      streamId,
      state,
      createdAt,
      updatedAt,
    });

    return { ok: true, eventCount: recordedEvents.length };
  });
