# DynamoDB Idempotency Ledger — Schema and TTL

## Purpose
Tracks webhook-level idempotency across requests. Each unique external event is recorded once via a conditional write. Retries or duplicate deliveries are detected and skipped.

## Table
- Name: `QuillIdempotencyLedger` (configurable via `DYNAMO_TABLE_NAME`)
- Primary key: `pk` (string)
- TTL attribute: `expiresAt` (number; epoch seconds)

## Item Shape
```
{
  pk: "ALOWARE:719285063",      // `${source}:${eventId}` (deterministic)
  seenAt: "2025-11-05T17:30:00Z",// ISO timestamp (server time)
  expiresAt: 1731173400,          // epoch seconds; used by Dynamo TTL
  source: "ALOWARE",              // optional, for diagnostics
  notes: "initial insert"         // optional
}
```

## Idempotency Write
- Operation: PutItem with ConditionExpression `attribute_not_exists(pk)`
- Result semantics:
  - First write → success (treat as NEW)
  - Subsequent writes with same `pk` → ConditionalCheckFailedException (treat as DUPLICATE)

## TTL Behavior
- In code: you compute and set `expiresAt = now + (DYNAMO_TTL_DAYS * 86400)` on each insert.
- In AWS: you must enable TTL on the table (one-time op) and select `expiresAt` as the TTL attribute.
  - Deletion is asynchronous (typically within 48 hours).
- In DynamoDB Local: items are not automatically deleted; simulate TTL in tests by filtering on `expiresAt` or running a local janitor.

## Key Guidance
- `pk` should uniquely identify an external event:
  - Aloware: `ALOWARE:<body.id>`
  - HubSpot: derive stable key from notification (e.g., `HUBSPOT:<objectTypeId>:<objectId>:<subscriptionType>[:<occurredAt>]`)
- Use server time for `seenAt` and TTL calculations to avoid clock skew.

## Environment
- `DYNAMO_TABLE_NAME=QuillIdempotencyLedger`
- `DYNAMO_TTL_DAYS=14`
- Optional for local:
  - `DYNAMO_ENDPOINT=http://localhost:8000`
  - `DYNAMO_REGION=us-west-2`

## Workflow Placement
1) within-batch dedup → drop duplicate `eventId`s
2) cross-request dedup (this table) → `checkAndMark(pk)`
3) ensure dims → upsert Power BI dims as needed
4) post facts → write rows to Power BI push dataset


