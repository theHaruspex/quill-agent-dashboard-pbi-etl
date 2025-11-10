# Proposed `src/` Architecture: Workflows (Data-plane + Control-plane)

This proposal formalizes a `workflows/` layout that cleanly separates the data-plane (per-event ingest) from the control-plane (explicit, authenticated, bulk/replace jobs). It preserves existing services/integrations and focuses on deployability (one Lambda per workflow), observability, and least blast radius.

## Goals
- Keep ingest fast, resilient, and minimal (webhook → facts).
- Manage dimensions via secured admin entrypoints (clear + repopulate).
- Centralize SDK usage behind `src/integrations/*`.
- Strong runtime validation for external admin payloads.
- Clear separation of responsibilities and easy testability.

## Directory Tree (proposed)

```
src/
  workflows/
    ingest/
      orchestrator.ts          # current handleIngest moved here (no behavior change)
      ensure.ts                # inline ensures (e.g., upsert-if-missing DimDate)
      entrypoints/
        server.ts              # dev route: POST /webhook/:source
        lambda.ts              # API Gateway handler
    dim-agent-sync/            # control-plane
      orchestrator.ts          # clear + repopulate DimAgent from ring group 8465
      entrypoints/
        lambda.ts              # webhook/API (auth strategy to be added)
      schema.ts                # request/auth schema (optional)
    dim-metric-sync/           # control-plane
      orchestrator.ts          # validate payload, audit/version, clear + repopulate
      entrypoints/
        lambda.ts
      schema.ts                # payload + auth (Zod)
    dim-date-seed/             # control-plane (rare)
      orchestrator.ts          # seed/extend calendar range
      entrypoints/
        lambda.ts
    dim-shift-sync/            # control-plane
      orchestrator.ts          # rules → rows
      entrypoints/
        lambda.ts
      schema.ts                # rules
  config/
    config.ts
    logger.ts
  domain/
    types.ts
    mapping.ts
  adapters/
    aloware.adapter.ts
    hubspot.adapter.ts
  ingest/
    router.ts
    idempotency.ts
  services/
    ensure-dims.service.ts
    post-factevent.service.ts
  integrations/
    powerbi/
      powerbi.sdk.ts
      dataset.repo.ts
      tables.repo.ts
    idempotency/
      dynamo.sdk.ts
      ledger.repo.ts
```

## Responsibilities by File/Directory

### `src/workflows/ingest/`
- `orchestrator.ts`: Main ingest flow used by both entrypoints:
  1) Adapter (Aloware/HubSpot) → events + hints  
  2) Within-batch dedup  
  3) Gate by ring group membership (Aloware authoritative roster)  
  4) Cross-request idempotency (Dynamo ledger)  
  5) Ensure dims (minimal, per `DimHints`; typically `DimDate`)  
  6) Post facts (rate-limited sink)
- `ensure.ts`: Inline, surgical ensures (upsert-if-missing for keys referenced by current facts).
- `entrypoints/server.ts`: Dev server for `/webhook/:source` → orchestrator.
- `entrypoints/lambda.ts`: Lambda handler that builds `IngestEnvelope` and calls the orchestrator.

### `src/workflows/dim-agent-sync/` (control-plane)
- `orchestrator.ts`: Clear `DimAgent`, fetch ring group members (8465), map and insert rows. Optional: update a Dynamo-based “activeAgents set.”
- `entrypoints/lambda.ts`: Webhook/API to trigger the sync (auth hardening planned). Accepts `dryRun` in the request body for validation flows.
- `schema.ts`: Request and auth schema (HMAC/shared secret, optional).
- Validation: service supports dependency injection and dry-run mode; `npm run test:dimagent` exercises the workflow contract with mocks.

### `src/workflows/dim-metric-sync/` (control-plane)
- `orchestrator.ts`: Validate signed payload, audit+version, clear `DimMetric`, insert new monthly values.
- `entrypoints/lambda.ts`: Signed webhook/API to apply metric updates.
- `schema.ts`: Payload + auth schema (Zod).

### `src/workflows/dim-date-seed/` (control-plane)
- `orchestrator.ts`: Generate/extend calendar and push `DimDate` rows (rarely re-run).
- `entrypoints/lambda.ts`: Operator-triggered seeding.

### `src/workflows/dim-shift-sync/` (control-plane)
- `orchestrator.ts`: Translate declared rules → rows; clear and insert `DimShift`.
- `entrypoints/lambda.ts`: Signed webhook/API to apply rules.
- `schema.ts`: Rules schema.

### `src/config/`
- `config.ts`: Load `AppConfig` from `process.env` with safe `.env` bootstrap; includes Power BI, Dynamo, HubSpot, Aloware (ring group), and logging. Future control-plane auth secrets can be added here once selected.
- `logger.ts`: Structured logger with console + optional file output. Used across services/entrypoints.

### `src/domain/`
- `types.ts`: Canonical app types:
  - `IngestEnvelope`, `FactEventRow`, `DimHints`
  - Dimension models: `DimAgent`, `DimMetric`, `DimDate`, `DimShift`
  - `MetricID`: `CALLS | TEXTS | EMAILS | CASES`
- `mapping.ts`: Typed mappings/helpers (e.g., event name → `MetricID`).

### `src/schemas/admin/`
- `dimmetric.schema.ts`: Runtime validation for admin DimMetric payloads (e.g., month/version, `MetricID` enums, `defaultGoal`, `defaultYellowFloorPct`). Produces canonical rows for `DimMetric`.
- `request-auth.schema.ts`: Validate admin request headers (HMAC/API key), optional IP allowlist, timestamp/nonce checks.

### `src/adapters/`
- `aloware.adapter.ts`: Parse outbound Aloware events into `FactEventRow[]`, emit `DimHints`.
- `hubspot.adapter.ts`: Placeholder for HubSpot (deferred).

### `src/ingest/`
- `router.ts`: Normalize raw HTTP/Lambda inputs into `IngestEnvelope` (keeps transport concerns out of business logic).
- `idempotency.ts`: Within-batch dedup + `computeDedupKey`.

### `src/services/`
- `ensure-dims.service.ts`: Upsert required dimension rows referenced by current facts (typically `DimDate`; `DimAgent` ensured by admin sync or cached set; `DimMetric` driven by admin; `DimShift` pre-seeded/derived).
- `post-factevent.service.ts`: Map `FactEventRow[]` to Power BI rows and post via SDK push sink (rate-limited).

#### `src/services/admin/`
- `dimagent.sync.service.ts`: Clear `DimAgent`, fetch members via Aloware ring group (8465), map and insert rows. Optionally update a Dynamo “activeAgents set”.
- `dimmetric.sync.service.ts`: Validate signed payload, audit+version, clear `DimMetric`, insert new monthly values (DefaultGoal/YellowFloorPct).
- `dimdate.seed.service.ts`: Generate calendar window and push `DimDate` rows. Rarely re-run.
- `dimshift.sync.service.ts`: Translate declared shift rules → rows (or derived bins), clear and insert `DimShift`.

### `src/integrations/powerbi/`
- `powerbi.sdk.ts`: Construct the SDK client (AAD auth, user agent, logging, retry/rate limit).
- `dataset.repo.ts`: Dataset-level helpers (ensure/create dataset with known schema).
- `tables.repo.ts`: Table-level helpers (deleteRows, addRows) used by services.

### `src/integrations/idempotency/`
- `dynamo.sdk.ts`: DynamoDB client construction (local/remote).
- `ledger.repo.ts`: Atomic conditional write for cross-request idempotency (`checkAndMark`).

### `src/integrations/admin/`
- `admin-versions.repo.ts`: Persist last-applied version/month for admin sync idempotency (e.g., DimMetric).
- `audit.repo.ts`: Store applied payloads to S3/Dynamo with metadata for audit/rollback.

### `src/entrypoints/server/`
- `index.ts`: Dev server for `/webhook/:source` → orchestrator.
- `admin.ts` (optional): Local admin endpoints to invoke sync/seed services in dev (auth enforced).

### `src/entrypoints/lambda/`
- `ingest.handler.ts`: Ingest lambda handler (current `handler.ts`). Parses API Gateway event, builds `IngestEnvelope`, calls orchestrator.
- `admin/dimagent-sync.handler.ts`: Control-plane lambda to refresh `DimAgent`.
- `admin/dimmetric-sync.handler.ts`: Admin lambda to refresh `DimMetric` from signed payload.
- `admin/dimdate-seed.handler.ts`: Admin lambda to seed `DimDate`.
- `admin/dimshift-sync.handler.ts`: Admin lambda to apply shift rules.

### `src/index.ts`
- Orchestrator for ingest:
  1) Adapter (Aloware/HubSpot) → events + hints
  2) Within-batch dedup
  3) Gate events by ring group membership (Aloware authoritative roster)
  4) Cross-request idempotency (Dynamo ledger)
  5) Ensure dims (minimal, per `DimHints`)
  6) Post facts (rate-limited sink)

## Workflow Chains

### Ingest (existing, moved)
`entrypoint → router (build envelope) → adapter → within-batch dedup → gate by ring group → ledger check → ensure (inline DimDate) → post-factevents → done`

### Control-plane: DimAgent Sync
`admin handler/CLI → fetch ring group 8465 → map to rows → deleteRows(DimAgent) → addRows(DimAgent) → optional cache update`

### Control-plane: DimMetric Sync
`admin handler/CLI → auth + validate payload (schema) → audit + version check → deleteRows(DimMetric) → addRows(DimMetric)`

### Control-plane: DimDate Seed
`admin handler/CLI → generate calendar range → addRows(DimDate) (delete optional on re-seed)`

### Control-plane: DimShift Sync
`admin handler/CLI → rules to rows → deleteRows(DimShift) → addRows(DimShift)`

## Configuration & Security
- `.env` (already supported): Power BI, Dynamo, Aloware ring group, logging.
- Planned (control-plane): shared secret/HMAC + optional `ADMIN_IP_ALLOWLIST` once the scheme is finalized.
- Control-plane handlers will require auth and write audits + versions for idempotency/rollback.

## Observability
- Structured logs throughout services and handlers.
- Admin operations log counts, versions, durations, and target dataset/table names.
- Errors surfaced with context; SDK handles rate limits and retries.

## Extensibility Notes
- Handlers share services; services rely on repositories; repositories wrap SDKs/infra.
- Adding a new admin sync is wiring a schema + service + handler.
- Swapping SDKs or moving to Fabric RTI changes only `src/integrations/powerbi/*`.


