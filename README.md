# Quill Agent Dashboard ETL

TypeScript service that ingests events from Aloware/HubSpot, dedupes via DynamoDB, and pushes normalized rows into Power BI Push Datasets. See `docs/` for design docs.

## Quickstart
- Install: `npm install`
- Dev server: `npm run dev`
- Build: `npm run build`

## Source code structure (what we built and why)

```
src/
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
  entrypoints/
    lambda/handler.ts
    server/index.ts
  index.ts
```

### `src/config/`
- `config.ts`: Loads runtime configuration from environment. Includes a safe, optional `.env` bootstrap (via `dotenv` if available) so root `.env` files are picked up in local/dev and lambda simulation.
- `logger.ts`: Minimal structured logger with level control (`debug|info|warn|error`). Used by other modules as needed.

### `src/domain/`
- `types.ts`: Canonical types used across the service.
  - `IngestEnvelope`: Normalized HTTP/Lambda request wrapper.
  - `FactEventRow`: Single atomic event written to Power BI.
  - `DimAgent`, `DimMetric`, `DimDate`, `DimShift`: Dimension models matching the docs’ star schema.
  - `MetricID`: `CALLS | TEXTS | EMAILS | CASES`.
  - `DimHints`: Hints emitted by adapters listing which dimension keys must exist (e.g., agent IDs, dates, metrics) before posting facts.
- `mapping.ts`: Declarative mapping helpers (e.g., map Aloware/HubSpot event types to `MetricID`).

### `src/adapters/`
- `aloware.adapter.ts`: Parses Aloware webhooks into `FactEventRow[]` (outbound-only as required).
  - Filters to outbound events (via event name or `direction === 2`).
  - Determines metric (`CALLS` vs `TEXTS`).
  - Computes `eventId` deterministically from source `body.id`.
  - Computes timezone-aware `factDateKey` (YYYY-MM-DD) using `contact.timezone` when present; falls back to UTC.
  - Emits `DimHints` for efficient dimension upserts.
- `hubspot.adapter.ts`: Present as a stub. We’ll implement later (HubSpot webhooks often require enrichment fetches before producing facts).

### `src/ingest/`
- `router.ts`: Small helper to convert a simple HTTP-like request into an `IngestEnvelope` (used by entrypoints or tests).
- `idempotency.ts`: Pure helpers for deduplication at process scope.
  - `computeDedupKey(source, event)`: Builds a ledger key.
  - `withinBatchDedup(rows)`: Drops duplicate `eventId`s inside a single request payload.

### `src/services/`
- `ensure-dims.service.ts`: Ensures required dimension rows exist in Power BI before posting facts. Currently stubbed; will use the Power BI SDK repos when wiring schemas.
- `post-factevent.service.ts`: Batches and posts `FactEventRow[]` into Power BI (stub today). We’ll map fact rows to the configured dataset/table names and call the SDK’s `postRows()` with idempotency keys.

### `src/integrations/powerbi/`
- `powerbi.sdk.ts`: Placeholder shim to isolate SDK usage. We’ll swap in calls to the vendored Power BI SDK (`sdks/power-bi-sdk`) for auth, dataset/table ops, and posting rows.
- `dataset.repo.ts`: Business-facing operations for dataset existence/creation (stub).
- `tables.repo.ts`: Table-level operations (add rows, clear rows; stub).

### `src/integrations/idempotency/`
- `dynamo.sdk.ts`: Placeholder client wrapper (configuration surface for AWS DynamoDB).
- `ledger.repo.ts`: `checkAndMark(dedupKey)` scaffold (returns `true` for now). This will perform atomic conditional writes in DynamoDB to prevent duplicates.

### `src/entrypoints/`
- `server/index.ts`: Minimal Node `http` dev server.
  - `GET /health` — health probe.
  - `POST /webhook/aloware` or `/webhook/hubspot` — routes to orchestrator with `IngestEnvelope`.
  - Loads `.env` automatically in dev.
- `lambda/handler.ts`: Lambda-style handler that parses the incoming event into an `IngestEnvelope` and calls the orchestrator. Also attempts `.env` loading when run locally.

### `src/index.ts` (orchestrator)
- `handleIngest(envelope)`: Main flow used by both entrypoints.
  1. Choose adapter (`ALOWARE` vs `HUBSPOT`).
  2. Run adapter → `events`, `dimHints`.
  3. `withinBatchDedup(events)` for process-local dedup.
  4. `ensureDims(dimHints)` to guarantee dimension rows exist in Power BI.
  5. `postFactEvents(uniqueEvents)` to write facts.
  6. Returns `{ processed, posted }` for observability.

## Running locally
- Dev server: `npm run dev`
  - Health: `GET http://localhost:3000/health`
  - Webhooks: `POST http://localhost:3000/webhook/aloware` (body can be raw Aloware payload or `{ parsedBody: { body, event } }`).

### Aloware webhook harness (verbose)
- Run samples through the current workflow with detailed logs:
  - `npm run harness:aloware -- --dir docs/aloware-webhooks --limit 25`
  - `npm run harness:aloware -- --dir "docs/aloware data" --pattern "_aloware.json" --limit 10`
- Output includes event name, direction/type, timestamps, agent, timezone, and `{ processed, posted }` per file, plus a summary.

## Environment
- Copy `env.example` to `.env` at the repo root and fill in values. The app auto-loads `.env` in local/server and lambda entrypoints.
  - Power BI: `POWERBI_TENANT_ID`, `POWERBI_CLIENT_ID`, `POWERBI_CLIENT_SECRET`, `POWERBI_WORKSPACE_ID`, `POWERBI_DATASET_ID`
  - DynamoDB: `DYNAMO_TABLE_NAME`, `DYNAMO_TTL_DAYS`
  - HubSpot (future adapter/enrichment): `HUBSPOT_PRIVATE_APP_TOKEN` (preferred) or `HUBSPOT_CLIENT_SECRET`

## Notes
- Aloware: We currently emit facts only for outbound events (requirement). Inbound events are ignored by the adapter.
- HubSpot: Adapter is deferred until requirements are finalized; reference enrichment patterns are captured in the vendored SDKs and the separate reference repo.

## ETL workflow: function chain and responsibilities

High-level chain for a single webhook request:

1) Entry (runtime-specific)
- Local dev: `src/entrypoints/server/index.ts` receives `POST /webhook/:source`
- Lambda: `src/entrypoints/lambda/handler.ts` receives API Gateway event

2) Normalize request
- Both entrypoints build an `IngestEnvelope` (source, headers, body, receivedAt). This step is trivial; the `src/ingest/router.ts` helper exists to avoid duplicating envelope-building in tests or other callers.

3) Orchestrate
- `src/index.ts` → `handleIngest(envelope)` is the orchestrator.
  - Chooses adapter: `ALOWARE` → `alowareAdapter`, `HUBSPOT` → `hubspotAdapter` (stub for now)
  - Runs adapter to produce:
    - `events: FactEventRow[]` (atomic facts to be written)
    - `dimHints: { agentIds, dates, metrics }` (keys of dimension rows that must exist)
  - Runs `withinBatchDedup(events)` to drop duplicate `eventId`s within a single webhook handling (no-op if only one event)
  - Calls `ensureDims(dimHints)` to upsert required dimension rows in Power BI (stub now; will call SDK)
  - Calls `postFactEvents(events)` to write fact rows into Power BI (stub now; will call SDK)
  - Returns `{ processed, posted }`

4) Cross-request idempotency (to be wired next)
- `src/integrations/idempotency/ledger.repo.ts` will implement `checkAndMark(dedupKey)` using DynamoDB conditional writes
- Purpose: guard against provider retries/concurrent deliveries producing duplicate facts across separate requests

Why both within-batch and cross-request dedup?
- Within-batch protects against accidental duplicates an adapter might emit inside one request
- Cross-request protects against duplicate deliveries from the source (retries, race conditions)

## Why `src/integrations/*` instead of directly using `sdks/*` everywhere?

Think of `sdks/*` as general-purpose libraries and `src/integrations/*` as this app’s boundary layer that adapts those libraries to project-specific needs.

- `sdks/power-bi-sdk`: a reusable client (auth, retries, rate limits, batching). It knows nothing about our dataset/table names or our dimension semantics.
- `src/integrations/powerbi/*`: thin, app-specific wrappers:
  - `powerbi.sdk.ts`: a shim surface to construct/configure the client and centralize options (base URL, logging, rate limits). This keeps the rest of the app decoupled from a specific SDK constructor shape and makes mocking/testing easy.
  - `dataset.repo.ts`: business-facing helpers (e.g., ensure dataset exists with our exact schema, clear dataset for re-seeding).
  - `tables.repo.ts`: table-level helpers (e.g., add rows to `FactEvent`, upsert dims) with our naming conventions.

This layering gives us:
- Isolation: if we swap SDK versions or migrate to Fabric RTI later, we change a small surface.
- Testability: repositories are easy to stub without pulling in the whole SDK.
- Cohesion: the rest of the app calls a small set of app-centric methods.

Similar rationale for idempotency (DynamoDB):
- We don’t vendor an AWS SDK in `sdks/`. Instead, `src/integrations/idempotency/*` provides a small wrapper (`dynamo.sdk.ts`) and a repository (`ledger.repo.ts`) that encapsulate our table schema and conditional-write logic. The rest of the app calls `checkAndMark(dedupKey)` without knowing AWS details.

Rule of thumb:
- `sdks/*` = reusable, external-style libraries
- `src/integrations/*` = this app’s adapter layer for those libraries (project-specific behaviors, schemas, naming)
