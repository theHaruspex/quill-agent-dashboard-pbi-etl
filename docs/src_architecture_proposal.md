# Proposed `src/` Architecture: Ingest + Admin Functions

This proposal extends the current ingest workflow with parallel “admin” functions to manage dimension tables (DimAgent, DimMetric, DimDate, DimShift). It preserves the existing orchestrator and adds clearly scoped services, handlers, and schemas.

## Goals
- Keep ingest fast, resilient, and minimal (webhook → facts).
- Manage dimensions via secured admin entrypoints (clear + repopulate).
- Centralize SDK usage behind `src/integrations/*`.
- Strong runtime validation for external admin payloads.
- Clear separation of responsibilities and easy testability.

## Directory Tree (proposed)

```
src/
  config/
    config.ts
    logger.ts
  domain/
    types.ts
    mapping.ts
  schemas/
    admin/
      dimmetric.schema.ts
      request-auth.schema.ts
  adapters/
    aloware.adapter.ts
    hubspot.adapter.ts
  ingest/
    router.ts
    idempotency.ts
  services/
    ensure-dims.service.ts
    post-factevent.service.ts
    admin/
      dimagent.sync.service.ts
      dimmetric.sync.service.ts
      dimdate.seed.service.ts
      dimshift.sync.service.ts
  integrations/
    powerbi/
      powerbi.sdk.ts
      dataset.repo.ts
      tables.repo.ts
    idempotency/
      dynamo.sdk.ts
      ledger.repo.ts
    admin/
      admin-versions.repo.ts
      audit.repo.ts
  entrypoints/
    server/
      index.ts
      admin.ts                # optional local admin server for dev
    lambda/
      ingest.handler.ts       # existing ingest (can remain handler.ts)
      admin/
        dimagent-sync.handler.ts
        dimmetric-sync.handler.ts
        dimdate-seed.handler.ts
        dimshift-sync.handler.ts
  index.ts
```

## Responsibilities by File/Directory

### `src/config/`
- `config.ts`: Load `AppConfig` from `process.env` with safe `.env` bootstrap; includes Power BI, Dynamo, HubSpot, Aloware (ring group), logging, and future admin auth keys (e.g., `ADMIN_HMAC_SECRET` or `ADMIN_API_KEY`).
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
- `admin/dimagent-sync.handler.ts`: Admin lambda to refresh `DimAgent`.
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

### Ingest (existing)
`entrypoint → router (build envelope) → adapter → within-batch dedup → gate by ring group → ledger check → ensure-dims → post-factevents → done`

### Admin: DimAgent Sync
`admin handler/CLI → fetch ring group 8465 → map to rows → deleteRows(DimAgent) → addRows(DimAgent) → optional cache update`

### Admin: DimMetric Sync
`admin handler/CLI → auth + validate payload (schema) → audit + version check → deleteRows(DimMetric) → addRows(DimMetric)`

### Admin: DimDate Seed
`admin handler/CLI → generate calendar range → addRows(DimDate) (delete optional on re-seed)`

### Admin: DimShift Sync
`admin handler/CLI → rules to rows → deleteRows(DimShift) → addRows(DimShift)`

## Configuration & Security
- `.env` (already supported): Power BI, Dynamo, Aloware ring group, logging.
- New (admin): `ADMIN_HMAC_SECRET` or `ADMIN_API_KEY`; optional `ADMIN_IP_ALLOWLIST`.
- All admin handlers require auth and write audits + versions for idempotency/rollback.

## Observability
- Structured logs throughout services and handlers.
- Admin operations log counts, versions, durations, and target dataset/table names.
- Errors surfaced with context; SDK handles rate limits and retries.

## Extensibility Notes
- Handlers share services; services rely on repositories; repositories wrap SDKs/infra.
- Adding a new admin sync is wiring a schema + service + handler.
- Swapping SDKs or moving to Fabric RTI changes only `src/integrations/powerbi/*`.


