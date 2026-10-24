# ADR 0002: Event-sourced case aggregate

- Status: Accepted
- Date: 2026-07-29

## Context

A case moves through administrator decisions, routing, document preparation, and
external dispatch. The project needs an auditable history and robust offline
command handling, while private data must remain erasable.

## Decision

Store the case aggregate as an append-only event stream in PostgreSQL. Commands
use optimistic concurrency and unique idempotency IDs. Synchronous projections
and outbox entries commit in the same transaction as events.

Event payloads contain no direct personal data, free text, exact location, media
metadata, generated documents, or message bodies. They refer to separately
erasable private records.

The case state machine is explicit domain code, not a generic workflow engine.

## Consequences

History and retry semantics are first-class. Projection rebuilds and
event-schema evolution require discipline. Some facts disappear after private
records are purged, by design.

[ADR 0010](0010-case-personal-data-erasure.md) records the implemented purge
behavior and proposes the complete erasure, redaction and restore workflow.
